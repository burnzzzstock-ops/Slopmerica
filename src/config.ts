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
  name: 'low' | 'medium' | 'high' | 'ultra';
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
  aoFull: boolean;
  groundRadius: number;
}

export const QUALITY: Record<Quality['name'], Quality> = {
  low: {
    name: 'low', pixelRatio: 1, shadows: true, shadowMap: 1024, treeDensity: 0.5, treeNear: 290, treeNearCap: 6000, treeFarCap: 42000,
    lod: [600, 1300, 2800], maxCars: 450, maxPeople: 120, post: false, ao: false, aoFull: false, groundRadius: 150,
  },
  medium: {
    name: 'medium', pixelRatio: 1.4, shadows: true, shadowMap: 2048, treeDensity: 0.75, treeNear: 480, treeNearCap: 12000, treeFarCap: 85000,
    lod: [650, 1450, 3000], maxCars: 800, maxPeople: 250, post: true, ao: false, aoFull: false, groundRadius: 190,
  },
  high: {
    name: 'high', pixelRatio: 2, shadows: true, shadowMap: 2048, treeDensity: 1, treeNear: 700, treeNearCap: 26000, treeFarCap: 160000,
    lod: [900, 1900, 3800], maxCars: 1400, maxPeople: 420, post: true, ao: true, aoFull: false, groundRadius: 240,
  },
  ultra: {
    name: 'ultra', pixelRatio: 2.25, shadows: true, shadowMap: 4096, treeDensity: 1.15, treeNear: 850, treeNearCap: 34000, treeFarCap: 210000,
    lod: [1100, 2200, 4200], maxCars: 1900, maxPeople: 580, post: true, ao: true, aoFull: true, groundRadius: 300,
  },
};

/**
 * Pixel density to render at. Phones have 3x screens: rendering Low at 1x and
 * stretching it looked like pixel soup, so touch devices get a denser floor
 * (with MSAA, which is cheap on tile-based mobile GPUs).
 */
export function presetPixelRatio(q: Quality['name']): number {
  const base = QUALITY[q].pixelRatio;
  return IS_TOUCH ? Math.max(base, q === 'low' ? 1.5 : 1.75) : base;
}
/** Dynamic resolution never drops below this share of the preset density. */
export const MIN_RENDER_SCALE = IS_TOUCH ? 0.8 : 0.6;

export function storedQuality(): Quality['name'] | null {
  try {
    const n = localStorage.getItem('slopmerica.quality');
    return n && n in QUALITY ? n as Quality['name'] : null;
  } catch { return null; }
}

export function saveQuality(n: Quality['name'], auto = false): boolean {
  try {
    localStorage.setItem('slopmerica.quality', n);
    if (auto) localStorage.setItem('slopmerica.qualityAuto', '1');
    return true;
  } catch { return false; }
}

export function defaultQuality(): Quality {
  return QUALITY[storedQuality() ?? (IS_TOUCH ? 'low' : 'high')];
}
