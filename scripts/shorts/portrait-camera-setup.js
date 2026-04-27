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

async function openGuiAndWait(portraitProfiles) {
  // Write portrait profiles to the GUI's save location so it loads them
  const cameraProfilesPath = path.join(cwd, 'public', 'camera', 'camera-profiles.json');
  await fs.ensureDir(path.dirname(cameraProfilesPath));

  // Back up existing landscape profiles if present and different
  let backup = null;
  if (await fs.pathExists(cameraProfilesPath)) {
    backup = await fs.readJson(cameraProfilesPath);
  }

  await fs.writeJson(cameraProfilesPath, portraitProfiles, { spaces: 2 });

  const devServer = spawn('npm', ['run', 'dev', '--', '--hostname', '0.0.0.0', '--port', '3000'], {
    cwd,
    shell: process.platform === 'win32',
    stdio: 'ignore',
  });

  const cameraUrl = 'http://127.0.0.1:3000/camera';
  const ready = await waitForHttp(cameraUrl, 90000, 700);

  if (ready) {
    console.log('\n  → Open http://localhost:3000/camera in your browser');
    console.log('  Adjust portrait crop positions, then click Save profiles.');
  } else {
    console.log('\n  ⚠ Camera server may not be ready — open http://localhost:3000/camera manually');
  }

  openFile('http://localhost:3000/camera');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise(resolve => rl.question('\n  Press Enter when done saving...\n  ', resolve));
  rl.close();

  // Kill dev server
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(devServer.pid), '/f', '/t'], { shell: true, stdio: 'ignore' });
    } else {
      process.kill(devServer.pid, 'SIGTERM');
    }
  } catch { /* ignore */ }

  // Read the saved profiles (GUI writes to public/camera/camera-profiles.json)
  const saved = await fs.readJson(cameraProfilesPath);

  // Restore backup if we overwrote landscape profiles
  if (backup && (backup.outputWidth !== PORTRAIT_WIDTH || backup.outputHeight !== PORTRAIT_HEIGHT)) {
    await fs.writeJson(cameraProfilesPath, backup, { spaces: 2 });
    console.log('  (Restored landscape camera-profiles.json)');
  }

  return saved;
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
      const saved = await openGuiAndWait(portraitProfiles);
      // Patch the saved profiles to ensure portrait dimensions are set
      const final = { ...saved, outputWidth: PORTRAIT_WIDTH, outputHeight: PORTRAIT_HEIGHT };
      await fs.writeJson(outPath, final, { spaces: 2 });
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
