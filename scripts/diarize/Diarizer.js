import { spawn } from 'child_process';
import path from 'path';
import os from 'os';
import fs from 'fs-extra';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function spawnPython(scriptPath, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(args[0], [scriptPath, ...args.slice(1)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    // Forward Python progress lines (written to stderr) straight to the terminal.
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
      process.stderr.write(d);
    });

    proc.on('close', (code) => {
      // run_diarize.py writes structured errors to stdout as JSON regardless of exit code.
      // Always try to extract the error field before falling back to raw stderr.
      try {
        const result = JSON.parse(stdout);
        if (result?.error) { reject(new Error(result.error)); return; }
        if (code !== 0) { reject(new Error(`run_diarize.py exited with code ${code}\n${stderr}`)); return; }
        resolve(result);
      } catch {
        if (code !== 0) { reject(new Error(`run_diarize.py exited with code ${code}\n${stderr || stdout}`)); return; }
        reject(new Error(`Failed to parse run_diarize.py output:\n${stdout}`));
      }
    });

    proc.on('error', (err) => {
      if (err.code === 'ENOENT') {
        reject(new Error(
          `Python not found ("${args[0]}" command missing). ` +
          'Install Python 3.9–3.12 or pass --python <path> to specify the binary.'
        ));
      } else {
        reject(new Error(`Failed to spawn Python: ${err.message}`));
      }
    });
  });
}

class Diarizer {
  constructor(options = {}) {
    this.audioPath = options.audioPath;
    this.rawJsonPath = options.rawJsonPath;
    this.diarizationJsonPath = options.diarizationJsonPath;
    this.numSpeakers = options.numSpeakers || null;
    this.pythonBin = options.pythonBin || 'python3';
    this.scriptPath = path.join(__dirname, 'run_diarize.py');
  }

  async initForDiarize() {
    if (!await fs.pathExists(this.audioPath)) {
      throw new Error(`Audio file not found: ${this.audioPath}`);
    }
    await fs.ensureDir(path.dirname(this.diarizationJsonPath));
  }

  async initForAssign() {
    if (!await fs.pathExists(this.diarizationJsonPath)) {
      throw new Error(
        `Diarization output not found: ${this.diarizationJsonPath}\n` +
        'Run "npm run diarize" first.'
      );
    }
    if (!await fs.pathExists(this.rawJsonPath)) {
      throw new Error(
        `Raw transcript not found: ${this.rawJsonPath}\n` +
        'Run "npm run transcribe" first.'
      );
    }
  }

  /**
   * Convert audio to 16 kHz mono 16-bit PCM WAV — the format silero_vad
   * requires. 24-bit PCM or non-standard sample rates (e.g. 96 kHz) cause
   * "Input contains NaN" inside the VAD model.
   */
  async _convertForDiarize(srcPath) {
    const tmpPath = path.join(os.tmpdir(), `diarize_${Date.now()}.wav`);
    await new Promise((resolve, reject) => {
      const proc = spawn('ffmpeg', [
        '-i', srcPath,
        '-ac', '1',          // mono
        '-ar', '16000',      // 16 kHz
        '-sample_fmt', 's16', // 16-bit PCM
        '-y', tmpPath,
      ], { stdio: ['ignore', 'ignore', 'pipe'] });
      let err = '';
      proc.stderr.on('data', d => { err += d.toString(); });
      proc.on('close', code => {
        if (code !== 0) reject(new Error(`ffmpeg conversion failed:\n${err}`));
        else resolve();
      });
      proc.on('error', reject);
    });
    return tmpPath;
  }

  async runDiarization() {
    console.log('Running speaker diarization (models download on first run)...');

    const tmpAudio = await this._convertForDiarize(this.audioPath);
    let turns;
    try {
      const pythonArgs = [this.pythonBin, tmpAudio];
      if (this.numSpeakers) pythonArgs.push(String(this.numSpeakers));
      turns = await spawnPython(this.scriptPath, pythonArgs);
    } finally {
      await fs.remove(tmpAudio).catch(() => {});
    }

    const speakerCount = new Set(turns.map((t) => t.speaker)).size;
    console.log(`  ${speakerCount} speaker(s), ${turns.length} turns.`);

    await fs.writeJson(this.diarizationJsonPath, turns, { spaces: 2 });
    console.log(`  Saved: ${this.diarizationJsonPath}`);

    return turns;
  }

  // Assign each transcript segment the speaker whose turn overlaps it the most.
  // Falls back to the nearest turn by midpoint distance for segments that fall
  // in gaps between diarization turns (silence, cross-talk boundaries, etc.).
  assignSpeakers(transcript, turns) {
    return {
      ...transcript,
      segments: transcript.segments.map((seg) => {
        const segMid = (seg.start + seg.end) / 2;
        let bestSpeaker = '';
        let bestOverlap = 0;
        let nearestSpeaker = '';
        let nearestDist = Infinity;

        for (const turn of turns) {
          const overlap = Math.min(seg.end, turn.end) - Math.max(seg.start, turn.start);
          if (overlap > bestOverlap) {
            bestOverlap = overlap;
            bestSpeaker = turn.speaker;
          }
          const dist = Math.abs(segMid - (turn.start + turn.end) / 2);
          if (dist < nearestDist) {
            nearestDist = dist;
            nearestSpeaker = turn.speaker;
          }
        }

        return { ...seg, speaker: bestSpeaker || nearestSpeaker };
      }),
    };
  }

  async runAssignment() {
    console.log(`Reading diarization output: ${this.diarizationJsonPath}`);
    const turns = await fs.readJson(this.diarizationJsonPath);
    console.log(`  ${new Set(turns.map((t) => t.speaker)).size} speaker(s), ${turns.length} turns.`);

    console.log(`Reading transcript: ${this.rawJsonPath}`);
    const transcript = await fs.readJson(this.rawJsonPath);

    console.log('Assigning speaker labels...');
    const updated = this.assignSpeakers(transcript, turns);
    await fs.writeJson(this.rawJsonPath, updated, { spaces: 2 });

    const speakers = [...new Set(updated.segments.map((s) => s.speaker).filter(Boolean))];
    console.log(`  Labels assigned: ${speakers.join(', ') || '(none — check diarization.json timestamps overlap with transcript)'}`);

    return updated;
  }

  // Placeholder to match Transcriber's lifecycle API.
  async close() {}
}

export default Diarizer;
