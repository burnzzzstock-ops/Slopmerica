// Low quality draws straight to the canvas, so the colour grade that High and Medium apply in a full-screen pass (the weather's
// tint and exposure, the moonlight's blue cast: render/post.ts, world/weather.ts) never ran on Low: a storm, a heat wave, a
// wildfire-smoke afternoon or a moonless night came out with the clear-day palette and exposure, and the frame's blue-to-red
// ratio after dark sat 10 to 17% under High's (scripts/presetlight.mjs). The grade multiplies the picture by a per-channel
// tint and an exposure before the tone map; the radiance of everything unlit is the lights' colour times the surface's, so
// tinting the two lights that carry the ambient and the key (the hemisphere light and the sun or moon), and putting the
// exposure on the tone map, reproduces both without a pass, a texture or a draw call. Lit windows, signs and lamps are
// emissive and keep their colour, as they do under the grade's own "lit" tint.
import { nightLift } from '../config';
import type { Environment } from '../world/sky';
import type { PostLook } from './post';

/** `on = false` gives the old Low (night lift only, no tint); the look tests flip it to measure the change. */
export const LOW_GRADE = { on: true };

/** The tone-map exposure for a preset without the grade: the weather's (times the night lift), or just the night lift. */
export function lowExposure(env: Environment, look: PostLook): number {
  return LOW_GRADE.on ? look.exposure : nightLift(env.night, env.moonLight);
}

/** Call once a frame after the weather has written `look` and before the render, on a preset without the grade. */
export function applyLowGrade(env: Environment, look: PostLook) {
  if (!LOW_GRADE.on) return;
  env.hemi.color.multiply(look.tint);
  env.sun.color.multiply(look.tint);
}
