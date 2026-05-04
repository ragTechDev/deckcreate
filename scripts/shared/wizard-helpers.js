import { spawn } from 'child_process';
import { execSync } from 'child_process';
import fs from 'fs-extra';
import path from 'path';

// ── Stateless helpers (no rl/cwd dependency) ─────────────────────────────────

export function progressBar(pct, width = 24) {
  const filled = Math.round(pct / 100 * width);
  return '[' + '█'.repeat(filled) + '░'.repeat(width - filled) + ']';
}

export function spinner(label) {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  let current = label;
  const interval = setInterval(() => {
    process.stdout.write(`\r  ${frames[i++ % frames.length]}  ${current}`);
  }, 80);
  return {
    update: (text) => { current = text; },
    stop: (finalMsg) => {
      clearInterval(interval);
      const padding = ' '.repeat(Math.max(0, current.length - finalMsg.length + 4));
      process.stdout.write(`\r  ${finalMsg}${padding}\n`);
    },
  };
}

export function openFile(filePath) {
  // Prefer opening in the current code editor window (VS Code or Cursor).
  // -r / --reuse-window opens in the most recently focused window.
  for (const editor of ['code', 'cursor']) {
    try {
      execSync(`${editor} -r "${filePath}"`, { stdio: 'ignore', shell: true });
      return;
    } catch {
      // editor not in PATH — try next
    }
  }
  // Fall back to system default app
  const cmd = process.platform === 'win32' ? 'start ""'
    : process.platform === 'darwin' ? 'open' : 'xdg-open';
  try {
    execSync(`${cmd} "${filePath}"`, { stdio: 'ignore', shell: true });
  } catch {
    console.log(`  (Open manually: ${filePath})`);
  }
}

export async function findFileIn(dir, exts) {
  if (!await fs.pathExists(dir)) return null;
  const files = await fs.readdir(dir);
  const match = files.find(f => exts.includes(path.extname(f).toLowerCase()));
  return match ? path.join(dir, match) : null;
}

export async function waitForHttp(url, timeoutMs = 30000, intervalMs = 500) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { method: 'GET' });
      if (res.ok) return true;
    } catch {
      // not ready yet
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return false;
}

export function isDockerEnv() {
  return fs.existsSync('/.dockerenv') || process.env.DOCKER === '1';
}

// ── Factory: returns all helpers bound to rl and cwd ─────────────────────────

export function createHelpers(rl, cwd) {
  const ask = (q) => new Promise(resolve => rl.question(q, resolve));

  async function confirm(q, defaultYes = true) {
    const hint = defaultYes ? '[Y/n/q]' : '[y/N/q]';
    const ans = (await ask(`  ${q} ${hint} `)).trim().toLowerCase();
    if (ans === 'q') quit();
    return defaultYes ? ans !== 'n' : ans === 'y';
  }

  async function askYesNo(q, defaultYes = true) {
    const hint = defaultYes ? '[Y/n]' : '[y/N]';
    const ans = (await ask(`  ${q} ${hint} `)).trim().toLowerCase();
    return defaultYes ? ans !== 'n' : ans === 'y';
  }

  async function askQuestion(q) {
    return (await ask(`  ${q}`)).trim();
  }

  function quit() {
    console.log('\nExiting wizard.\n');
    rl.close();
    process.exit(0);
  }

  function spawnStep(cmd, args, opts = {}) {
    return new Promise((resolve, reject) => {
      const proc = spawn(cmd, args, {
        stdio: 'inherit',
        cwd,
        shell: process.platform === 'win32',
        ...opts,
      });
      proc.on('close', code => {
        if (code === 0) resolve();
        else reject(new Error(`Exited with code ${code}`));
      });
      proc.on('error', e => reject(new Error(e.message)));
    });
  }

  async function runStep(label, cmd, args, outputPath) {
    while (true) {
      console.log(`\n  → ${label}`);
      let ok = false;
      try {
        await spawnStep(cmd, args);
        if (outputPath) console.log(`  ✓ Done — ${outputPath}`);
        else console.log(`  ✓ Done`);
        ok = true;
      } catch (err) {
        console.error(`  ✗ Failed: ${err.message}`);
      }

      const happy = await confirm('  Happy with the result?');
      if (happy) return;

      console.log('');
      console.log('  1. Re-run this step');
      if (ok && outputPath) console.log(`  2. Open output file, then re-run`);
      const skipNum = ok && outputPath ? 3 : 2;
      console.log(`  ${skipNum}. Skip and continue anyway`);
      const c = (await ask('  > ')).trim();
      if (ok && outputPath && c === '2') openFile(outputPath);
      if (c === String(skipNum)) return;
      // else: re-run
    }
  }

  function runStep_parallel(label, cmd, args) {
    return new Promise((resolve, reject) => {
      const proc = spawn(cmd, args, {
        cwd,
        shell: process.platform === 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const pfx = `  [${label}]`;
      let stderr = '';
      const writeLine = (stream, line) => { if (line) stream.write(`${pfx} ${line}\n`); };
      proc.stdout.on('data', d => d.toString().split('\n').forEach(l => writeLine(process.stdout, l)));
      proc.stderr.on('data', d => {
        const s = d.toString();
        stderr += s;
        s.split('\n').forEach(l => writeLine(process.stderr, l));
      });
      proc.on('close', code => {
        if (code === 0) { console.log(`${pfx} ✓ Done`); resolve(); }
        else {
          console.log(`${pfx} ✗ Failed`);
          console.log('');
          console.log('  ┌─────────────────────────────────────────────────────────┐');
          console.log(`  │  ${label.toUpperCase()} FAILED — OTHER STEPS ARE STILL RUNNING       │`.slice(0, 63) + '│');
          console.log('  │  Please wait. Do NOT close this window.                 │');
          console.log('  │  Recovery options will appear when all steps finish.    │');
          console.log('  └─────────────────────────────────────────────────────────┘');
          console.log('');
          const e = new Error(`${label} failed (exit ${code})`); e.stderr = stderr; reject(e);
        }
      });
      proc.on('error', e => { e.stderr = stderr; reject(new Error(`${label}: ${e.message}`)); });
    });
  }

  async function runParallel(steps) {
    const results = await Promise.allSettled(
      steps.map(({ label, cmd, args }) => runStep_parallel(label, cmd, args))
    );
    return steps.map(({ label }, i) => ({
      label,
      ok: results[i].status === 'fulfilled',
      error: results[i].reason ?? null,
    }));
  }

  async function copyFileWithProgress(src, dest, label) {
    const { size: total } = await fs.stat(src);
    const fmt = (bytes) => bytes >= 1e9
      ? `${(bytes / 1e9).toFixed(1)} GB`
      : `${(bytes / 1e6).toFixed(0)} MB`;

    process.stdout.write(`\r  ${label}  ${progressBar(0)} 0%  0 / ${fmt(total)}`);

    const copyPromise = fs.copy(src, dest, { overwrite: true });

    const interval = setInterval(async () => {
      const { size: current } = await fs.stat(dest).catch(() => ({ size: 0 }));
      const pct = Math.min(99, Math.round(current / total * 100));
      process.stdout.write(`\r  ${label}  ${progressBar(pct)} ${pct}%  ${fmt(current)} / ${fmt(total)}`);
    }, 300);

    await copyPromise;
    clearInterval(interval);
    process.stdout.write(`\r  ${label}  ${progressBar(100)} 100%  ${fmt(total)} / ${fmt(total)}\n`);
  }

  return {
    ask, confirm, askYesNo, askQuestion, quit,
    spawnStep, runStep, runStep_parallel, runParallel,
    progressBar, spinner, copyFileWithProgress,
    openFile, findFileIn, waitForHttp, isDockerEnv,
  };
}
