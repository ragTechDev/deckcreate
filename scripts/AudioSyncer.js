import { spawn } from 'child_process';
import os from 'os';
import path from 'path';
import fs from 'fs-extra';
import wavefileModule from 'wavefile';
const { WaveFile } = wavefileModule;
import FFT from 'fft.js';

function nextPowerOfTwo(n) {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

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

async function getMediaDuration(filePath) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      filePath,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffprobe failed for ${filePath}`));
      try {
        const data = JSON.parse(stdout);
        resolve(parseFloat(data.format.duration));
      } catch (e) {
        reject(new Error(`Failed to parse ffprobe output: ${e.message}`));
      }
    });
    proc.on('error', (err) => reject(new Error(`Failed to spawn ffprobe: ${err.message}`)));
  });
}

// Default correlation window: 300s keeps FFT size at ~4M samples (~64 MB), well within Node limits.
const DEFAULT_CORRELATION_WINDOW = 300;

class AudioSyncer {
  constructor(options = {}) {
    this.videoPath = options.videoPath;
    this.audioPath = options.audioPath;
    this.outputPath = options.outputPath;
    this.sampleRate = options.sampleRate || 8000;
    this.correlationWindow = options.windowSeconds || DEFAULT_CORRELATION_WINDOW;
    this.tempDir = null;
  }

  async init() {
    if (!await fs.pathExists(this.videoPath)) {
      throw new Error(`Video file not found: ${this.videoPath}`);
    }
    if (!await fs.pathExists(this.audioPath)) {
      throw new Error(`Audio file not found: ${this.audioPath}`);
    }
    await fs.ensureDir(path.dirname(this.outputPath));
    this.tempDir = path.join(os.tmpdir(), `sync-audio-${Date.now()}`);
    await fs.ensureDir(this.tempDir);
  }

  async close() {
    if (this.tempDir) {
      await fs.remove(this.tempDir).catch(() => {});
    }
  }

  async extractVideoAudio() {
    const outPath = path.join(this.tempDir, 'video-audio.wav');
    await spawnProcess('ffmpeg', [
      '-i', this.videoPath,
      '-t', String(this.correlationWindow),
      '-vn', '-ac', '1', '-ar', String(this.sampleRate),
      '-acodec', 'pcm_s16le', '-f', 'wav', outPath, '-y',
    ]);
    return outPath;
  }

  async convertAudioToWav() {
    const outPath = path.join(this.tempDir, 'audio-track.wav');
    await spawnProcess('ffmpeg', [
      '-i', this.audioPath,
      '-t', String(this.correlationWindow),
      '-ac', '1', '-ar', String(this.sampleRate),
      '-acodec', 'pcm_s16le', '-f', 'wav', outPath, '-y',
    ]);
    return outPath;
  }

  loadWavSamples(wavPath) {
    const buf = fs.readFileSync(wavPath);
    const wav = new WaveFile(buf);
    wav.toBitDepth('32f');
    const samples = wav.getSamples(false, Float32Array);
    return samples;
  }

  computeCrossCorrelation(samplesA, samplesB) {
    const lenA = samplesA.length;
    const lenB = samplesB.length;
    const N = nextPowerOfTwo(lenA + lenB - 1);

    const estimatedMB = Math.round((N * 16) / 1e6);
    console.log(`  FFT size: ${N.toLocaleString()} samples (~${estimatedMB} MB)`);

    const fft = new FFT(N);

    // Build complex arrays (interleaved re, im)
    const cA = fft.createComplexArray();
    const cB = fft.createComplexArray();
    for (let i = 0; i < lenA; i++) cA[2 * i] = samplesA[i];
    for (let i = 0; i < lenB; i++) cB[2 * i] = samplesB[i];

    const FA = fft.createComplexArray();
    const FB = fft.createComplexArray();
    fft.transform(FA, cA);
    fft.transform(FB, cB);

    // Multiply FA by conjugate of FB
    const product = fft.createComplexArray();
    for (let i = 0; i < N; i++) {
      const re = FA[2 * i] * FB[2 * i] + FA[2 * i + 1] * FB[2 * i + 1];
      const im = FA[2 * i + 1] * FB[2 * i] - FA[2 * i] * FB[2 * i + 1];
      product[2 * i] = re;
      product[2 * i + 1] = im;
    }

    // Inverse FFT
    const result = fft.createComplexArray();
    fft.inverseTransform(result, product);

    // Extract real part (normalized by N)
    const correlation = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      correlation[i] = result[2 * i] / N;
    }

    return correlation;
  }

  findBestLag(correlation, lenA) {
    const N = correlation.length;
    let maxVal = -Infinity;
    let maxIdx = 0;
    for (let i = 0; i < N; i++) {
      const v = Math.abs(correlation[i]);
      if (v > maxVal) { maxVal = v; maxIdx = i; }
    }

    // Convert circular index to signed lag in samples
    const lagSamples = maxIdx <= N / 2 ? maxIdx : maxIdx - N;
    return lagSamples / this.sampleRate;
  }

  validatePeak(correlation, lagSeconds) {
    const N = correlation.length;
    let sum = 0, sumSq = 0;
    for (let i = 0; i < N; i++) { sum += correlation[i]; sumSq += correlation[i] ** 2; }
    const mean = sum / N;
    const std = Math.sqrt(sumSq / N - mean ** 2);

    const lagSamples = Math.round(lagSeconds * this.sampleRate);
    const idx = ((lagSamples % N) + N) % N;
    const snr = std > 0 ? Math.abs(correlation[idx] - mean) / std : 0;

    return { snr, isReliable: snr >= 3.0 };
  }

  async computeTrimPoints(lagSeconds) {
    const videoDuration = await getMediaDuration(this.videoPath);
    const audioDuration = await getMediaDuration(this.audioPath);

    // Positive lag: external audio starts lagSeconds after video audio -> trim video start
    // Negative lag: external audio starts |lag| before video audio -> trim audio start
    const videoStart = Math.max(0, lagSeconds);
    const audioStart = Math.max(0, -lagSeconds);
    const duration = Math.min(
      videoDuration - videoStart,
      audioDuration - audioStart,
    );

    if (duration <= 0) {
      throw new Error(
        `Computed duration is ${duration.toFixed(3)}s — the files may not overlap. ` +
        `Video duration: ${videoDuration.toFixed(1)}s, Audio duration: ${audioDuration.toFixed(1)}s, lag: ${lagSeconds.toFixed(3)}s`
      );
    }

    return { videoStart, audioStart, duration, videoDuration, audioDuration };
  }

  async runFinalFfmpeg(trimPoints) {
    const { videoStart, audioStart, duration } = trimPoints;
    const args = [
      '-ss', String(videoStart), '-i', this.videoPath,
      '-ss', String(audioStart), '-i', this.audioPath,
      '-t', String(duration),
      '-map', '0:v:0',
      '-map', '1:a:0',
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-movflags', '+faststart',
      this.outputPath,
      '-y',
    ];
    await spawnProcess('ffmpeg', args);
  }

  async sync() {
    console.log('Step 1/5: Extracting audio from video (may take a while for large files)...');
    const videoWav = await this.extractVideoAudio();

    console.log('Step 2/5: Converting audio file to WAV...');
    const audioWav = await this.convertAudioToWav();

    console.log('Step 3/5: Loading waveform data...');
    const videoSamples = this.loadWavSamples(videoWav);
    const audioSamples = this.loadWavSamples(audioWav);
    console.log(`  Video audio:    ${(videoSamples.length / this.sampleRate).toFixed(1)}s (${videoSamples.length.toLocaleString()} samples)`);
    console.log(`  External audio: ${(audioSamples.length / this.sampleRate).toFixed(1)}s (${audioSamples.length.toLocaleString()} samples)`);

    console.log('Step 4/5: Computing cross-correlation via FFT...');
    const correlation = this.computeCrossCorrelation(videoSamples, audioSamples);
    const lagSeconds = this.findBestLag(correlation, videoSamples.length);
    const { snr, isReliable } = this.validatePeak(correlation, lagSeconds);

    console.log(`  Best lag:   ${lagSeconds.toFixed(3)}s  (SNR: ${snr.toFixed(1)}${isReliable ? '' : ' — LOW CONFIDENCE, verify output manually'})`);
    if (lagSeconds >= 0) {
      console.log(`  Interpretation: external audio starts ${lagSeconds.toFixed(3)}s AFTER video audio -> trimming video start`);
    } else {
      console.log(`  Interpretation: external audio starts ${Math.abs(lagSeconds).toFixed(3)}s BEFORE video audio -> trimming audio start`);
    }

    const trimPoints = await this.computeTrimPoints(lagSeconds);
    console.log(`  Video start:    ${trimPoints.videoStart.toFixed(3)}s`);
    console.log(`  Audio start:    ${trimPoints.audioStart.toFixed(3)}s`);
    console.log(`  Output duration: ${trimPoints.duration.toFixed(3)}s`);

    console.log('Step 5/5: Producing synchronized output MP4...');
    await this.runFinalFfmpeg(trimPoints);
    console.log(`Done. Output: ${this.outputPath}`);
  }
}

export default AudioSyncer;
