import { spawn } from 'child_process';
import os from 'os';
import path from 'path';
import fs from 'fs-extra';

// Detect venv Python executable
function getVenvPython() {
  const venvPath = path.join(process.cwd(), '.venv');
  const pythonExe = process.platform === 'win32' 
    ? path.join(venvPath, 'Scripts', 'python.exe')
    : path.join(venvPath, 'bin', 'python');
  
  if (fs.existsSync(pythonExe)) {
    return pythonExe;
  }
  
  // Fallback to system python
  return 'python';
}

function spawnProcess(cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { 
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: process.env
    });
    let stderr = '';
    let stdout = '';
    
    proc.stderr.on('data', (d) => { 
      const chunk = d.toString();
      stderr += chunk;
      // Forward stderr to console in real-time for progress
      process.stderr.write(chunk);
    });
    
    proc.stdout.on('data', (d) => { 
      const chunk = d.toString();
      stdout += chunk;
      process.stdout.write(chunk);
    });
    
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`${cmd} exited with code ${code}\n${stderr}`));
      } else {
        resolve(stdout);
      }
    });
    
    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn ${cmd}: ${err.message}`));
    });
  });
}

// ms → "HH:MM:SS.mmm"
function msToVttTimestamp(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const mil = ms % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(mil).padStart(3, '0')}`;
}

class TranscriberGPU {
  constructor(options = {}) {
    this.audioPath = options.audioPath;
    this.outputDir = options.outputDir;
    this.model = options.model || 'medium.en';
    this.timestampOffset = options.timestampOffset || 0;
    this.device = options.device || 'cuda';
    this.tempDir = null;
  }

  async init() {
    if (!await fs.pathExists(this.audioPath)) {
      throw new Error(`Audio file not found: ${this.audioPath}`);
    }
    await fs.ensureDir(this.outputDir);
    this.tempDir = path.join(os.tmpdir(), `transcript-gpu-${Date.now()}`);
    await fs.ensureDir(this.tempDir);
  }

  async close() {
    if (this.tempDir) {
      await fs.remove(this.tempDir).catch(() => {});
    }
  }

  async convertToWav16k() {
    const outPath = path.join(this.tempDir, 'audio-16k.wav');
    await spawnProcess('ffmpeg', [
      '-i', this.audioPath,
      '-ar', '16000',
      '-ac', '1',
      '-c:a', 'pcm_s16le',
      outPath, '-y',
    ]);
    return outPath;
  }

  async runTranscription(wavPath) {
    const scriptPath = path.join(process.cwd(), 'scripts', 'transcribe', 'transcribe-gpu.py');
    const outputPath = path.join(this.tempDir, 'transcription.json');
    
    console.log(`  Running faster-whisper transcription (model: ${this.model}, device: ${this.device})...`);
    
    const pythonCmd = getVenvPython();
    console.log(`  Using Python: ${pythonCmd}`);
    
    await spawnProcess(pythonCmd, [
      scriptPath,
      '--audio', wavPath,
      '--model', this.model,
      '--output', outputPath,
      '--device', this.device,
      '--timestamp-offset', String(this.timestampOffset),
    ]);
    
    return await fs.readJson(outputPath);
  }

  buildVtt(transcription) {
    const lines = ['WEBVTT', ''];
    for (const segment of transcription) {
      if (segment.words && segment.words.length > 0) {
        for (const word of segment.words) {
          const startMs = word.start * 1000;
          const endMs = word.end * 1000;
          lines.push(`${msToVttTimestamp(startMs)} --> ${msToVttTimestamp(endMs)}`);
          lines.push(word.word);
          lines.push('');
        }
      } else {
        // Fallback to segment-level
        const startMs = segment.start * 1000;
        const endMs = segment.end * 1000;
        lines.push(`${msToVttTimestamp(startMs)} --> ${msToVttTimestamp(endMs)}`);
        lines.push(segment.text);
        lines.push('');
      }
    }
    return lines.join('\n');
  }

  buildJson(transcription) {
    // Convert faster-whisper format to our segment format
    const segments = transcription.map(seg => {
      // Convert words to tokens format with forced alignment timestamps
      const tokens = seg.words ? seg.words.map(w => ({
        text: w.word.trim(),
        t_dtw: w.start,
        t_end: w.end,
        probability: w.probability
      })) : [];
      
      return {
        id: seg.id,
        start: seg.start,
        end: seg.end,
        speaker: '',
        text: seg.text,
        tokens: tokens
      };
    });

    return {
      meta: { provider: 'faster-whisper-gpu', model: this.model, device: this.device },
      segments,
    };
  }

  async transcribe() {
    console.log('  Converting audio to 16kHz WAV...');
    const wavPath = await this.convertToWav16k();
    
    const transcription = await this.runTranscription(wavPath);
    
    const vtt = this.buildVtt(transcription);
    const json = this.buildJson(transcription);
    
    const vttPath = path.join(this.outputDir, 'transcript.vtt');
    const jsonPath = path.join(this.outputDir, 'transcript.raw.json');
    
    await fs.writeFile(vttPath, vtt);
    await fs.writeJson(jsonPath, json, { spaces: 2 });
    
    console.log(`  ✓ VTT:  ${vttPath}`);
    console.log(`  ✓ JSON: ${jsonPath}`);
    
    return json;
  }
}

export default TranscriberGPU;
