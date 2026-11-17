// Low draws to the canvas. Its tone-map chunk applies the weather's exposure,
// shadow/lit tint, saturation, contrast and lift in that same draw. Standalone
// tools without a registered renderer retain the historical light-tint path.
import { nightLift } from '../config';
import type { Environment } from '../world/sky';
import type { PostLook } from './post';
import type { WebGLRenderer } from 'three';
import { updateGradeLite } from './gradeLite';

/** `on = false` gives the old Low (night lift only, no tint); the look tests flip it to measure the change. */
export const LOW_GRADE = { on: true };

/** The tone-map exposure for a preset without the grade: the weather's (times the night lift), or just the night lift. */
export function lowExposure(env: Environment, look: PostLook): number {
  return LOW_GRADE.on ? look.exposure : nightLift(env.night, env.moonLight);
}

/** Call once a frame after the weather has written `look` and before the render, on a preset without the grade. */
export function applyLowGrade(env: Environment, look: PostLook, renderer?: WebGLRenderer) {
  if (renderer && updateGradeLite(renderer, look, LOW_GRADE.on)) return;
  if (!LOW_GRADE.on) return;
  env.hemi.color.multiply(look.tint);
  env.sun.color.multiply(look.tint);
}
