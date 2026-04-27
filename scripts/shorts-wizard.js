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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cwd = path.join(__dirname, '..');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

const {
  ask, confirm, askYesNo, askQuestion,
  spawnStep, runStep,
  openFile,
} = createHelpers(rl, cwd);

// ── Detection logic ─────────────────────────────────────────────────────────

async function detectExistingWork() {
  const p = (...parts) => path.join(cwd, ...parts);

  // Check for existing short clips
  const shortsDir = p('public', 'shorts');
  let shortClips = [];
  if (await fs.pathExists(shortsDir)) {
    const entries = await fs.readdir(shortsDir, { withFileTypes: true });
    const shortDirs = entries.filter(e => e.isDirectory() && /^short-/.test(e.name));
    shortClips = await Promise.all(shortDirs.map(async (dir) => {
      const id = dir.name;
      return {
        id,
        hasDoc: await fs.pathExists(p('public', 'shorts', id, 'transcript.doc.txt')),
        hasMerged: await fs.pathExists(p('public', 'shorts', id, 'transcript.json')),
        hasPreview: await fs.pathExists(p('public', 'shorts', id, 'preview-cut.mp4')),
      };
    }));
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
    .filter(line => !/^\s*>\s*HOOK\b/i.test(line))  // Remove all HOOK cues (with or without phrases/timing)
    .filter(line => !/^\s*>\s*START\b/i.test(line))  // Remove any existing START
    .filter(line => !/^\s*>\s*END\b/i.test(line))    // Remove any existing END
    .join('\n');

  await fs.writeFile(clipDocPath, docContent);
  console.log(`  ✓ Copied cleaned doc to public/shorts/${clipId}/transcript.doc.txt`);

  // 4. Show instructions for defining clip range
  console.log('\n  ── Define clip range ────────────────────────────────');
  console.log('  Edit the doc to define your clip range:');
  console.log('    1. Add "> START" on its own line BEFORE the first segment to include');
  console.log('    2. Add "> END" on its own line AFTER the last segment to include');
  console.log('  Everything outside START..END will be excluded from the short.');
  console.log('  You can also mark hooks with "> HOOK" and add cuts with {curly braces}.');
  openFile(clipDocPath);

  // 5. Edit doc
  console.log('\n  ── Edit clip doc ─────────────────────────────────────');
  console.log('  Open the doc and:');
  console.log('    - Add "> START" and "> END" to define the clip range');
  console.log('    - Mark a > HOOK segment for the hook/teaser');
  console.log('    - Adjust cuts with {curly braces}');
  console.log('    - Correct any text as needed');

  // Validate START/END markers are present before proceeding
  let hasStartEnd = false;
  while (!hasStartEnd) {
    await ask('  Press Enter when done editing...');

    const editedContent = await fs.readFile(clipDocPath, 'utf-8');
    const hasStart = /^>\s*START\b/im.test(editedContent);
    const hasEnd = /^>\s*END\b/im.test(editedContent);

    if (hasStart && hasEnd) {
      hasStartEnd = true;
    } else {
      console.log('\n  ⚠ Missing required markers:');
      if (!hasStart) console.log('    - "> START" not found — add it before the first segment to include');
      if (!hasEnd) console.log('    - "> END" not found — add it after the last segment to include');
      console.log('  Please edit the doc and add the missing markers.\n');
      openFile(clipDocPath);
    }
  }

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
    console.log('\n  → Launching Remotion studio...');
    console.log('  Select the "ShortFormClip" composition from the dropdown.');
    await spawnStep('npm', ['run', 'remotion:studio']);
  }

  console.log('\n  ✓ Clip workflow complete!\n');
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
    await spawnStep('npm', ['run', 'shorts:camera-setup', '--', '--source', sourceProfiles]);
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
    await runPathA(true);
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
