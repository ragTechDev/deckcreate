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

async function getAudioChannels(filePath) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_streams',
      '-select_streams', 'a:0',
      filePath,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffprobe failed for ${filePath}`));
      try {
        const data = JSON.parse(stdout);
        resolve(data.streams?.[0]?.channels ?? 1);
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

  // ─── Audio processing ───────────────────────────────────────────────────────

  /**
   * Shared processing chain applied to both outputs before loudness normalisation:
   *   0. Stereo→mono downmix (aformat) — only when input has ≥2 channels
   *   1. High-pass at 80 Hz  — removes low-frequency rumble and hiss
   *   2. FFT denoising       — broadband noise reduction (noise floor -25 dB)
   *   3. Low-mid cut 300 Hz  — reduces boxiness/muddiness
   *   4. Presence boost 3 kHz — adds vocal clarity and intelligibility
   *   5. Dynamic compressor  — evens out volume, ratio 4:1 with soft makeup gain
   */
  buildBaseFilterChain(isStereo = false) {
    const filters = [];
    if (isStereo) filters.push('aformat=channel_layouts=mono');
    filters.push(
      'highpass=f=80',
      'afftdn=nf=-25',
      'equalizer=f=300:width_type=o:width=2:g=-2',
      'equalizer=f=3000:width_type=o:width=2:g=2',
      'acompressor=threshold=-20dB:ratio=4:attack=5:release=50:makeup=3dB',
    );
    return filters.join(',');
  }

  /**
   * Two-pass loudnorm: first pass measures actual loudness of the source,
   * second pass uses those measurements for accurate linear normalisation.
   * Returns the parsed JSON stats from ffmpeg's loudnorm filter.
   */
  async measureLoudness(audioStart, duration, baseFilter, targetI, targetTP) {
    const filter = `${baseFilter},loudnorm=I=${targetI}:TP=${targetTP}:LRA=11:print_format=json`;
    return new Promise((resolve, reject) => {
      const proc = spawn('ffmpeg', [
        '-ss', String(audioStart),
        '-i', this.audioPath,
        '-t', String(duration),
        '-af', filter,
        '-f', 'null', '-',
        '-y',
      ], { stdio: ['ignore', 'pipe', 'pipe'] });

      let stderr = '';
      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      proc.on('close', (code) => {
        // loudnorm prints its JSON block to stderr after processing completes
        const start = stderr.lastIndexOf('{');
        const end = stderr.lastIndexOf('}');
        if (start === -1 || end === -1) {
          return reject(new Error('loudnorm measurement JSON not found in ffmpeg output'));
        }
        try {
          resolve(JSON.parse(stderr.slice(start, end + 1)));
        } catch (e) {
          reject(new Error(`Failed to parse loudnorm JSON: ${e.message}`));
        }
      });
      proc.on('error', (err) => reject(new Error(`Failed to spawn ffmpeg: ${err.message}`)));
    });
  }

  buildLoudnormFilter(stats, targetI, targetTP) {
    return [
      `loudnorm=I=${targetI}:TP=${targetTP}:LRA=11`,
      `measured_I=${stats.input_i}`,
      `measured_TP=${stats.input_tp}`,
      `measured_LRA=${stats.input_lra}`,
      `measured_thresh=${stats.input_thresh}`,
      `offset=${stats.target_offset}`,
      'linear=true',
    ].join(':');
  }

  /**
   * Produce the synchronized video MP4 with processed audio.
   * Audio target: -1 dBFS true peak (iZotope peak normalisation advice).
   */
  async runVideoOutput(trimPoints, baseFilter, videoStats) {
    const { videoStart, audioStart, duration } = trimPoints;
    const loudnorm = this.buildLoudnormFilter(videoStats, -16, -1);
    const audioFilter = `[1:a]${baseFilter},${loudnorm}[a_out]`;

    await spawnProcess('ffmpeg', [
      '-ss', String(videoStart), '-i', this.videoPath,
      '-ss', String(audioStart), '-i', this.audioPath,
      '-t', String(duration),
      '-filter_complex', audioFilter,
      '-map', '0:v:0',
      '-map', '[a_out]',
      '-c:v', 'copy',
      '-c:a', 'aac', '-b:a', '192k',
      '-movflags', '+faststart',
      this.outputPath,
      '-y',
    ]);
  }

  /**
   * Produce the standalone processed audio MP3.
   * Audio target: -14 LUFS integrated, TP -1 dB (or -2 dB if source is louder than -14 LUFS).
   * Output format: 24-bit PCM WAV (lossless).
   */
  async runAudioOutput(trimPoints, baseFilter, audioStats, audioOutputPath, tp = -1) {
    const { audioStart, duration } = trimPoints;
    const loudnorm = this.buildLoudnormFilter(audioStats, -14, tp);
    const filter = `${baseFilter},${loudnorm}`;

    await spawnProcess('ffmpeg', [
      '-ss', String(audioStart),
      '-i', this.audioPath,
      '-t', String(duration),
      '-af', filter,
      '-c:a', 'pcm_s24le',
      audioOutputPath,
      '-y',
    ]);
  }

  // ─── Orchestration ───────────────────────────────────────────────────────────

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
    console.log(`  Video start:     ${trimPoints.videoStart.toFixed(3)}s`);
    console.log(`  Audio start:     ${trimPoints.audioStart.toFixed(3)}s`);
    console.log(`  Output duration: ${trimPoints.duration.toFixed(3)}s`);

    console.log('Step 5/5: Processing audio and producing outputs...');
    const audioChannels = await getAudioChannels(this.audioPath);
    const isStereo = audioChannels >= 2;
    if (isStereo) console.log(`  Input audio has ${audioChannels} channels — downmixing to mono.`);
    const baseFilter = this.buildBaseFilterChain(isStereo);

    // Video: iZotope advice — normalise max peaks to -1 dBFS
    console.log('  Measuring loudness for video output (-1 dBFS TP)...');
    const videoStats = await this.measureLoudness(trimPoints.audioStart, trimPoints.duration, baseFilter, -16, -1);
    console.log(`  Video audio measured: ${videoStats.input_i} LUFS integrated, ${videoStats.input_tp} dBTP`);

    // Audio: Spotify advice — -14 LUFS integrated; TP -1 if source <= -14 LUFS, else TP -2
    console.log('  Measuring loudness for audio output (-14 LUFS)...');
    const audioStats = await this.measureLoudness(trimPoints.audioStart, trimPoints.duration, baseFilter, -14, -1);
    const audioTP = parseFloat(audioStats.input_i) > -14 ? -2 : -1;
    console.log(`  Audio measured:       ${audioStats.input_i} LUFS integrated, ${audioStats.input_tp} dBTP -> using TP=${audioTP} dB`);

    console.log('  Rendering video output...');
    await this.runVideoOutput(trimPoints, baseFilter, videoStats);
    console.log(`  Video: ${this.outputPath}`);

    const audioOutputPath = this.outputPath.replace(/\.[^.]+$/, '.wav');
    console.log('  Rendering audio output...');
    await this.runAudioOutput(trimPoints, baseFilter, audioStats, audioOutputPath, audioTP);
    console.log(`  Audio: ${audioOutputPath}`);

    console.log('Done.');
  }
}

export default AudioSyncer;
