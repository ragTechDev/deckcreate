#!/usr/bin/env node
/**
 * DeckCreate — Short-form clip wizard.
 * Usage: npm run shorts:wizard
 */

import readline from 'readline';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { createHelpers } from './shared/wizard-helpers.js';
import CarouselGenerator from './carousel/CarouselGenerator.js';
import {
  replaceWithCarouselGuide, extractCarouselSegments,
  resolveFrameSource, applyViewportAndResize,
  extractFrameWithFFmpeg, resolveVideoPath,
} from './carousel/carousel-helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cwd = path.join(__dirname, '..');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

const {
  ask, askYesNo, askQuestion,
  spawnStep,
  openFile, spinner,
} = createHelpers(rl, cwd);

// ── Detection logic ─────────────────────────────────────────────────────────

async function detectExistingWork() {
  const p = (...parts) => path.join(cwd, ...parts);

  // Check for existing short clips (any directory with transcript files)
  const shortsDir = p('public', 'shorts');
  let shortClips = [];
  if (await fs.pathExists(shortsDir)) {
    const entries = await fs.readdir(shortsDir, { withFileTypes: true });
    const shortDirs = entries.filter(e => e.isDirectory());
    shortClips = await Promise.all(shortDirs.map(async (dir) => {
      const id = dir.name;
      return {
        id,
        hasDoc: await fs.pathExists(p('public', 'shorts', id, 'transcript.doc.txt')),
        hasMerged: await fs.pathExists(p('public', 'shorts', id, 'transcript.json')),
        hasPreview: await fs.pathExists(p('public', 'shorts', id, 'preview-cut.mp4')),
      };
    }));
    // Only include dirs that actually have clip content
    shortClips = shortClips.filter(c => c.hasDoc || c.hasMerged);
  }

  const hasCameraProfiles = await fs.pathExists(p('public', 'shorts', 'camera-profiles.json'));

  // Check for Path B (dedicated portrait recording) progress
  const hasShortTranscribe = await fs.pathExists(
    p('public', 'shorts', 'transcribe', 'output', 'raw', 'transcript.raw.json')
  );

  // Check for Path A source (longform transcript)
  const hasLongformTranscript = await fs.pathExists(p('public', 'edit', 'transcript.json'));

  return {
    shortClips,
    hasCameraProfiles,
    hasShortTranscribe,
    hasLongformTranscript,
  };
}

function getClipStatus(id) {
  return {
    hasDoc: fs.pathExistsSync(path.join(cwd, 'public', 'shorts', id, 'transcript.doc.txt')),
    hasMerged: fs.pathExistsSync(path.join(cwd, 'public', 'shorts', id, 'transcript.json')),
    hasPreview: fs.pathExistsSync(path.join(cwd, 'public', 'shorts', id, 'preview-cut.mp4')),
    hasCamera: fs.pathExistsSync(path.join(cwd, 'public', 'shorts', 'camera-profiles.json')),
  };
}

function formatDuration(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// ── Path A: Clip from longform ──────────────────────────────────────────────

async function runPathA() {
  // 1. Load longform transcript
  const transcriptPath = path.join(cwd, 'public', 'edit', 'transcript.json');
  const docPath = path.join(cwd, 'public', 'edit', 'transcript.doc.txt');

  let transcript;
  try {
    transcript = await fs.readJson(transcriptPath);
  } catch (err) {
    console.error(`\n  ✗ Could not load transcript: ${err.message}`);
    console.log('  Make sure the longform pipeline has run and produced public/edit/transcript.json');
    process.exit(1);
  }

  const { meta, segments } = transcript;
  const duration = meta.duration || (segments.length > 0 ? segments[segments.length - 1].end : 0);
  const speakers = [...new Set(segments.map(s => s.speaker))];

  console.log('\n  ── Longform recording ────────────────────────────────');
  console.log(`  Title:    ${meta.title || '(untitled)'}`);
  console.log(`  Duration: ${formatDuration(duration)}`);
  console.log(`  Speakers: ${speakers.join(', ')}`);
  console.log(`  Segments: ${segments.length}`);

  // 2. Assign clip ID
  const shortsDir = path.join(cwd, 'public', 'shorts');
  await fs.ensureDir(shortsDir);

  const existingIds = (await fs.readdir(shortsDir))
    .filter(d => /^short-\d+$/.test(d))
    .map(d => parseInt(d.replace('short-', '')));
  const nextId = existingIds.length > 0 ? Math.max(...existingIds) + 1 : 1;
  const defaultId = `short-${nextId}`;

  const idInput = (await askQuestion(`  Clip ID [${defaultId}]: `)).trim();
  const clipId = idInput || defaultId;

  // 3. Copy full doc for editing (cleaned for short-form)
  console.log('\n  ── Prepare clip doc ──────────────────────────────────');
  const clipDocPath = path.join(cwd, 'public', 'shorts', clipId, 'transcript.doc.txt');
  await fs.ensureDir(path.dirname(clipDocPath));

  // Read longform doc and clean it for short-form editing
  let docContent = await fs.readFile(docPath, 'utf-8');

  // Strip lines that shouldn't carry over or would conflict
  // Match with optional leading whitespace (indented cues) and word boundaries
  docContent = docContent
    .split('\n')
    .filter(line => !/^\s*>\s*CAM\b/i.test(line))
    // Note: HOOK cues are preserved for shorts — user can add them for teasers
    .filter(line => !/^\s*>\s*START\b/i.test(line))  // Remove any existing START
    .filter(line => !/^\s*>\s*END\b/i.test(line))    // Remove any existing END
    .join('\n');

  await fs.writeFile(clipDocPath, docContent);
  console.log(`  ✓ Copied cleaned doc to public/shorts/${clipId}/transcript.doc.txt`);

  // 4. Sequential editing guide
  console.log('\n  ── Edit clip doc ─────────────────────────────────────');
  console.log(`  File: ${clipDocPath}`);
  openFile(clipDocPath);
  console.log('\n  Work through each step below. Save the file after each, then press Enter.\n');

  const multiSpeakerShort = speakers.length > 1;

  // 1/6 — Speaker names
  console.log('  ─── 1 / 6  Speaker names ─────────────────────────────');
  if (multiSpeakerShort) {
    console.log('  Review the # SPEAKERS section at the top of the doc.');
    console.log('  Confirm each label is the correct display name. To rename:');
    console.log('    Natasha: Natasha Lum');
  } else {
    console.log('  Single speaker — nothing to do here. (skip)');
  }
  await ask('  Press Enter to continue...');

  // 2/6 — Segment speaker assignments
  console.log('\n  ─── 2 / 6  Segment speaker assignments ───────────────');
  if (multiSpeakerShort) {
    console.log('  Scroll through every segment and verify the speaker label.');
    console.log('  Reassign a whole segment:');
    console.log('    [10] text...');
    console.log('    > SPEAKER Alice');
    console.log('  Split a segment where two people spoke:');
    console.log('    [11] I\'m Victoria, solutions engineer.');
    console.log('    > SPEAKER Victoria  at="I\'m"');
  } else {
    console.log('  Single speaker — nothing to do here. (skip)');
  }
  await ask('  Press Enter to continue...');

  // 3/6 — Typos and cuts
  console.log('\n  ─── 3 / 6  Fix typos & cuts ──────────────────────────');
  console.log('  Edit any misheard or misspelled words directly in the doc.');
  console.log('  Wrap filler words in {} to cut them:  {um}  {you know}');
  console.log('  Cut a whole segment by prefixing its ID with -:');
  console.log('    -[12] this segment will be removed...');
  await ask('  Press Enter to continue...');

  // 4/6 — START and END (required — validated below)
  console.log('\n  ─── 4 / 6  Define clip range  (> START and > END) ───');
  console.log('  Everything OUTSIDE > START .. > END is excluded from the clip.');
  console.log('');
  console.log('    > START');
  console.log('    [5] First segment to include...');
  console.log('    [12] Last segment to include...');
  console.log('    > END');
  console.log('');
  console.log('  For a phrase-precise trim, add the phrase in quotes:');
  console.log('    > START "we need"');
  console.log('    > END   "for today"');

  let hasStartEnd = false;
  while (!hasStartEnd) {
    await ask('  Press Enter when > START and > END are placed...');

    const editedContent = await fs.readFile(clipDocPath, 'utf-8');
    const hasStart = /^>\s*START\b/im.test(editedContent);
    const hasEnd = /^>\s*END\b/im.test(editedContent);

    if (hasStart && hasEnd) {
      hasStartEnd = true;
    } else {
      console.log('\n  ⚠ Missing required markers:');
      if (!hasStart) console.log('    - "> START" not found — add it before the first segment to include');
      if (!hasEnd) console.log('    - "> END" not found — add it after the last segment to include');
      console.log('  Please add the missing markers and save.\n');
      openFile(clipDocPath);
    }
  }

  // 5/6 — HOOK
  console.log('\n  ─── 5 / 6  Hook teaser  (> HOOK) ────────────────────');
  console.log('  Mark a compelling moment as the hook — it plays first as a teaser,');
  console.log('  then again in its natural position within the clip.');
  console.log('');
  console.log('  Whole segment:');
  console.log('    [8] This is the key insight...');
  console.log('    > HOOK');
  console.log('');
  console.log('  Specific phrase only:');
  console.log('    [8] This is the key insight...');
  console.log('    > HOOK "key insight"');
  console.log('');
  console.log('  Skip if no hook is needed for this clip.');
  await ask('  Press Enter to continue...');

  // 6/6 — Image / GIF overlays
  console.log('\n  ─── 6 / 6  Image / GIF overlays ─────────────────────');
  console.log('  Add visual overlays for links, diagrams, or memes:');
  console.log('');
  console.log('    > ImageWindow  at="word"  duration=8  src="https://..."  title="Title"');
  console.log('    > GifWindow    at="word"  duration=8  src="https://..."  title="Title"');
  console.log('');
  console.log('  src= can be a URL or a /public-relative path.');
  console.log('  Skip if no overlays are needed.');
  await ask('  Press Enter when all edits are done...');

  // 6. Merge doc
  console.log('\n  ── Merge clip doc ────────────────────────────────────');
  const cutPauses = await askYesNo('  Auto-cut silences longer than 0.5 s?', false);

  const mergeArgs = [
    'run', 'shorts:merge-doc', '--',
    '--doc', `public/shorts/${clipId}/transcript.doc.txt`,
    '--parent-transcript', 'public/edit/transcript.json',
    '--id', clipId,
    ...(cutPauses ? ['--cut-pauses'] : []),
  ];

  try {
    await spawnStep('npm', mergeArgs);
    console.log(`  ✓ Merged to public/shorts/${clipId}/transcript.json`);
  } catch (err) {
    console.error(`  ✗ Merge failed: ${err.message}`);
    process.exit(1);
  }

  // 7. Portrait camera setup
  await runCameraSetup();

  // 8. Cut preview (optional)
  const doPreview = await askYesNo('\n  Generate portrait cut preview?', false);
  if (doPreview) {
    await runCutPreview(clipId);
  }

  // 9. Launch Remotion (optional)
  const doRemotion = await askYesNo('\n  Launch Remotion studio with this short?', false);
  if (doRemotion) {
    console.log('\n  ── Remotion studio ───────────────────────────────────');
    console.log('  Select the "ShortFormClip" composition from the dropdown.');
    console.log('  Use Preview mode to review the composition with all overlays.');
    console.log('  When the clip looks good, click Render in Remotion studio to export.');
    console.log('');
    console.log('  If you need more edits after previewing — no need to restart the wizard:');
    console.log(`    1. Edit public/shorts/${clipId}/transcript.doc.txt`);
    console.log(`    2. npm run shorts:merge-doc -- --doc public/shorts/${clipId}/transcript.doc.txt --parent-transcript public/edit/transcript.json --id ${clipId}`);
    console.log('    3. npm run remotion:studio');
    console.log('');
    await spawnStep('npm', ['run', 'remotion:studio']);
  }

  // 10. Optional carousel from the same segment
  const doCarousel = await askYesNo('\n  Create a carousel from this short segment?', false);
  if (doCarousel) {
    await createCarouselFromShort(clipId);
  }

  console.log('\n  ✓ Clip workflow complete!\n');
}

// ── Carousel from short ─────────────────────────────────────────────────────

/**
 * Generate carousel slides from a completed short clip.
 * Uses the short's merged transcript.json for timestamps and
 * camera-profiles.json (longform) for per-speaker angle resolution.
 */
async function createCarouselFromShort(clipId) {
  console.log('\n  ── Create carousel from short ────────────────────────');

  const shortTranscriptPath = path.join(cwd, 'public', 'shorts', clipId, 'transcript.json');
  const shortDocPath = path.join(cwd, 'public', 'shorts', clipId, 'transcript.doc.txt');

  if (!await fs.pathExists(shortTranscriptPath)) {
    console.log('  ✗ Merged transcript not found — run "Merge clip doc" first.');
    return;
  }

  // Assign carousel ID (default: next carousel-N)
  const carouselDir = path.join(cwd, 'public', 'carousel');
  await fs.ensureDir(carouselDir);
  const existingIds = (await fs.readdir(carouselDir))
    .filter(d => /^carousel-\d+$/.test(d))
    .map(d => parseInt(d.replace('carousel-', '')));
  const nextId = existingIds.length > 0 ? Math.max(...existingIds) + 1 : 1;
  const defaultId = `carousel-${nextId}`;
  const idInput = (await askQuestion(`  Carousel ID [${defaultId}]: `)).trim();
  const carouselId = idInput || defaultId;

  const carouselDocPath = path.join(cwd, 'public', 'carousel', carouselId, 'transcript.doc.txt');
  const carouselJsonPath = path.join(cwd, 'public', 'carousel', carouselId, 'transcript.json');
  await fs.ensureDir(path.dirname(carouselDocPath));

  // Copy the short's merged transcript.json (provides segment timestamps)
  await fs.copy(shortTranscriptPath, carouselJsonPath);

  // Strip Remotion directives from the short's doc and prepend carousel guide
  const shortDocContent = await fs.readFile(shortDocPath, 'utf-8');
  await fs.writeFile(carouselDocPath, replaceWithCarouselGuide(shortDocContent));
  console.log(`  ✓ Created public/carousel/${carouselId}/transcript.doc.txt`);

  openFile(carouselDocPath);
  console.log('\n  Mark carousel slides with > CAROUSEL START / > CAROUSEL END.');
  console.log('  Each consecutive pair of segments becomes one slide (top + bottom frame).');
  await ask('  Press Enter when done editing...');

  // Parse the marked segments
  const editedContent = await fs.readFile(carouselDocPath, 'utf-8');
  const carouselSegments = await extractCarouselSegments(editedContent, carouselJsonPath);

  if (carouselSegments.length === 0) {
    console.log('  ✗ No carousel segments found. Add > CAROUSEL START / > CAROUSEL END markers and retry.');
    return;
  }
  console.log(`  ✓ ${carouselSegments.length} slide(s) configured`);

  // Build slide objects with speaker labels for angle resolution
  const slides = carouselSegments.map(pair => ({
    topTimestamp: Math.floor((pair.top.start + pair.top.end) / 2 || pair.top.start || 0),
    bottomTimestamp: Math.floor((pair.bottom.start + pair.bottom.end) / 2 || pair.bottom.start || 0),
    topText: pair.top.text,
    bottomText: pair.bottom.text,
    topSpeaker: pair.top.speaker || null,
    bottomSpeaker: pair.bottom.speaker || null,
  }));

  // Prefer longform camera-profiles.json for multi-angle resolution
  const profilesPath = path.join(cwd, 'public', 'camera-profiles.json');
  const hasProfiles = await fs.pathExists(profilesPath);
  let cameraProfiles = null;
  let localVideoPath = null;

  if (hasProfiles) {
    cameraProfiles = await fs.readJson(profilesPath);
    const angleNames = Object.keys(cameraProfiles.angles || {});
    console.log(`\n  Using camera-profiles.json (${angleNames.length} angle(s): ${angleNames.join(', ')})`);
  } else {
    const syncDir = path.join(cwd, 'public', 'sync', 'output');
    let synced = [];
    if (await fs.pathExists(syncDir)) {
      const files = await fs.readdir(syncDir);
      synced = files.filter(f => f.startsWith('synced-output-') && f.endsWith('.mp4'));
    }
    if (synced.length === 0) {
      console.log('  ✗ No camera-profiles.json found and no synced videos in public/sync/output/.');
      return;
    }
    if (synced.length === 1) {
      localVideoPath = path.join(cwd, 'public', 'sync', 'output', synced[0]);
      console.log(`  Using: ${synced[0]}`);
    } else {
      console.log('  Synced videos:');
      synced.forEach((v, i) => console.log(`    ${i + 1}. ${v}`));
      const choice = (await ask('  Select: ')).trim() || '1';
      const idx = Math.max(0, Math.min(synced.length - 1, parseInt(choice) - 1 || 0));
      localVideoPath = path.join(cwd, 'public', 'sync', 'output', synced[idx]);
    }
  }

  // Save config so carousel-wizard can regenerate later
  const configPath = path.join(cwd, 'public', 'carousel', carouselId, 'carousel-config.json');
  await fs.writeJson(configPath, {
    name: `${carouselId}-carousel`,
    videoId: null,
    localVideoPath,
    cameraProfilesPath: hasProfiles ? profilesPath : null,
    slides,
    showLogo: true,
  }, { spaces: 2 });

  const doGenerate = await askYesNo('\n  Generate carousel images now?', true);
  if (!doGenerate) {
    console.log(`  Config saved to ${configPath}.`);
    console.log('  Run npm run carousel:wizard to generate later.');
    return;
  }

  const outputDir = path.join(cwd, 'public', 'output', `${carouselId}-carousel`);
  await fs.ensureDir(outputDir);

  const generator = new CarouselGenerator({
    name: `${carouselId}-carousel`, slides, showLogo: true, returnBase64: false,
  });
  generator.outputDir = outputDir;

  try {
    await generator.init();
    await generateCarouselSlides(generator, slides, outputDir, carouselId, cameraProfiles, localVideoPath);
    console.log(`\n  ✅ Carousel complete! Output: ${outputDir}`);
    console.log('  Run npm run carousel:wizard to add a CTA slide or compile to PDF.');
  } catch (err) {
    console.error(`\n  ✗ Carousel generation failed: ${err.message}`);
  } finally {
    await generator.close();
  }
}

/**
 * Core slide generation loop: extract frames, apply viewport crop, composite.
 * Does not generate a CTA slide — use carousel:wizard for that.
 */
async function generateCarouselSlides(generator, slides, outputDir, carouselId, cameraProfiles, fallbackVideoPath) {
  const { default: sharp } = await import('sharp');
  const width = 1080, height = 1080, halfHeight = 540;
  const fontData = await generator.loadNunitoFont();

  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i];
    const topSrc = resolveFrameSource(cameraProfiles, slide.topSpeaker, slide.topTimestamp, fallbackVideoPath, cwd);
    const bottomSrc = resolveFrameSource(cameraProfiles, slide.bottomSpeaker, slide.bottomTimestamp, fallbackVideoPath, cwd);

    if (!topSrc.videoPath || !bottomSrc.videoPath) {
      throw new Error(`Slide ${i + 1}: no video source — check camera-profiles.json`);
    }

    console.log(`\n  Slide ${i + 1}/${slides.length}:`);
    console.log(`    Top:    ${slide.topTimestamp}s${slide.topSpeaker ? ` (${slide.topSpeaker})` : ''}${topSrc.angleName ? ` → ${topSrc.angleName}` : ''}`);
    console.log(`    Bottom: ${slide.bottomTimestamp}s${slide.bottomSpeaker ? ` (${slide.bottomSpeaker})` : ''}${bottomSrc.angleName ? ` → ${bottomSrc.angleName}` : ''}`);

    const spin = spinner('Extracting frames...');
    try {
      const topFramePath = path.join(outputDir, `frame-${i}-top.png`);
      const bottomFramePath = path.join(outputDir, `frame-${i}-bottom.png`);

      await extractFrameWithFFmpeg(resolveVideoPath(topSrc.videoPath), topSrc.effectiveTimestamp, topFramePath, cwd);
      await extractFrameWithFFmpeg(resolveVideoPath(bottomSrc.videoPath), bottomSrc.effectiveTimestamp, bottomFramePath, cwd);

      spin.update('Compositing...');

      const topFrame = await applyViewportAndResize(sharp, topFramePath, topSrc.viewport, topSrc.srcWidth, topSrc.srcHeight, width, halfHeight);
      const bottomFrame = await applyViewportAndResize(sharp, bottomFramePath, bottomSrc.viewport, bottomSrc.srcWidth, bottomSrc.srcHeight, width, halfHeight);

      const svgOverlay = generator.generateTextOverlaySVG(width, height, slide.topText, slide.bottomText, fontData, null);

      const composited = await sharp({
        create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
      }).composite([
        { input: topFrame, top: 0, left: 0 },
        { input: bottomFrame, top: halfHeight, left: 0 },
        { input: Buffer.from(svgOverlay), top: 0, left: 0 },
      ]).png().toBuffer();

      await fs.writeFile(path.join(outputDir, `slide-${i + 1}.png`), composited);
      await fs.remove(topFramePath);
      await fs.remove(bottomFramePath);
      spin.stop(`✓ slide-${i + 1}.png`);
    } catch (err) {
      spin.stop(`✗ Failed: ${err.message}`);
      throw err;
    }
  }
}

// ── Shared per-clip steps ───────────────────────────────────────────────────

async function runCameraSetup() {
  const cameraProfilesPath = path.join(cwd, 'public', 'shorts', 'camera-profiles.json');
  const hasExisting = await fs.pathExists(cameraProfilesPath);

  console.log('\n  ── Portrait camera setup ─────────────────────────────');

  if (hasExisting) {
    const redo = await askYesNo('  Using existing portrait camera profiles. Redo camera setup?', false);
    if (!redo) {
      console.log('  (Using existing camera profiles)');
      return;
    }
  }

  const sourceProfiles = path.join(cwd, 'public', 'camera', 'camera-profiles.json');
  if (!(await fs.pathExists(sourceProfiles))) {
    console.log('  ⚠ No landscape camera profiles found at public/camera/camera-profiles.json');
    console.log('  Run the longform wizard camera setup first, or use Path B for a fresh portrait recording.');
    return;
  }

  try {
    // Use spawn directly with stdio: 'inherit' so the interactive prompt works
    const { spawn } = await import('child_process');
    await new Promise((resolve, reject) => {
      const proc = spawn('npm', ['run', 'shorts:camera-setup', '--', '--source', sourceProfiles], {
        stdio: 'inherit',
        cwd,
        shell: process.platform === 'win32',
      });
      proc.on('close', code => code === 0 ? resolve() : reject(new Error(`Camera setup exited ${code}`)));
      proc.on('error', e => reject(e));
    });
    console.log('  ✓ Portrait camera profiles created');
  } catch (err) {
    console.error(`  ✗ Camera setup failed: ${err.message}`);
  }
}

async function runCutPreview(clipId) {
  console.log('\n  ── Generate cut preview ──────────────────────────────');
  console.log('  (This would generate a portrait preview MP4)');
  console.log(`  Output: public/shorts/${clipId}/preview-cut.mp4`);
  // TODO: Implement cut preview for portrait mode
  console.log('  ⚠ Cut preview for portrait mode not yet implemented');
}

// ── Existing clips menu ─────────────────────────────────────────────────────

function getStatusSymbol(status) {
  if (status.hasPreview) return '✓';
  if (status.hasCamera) return '●';
  if (status.hasMerged) return '◑';
  if (status.hasDoc) return '○';
  return '·';
}

async function showExistingClips(clips, sourceType) {
  console.log('\n  Existing short-form clips:');
  clips.forEach(clip => {
    const status = getClipStatus(clip.id);
    const symbol = getStatusSymbol(status);
    const info = clip.id;
    console.log(`    ${symbol}  ${info}`);
  });

  console.log('\n  Options:');
  console.log('  1. Create a new clip' + (sourceType === 'longform' ? ' from the same source' : ''));
  console.log('  2. Continue / redo an existing clip');
  if (sourceType !== 'longform') {
    console.log('  3. Start fresh (new recording entirely)');
  }

  const choice = (await ask('  > [1] ')).trim() || '1';

  if (choice === '1') {
    return { action: 'new' };
  } else if (choice === '2') {
    console.log('\n  Select clip to continue:');
    clips.forEach((clip, i) => {
      const status = getClipStatus(clip.id);
      const symbol = getStatusSymbol(status);
      console.log(`  ${i + 1}. ${symbol} ${clip.id}`);
    });
    const clipChoice = (await ask('  > ')).trim();
    const idx = parseInt(clipChoice) - 1;
    if (idx >= 0 && idx < clips.length) {
      return { action: 'continue', clipId: clips[idx].id };
    }
    console.log('  Invalid choice');
    return { action: 'menu' };
  } else if (choice === '3' && sourceType !== 'longform') {
    return { action: 'fresh' };
  }

  return { action: 'menu' };
}

async function runContinueClip(clipId) {
  const status = getClipStatus(clipId);

  console.log(`\n  ── Continue ${clipId} ────────────────────────────────`);

  // Determine available redo steps based on current status
  console.log('\n  Redo steps:');
  let stepNum = 1;
  const steps = [];

  steps.push({ id: 'extract', label: 'Re-extract doc from longform', always: true });
  console.log(`  ${stepNum++}. Re-extract doc from longform`);

  steps.push({ id: 'edit', label: 'Re-open doc for editing', always: true });
  console.log(`  ${stepNum++}. Re-open doc for editing`);

  if (status.hasMerged) {
    steps.push({ id: 'merge', label: 'Re-merge doc', always: false });
    console.log(`  ${stepNum++}. Re-merge doc`);
  }

  steps.push({ id: 'camera', label: 'Redo portrait camera', always: true });
  console.log(`  ${stepNum++}. Redo portrait camera (shared — affects all clips)`);

  if (status.hasMerged) {
    steps.push({ id: 'preview', label: 'Re-generate cut preview', always: false });
    console.log(`  ${stepNum++}. Re-generate cut preview`);
  }

  steps.push({ id: 'remotion', label: 'Relaunch Remotion', always: true });
  console.log(`  ${stepNum++}. Relaunch Remotion`);

  const choice = (await ask('  > ')).trim();
  const stepIdx = parseInt(choice) - 1;

  if (stepIdx < 0 || stepIdx >= steps.length) {
    console.log('  Invalid choice');
    return;
  }

  const step = steps[stepIdx];

  switch (step.id) {
    case 'extract':
      // Re-run Path A from the beginning for this clip
      await runPathA();
      break;
    case 'edit':
      const docPath = path.join(cwd, 'public', 'shorts', clipId, 'transcript.doc.txt');
      openFile(docPath);
      await ask('  Press Enter when done editing...');
      break;
    case 'merge':
      const cutPauses = await askYesNo('  Auto-cut silences longer than 0.5 s?', false);
      try {
        await spawnStep('npm', [
          'run', 'shorts:merge-doc', '--',
          '--doc', `public/shorts/${clipId}/transcript.doc.txt`,
          '--parent-transcript', 'public/edit/transcript.json',
          '--id', clipId,
          ...(cutPauses ? ['--cut-pauses'] : []),
        ]);
        console.log('  ✓ Merged successfully');
      } catch (err) {
        console.error(`  ✗ Merge failed: ${err.message}`);
      }
      break;
    case 'camera':
      await runCameraSetup();
      break;
    case 'preview':
      await runCutPreview(clipId);
      break;
    case 'remotion':
      console.log('\n  → Launching Remotion studio...');
      console.log('  Select the "ShortFormClip" composition from the dropdown.');
      await spawnStep('npm', ['run', 'remotion:studio']);
      break;
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const fromLongform = args.includes('--from-longform');

  console.log('\n  DeckCreate — Short-form Clip Wizard');
  console.log('  ───────────────────────────────────\n');

  // Detect existing work
  const existing = await detectExistingWork();

  // If launched from longform wizard, jump straight to Path A
  if (fromLongform) {
    await runPathA();
    rl.close();
    return;
  }

  // Determine startup case
  const hasShorts = existing.shortClips.length > 0;
  const hasShortTranscribe = existing.hasShortTranscribe;

  // Case 3: Dedicated recording in progress
  if (hasShortTranscribe && !hasShorts) {
    console.log('  Found dedicated portrait recording in progress.');
    console.log('  (Path B resume not yet implemented — please continue manually)');
    console.log('\n  Transcribed audio found at:');
    console.log('    public/shorts/transcribe/output/raw/transcript.raw.json');
    rl.close();
    return;
  }

  // Case 2: Existing shorts — show list and options
  if (hasShorts) {
    const sourceType = existing.hasLongformTranscript ? 'longform' : 'dedicated';
    const action = await showExistingClips(existing.shortClips, sourceType);

    if (action.action === 'new') {
      if (existing.hasLongformTranscript) {
        const confirmNew = await askYesNo('  Create a new clip from the longform recording?', true);
        if (confirmNew) {
          await runPathA();
        }
      } else {
        console.log('  ⚠ Creating new clips from dedicated recording not yet implemented');
      }
    } else if (action.action === 'continue') {
      await runContinueClip(action.clipId);
    } else if (action.action === 'fresh') {
      console.log('  Starting fresh (Path B not yet implemented)');
    }

    rl.close();
    return;
  }

  // Case 1: No existing shorts
  console.log('  No existing short-form clips found.');

  if (existing.hasLongformTranscript) {
    const useLongform = await askYesNo('  Found longform transcript. Clip a short from it?', true);
    if (useLongform) {
      await runPathA();
      rl.close();
      return;
    }

    const startFresh = await askYesNo('  Start a new dedicated portrait recording?', false);
    if (startFresh) {
      console.log('  (Path B — dedicated portrait recording — not yet implemented)');
      console.log('  Place portrait video/audio files in public/shorts/input/ and run the sync/transcribe pipeline manually.');
    }
  } else {
    console.log('  No longform transcript found.');
    console.log('  (Path B — dedicated portrait recording — not yet implemented)');
    console.log('  For now, please run the longform wizard first to create a recording,');
    console.log('  or manually place portrait files in public/shorts/input/');
  }

  rl.close();
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
