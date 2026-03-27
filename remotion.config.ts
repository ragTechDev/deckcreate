import { Config } from '@remotion/cli/config';

// Increase the global render timeout to accommodate slow seeks deep into large
// video files (e.g. synced-output.mp4 with sparse keyframes at t > 40 s).
// The permanent fix is to re-encode the video with -g 60 -movflags +faststart;
// this is a safety net so previews don't abort in the meantime.
Config.setTimeoutInMilliseconds(120_000);
