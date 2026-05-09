import fs from 'fs';
import os from 'os';
import path from 'path';
import { readProject, writeProject, ProjectNotFoundError, PROJECT_DIR, PROJECT_FILENAME } from './project';
import type { ProjectFile } from './project';

const SAMPLE: ProjectFile = {
  version: '1.0.0',
  episode: { id: 'ep-01', title: 'Pilot', number: 1 },
  brandId: 'ragtech',
  tools: { node: '20.0.0', ffmpeg: '6.0' },
  params: { seed: 42 },
  artifacts: {},
};

function mkTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'deckcreate-test-'));
}

describe('writeProject', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = mkTmpDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('creates .ragtech/project.json', () => {
    writeProject(SAMPLE, tmpDir);
    expect(fs.existsSync(path.join(tmpDir, PROJECT_DIR, PROJECT_FILENAME))).toBe(true);
  });

  it('writes valid formatted JSON', () => {
    writeProject(SAMPLE, tmpDir);
    const raw = fs.readFileSync(path.join(tmpDir, PROJECT_DIR, PROJECT_FILENAME), 'utf-8');
    expect(() => JSON.parse(raw)).not.toThrow();
    expect(raw).toContain('\n');
  });

  it('creates .ragtech/ directory if absent', () => {
    const dirPath = path.join(tmpDir, PROJECT_DIR);
    expect(fs.existsSync(dirPath)).toBe(false);
    writeProject(SAMPLE, tmpDir);
    expect(fs.existsSync(dirPath)).toBe(true);
  });
});

describe('readProject', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = mkTmpDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('reads an existing project file', () => {
    writeProject(SAMPLE, tmpDir);
    const result = readProject(tmpDir);
    expect(result).toEqual(SAMPLE);
  });

  it('throws ProjectNotFoundError when file is absent', () => {
    expect(() => readProject(tmpDir)).toThrow(ProjectNotFoundError);
  });

  it('roundtrip preserves all top-level fields', () => {
    writeProject(SAMPLE, tmpDir);
    const result = readProject(tmpDir);
    expect(result.version).toBe(SAMPLE.version);
    expect(result.episode).toEqual(SAMPLE.episode);
    expect(result.brandId).toBe(SAMPLE.brandId);
    expect(result.tools).toEqual(SAMPLE.tools);
    expect(result.params).toEqual(SAMPLE.params);
    expect(result.artifacts).toEqual(SAMPLE.artifacts);
  });
});
