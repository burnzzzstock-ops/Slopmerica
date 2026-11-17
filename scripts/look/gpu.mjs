// BASE_URL identifies the frozen server. Optional PRESETS, SIZES and SCENES
// are comma-separated selectors for replaying an individual case.
import { checkSavedFrames, runFrames } from './frames.mjs';
import { launch } from './measure.mjs';
if (!checkSavedFrames(false)) await runFrames(await launch(), false);
