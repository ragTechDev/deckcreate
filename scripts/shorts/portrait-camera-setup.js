#!/usr/bin/env node
/**
 * Set up portrait camera profiles for short-form clips.
 *
 * Path A — from an existing landscape camera-profiles.json:
 *   node scripts/shorts/portrait-camera-setup.js --source public/camera/camera-profiles.json
 *
 * Path B — fresh face detection from portrait videos:
 *   node scripts/shorts/portrait-camera-setup.js --videos <path1> [<path2> ...]
 *
 * Options:
 *   --source <path>      Path A: source landscape camera-profiles.json
 *   --videos <paths...>  Path B: video files for fresh face detection
 *   --skip-gui           Skip opening the camera GUI
 */

import fs from 'fs-extra';
import path from 'path';
import readline from 'readline';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { waitForHttp, openFile } from '../shared/wizard-helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cwd = path.join(__dirname, '../..');

const PORTRAIT_WIDTH  = 1080;
const PORTRAIT_HEIGHT = 1920;

function parseArgs(argv) {
  const args = { videos: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--source') {
      args.source = argv[++i];
    } else if (argv[i] === '--videos') {
      while (argv[i + 1] && !argv[i + 1].startsWith('--')) {
        args.videos.push(argv[++i]);
      }
    } else if (argv[i] === '--skip-gui') {
      args.skipGui = true;
    }
  }
  return args;
}

function buildPortraitProfiles(source) {
  const portrait = {
    ...source,
    outputWidth:  PORTRAIT_WIDTH,
    outputHeight: PORTRAIT_HEIGHT,
  };

  if (source.speakers) {
    portrait.speakers = {};
    for (const [name, speaker] of Object.entries(source.speakers)) {
      const cx = speaker.closeupViewport?.cx ?? 0.5;
      portrait.speakers[name] = {
        ...speaker,
        portraitCx: speaker.portraitCx ?? cx,
      };
    }
  }

  return portrait;
}

async function openGuiAndWait() {
  // The GUI runs at /camera?mode=shorts — portrait mode is signalled via the
  // query param, so we never touch public/camera/camera-profiles.json here.
  // The Save button in the GUI calls /api/camera/save-profiles?dest=shorts
  // which writes directly to public/shorts/camera-profiles.json.

  const cameraUrl = 'http://127.0.0.1:3000/camera?mode=shorts';

  console.log('\n  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  📷 Portrait Camera Setup — Action Required');
  console.log('  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  const devServer = spawn('npm', ['run', 'dev', '--', '--hostname', '0.0.0.0', '--port', '3000'], {
    cwd,
    shell: process.platform === 'win32',
    stdio: 'ignore',
  });

  console.log('  ⏳ Starting camera server (this may take 10-30 seconds)...');
  console.log('     Please wait — instructions will appear shortly.');
  process.stdout.write('  ');

  const dotInterval = setInterval(() => { process.stdout.write('.'); }, 1000);
  const ready = await waitForHttp('http://127.0.0.1:3000/camera', 90000, 700);
  clearInterval(dotInterval);
  console.log('');

  if (ready) {
    console.log('  ✓ Camera server is ready');
  } else {
    console.log('  ⚠ Camera server is slow — you may need to refresh the browser');
  }

  console.log('');
  console.log('  STEP 1: Open the portrait camera editor in your browser');
  console.log('          → http://localhost:3000/camera?mode=shorts');
  console.log('');
  console.log('  STEP 2: For each speaker, adjust the portrait crop');
  console.log('          - The yellow box shows the 9:16 closeup framing');
  console.log('          - Drag the red dot to center the speaker face');
  console.log('          - Use the Angle tabs if you have multiple cameras');
  console.log('');
  console.log('  STEP 3: Click "Save profiles" when satisfied');
  console.log('          (Saves to public/shorts/camera-profiles.json)');
  console.log('');
  console.log('  STEP 4: Return here and press Enter to continue');
  console.log('');
  console.log('  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  openFile(cameraUrl);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise(resolve => rl.question('\n  Press Enter when done saving...\n  ', resolve));
  rl.close();

  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(devServer.pid), '/f', '/t'], { shell: true, stdio: 'ignore' });
    } else {
      process.kill(devServer.pid, 'SIGTERM');
    }
  } catch { /* ignore */ }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const outPath = path.join(cwd, 'public', 'shorts', 'camera-profiles.json');
  await fs.ensureDir(path.dirname(outPath));

  if (args.source) {
    // ── Path A: derive portrait profiles from existing landscape profiles ──
    const sourcePath = path.resolve(cwd, args.source);
    if (!await fs.pathExists(sourcePath)) {
      console.error(`✗ Source profiles not found: ${sourcePath}`);
      process.exit(1);
    }

    const source = await fs.readJson(sourcePath);
    let portraitProfiles = buildPortraitProfiles(source);

    // Write initial portrait profiles
    await fs.writeJson(outPath, portraitProfiles, { spaces: 2 });
    console.log(`  ✓ Initial portrait profiles written: ${outPath}`);

    if (!args.skipGui) {
      await openGuiAndWait();
      // GUI saved directly to outPath via /api/camera/save-profiles?dest=shorts.
      // Patch to guarantee portrait dimensions in case the GUI lost them.
      if (await fs.pathExists(outPath)) {
        const saved = await fs.readJson(outPath);
        if (saved.outputWidth !== PORTRAIT_WIDTH || saved.outputHeight !== PORTRAIT_HEIGHT) {
          await fs.writeJson(outPath, { ...saved, outputWidth: PORTRAIT_WIDTH, outputHeight: PORTRAIT_HEIGHT }, { spaces: 2 });
        }
      }
      console.log(`  ✓ Portrait profiles updated from GUI: ${outPath}`);
    }

  } else if (args.videos.length > 0) {
    // ── Path B: fresh face detection from portrait videos ──
    console.log(`  Running camera setup for ${args.videos.length} portrait video(s)...`);
    await new Promise((resolve, reject) => {
      const setupArgs = ['scripts/camera/setup-camera.js', '--videos', ...args.videos];
      if (args.skipGui) setupArgs.push('--detect-only');
      const proc = spawn('node', setupArgs, { stdio: 'inherit', cwd, shell: process.platform === 'win32' });
      proc.on('close', code => code === 0 ? resolve() : reject(new Error(`setup-camera exited ${code}`)));
      proc.on('error', e => reject(e));
    });

    // Copy and patch the result
    const generatedPath = path.join(cwd, 'public', 'camera', 'camera-profiles.json');
    if (!await fs.pathExists(generatedPath)) {
      console.error(`✗ setup-camera did not produce ${generatedPath}`);
      process.exit(1);
    }
    const generated = await fs.readJson(generatedPath);
    const final = { ...generated, outputWidth: PORTRAIT_WIDTH, outputHeight: PORTRAIT_HEIGHT };
    await fs.writeJson(outPath, final, { spaces: 2 });
    console.log(`  ✓ Portrait profiles written: ${outPath}`);

  } else {
    console.error('Usage: portrait-camera-setup.js --source <path>  OR  --videos <path...>');
    process.exit(1);
  }

  console.log(`  outputWidth:  ${PORTRAIT_WIDTH}`);
  console.log(`  outputHeight: ${PORTRAIT_HEIGHT}`);
}

main().catch(err => {
  console.error('✗', err.message);
  process.exit(1);
});
