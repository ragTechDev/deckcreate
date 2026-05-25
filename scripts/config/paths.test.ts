import {
  projectFile,
  artifactDir,
  transcribeInput,
  transcriptRaw,
  diarizationOutput,
  hookQaDir,
  transcriptOutput,
  transcriptDoc,
  syncVideoDir,
  syncAudioDir,
  syncOutputDir,
  syncedVideo,
  syncedVideoAngle,
  cameraProfiles,
  shortsDir,
  shortClipDir,
  shortTranscript,
  shortDoc,
  shortsCameraProfiles,
  shortsTranscriptRaw,
  carouselClipDir,
  carouselTranscript,
  carouselDoc,
  thumbnailCameraProfiles,
} from './paths';

const ROOT = '/project/root';

describe('project / artifact', () => {
  it('projectFile', () => {
    expect(projectFile(ROOT)).toBe('/project/root/.ragtech/project.json');
  });

  it('artifactDir', () => {
    expect(artifactDir(ROOT)).toBe('/project/root/.ragtech/artifacts');
  });
});

describe('transcribe pipeline', () => {
  it('transcribeInput', () => {
    expect(transcribeInput(ROOT)).toBe('/project/root/public/transcribe/input');
  });

  it('transcriptRaw', () => {
    expect(transcriptRaw(ROOT)).toBe('/project/root/public/transcribe/output/raw/transcript.raw.json');
  });

  it('diarizationOutput', () => {
    expect(diarizationOutput(ROOT)).toBe('/project/root/public/transcribe/output/raw/diarization.json');
  });

  it('hookQaDir', () => {
    expect(hookQaDir(ROOT)).toBe('/project/root/public/transcribe/output/hook-qa');
  });
});

describe('edit / longform output', () => {
  it('transcriptOutput', () => {
    expect(transcriptOutput(ROOT)).toBe('/project/root/public/edit/transcript.json');
  });

  it('transcriptDoc', () => {
    expect(transcriptDoc(ROOT)).toBe('/project/root/public/edit/transcript.doc.txt');
  });
});

describe('sync pipeline', () => {
  it('syncVideoDir', () => {
    expect(syncVideoDir(ROOT)).toBe('/project/root/public/sync/video');
  });

  it('syncAudioDir', () => {
    expect(syncAudioDir(ROOT)).toBe('/project/root/public/sync/audio');
  });

  it('syncOutputDir', () => {
    expect(syncOutputDir(ROOT)).toBe('/project/root/public/sync/output');
  });

  it('syncedVideo', () => {
    expect(syncedVideo(ROOT)).toBe('/project/root/public/sync/output/synced-output.mp4');
  });

  it('syncedVideoAngle — index 1', () => {
    expect(syncedVideoAngle(1, ROOT)).toBe('/project/root/public/sync/output/synced-output-1.mp4');
  });

  it('syncedVideoAngle — index 2', () => {
    expect(syncedVideoAngle(2, ROOT)).toBe('/project/root/public/sync/output/synced-output-2.mp4');
  });

  it('syncedVideoAngle — index 0 throws', () => {
    expect(() => syncedVideoAngle(0, ROOT)).toThrow(RangeError);
  });

  it('syncedVideoAngle — negative index throws', () => {
    expect(() => syncedVideoAngle(-1, ROOT)).toThrow(RangeError);
  });
});

describe('camera', () => {
  it('cameraProfiles', () => {
    expect(cameraProfiles(ROOT)).toBe('/project/root/public/camera/camera-profiles.json');
  });
});

describe('shorts pipeline', () => {
  it('shortsDir', () => {
    expect(shortsDir(ROOT)).toBe('/project/root/public/shorts');
  });

  it('shortClipDir', () => {
    expect(shortClipDir('clip-01', ROOT)).toBe('/project/root/public/shorts/clip-01');
  });

  it('shortTranscript', () => {
    expect(shortTranscript('clip-01', ROOT)).toBe('/project/root/public/shorts/clip-01/transcript.json');
  });

  it('shortDoc', () => {
    expect(shortDoc('clip-01', ROOT)).toBe('/project/root/public/shorts/clip-01/transcript.doc.txt');
  });

  it('shortsCameraProfiles', () => {
    expect(shortsCameraProfiles(ROOT)).toBe('/project/root/public/shorts/camera-profiles.json');
  });

  it('shortsTranscriptRaw', () => {
    expect(shortsTranscriptRaw(ROOT)).toBe(
      '/project/root/public/shorts/transcribe/output/raw/transcript.raw.json',
    );
  });
});

describe('carousel pipeline', () => {
  it('carouselClipDir', () => {
    expect(carouselClipDir('ep-42', ROOT)).toBe('/project/root/public/carousel/ep-42');
  });

  it('carouselTranscript', () => {
    expect(carouselTranscript('ep-42', ROOT)).toBe('/project/root/public/carousel/ep-42/transcript.json');
  });

  it('carouselDoc', () => {
    expect(carouselDoc('ep-42', ROOT)).toBe('/project/root/public/carousel/ep-42/transcript.doc.txt');
  });
});

describe('thumbnail pipeline', () => {
  it('thumbnailCameraProfiles', () => {
    expect(thumbnailCameraProfiles(ROOT)).toBe('/project/root/public/thumbnail/camera-profiles.json');
  });
});

describe('cwd defaults', () => {
  it('uses process.cwd() as root when cwd is omitted', () => {
    const result = transcriptOutput();
    expect(result.startsWith(process.cwd())).toBe(true);
    expect(result.endsWith('/public/edit/transcript.json')).toBe(true);
  });
});

describe('id guards', () => {
  it('shortClipDir — empty string throws', () => {
    expect(() => shortClipDir('', ROOT)).toThrow(TypeError);
  });

  it('carouselClipDir — empty string throws', () => {
    expect(() => carouselClipDir('', ROOT)).toThrow(TypeError);
  });
});
