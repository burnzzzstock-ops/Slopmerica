// Set BASE_URL to the frozen game. Low, 390x844, DPR 3, touch, with
// a 4x and 6x CPU throttle on the desktop GPU.
import { checkSavedFrames, runFrames } from './frames.mjs';
import { launch } from './measure.mjs';
if (!checkSavedFrames(true)) await runFrames(await launch(), true);
