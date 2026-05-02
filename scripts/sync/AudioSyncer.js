import { spawn } from 'child_process';
import os from 'os';
import path from 'path';
import fs from 'fs-extra';
import wavefileModule from 'wavefile';
import { detectHDR, HDR_TONEMAP_VF, SDR_FORMAT_VF } from '../shared/hdr-detect.js';
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
   *   2. Low-mid cut 300 Hz  — reduces boxiness/muddiness
   *   3. Presence boost 3 kHz — adds vocal clarity and intelligibility
   *   4. Dynamic compressor  — evens out volume, ratio 2:1 (transparent)
   *
   * afftdn is intentionally absent: FFT denoising on clean podcast audio
   * introduces spectral phase artifacts ("watery" / phasey effect). Loudnorm
   * handles gain staging so no makeup gain is needed on the compressor.
   */
  buildBaseFilterChain(isStereo = false) {
    const filters = [];
    if (isStereo) filters.push('aformat=channel_layouts=mono');
    filters.push(
      'highpass=f=80',
      'equalizer=f=300:width_type=o:width=2:g=-2',
      'equalizer=f=3000:width_type=o:width=2:g=2',
      'acompressor=threshold=-20dB:ratio=2:attack=5:release=50',
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

    // Detect HDR so we can tonemap to BT.709 before encoding to H.264.
    // Without tonemapping, HDR transfer functions (HLG/PQ) produce washed-out
    // 8-bit output because the luminance values are interpreted as SDR.
    const isHDR = await detectHDR(this.videoPath);
    if (isHDR) console.log('  HDR source detected — applying HLG/PQ→BT.709 tonemapping.');
    const videoVf = isHDR ? HDR_TONEMAP_VF : SDR_FORMAT_VF;

    // Both video and audio go through filter_complex so we can map the
    // tonemapped video stream alongside the loudness-normalised audio stream.
    const filterComplex = `[0:v]${videoVf}[v_out];[1:a]${baseFilter},${loudnorm}[a_out]`;

    // Use VideoToolbox hardware encoder on macOS; fall back to libx264 elsewhere.
    // -sc_threshold and -keyint_min are libx264-only options, omitted for VideoToolbox.
    const videoEncArgs = process.platform === 'darwin'
      ? ['-c:v', 'h264_videotoolbox', '-q:v', '65', '-g', '60']
      : ['-c:v', 'libx264', '-crf', '23', '-preset', 'fast', '-g', '60', '-keyint_min', '60', '-sc_threshold', '0'];

    await spawnProcess('ffmpeg', [
      '-ss', String(videoStart), '-i', this.videoPath,
      '-ss', String(audioStart), '-i', this.audioPath,
      '-t', String(duration),
      '-filter_complex', filterComplex,
      '-map', '[v_out]',
      '-map', '[a_out]',
      // Re-encode video so keyframes land every 1 s (g=fps). Stream-copying
      // preserves the original recording's sparse keyframe structure, which
      // can leave gaps of 10–30 s between keyframes. Remotion's OffthreadVideo
      // must seek into the middle of the file for hook clips; without nearby
      // keyframes it snaps to the preceding one and plays from there, causing
      // the hook to start many seconds before the intended frame.
      ...videoEncArgs,
      // format=yuv420p is already at the end of both videoVf chains
      '-c:a', 'aac', '-ar', '48000', '-b:a', '192k',
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

  // ─── Validation ──────────────────────────────────────────────────────────────

  /**
   * Computes a quick content fingerprint from the first 64KB of the file.
   * Catches copies made to different directories (e.g., angle1.mp4 copied to angle2/).
   *
   * @param {string} filePath
   * @returns {Promise<string>} sha256 hash of sample
   */
  static async getContentFingerprint(filePath) {
    const { createHash } = await import('crypto');
    const hash = createHash('sha256');
    const fd = await fs.open(filePath, 'r');
    try {
      const buffer = Buffer.alloc(64 * 1024); // Sample first 64KB
      const { bytesRead } = await fd.read(buffer, 0, buffer.length, 0);
      hash.update(buffer.slice(0, bytesRead));
      return hash.digest('hex');
    } finally {
      await fd.close();
    }
  }

  /**
   * Validates that all video paths point to distinct files.
   * Checks for: duplicate paths, same inode (hardlinks/symlinks), and same content.
   *
   * @param {string[]} videoPaths
   * @throws {Error} if duplicates are detected
   */
  static async validateUniqueVideos(videoPaths) {
    // Level 1: Path deduplication (catches same path passed twice)
    const normalizedPaths = videoPaths.map(p => path.resolve(p));
    const pathSet = new Set();
    for (const p of normalizedPaths) {
      if (pathSet.has(p)) {
        throw new Error(`Duplicate video path detected: ${p}. Each angle must be a different video file.`);
      }
      pathSet.add(p);
    }

    // Level 2: Inode check (catches hardlinks/symlinks to same file)
    const identities = await Promise.all(videoPaths.map(async (p) => {
      const stats = await fs.stat(p);
      return `${stats.dev}-${stats.ino}`;
    }));
    const inodeSet = new Set();
    for (let i = 0; i < identities.length; i++) {
      if (inodeSet.has(identities[i])) {
        throw new Error(
          `Same file used for multiple angles (symlink/hardlink): ${videoPaths[i]}. ` +
          `Each angle must be a different video file.`
        );
      }
      inodeSet.add(identities[i]);
    }

    // Level 3: Content fingerprint (catches copies to different directories)
    const fingerprints = await Promise.all(videoPaths.map(p => this.getContentFingerprint(p)));
    const contentSet = new Set();
    for (let i = 0; i < fingerprints.length; i++) {
      if (contentSet.has(fingerprints[i])) {
        throw new Error(
          `Duplicate video content detected: ${videoPaths[i]} matches another angle's file. ` +
          `Each angle must be a different video recording.`
        );
      }
      contentSet.add(fingerprints[i]);
    }
  }

  // ─── Orchestration ───────────────────────────────────────────────────────────

  /**
   * Phase 1 of sync: extract audio from this video and compute its lag against
   * the external audio track.  Does NOT write any output files.
   *
   * @returns {{ lagSeconds: number, snr: number, isReliable: boolean }}
   */
  async computeLag() {
    console.log('  Step A/B: Extracting audio tracks in parallel...');
    const [videoWav, audioWav] = await Promise.all([
      this.extractVideoAudio(),
      this.convertAudioToWav(),
    ]);

    console.log('  Step C: Loading waveform data...');
    const videoSamples = this.loadWavSamples(videoWav);
    const audioSamples = this.loadWavSamples(audioWav);
    console.log(`    Video audio:    ${(videoSamples.length / this.sampleRate).toFixed(1)}s (${videoSamples.length.toLocaleString()} samples)`);
    console.log(`    External audio: ${(audioSamples.length / this.sampleRate).toFixed(1)}s (${audioSamples.length.toLocaleString()} samples)`);

    console.log('  Step D: Computing cross-correlation via FFT...');
    const correlation = this.computeCrossCorrelation(videoSamples, audioSamples);
    const lagSeconds = this.findBestLag(correlation, videoSamples.length);
    const { snr, isReliable } = this.validatePeak(correlation, lagSeconds);

    return { lagSeconds, snr, isReliable };
  }

  /**
   * Phase 2 of sync: measure loudness and render the output video (and
   * optionally a standalone processed audio WAV) using pre-computed trim points.
   *
   * @param {{ videoStart: number, audioStart: number, duration: number }} trimPoints
   * @param {boolean} produceAudioFile  When true, also writes a .wav alongside the video.
   */
  async produceOutput(trimPoints, produceAudioFile = true) {
    const audioChannels = await getAudioChannels(this.audioPath);
    const isStereo = audioChannels >= 2;
    if (isStereo) console.log(`  Input audio has ${audioChannels} channels — downmixing to mono.`);
    const baseFilter = this.buildBaseFilterChain(isStereo);

    console.log('  Measuring loudness (-16 LUFS target, single pass)...');
    const videoStats = await this.measureLoudness(trimPoints.audioStart, trimPoints.duration, baseFilter, -16, -1);
    console.log(`  Measured: ${videoStats.input_i} LUFS integrated, ${videoStats.input_tp} dBTP`);

    console.log('  Rendering video output...');
    await this.runVideoOutput(trimPoints, baseFilter, videoStats);
    console.log(`  Video: ${this.outputPath}`);

    if (produceAudioFile) {
      // Derive the -14 LUFS audio target from the single measurement pass.
      // target_offset = targetI − input_I; shifting from −16 to −14 adds 2 dB.
      const audioTP = parseFloat(videoStats.input_i) > -14 ? -2 : -1;
      const audioStats = { ...videoStats, target_offset: String(parseFloat(videoStats.target_offset) + 2) };

      const audioOutputPath = this.outputPath.replace(/\.[^.]+$/, '.wav');
      console.log(`  Rendering audio output (-14 LUFS, TP=${audioTP} dB)...`);
      await this.runAudioOutput(trimPoints, baseFilter, audioStats, audioOutputPath, audioTP);
      console.log(`  Audio: ${audioOutputPath}`);
    }
  }

  async sync() {
    console.log('Step 1/2: Computing lag...');
    const { lagSeconds, snr, isReliable } = await this.computeLag();

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

    console.log('Step 2/2: Processing audio and producing outputs...');
    await this.produceOutput(trimPoints, true);

    console.log('Done.');
  }

  /**
   * Sync multiple video angles to the same audio track so that all output files
   * are anchored to the exact same moment in the audio timeline.
   *
   * The bug with the naive "sync each video independently" approach:
   *   - If angle-1's camera started BEFORE the audio (lag > 0): output starts at
   *     audio time 0.
   *   - If angle-2's camera started AFTER the audio (lag < 0): output starts at
   *     audio time |lag|.
   *   → The two outputs are misaligned by |lag| seconds.
   *
   * Fix — two-pass approach:
   *   Pass 1  Compute the lag of every angle against the shared audio.
   *   Pass 2  Use a single common audio start point (T_common = the latest absolute
   *           start among all angles) so every output begins at the same audio frame.
   *           For each angle i: videoStart_i = lag_i + T_common (always ≥ 0),
   *           audioStart = T_common.
   *
   * @param {string[]} videoPaths   Paths to each angle's video file.
   * @param {string}   audioPath    Path to the shared audio file.
   * @param {string}   outputDir    Directory to write synced output files into.
   * @returns {Promise<Array<{outputPath: string, videoSrc: string, sourceWidth: number, sourceHeight: number}>>}
   */
  static async syncMultiple(videoPaths, audioPath, outputDir) {
    await this.validateUniqueVideos(videoPaths);
    await fs.ensureDir(outputDir);

    // ── Pass 1: compute lags ──────────────────────────────────────────────────
    console.log('\n── Pass 1/2: Computing lags for all angles ──────────────────────────────');

    const syncers = [];
    const lags = [];

    for (let i = 0; i < videoPaths.length; i++) {
      const outputFileName = `synced-output-${i + 1}.mp4`;
      const outputPath = path.join(outputDir, outputFileName);
      const syncer = new AudioSyncer({ videoPath: videoPaths[i], audioPath, outputPath });
      await syncer.init();
      syncers.push(syncer);

      console.log(`\n  Angle ${i + 1}/${videoPaths.length}: ${path.basename(videoPaths[i])}`);
      const { lagSeconds, snr, isReliable } = await syncer.computeLag();
      lags.push(lagSeconds);

      console.log(`  Best lag: ${lagSeconds.toFixed(3)}s  (SNR: ${snr.toFixed(1)}${isReliable ? '' : ' — LOW CONFIDENCE'})`);
      if (lagSeconds >= 0) {
        console.log(`  Interpretation: external audio starts ${lagSeconds.toFixed(3)}s AFTER video audio`);
      } else {
        console.log(`  Interpretation: external audio starts ${Math.abs(lagSeconds).toFixed(3)}s BEFORE video audio`);
      }
    }

    // ── Compute common reference ──────────────────────────────────────────────
    //
    // T_common is the external-audio time at which ALL angles have video data.
    // Each angle i contributes video from absolute audio time max(0, -lag_i).
    // The common start is the latest of these, i.e. max(0, -min(lags)).
    //
    //   videoStart_i = lag_i + T_common   (guaranteed ≥ 0 for all i)
    //   audioStart   = T_common           (identical for all angles)
    //
    const T_common = Math.max(0, ...lags.map(l => -l));
    const audioDuration = await getMediaDuration(audioPath);

    // Compute per-angle video starts and find the shortest available span.
    const videoStarts = lags.map(l => l + T_common);
    const videoDurations = await Promise.all(syncers.map(s => getMediaDuration(s.videoPath)));
    const commonDuration = Math.min(
      audioDuration - T_common,
      ...videoStarts.map((vs, i) => videoDurations[i] - vs),
    );

    if (commonDuration <= 0) {
      throw new Error(
        `Cannot align angles: computed common duration is ${commonDuration.toFixed(3)}s. ` +
        `Check that all videos and the audio overlap in time.`
      );
    }

    console.log(`\n── Common reference ─────────────────────────────────────────────────────`);
    console.log(`  Audio start (T_common): ${T_common.toFixed(3)}s`);
    console.log(`  Common duration:        ${commonDuration.toFixed(3)}s`);
    for (let i = 0; i < videoPaths.length; i++) {
      console.log(`  Angle ${i + 1} video start:   ${videoStarts[i].toFixed(3)}s  (lag ${lags[i].toFixed(3)}s)`);
    }

    // ── Pass 2: produce outputs ───────────────────────────────────────────────
    console.log('\n── Pass 2/2: Producing aligned outputs ──────────────────────────────────');

    const results = [];

    for (let i = 0; i < syncers.length; i++) {
      const syncer = syncers[i];
      console.log(`\n  Angle ${i + 1}/${syncers.length}: ${path.basename(videoPaths[i])}`);

      const trimPoints = {
        videoStart: videoStarts[i],
        audioStart: T_common,
        duration: commonDuration,
        videoDuration: videoDurations[i],
        audioDuration,
      };

      // Produce the audio WAV master only from angle 1 (it's the same audio for all).
      const produceAudioFile = i === 0;
      try {
        await syncer.produceOutput(trimPoints, produceAudioFile);
      } finally {
        await syncer.close();
      }

      const { width: sourceWidth, height: sourceHeight } = await getVideoDimensions(syncer.outputPath);
      results.push({ outputPath: syncer.outputPath, videoSrc: syncer.outputPath, sourceWidth, sourceHeight });
    }

    return results;
  }
}

/**
 * Returns the pixel dimensions of the video stream in the given file.
 * @param {string} filePath
 * @returns {Promise<{width: number, height: number}>}
 */
async function getVideoDimensions(filePath) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_streams',
      '-select_streams', 'v:0',
      filePath,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffprobe failed for ${filePath}`));
      try {
        const data = JSON.parse(stdout);
        const stream = data.streams?.[0];
        if (!stream) return reject(new Error(`No video stream found in ${filePath}`));
        resolve({ width: parseInt(stream.width, 10), height: parseInt(stream.height, 10) });
      } catch (e) {
        reject(new Error(`Failed to parse ffprobe output: ${e.message}`));
      }
    });
    proc.on('error', (err) => reject(new Error(`Failed to spawn ffprobe: ${err.message}`)));
  });
}

export default AudioSyncer;
