import os from 'os';
import path from 'path';
import fse from 'fs-extra';
import Diarizer from '../../scripts/diarize/Diarizer.js';

const SAMPLE_TRANSCRIPT = {
  meta: { fps: 60 },
  segments: [
    { id: 's1', start: 0.0, end: 2.0, text: 'Hello world', speaker: '', tokens: [], cuts: [] },
    { id: 's2', start: 3.0, end: 5.0, text: 'How are you', speaker: '', tokens: [], cuts: [] },
  ],
};

const SAMPLE_TURNS = [
  { speaker: 'Natasha', start: 0.0, end: 2.5 },
  { speaker: 'Saloni', start: 2.8, end: 5.5 },
];

describe('Diarizer.runAssignment — diarization.json format compatibility', () => {
  let tmpDir: string;
  let diarizationPath: string;
  let transcriptPath: string;

  beforeEach(async () => {
    tmpDir = await fse.mkdtemp(path.join(os.tmpdir(), 'deckcreate-diarizer-test-'));
    diarizationPath = path.join(tmpDir, 'diarization.json');
    transcriptPath = path.join(tmpDir, 'transcript.raw.json');
    await fse.writeJson(transcriptPath, SAMPLE_TRANSCRIPT, { spaces: 2 });
  });

  afterEach(async () => {
    await fse.remove(tmpDir);
  });

  function makeDiarizer() {
    return new Diarizer({ diarizationJsonPath: diarizationPath, rawJsonPath: transcriptPath });
  }

  it('reads legacy array format and assigns speakers to segments', async () => {
    await fse.writeJson(diarizationPath, SAMPLE_TURNS, { spaces: 2 });
    const result = await makeDiarizer().runAssignment();
    const speakers = result.segments.map((s: { speaker: string }) => s.speaker);
    expect(speakers).toEqual(['Natasha', 'Saloni']);
  });

  it('reads new object format { turns: [...] } and assigns speakers', async () => {
    await fse.writeJson(
      diarizationPath,
      { schema_version: '1', tool_versions: { node: process.version }, turns: SAMPLE_TURNS },
      { spaces: 2 },
    );
    const result = await makeDiarizer().runAssignment();
    const speakers = result.segments.map((s: { speaker: string }) => s.speaker);
    expect(speakers).toEqual(['Natasha', 'Saloni']);
  });

  it('handles empty turns array gracefully (no speakers assigned)', async () => {
    await fse.writeJson(diarizationPath, { turns: [] }, { spaces: 2 });
    const result = await makeDiarizer().runAssignment();
    const speakers = result.segments.map((s: { speaker: string }) => s.speaker);
    expect(speakers.every((sp: string) => sp === '')).toBe(true);
  });

  it('stamps schema_version and tool_versions on the written transcript', async () => {
    await fse.writeJson(diarizationPath, SAMPLE_TURNS, { spaces: 2 });
    await makeDiarizer().runAssignment();
    const written = await fse.readJson(transcriptPath);
    expect(written.schema_version).toBeDefined();
    expect(typeof written.tool_versions).toBe('object');
  });
});
