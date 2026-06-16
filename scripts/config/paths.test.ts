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
import path from 'path';

const ROOT = '/project/root';

function expectNormalizedPath(actual: string, expectedPosixPath: string) {
  expect(actual).toBe(path.normalize(expectedPosixPath));
}

describe('project / artifact', () => {
  it('projectFile', () => {
    expectNormalizedPath(projectFile(ROOT), '/project/root/.ragtech/project.json');
  });

  it('artifactDir', () => {
    expectNormalizedPath(artifactDir(ROOT), '/project/root/.ragtech/artifacts');
  });
});

describe('transcribe pipeline', () => {
  it('transcribeInput', () => {
    expectNormalizedPath(transcribeInput(ROOT), '/project/root/public/transcribe/input');
  });

  it('transcriptRaw', () => {
    expectNormalizedPath(transcriptRaw(ROOT), '/project/root/public/transcribe/output/raw/transcript.raw.json');
  });

  it('diarizationOutput', () => {
    expectNormalizedPath(diarizationOutput(ROOT), '/project/root/public/transcribe/output/raw/diarization.json');
  });

  it('hookQaDir', () => {
    expectNormalizedPath(hookQaDir(ROOT), '/project/root/public/transcribe/output/hook-qa');
  });
});

describe('edit / longform output', () => {
  it('transcriptOutput', () => {
    expectNormalizedPath(transcriptOutput(ROOT), '/project/root/public/edit/transcript.json');
  });

  it('transcriptDoc', () => {
    expectNormalizedPath(transcriptDoc(ROOT), '/project/root/public/edit/transcript.doc.txt');
  });
});

describe('sync pipeline', () => {
  it('syncVideoDir', () => {
    expectNormalizedPath(syncVideoDir(ROOT), '/project/root/public/sync/video');
  });

  it('syncAudioDir', () => {
    expectNormalizedPath(syncAudioDir(ROOT), '/project/root/public/sync/audio');
  });

  it('syncOutputDir', () => {
    expectNormalizedPath(syncOutputDir(ROOT), '/project/root/public/sync/output');
  });

  it('syncedVideo', () => {
    expectNormalizedPath(syncedVideo(ROOT), '/project/root/public/sync/output/synced-output.mp4');
  });

  it('syncedVideoAngle — index 1', () => {
    expectNormalizedPath(syncedVideoAngle(1, ROOT), '/project/root/public/sync/output/synced-output-1.mp4');
  });

  it('syncedVideoAngle — index 2', () => {
    expectNormalizedPath(syncedVideoAngle(2, ROOT), '/project/root/public/sync/output/synced-output-2.mp4');
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
    expectNormalizedPath(cameraProfiles(ROOT), '/project/root/public/camera/camera-profiles.json');
  });
});

describe('shorts pipeline', () => {
  it('shortsDir', () => {
    expectNormalizedPath(shortsDir(ROOT), '/project/root/public/shorts');
  });

  it('shortClipDir', () => {
    expectNormalizedPath(shortClipDir('clip-01', ROOT), '/project/root/public/shorts/clip-01');
  });

  it('shortTranscript', () => {
    expectNormalizedPath(shortTranscript('clip-01', ROOT), '/project/root/public/shorts/clip-01/transcript.json');
  });

  it('shortDoc', () => {
    expectNormalizedPath(shortDoc('clip-01', ROOT), '/project/root/public/shorts/clip-01/transcript.doc.txt');
  });

  it('shortsCameraProfiles', () => {
    expectNormalizedPath(shortsCameraProfiles(ROOT), '/project/root/public/shorts/camera-profiles.json');
  });

  it('shortsTranscriptRaw', () => {
    expectNormalizedPath(shortsTranscriptRaw(ROOT),
      '/project/root/public/shorts/transcribe/output/raw/transcript.raw.json',
    );
  });
});

describe('carousel pipeline', () => {
  it('carouselClipDir', () => {
    expectNormalizedPath(carouselClipDir('ep-42', ROOT), '/project/root/public/carousel/ep-42');
  });

  it('carouselTranscript', () => {
    expectNormalizedPath(carouselTranscript('ep-42', ROOT), '/project/root/public/carousel/ep-42/transcript.json');
  });

  it('carouselDoc', () => {
    expectNormalizedPath(carouselDoc('ep-42', ROOT), '/project/root/public/carousel/ep-42/transcript.doc.txt');
  });
});

describe('thumbnail pipeline', () => {
  it('thumbnailCameraProfiles', () => {
    expectNormalizedPath(thumbnailCameraProfiles(ROOT), '/project/root/public/thumbnail/camera-profiles.json');
  });
});

describe('cwd defaults', () => {
  it('uses process.cwd() as root when cwd is omitted', () => {
    const result = transcriptOutput();
    expect(result.startsWith(process.cwd())).toBe(true);
    expect(result.endsWith(path.normalize('/public/edit/transcript.json'))).toBe(true);
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
