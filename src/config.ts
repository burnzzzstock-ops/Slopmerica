// World constants and device quality presets.

export const WORLD = 2048; // meters, square playable map
export const HALF = WORLD / 2;
export const HM_STEP = 4; // meters between heightmap samples
export const HM_N = WORLD / HM_STEP + 1; // 513 samples per side
export const WATER = 0; // global water level
export const CELL = 8; // zoning cell size, meters (same as Cities: Skylines)

const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
export const IS_TOUCH =
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(pointer: coarse)').matches || /Android|iPhone|iPad|iPod/i.test(ua));

export interface Quality {
  name: 'low' | 'high';
  pixelRatio: number;
  shadows: boolean;
  shadowMap: number;
  treeDensity: number; // multiplier
  maxCars: number;
  maxPeople: number;
  post: boolean;
}

export const QUALITY: Record<'low' | 'high', Quality> = {
  low: { name: 'low', pixelRatio: 1.25, shadows: true, shadowMap: 1024, treeDensity: 0.4, maxCars: 450, maxPeople: 120, post: false },
  high: { name: 'high', pixelRatio: 2, shadows: true, shadowMap: 2048, treeDensity: 1, maxCars: 1400, maxPeople: 420, post: true },
};

export function defaultQuality(): Quality {
  return IS_TOUCH ? QUALITY.low : QUALITY.high;
}
