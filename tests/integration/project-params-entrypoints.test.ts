import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

function mkTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'deckcreate-params-test-'));
}

function writeProjectJson(dir: string, params: Record<string, unknown>): void {
  const ragtech = path.join(dir, '.ragtech');
  fs.mkdirSync(ragtech, { recursive: true });
  fs.writeFileSync(
    path.join(ragtech, 'project.json'),
    JSON.stringify({
      version: '1.0.0',
      episode: { id: 'ep-test' },
      brandId: 'ragtech',
      tools: {},
      params,
      artifacts: {},
    }),
    'utf-8',
  );
}

const REPO_ROOT = path.resolve(__dirname, '../..');

describe('diarize-audio.js reads num_speakers from project file', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = mkTmpDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('prints locked speaker count from project file when --num-speakers is absent', () => {
    writeProjectJson(tmpDir, { num_speakers: 3 });

    const result = spawnSync(
      process.execPath,
      [path.join(REPO_ROOT, 'scripts/diarize/diarize-audio.js'), '--audio', '/fake/audio.mp3'],
      { cwd: tmpDir, encoding: 'utf-8', timeout: 10_000 },
    );

    // The script logs speaker count before attempting diarization.
    // Absence of the "num_speakers not set" error and presence of the
    // locked-count line proves the project file param was consumed.
    expect(result.stdout).toContain('Speakers: 3 (locked)');
    expect(result.stderr).not.toContain('num_speakers not set');
  });

  it('exits with num_speakers error when project file is absent and no CLI flag', () => {
    // No project.json written — should fall through to the error.
    const result = spawnSync(
      process.execPath,
      [path.join(REPO_ROOT, 'scripts/diarize/diarize-audio.js'), '--audio', '/fake/audio.mp3'],
      { cwd: tmpDir, encoding: 'utf-8', timeout: 10_000 },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('num_speakers not set');
  });

  it('CLI --num-speakers overrides project file value', () => {
    writeProjectJson(tmpDir, { num_speakers: 3 });

    const result = spawnSync(
      process.execPath,
      [
        path.join(REPO_ROOT, 'scripts/diarize/diarize-audio.js'),
        '--audio', '/fake/audio.mp3',
        '--num-speakers', '2',
      ],
      { cwd: tmpDir, encoding: 'utf-8', timeout: 10_000 },
    );

    expect(result.stdout).toContain('Speakers: 2 (locked)');
  });
});

describe('transcribe-audio.js reads timestamp_offset from project file', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = mkTmpDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('prints offset from project file when --timestamp-offset is absent', () => {
    writeProjectJson(tmpDir, { timestamp_offset: 0.5 });

    const result = spawnSync(
      process.execPath,
      [path.join(REPO_ROOT, 'scripts/transcribe/transcribe-audio.js'), '--audio', '/fake/audio.mp3'],
      { cwd: tmpDir, encoding: 'utf-8', timeout: 10_000 },
    );

    expect(result.stdout).toContain('Offset:     -0.5s');
  });

  it('uses offset of 0 when project file is absent', () => {
    // No project.json — timestamp_offset defaults to 0, so the offset line is not printed.
    const result = spawnSync(
      process.execPath,
      [path.join(REPO_ROOT, 'scripts/transcribe/transcribe-audio.js'), '--audio', '/fake/audio.mp3'],
      { cwd: tmpDir, encoding: 'utf-8', timeout: 10_000 },
    );

    expect(result.stdout).not.toContain('Offset:');
  });

  it('CLI --timestamp-offset overrides project file value', () => {
    writeProjectJson(tmpDir, { timestamp_offset: 0.5 });

    const result = spawnSync(
      process.execPath,
      [
        path.join(REPO_ROOT, 'scripts/transcribe/transcribe-audio.js'),
        '--audio', '/fake/audio.mp3',
        '--timestamp-offset', '1.2',
      ],
      { cwd: tmpDir, encoding: 'utf-8', timeout: 10_000 },
    );

    expect(result.stdout).toContain('Offset:     -1.2s');
  });
});

describe('edit-transcript.js reads timestamp_offset from project file', () => {
  let tmpDir: string;

  const MINIMAL_RAW = {
    meta: { fps: 60, duration: 5 },
    segments: [{
      id: 1, start: 1.0, end: 3.0,
      speaker: 'SPEAKER_01', text: 'Hello world.',
      cut: false, cutReason: null,
      tokens: [
        { t_dtw: 1.0, text: 'Hello', cut: false, cutReason: null },
        { t_dtw: 2.0, text: 'world.', cut: false, cutReason: null },
      ],
    }],
  };

  function writeRawTranscript(dir: string): void {
    const rawDir = path.join(dir, 'public', 'transcribe', 'output', 'raw');
    fs.mkdirSync(rawDir, { recursive: true });
    fs.writeFileSync(path.join(rawDir, 'transcript.raw.json'), JSON.stringify(MINIMAL_RAW), 'utf-8');
  }

  beforeEach(() => { tmpDir = mkTmpDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('logs offset from project file when --timestamp-offset is absent', () => {
    writeProjectJson(tmpDir, { timestamp_offset: 0.5 });
    writeRawTranscript(tmpDir);

    const result = spawnSync(
      process.execPath,
      [path.join(REPO_ROOT, 'scripts/edit-transcript.js')],
      { cwd: tmpDir, encoding: 'utf-8', timeout: 15_000 },
    );

    expect(result.stdout).toContain('Applied timestamp offset: -0.5s');
  });

  it('does not apply offset when project file is absent', () => {
    writeRawTranscript(tmpDir);

    const result = spawnSync(
      process.execPath,
      [path.join(REPO_ROOT, 'scripts/edit-transcript.js')],
      { cwd: tmpDir, encoding: 'utf-8', timeout: 15_000 },
    );

    expect(result.stdout).not.toContain('Applied timestamp offset');
  });

  it('CLI --timestamp-offset overrides project file value', () => {
    writeProjectJson(tmpDir, { timestamp_offset: 0.5 });
    writeRawTranscript(tmpDir);

    const result = spawnSync(
      process.execPath,
      [
        path.join(REPO_ROOT, 'scripts/edit-transcript.js'),
        '--timestamp-offset', '1.2',
      ],
      { cwd: tmpDir, encoding: 'utf-8', timeout: 15_000 },
    );

    expect(result.stdout).toContain('Applied timestamp offset: -1.2s');
  });
});
