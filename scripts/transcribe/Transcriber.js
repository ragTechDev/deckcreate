import { spawn } from 'child_process';
import os from 'os';
import path from 'path';
import fs from 'fs-extra';
import { installWhisperCpp, downloadWhisperModel, transcribe } from '@remotion/install-whisper-cpp';

const WHISPER_VERSION = '1.5.5';
const DEFAULT_MODEL = 'medium.en';

function spawnProcess(cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      if (code !== 0) reject(new Error(`${cmd} exited with code ${code}\n${stderr}`));
      else resolve();
    });
    proc.on('error', (err) => reject(new Error(`Failed to spawn ${cmd}: ${err.message}`)));
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

class Transcriber {
  constructor(options = {}) {
    this.audioPath = options.audioPath;
    this.outputDir = options.outputDir;
    this.model = options.model || DEFAULT_MODEL;
    this.whisperDir = options.whisperDir || path.join(process.cwd(), 'whisper.cpp');
    this.timestampOffset = options.timestampOffset || 0; // seconds to subtract from all timestamps
    this.tempDir = null;
  }

  async init() {
    if (!await fs.pathExists(this.audioPath)) {
      throw new Error(`Audio file not found: ${this.audioPath}`);
    }
    await fs.ensureDir(this.outputDir);
    this.tempDir = path.join(os.tmpdir(), `transcript-${Date.now()}`);
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

  async ensureWhisper() {
    const binaryName = process.platform === 'win32' ? 'main.exe' : 'main';
    const binaryPath = path.join(this.whisperDir, binaryName);
    const dirExists = await fs.pathExists(this.whisperDir);
    const binaryExists = await fs.pathExists(binaryPath);

    // If the folder exists without the binary it's a broken install — clean it up
    if (dirExists && !binaryExists) {
      console.log('  Removing incomplete whisper.cpp installation...');
      await fs.remove(this.whisperDir);
    }

    // Guard against a wrong-platform binary (e.g. Linux ELF installed via Docker on macOS).
    // ELF magic: 0x7F 'E' 'L' 'F'. On a non-Linux host an ELF binary cannot run and will
    // not use Metal acceleration even if somehow invoked through a compatibility layer.
    if (binaryExists && process.platform !== 'linux') {
      const fd = await fs.open(binaryPath, 'r');
      const magic = Buffer.alloc(4);
      await fd.read(magic, 0, 4, 0);
      await fd.close();
      const isElf = magic[0] === 0x7F && magic[1] === 0x45 && magic[2] === 0x4C && magic[3] === 0x46;
      if (isElf) {
        console.log('  Detected Linux whisper.cpp binary on non-Linux host — reinstalling for this platform...');
        await fs.remove(this.whisperDir);
        binaryExists = false;
      }
    }

    if (!binaryExists) {
      console.log('  Installing whisper.cpp (one-time setup)...');
      await installWhisperCpp({ to: this.whisperDir, version: WHISPER_VERSION });
    }
    const modelPath = path.join(this.whisperDir, `ggml-${this.model}.bin`);
    if (!await fs.pathExists(modelPath)) {
      console.log(`  Downloading model "${this.model}" (one-time download)...`);
      await downloadWhisperModel({ model: this.model, folder: this.whisperDir });
    }
  }

  async runWhisper(wavPath) {
    return transcribe({
      inputPath: wavPath,
      whisperPath: this.whisperDir,
      whisperCppVersion: WHISPER_VERSION,
      model: this.model,
      tokenLevelTimestamps: true,
      printOutput: false,
    });
  }

  buildVtt(transcription) {
    const lines = ['WEBVTT', ''];
    for (const item of transcription) {
      const tokens = (item.tokens || []).filter(t => t.t_dtw >= 0);
      if (tokens.length === 0) {
        // Fallback to segment-level if no valid token timestamps
        lines.push(`${msToVttTimestamp(item.offsets.from)} --> ${msToVttTimestamp(item.offsets.to)}`);
        lines.push(item.text.trim());
        lines.push('');
        continue;
      }
      for (let i = 0; i < tokens.length; i++) {
        const offsetMs = this.timestampOffset * 1000;
        const startMs = Math.max(0, tokens[i].t_dtw * 10 - offsetMs);           // centiseconds → ms, minus offset
        const endMs = i + 1 < tokens.length
          ? Math.max(0, tokens[i + 1].t_dtw * 10 - offsetMs)
          : item.offsets.to;
        const word = tokens[i].text.trim();
        if (!word) continue;
        lines.push(`${msToVttTimestamp(startMs)} --> ${msToVttTimestamp(endMs)}`);
        lines.push(word);
        lines.push('');
      }
    }
    return lines.join('\n');
  }

  // With tokenLevelTimestamps:true, whisper emits one item per word.
  // Merge them into phrase-level segments for the raw JSON.
  mergeItemsIntoPhrases(transcription) {
    const PHRASE_END = /[.!?]$/;
    const MAX_WORDS = 8;
    const PAUSE_THRESHOLD = 0.7; // seconds

    const phrases = [];
    let bucket = null;

    for (let i = 0; i < transcription.length; i++) {
      const item = transcription[i];
      const next = transcription[i + 1];
      const token = item.tokens?.[0] ?? null;

      if (!bucket) {
        bucket = {
          start: item.offsets.from,
          end: item.offsets.to,
          words: [item.text],
          tokens: token ? [token] : [],
        };
      } else {
        bucket.end = item.offsets.to;
        bucket.words.push(item.text);
        if (token) bucket.tokens.push(token);
      }

      const endsWithPunctuation = PHRASE_END.test(item.text.trim());
      const longPause = next && (next.offsets.from - item.offsets.to) / 1000 > PAUSE_THRESHOLD;
      const tooLong = bucket.words.length >= MAX_WORDS;

      if (endsWithPunctuation || longPause || tooLong || !next) {
        phrases.push(bucket);
        bucket = null;
      }
    }

    return phrases;
  }

  buildJson(transcription) {
    const phrases = this.mergeItemsIntoPhrases(transcription);

    const off = this.timestampOffset;
    const segments = phrases.map((phrase, i) => ({
      id: i + 1,
      start: Math.max(0, phrase.start / 1000 - off),
      end: Math.max(0, phrase.end / 1000 - off),
      speaker: '',
      text: phrase.words.reduce((acc, w) => {
        const stripped = w.replace(/^[^\w']+|[^\w']+$/g, '');
        if (!stripped) return acc;
        return (!acc || w.startsWith(' ')) ? (acc ? `${acc} ${stripped}` : stripped) : acc + stripped;
      }, ''),
      cut: false,
      cutReason: null,
      // t_dtw is in centiseconds (1/100 s) per whisper.cpp convention
      tokens: phrase.tokens.map(t => ({
        t_dtw: Math.max(0, t.t_dtw / 100 - off),
        text: t.text,
        cut: false,
        cutReason: null,
      })),
      cuts: [],
      graphics: [],
    }));

    return {
      meta: {
        title: '',
        duration: segments.length ? segments[segments.length - 1].end : 0,
        fps: 60,
      },
      segments,
    };
  }

  async transcribe() {
    console.log('Step 1/4: Ensuring whisper.cpp is installed...');
    await this.ensureWhisper();

    console.log('Step 2/4: Converting audio to 16 kHz WAV...');
    const wavPath = await this.convertToWav16k();

    console.log('Step 3/4: Transcribing with Whisper (this may take a while)...');
    const whisperStart = Date.now();
    const heartbeat = setInterval(() => {
      const s = Math.floor((Date.now() - whisperStart) / 1000);
      const m = Math.floor(s / 60);
      console.log(`  Still transcribing... [${m}m ${String(s % 60).padStart(2, '0')}s elapsed]`);
    }, 15000);
    let transcription;
    try {
      ({ transcription } = await this.runWhisper(wavPath));
    } finally {
      clearInterval(heartbeat);
    }

    console.log('Step 4/4: Writing outputs...');
    const vttPath = path.join(this.outputDir, 'transcript.raw.vtt');
    const jsonPath = path.join(this.outputDir, 'transcript.raw.json');

    await fs.writeFile(vttPath, this.buildVtt(transcription), 'utf8');
    await fs.writeJson(jsonPath, this.buildJson(transcription), { spaces: 2 });

    console.log(`  VTT:  ${vttPath}`);
    console.log(`  JSON: ${jsonPath}`);

    return { vttPath, jsonPath };
  }
}

export default Transcriber;
