#!/usr/bin/env node
/**
 * DeckCreate — Carousel Generation Wizard
 * Usage: npm run carousel:wizard
 *
 * Generates social media carousels from transcript.doc.txt files.
 * Follows the pattern of shorts-wizard: creates dedicated folder in public/carousel/
 */

import readline from 'readline';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { createHelpers } from '../shared/wizard-helpers.js';
import { detectHDR, HDR_TONEMAP_VF, SDR_FORMAT_VF } from '../shared/hdr-detect.js';
import CarouselGenerator from './CarouselGenerator.js';
import CaptionExtractor from './CaptionExtractor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cwd = path.join(__dirname, '..', '..');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

const {
  ask, confirm, askYesNo, askQuestion,
  spawnStep, openFile, findFileIn,
  progressBar, spinner,
} = createHelpers(rl, cwd);

// ─── Detection Logic ───────────────────────────────────────────────────────

async function detectExistingWork() {
  const p = (...parts) => path.join(cwd, ...parts);

  // Check for existing carousels
  const carouselDir = p('public', 'carousel');
  let carousels = [];
  if (await fs.pathExists(carouselDir)) {
    const entries = await fs.readdir(carouselDir, { withFileTypes: true });
    const carouselDirs = entries.filter(e => e.isDirectory());
    carousels = await Promise.all(carouselDirs.map(async (dir) => {
      const id = dir.name;
      return {
        id,
        hasDoc: await fs.pathExists(p('public', 'carousel', id, 'transcript.doc.txt')),
        hasConfig: await fs.pathExists(p('public', 'carousel', id, 'carousel-config.json')),
        hasOutput: await fs.pathExists(p('public', 'output', `${id}-carousel`)),
      };
    }));
    // Only include dirs that actually have carousel content
    carousels = carousels.filter(c => c.hasDoc || c.hasConfig);
  }

  // Check for longform transcript (source for carousels)
  const hasLongformTranscript = await fs.pathExists(p('public', 'edit', 'transcript.json'));
  const hasLongformDoc = await fs.pathExists(p('public', 'edit', 'transcript.doc.txt'));

  return {
    carousels,
    hasLongformTranscript,
    hasLongformDoc,
  };
}

function getCarouselStatus(id) {
  return {
    hasDoc: fs.pathExistsSync(path.join(cwd, 'public', 'carousel', id, 'transcript.doc.txt')),
    hasConfig: fs.pathExistsSync(path.join(cwd, 'public', 'carousel', id, 'carousel-config.json')),
    hasOutput: fs.pathExistsSync(path.join(cwd, 'public', 'output', `${id}-carousel`)),
  };
}

function formatDuration(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// ─── Path A: Create carousel from longform ───────────────────────────────────

async function runPathA(fromLongform = false) {
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

  // 2. Assign carousel ID
  const carouselDir = path.join(cwd, 'public', 'carousel');
  await fs.ensureDir(carouselDir);

  const existingIds = (await fs.readdir(carouselDir))
    .filter(d => /^carousel-\d+$/.test(d))
    .map(d => parseInt(d.replace('carousel-', '')));
  const nextId = existingIds.length > 0 ? Math.max(...existingIds) + 1 : 1;
  const defaultId = `carousel-${nextId}`;

  const idInput = (await askQuestion(`  Carousel ID [${defaultId}]: `)).trim();
  const carouselId = idInput || defaultId;

  // 3. Create carousel folder and copy transcript
  console.log('\n  ── Prepare carousel folder ───────────────────────────');
  const carouselDocPath = path.join(cwd, 'public', 'carousel', carouselId, 'transcript.doc.txt');
  const carouselJsonPath = path.join(cwd, 'public', 'carousel', carouselId, 'transcript.json');
  await fs.ensureDir(path.dirname(carouselDocPath));

  // Copy the full doc for editing
  let docContent = await fs.readFile(docPath, 'utf-8');
  await fs.writeFile(carouselDocPath, docContent);
  console.log(`  ✓ Copied transcript.doc.txt to public/carousel/${carouselId}/`);

  // Also copy transcript.json for timestamp reference
  await fs.copy(transcriptPath, carouselJsonPath);
  console.log(`  ✓ Copied transcript.json to public/carousel/${carouselId}/`);

  // 4. Detect synced videos for reference
  const syncOutputDir = path.join(cwd, 'public', 'sync', 'output');
  let syncedVideos = [];
  if (await fs.pathExists(syncOutputDir)) {
    const files = await fs.readdir(syncOutputDir);
    syncedVideos = files.filter(f => f.startsWith('synced-output-') && f.endsWith('.mp4'));
    if (syncedVideos.length > 0) {
      console.log(`\n  Found synced videos:`);
      syncedVideos.forEach(v => console.log(`    - ${v}`));
    }
  }

  // 5. Show instructions for carousel creation
  console.log('\n  ── Carousel creation guide ──────────────────────────');
  console.log('  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  console.log('  ▶ MARK SLIDES with CAROUSEL directive:');
  console.log('');
  console.log('    Mark segments to include in carousel:');
  console.log('      [5] This segment will be in the carousel...');
  console.log('      > CAROUSEL');
  console.log('');
  console.log('    For a specific range:');
  console.log('      > CAROUSEL START');
  console.log('      [8] First carousel slide segment...');
  console.log('      [12] Last carousel slide segment...');
  console.log('      > CAROUSEL END');
  console.log('');
  console.log('  ▶ HOOK segments for carousel highlights:');
  console.log('      [3] {Key insight for first slide}...');
  console.log('      > HOOK');
  console.log('');
  console.log('  ▶ WORD-LEVEL CUTS (content to exclude):');
  console.log('      [5] Remove these {um} {you know} filler words');
  console.log('');
  console.log('  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  openFile(carouselDocPath);

  // 6. Edit doc
  console.log('\n  ── Edit carousel doc ─────────────────────────────────');
  console.log('  The doc is open. Now you:');
  console.log('    1. Add "> CAROUSEL" before segments to include (or use range)');
  console.log('    2. Optionally mark "> HOOK" for key highlight slides');
  console.log('    3. Add {cuts} to clean up filler words');
  console.log('');
  await ask('  Press Enter when done editing...');

  // 7. Load the edited doc and extract carousel segments
  console.log('\n  ── Extract carousel segments ─────────────────────────');
  const editedContent = await fs.readFile(carouselDocPath, 'utf-8');
  const carouselSegments = await extractCarouselSegments(editedContent, carouselJsonPath);

  if (carouselSegments.length === 0) {
    console.log('  No segments marked for carousel. Using first 6 non-cut segments...');
    const visibleSegments = segments.filter(s => !s.cut).slice(0, 12);
    for (let i = 0; i < visibleSegments.length; i += 2) {
      if (visibleSegments[i + 1]) {
        carouselSegments.push({
          top: visibleSegments[i],
          bottom: visibleSegments[i + 1],
        });
      }
    }
  }

  console.log(`  ✓ ${carouselSegments.length} slide(s) configured`);

  // 8. Configure video source
  console.log('\n  ── Video source for frames ───────────────────────────');
  console.log('    1. YouTube video');
  console.log('    2. Local synced video');
  const sourceChoice = (await ask('  > [1]: ')).trim() || '1';
  const useYouTube = sourceChoice !== '2';

  let videoId = null;
  let localVideoPath = null;

  if (useYouTube) {
    videoId = await askQuestion('  YouTube video ID: ');
    if (!videoId) {
      console.error('  ✗ Video ID required');
      process.exit(1);
    }
  } else {
    if (syncedVideos.length === 1) {
      localVideoPath = path.join(syncOutputDir, syncedVideos[0]);
      console.log(`  Using: ${syncedVideos[0]}`);
    } else if (syncedVideos.length > 1) {
      console.log('  Available synced videos:');
      syncedVideos.forEach((v, i) => console.log(`    ${i + 1}. ${v}`));
      const choice = (await ask('  Select: ')).trim() || '1';
      const idx = Math.max(0, Math.min(syncedVideos.length - 1, parseInt(choice) - 1 || 0));
      localVideoPath = path.join(syncOutputDir, syncedVideos[idx]);
    } else {
      console.log('  No synced videos found. Place video in input/video/');
      const inputVideoDir = path.join(cwd, 'input', 'video');
      await fs.ensureDir(inputVideoDir);
      await ask('  Press Enter when video is ready...');
      const videoExts = ['.mp4', '.mov', '.mkv'];
      const found = await findFileIn(inputVideoDir, videoExts);
      if (!found) {
        console.error('  ✗ No video found');
        process.exit(1);
      }
      localVideoPath = found;
    }
  }

  // 8. Build slides and save config
  console.log('\n  ── Build carousel configuration ─────────────────────');

  const slides = carouselSegments.map((pair, i) => ({
    // Use middle of segment for better visual-text alignment
    // Note: transcript timestamps are already in raw video time
    topTimestamp: Math.floor((pair.top.start + pair.top.end) / 2 || pair.top.start || 0),
    bottomTimestamp: Math.floor((pair.bottom.start + pair.bottom.end) / 2 || pair.bottom.start || 0),
    topText: pair.top.text,
    bottomText: pair.bottom.text,
  }));

  const configPath = path.join(cwd, 'public', 'carousel', carouselId, 'carousel-config.json');
  const config = {
    name: `${carouselId}-carousel`,
    videoId: videoId,
    localVideoPath: localVideoPath,
    slides: slides,
    showLogo: true,
  };
  await fs.writeJson(configPath, config, { spaces: 2 });
  console.log(`  ✓ Saved carousel-config.json`);

  slides.forEach((s, i) => {
    console.log(`    ${i + 1}. [${s.topTimestamp}s] ${s.topText.slice(0, 40)}...`);
  });

  // 10. Generate carousel
  const doGenerate = await askYesNo('\n  Generate carousel now?', true);
  if (doGenerate) {
    await generateCarousel(carouselId, config);
  }

  console.log('\n  ✓ Carousel workflow complete!\n');
}

// ─── Extract carousel segments from edited doc ─────────────────────────────

async function extractCarouselSegments(docContent, jsonPath) {
  const transcript = await fs.readJson(jsonPath);
  const segments = transcript.segments;

  const lines = docContent.split('\n');
  const pairs = [];
  let inCarousel = false;
  let selectedSegments = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Carousel start markers
    if (/^>\s*CAROUSEL\s*START/i.test(trimmed) || trimmed === '> CAROUSEL') {
      inCarousel = true;
      continue;
    }

    // Carousel end marker
    if (/^>\s*CAROUSEL\s*END/i.test(trimmed)) {
      inCarousel = false;
      continue;
    }

    // Parse segment IDs
    const segMatch = trimmed.match(/^\[(\d+)\]/);
    if (segMatch && inCarousel) {
      const segId = parseInt(segMatch[1], 10);
      const seg = segments.find(s => s.id === segId);
      if (seg && !seg.cut) {
        selectedSegments.push(seg);
      }
    }
  }

  // Pair consecutive segments for top/bottom frames
  for (let i = 0; i < selectedSegments.length; i += 2) {
    if (selectedSegments[i + 1]) {
      pairs.push({
        top: selectedSegments[i],
        bottom: selectedSegments[i + 1],
      });
    }
  }

  return pairs;
}

// ─── Path Helpers ──────────────────────────────────────────────────────────

/**
 * Convert host paths to Docker container paths when running in Docker.
 * The input directory is mounted at /app/input in the container.
 */
function resolveVideoPath(videoPath) {
  if (!videoPath) return videoPath;

  // If running in Docker, convert host absolute paths to container paths
  if (process.env.DOCKER_ENV === 'true' || process.env.DOCKER_ENV === true) {
    // Match patterns like /Users/.../deckcreate/input/video/file.MOV
    const inputMatch = videoPath.match(/\/.*?\/deckcreate\/input\/(.*)$/);
    if (inputMatch) {
      return path.join('/app/input', inputMatch[1]);
    }
    // Match patterns like /home/.../deckcreate/input/video/file.MOV
    const homeMatch = videoPath.match(/\/home\/.*?\/deckcreate\/input\/(.*)$/);
    if (homeMatch) {
      return path.join('/app/input', homeMatch[1]);
    }
    // Match patterns like /Users/.../deckcreate/public/sync/output/file.mp4
    const syncMatch = videoPath.match(/\/.*?\/deckcreate\/public\/(.*)$/);
    if (syncMatch) {
      return path.join('/app/public', syncMatch[1]);
    }
    // If path already starts with /app, assume it's correct
    if (videoPath.startsWith('/app/')) {
      return videoPath;
    }
  }

  return videoPath;
}

// ─── Frame Extraction ─────────────────────────────────────────────────────

async function extractFrameWithFFmpeg(videoPath, timestamp, outputPath) {
  // Detect HDR and apply proper tonemapping (same as camera setup)
  const isHDR = await detectHDR(videoPath);
  const vf = isHDR ? HDR_TONEMAP_VF : SDR_FORMAT_VF;

  if (isHDR) {
    console.log(`    (HDR video detected, applying tonemapping)`);
  }

  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-hide_banner',
      '-loglevel', 'error',
      '-ss', String(timestamp),
      '-i', videoPath,
      '-frames:v', '1',
      '-vf', vf,
      '-pix_fmt', 'rgb24',
      '-y',
      outputPath,
    ], { stdio: ['ignore', 'ignore', 'pipe'], cwd });

    let err = '';
    proc.stderr.on('data', d => { err += d.toString(); });
    proc.on('close', code => {
      if (code === 0) resolve(outputPath);
      else reject(new Error(`ffmpeg failed: ${err}`));
    });
  });
}

// ─── Carousel Generation ─────────────────────────────────────────────────────

async function generateCarousel(carouselId, config) {
  console.log('\n  ── Generating carousel ───────────────────────────────');

  const outputDir = path.join(cwd, 'public', 'output', config.name);
  const generator = new CarouselGenerator(config);
  generator.outputDir = outputDir;

  try {
    await generator.init();

    if (config.videoId) {
      // YouTube mode: use existing CarouselGenerator
      await generator.generateCarousel();
    } else if (config.localVideoPath) {
      // Local video mode
      await generateFromLocalVideo(generator, config.localVideoPath, config.slides, outputDir, carouselId);
    }

    console.log(`\n  ✅ Carousel complete!`);
    console.log(`  Output: ${outputDir}`);

  } catch (error) {
    console.error(`\n  ✗ Error:`, error.message);
    throw error;
  } finally {
    await generator.close();
  }
}

async function generateFromLocalVideo(generator, videoPath, slides, outputDir, carouselId) {
  const sharp = (await import('sharp')).default;
  const width = 1080;
  const height = 1080;
  const halfHeight = height / 2;

  // Resolve path for Docker environment
  const resolvedPath = resolveVideoPath(videoPath);
  console.log(`\n  Extracting frames from: ${path.basename(resolvedPath)}`);
  if (resolvedPath !== videoPath) {
    console.log(`    (Docker path: ${resolvedPath})`);
  }

  const fontData = await generator.loadNunitoFont();

  // Load episode metadata from transcript.json and brand colors
  let headerConfig = null;
  try {
    const transcriptPath = path.join(cwd, 'public', 'carousel', carouselId, 'transcript.json');
    const transcript = await fs.readJson(transcriptPath);
    const { meta } = transcript;
    
    // Load brand colors
    let brandColor = '#eebf89'; // Default fallback
    try {
      const brandPath = path.join(cwd, 'public', 'brand.json');
      const brand = await fs.readJson(brandPath);
      brandColor = brand.colors?.primary || brandColor;
    } catch (brandErr) {
      console.log(`  (Using default brand color)`);
    }
    
    if (meta?.thumbnail) {
      const logoPath = path.join(cwd, 'public', 'assets', 'logo', 'transparent-bg-logo.png');
      const logoBase64 = await generator.loadLogoAsBase64(logoPath);
      
      headerConfig = {
        logoBase64,
        episodeNumber: meta.thumbnail.episodeNumber,
        episodeTitle: meta.thumbnail.extendedTitle || meta.thumbnail.title || meta.title,
        brandColor,
      };
      console.log(`  ✓ Loaded episode metadata: EP ${headerConfig.episodeNumber}`);
    }
  } catch (e) {
    console.log(`  (No episode metadata found: ${e.message})`);
  }

  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i];
    console.log(`\n  Slide ${i + 1}/${slides.length}:`);
    console.log(`    Top: ${slide.topTimestamp}s`);
    console.log(`    Bottom: ${slide.bottomTimestamp}s`);

    const spin = spinner('Extracting frames...');

    try {
      const topFramePath = path.join(outputDir, `frame-${i}-top.png`);
      const bottomFramePath = path.join(outputDir, `frame-${i}-bottom.png`);

      await extractFrameWithFFmpeg(resolvedPath, slide.topTimestamp, topFramePath);
      await extractFrameWithFFmpeg(resolvedPath, slide.bottomTimestamp, bottomFramePath);

      spin.update('Compositing...');

      const topFrame = await sharp(topFramePath)
        .resize(width, halfHeight, { fit: 'cover', position: 'center' })
        .png()
        .toBuffer();

      const bottomFrame = await sharp(bottomFramePath)
        .resize(width, halfHeight, { fit: 'cover', position: 'center' })
        .png()
        .toBuffer();

      const textOverlaySvg = generator.generateTextOverlaySVG(
        width, height, slide.topText, slide.bottomText, fontData, headerConfig
      );

      const composited = await sharp({
        create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
      })
        .composite([
          { input: topFrame, top: 0, left: 0 },
          { input: bottomFrame, top: halfHeight, left: 0 },
          { input: Buffer.from(textOverlaySvg), top: 0, left: 0 },
        ])
        .png()
        .toBuffer();

      const outputPath = path.join(outputDir, `slide-${i + 1}.png`);
      await fs.writeFile(outputPath, composited);

      await fs.remove(topFramePath);
      await fs.remove(bottomFramePath);

      spin.stop(`✓ slide-${i + 1}.png`);

    } catch (error) {
      spin.stop(`✗ Failed: ${error.message}`);
      throw error;
    }
  }

  console.log(`\n  ✓ Generated ${slides.length} slides`);

  // Generate CTA slide
  console.log('\n  ── Generating CTA slide ───────────────────────────────');
  try {
    // Check for thumbnail.png
    const thumbnailPath = path.join(cwd, 'public', 'thumbnail', 'thumbnail.png');
    const hasThumbnail = await fs.pathExists(thumbnailPath);
    
    // Prepare CTA config
    const ctaConfig = {
      bgColor: headerConfig?.brandColor ? '#1a1a2e' : '#1a1a2e',
      episodeNumber: headerConfig?.episodeNumber || '',
      episodeTitle: headerConfig?.episodeTitle || '',
      brandColor: headerConfig?.brandColor || '#eebf89',
      handle: 'ragtechdev',
      thumbnailPath: hasThumbnail ? thumbnailPath : null,
      logoBase64: headerConfig?.logoBase64 || null,
    };
    
    await generator.generateCtaSlide(ctaConfig, slides.length + 1);
    console.log('  ✓ CTA slide generated');
  } catch (ctaError) {
    console.log(`  (CTA slide skipped: ${ctaError.message})`);
  }
}

// ─── Existing Carousels Menu ────────────────────────────────────────────────

function getStatusSymbol(status) {
  if (status.hasOutput) return '✓';
  if (status.hasConfig) return '◑';
  if (status.hasDoc) return '○';
  return '·';
}

async function showExistingCarousels(carousels) {
  console.log('\n  Existing carousels:');
  carousels.forEach(carousel => {
    const status = getCarouselStatus(carousel.id);
    const symbol = getStatusSymbol(status);
    console.log(`    ${symbol}  ${carousel.id}`);
  });

  console.log('\n  Options:');
  console.log('  1. Create a new carousel from longform');
  console.log('  2. Continue / redo an existing carousel');

  const choice = (await ask('  > [1] ')).trim() || '1';

  if (choice === '1') {
    return { action: 'new' };
  } else if (choice === '2') {
    console.log('\n  Select carousel to continue:');
    carousels.forEach((c, i) => {
      const status = getCarouselStatus(c.id);
      const symbol = getStatusSymbol(status);
      console.log(`  ${i + 1}. ${symbol} ${c.id}`);
    });
    const carouselChoice = (await ask('  > ')).trim();
    const idx = parseInt(carouselChoice) - 1;
    if (idx >= 0 && idx < carousels.length) {
      return { action: 'continue', carouselId: carousels[idx].id };
    }
    console.log('  Invalid choice');
    return { action: 'menu' };
  }

  return { action: 'menu' };
}

async function runContinueCarousel(carouselId) {
  const carouselDir = path.join(cwd, 'public', 'carousel', carouselId);
  const jsonPath = path.join(carouselDir, 'transcript.json');
  let running = true;

  while (running) {
    const status = getCarouselStatus(carouselId);

    console.log(`\n  ── Continue ${carouselId} ─────────────────────────────`);

    console.log('\n  Redo steps:');
    let stepNum = 1;
    const steps = [];

    steps.push({ id: 'edit', label: 'Re-open doc for editing', always: true });
    console.log(`  ${stepNum++}. Re-open doc for editing`);

    if (status.hasConfig) {
      steps.push({ id: 'regenerate', label: 'Regenerate carousel', always: false });
      console.log(`  ${stepNum++}. Regenerate carousel`);
    }

    steps.push({ id: 'video', label: 'Change video source', always: true });
    console.log(`  ${stepNum++}. Change video source`);

    console.log(`  ${stepNum++}. Done / Exit`);
    steps.push({ id: 'exit', label: 'Done / Exit', always: true });

    const choice = (await ask('  > ')).trim();
    const stepIdx = parseInt(choice) - 1;

    if (stepIdx < 0 || stepIdx >= steps.length) {
      console.log('  Invalid choice');
      continue;
    }

    const step = steps[stepIdx];

    switch (step.id) {
      case 'edit': {
        const docPath = path.join(carouselDir, 'transcript.doc.txt');
        openFile(docPath);
        await ask('  Press Enter when done editing...');

        // Rebuild config from edited doc
        console.log('\n  ── Rebuilding carousel config ────────────────────────');
        const editedContent = await fs.readFile(docPath, 'utf-8');
        const carouselSegments = await extractCarouselSegments(editedContent, jsonPath);

        if (carouselSegments.length === 0) {
          console.log('  ✗ No segments marked for carousel. Add > CAROUSEL markers to the doc.');
          break;
        }

        // Build slides from segments
        const slides = carouselSegments.map((pair, i) => ({
          topTimestamp: Math.floor((pair.top.start + pair.top.end) / 2 || pair.top.start || 0),
          bottomTimestamp: Math.floor((pair.bottom.start + pair.bottom.end) / 2 || pair.bottom.start || 0),
          topText: pair.top.text,
          bottomText: pair.bottom.text,
        }));

        // Load existing config or create new one
        const configPath = path.join(carouselDir, 'carousel-config.json');
        let config = { showLogo: true };
        if (await fs.pathExists(configPath)) {
          config = await fs.readJson(configPath);
        }

        config.slides = slides;
        config.name = `${carouselId}-carousel`;

        // If no video source set, prompt for one
        if (!config.videoId && !config.localVideoPath) {
          console.log('\n  No video source configured. Choose source:');
          console.log('    1. YouTube video');
          console.log('    2. Local video');
          const vchoice = (await ask('  > ')).trim() || '1';
          if (vchoice === '1') {
            config.videoId = await askQuestion('  YouTube video ID: ');
          } else {
            console.log('  Place video in input/video/ or use synced video');
            const syncDir = path.join(cwd, 'public', 'sync', 'output');
            if (await fs.pathExists(syncDir)) {
              const files = await fs.readdir(syncDir);
              const synced = files.filter(f => f.startsWith('synced-output-') && f.endsWith('.mp4'));
              if (synced.length > 0) {
                console.log('  Found synced videos:');
                synced.forEach((f, i) => console.log(`    ${i + 1}. ${f}`));
                const schoice = (await ask('  Select synced video [1]: ')).trim() || '1';
                const sidx = parseInt(schoice) - 1;
                if (sidx >= 0 && sidx < synced.length) {
                  config.localVideoPath = path.join(cwd, 'public', 'sync', 'output', synced[sidx]);
                }
              }
            }
          }
        }

        await fs.writeJson(configPath, config, { spaces: 2 });
        console.log(`  ✓ Saved carousel-config.json (${slides.length} slides)`);
        break;
      }
      case 'regenerate': {
        const configPath = path.join(carouselDir, 'carousel-config.json');
        const config = await fs.readJson(configPath);
        await generateCarousel(carouselId, config);
        break;
      }
      case 'video': {
        const configPath = path.join(carouselDir, 'carousel-config.json');
        if (!await fs.pathExists(configPath)) {
          console.log('  ✗ No config found. Edit doc first to create config.');
          break;
        }
        const config = await fs.readJson(configPath);
        console.log('    1. YouTube video');
        console.log('    2. Local video');
        const choice2 = (await ask('  > ')).trim() || '1';
        if (choice2 === '1') {
          config.videoId = await askQuestion('  YouTube video ID: ');
          config.localVideoPath = null;
        } else {
          console.log('  Place video in input/video/');
          await ask('  Press Enter when ready...');
          const inputVideoDir = path.join(cwd, 'input', 'video');
          const videoExts = ['.mp4', '.mov', '.mkv'];
          const found = await findFileIn(inputVideoDir, videoExts);
          if (found) {
            config.localVideoPath = found;
            config.videoId = null;
          }
        }
        await fs.writeJson(configPath, config, { spaces: 2 });
        console.log('  ✓ Updated config');
        break;
      }
      case 'exit':
        running = false;
        break;
    }
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n  DeckCreate — Carousel Wizard');
  console.log('  ─────────────────────────────\n');

  // Detect existing work
  const existing = await detectExistingWork();

  // Case 2: Existing carousels
  if (existing.carousels.length > 0) {
    const action = await showExistingCarousels(existing.carousels);

    if (action.action === 'new') {
      if (existing.hasLongformTranscript) {
        await runPathA();
      } else {
        console.log('  ✗ No longform transcript found. Run video wizard first.');
      }
    } else if (action.action === 'continue') {
      await runContinueCarousel(action.carouselId);
    }

    rl.close();
    return;
  }

  // Case 1: No existing carousels
  console.log('  No existing carousels found.');

  if (existing.hasLongformTranscript) {
    console.log('  Found longform transcript.');
    const createNew = await askYesNo('  Create a carousel from it?', true);
    if (createNew) {
      await runPathA();
    }
  } else {
    console.log('  ✗ No longform transcript found.');
    console.log('  Run the video wizard first to create a recording.');
  }

  rl.close();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
