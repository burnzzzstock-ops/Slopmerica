// World constants and device quality presets.

export const WORLD = 6144; // meters, square playable map (~Cities: Skylines 1 size)
export const HALF = WORLD / 2;
export const HM_STEP = 4; // meters between heightmap samples
export const HM_N = WORLD / HM_STEP + 1; // 1537 samples per side
export const MAC_STEP = 8; // macro terrain resolution
export const MAC_N = WORLD / MAC_STEP + 1;
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
  treeNear: number; // max radius of full 3D trees (m)
  treeNearCap: number; // max full trees drawn
  treeFarCap: number; // max impostor trees drawn
  lod: [number, number, number]; // terrain LOD switch distances
  maxCars: number;
  maxPeople: number;
  post: boolean;
  ao: boolean;
}

export const QUALITY: Record<'low' | 'high', Quality> = {
  low: {
    name: 'low', pixelRatio: 1.25, shadows: true, shadowMap: 1024, treeDensity: 0.55, treeNear: 320, treeNearCap: 7000, treeFarCap: 45000,
    lod: [500, 1100, 2400], maxCars: 450, maxPeople: 120, post: false, ao: false,
  },
  high: {
    name: 'high', pixelRatio: 2, shadows: true, shadowMap: 4096, treeDensity: 1, treeNear: 700, treeNearCap: 26000, treeFarCap: 160000,
    lod: [900, 1900, 3800], maxCars: 1400, maxPeople: 420, post: true, ao: true,
  },
};

export function defaultQuality(): Quality {
  return IS_TOUCH ? QUALITY.low : QUALITY.high;
}
