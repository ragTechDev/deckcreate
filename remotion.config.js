import { Config } from '@remotion/cli/config';
import os from 'os';
import path from 'path';

// Increase the global render timeout to accommodate slow seeks deep into large
// video files (e.g. synced-output.mp4 with sparse keyframes at t > 40 s).
// The permanent fix is to re-encode the video with -g 60 -movflags +faststart;
// this is a safety net so previews don't abort in the meantime.
Config.setTimeoutInMilliseconds(120_000);

// Use all but 2 cores for parallel frame rendering.
// On M3 MacBook Air (8 cores) this gives 6 concurrent renderers, ~50% faster than
// the default of cpuCount/2. The floor of 4 keeps it safe on smaller machines.
Config.setConcurrency(Math.max(4, os.cpus().length - 2));

// Raw input files live in /input/ (outside public) so Remotion never bundles them.
Config.setPublicDir(path.join(process.cwd(), 'public'));

// Render output goes to public/renders/ so all outputs live under public/.
Config.setOutputLocation(path.join(process.cwd(), 'public', 'renders'));
