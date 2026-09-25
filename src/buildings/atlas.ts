// Facade texture array for every building, painted procedurally on canvases.
// RGB = albedo (neutral where the vertex color tints it), A = material mask:
//   A ~ 0.4  glass that reflects but never lights up (car windows)
//   A ~ 1.0  window glass: reflective by day, randomly lit at night
// Layers from SIGN_BASE on hold brand signs (4 stacked 256x64 signs per layer)
// that glow at night like lightboxes.
import * as THREE from 'three';
import { mulberry32 } from '../core/rng';
import { BRANDS, GENERIC_SIGNS, type SignFont } from '../art/brands';
import { EXTRA_SIGNS } from './signRegistry';
import { ALL_COMMUNE_NAMES } from '../art/communeNames';

export const TS = 256;

export const T = {
  STUCCO: 0,
  SIDING: 1,
  BRICK: 2,
  HOUSE_WIN: 3,
  APT_WIN: 4,
  GLASS: 5,
  STORE: 6,
  SHINGLE: 7,
  ROOF_FLAT: 8,
  METAL: 9,
  PARKING: 10,
  CONCRETE: 11,
  LAWN: 12,
  GARAGE: 13,
  TRAILER: 14,
  OFFICE_WIN: 15,
  SOLID: 16,
  CAR_GLASS: 17,
  DOCK: 18,
  PANEL: 19, // fiber-cement "5-over-1" panels with windows
  DIRT: 20,
  WATER: 21,
  CANVAS: 22, // yurt / teepee canvas over lattice
  WOOD: 23, // rough plank boards
  CROPS: 24, // garden soil with rows of greens
  SOLAR: 25,
  PSYCHE: 26, // hand-painted psychedelic bus/van side with a window band
  TIEDYE: 27,
  STONE: 28, // fieldstone
  CLAY_TILE: 29, // warm overlapping barrel tiles, common on western / coastal roofs
} as const;
export const SIGN_BASE = 30;

/** Meters covered by one repeat of each tile (u, v). */
export const TILE_M: Record<number, [number, number]> = {
  [T.STUCCO]: [4, 4], [T.SIDING]: [3, 3], [T.BRICK]: [3, 3], [T.HOUSE_WIN]: [3.2, 3], [T.APT_WIN]: [3.4, 3],
  [T.GLASS]: [3, 4], [T.STORE]: [4, 4.5], [T.SHINGLE]: [3, 3], [T.ROOF_FLAT]: [8, 8], [T.METAL]: [3, 3],
  [T.PARKING]: [2.7, 5.4], [T.CONCRETE]: [4, 4], [T.LAWN]: [6, 6], [T.GARAGE]: [3, 2.4], [T.TRAILER]: [3.2, 2.6],
  [T.OFFICE_WIN]: [4, 4], [T.SOLID]: [1, 1], [T.CAR_GLASS]: [1, 1], [T.DOCK]: [4, 4.5], [T.PANEL]: [3.4, 3], [T.DIRT]: [6, 6], [T.WATER]: [6, 6],
  [T.CANVAS]: [2.4, 2.4], [T.WOOD]: [2, 2], [T.CROPS]: [1.2, 2.4], [T.SOLAR]: [1, 1.6], [T.PSYCHE]: [4, 2.2], [T.TIEDYE]: [2, 2], [T.STONE]: [1.6, 1.6],
  [T.CLAY_TILE]: [2.4, 2.4],
};

interface SignSlot { layer: number; v0: number; v1: number }
const signSlots = new Map<string, SignSlot>();
export function signSlot(id: string): SignSlot | undefined {
  return signSlots.get(id);
}

let texture: THREE.DataArrayTexture | null = null;
export function facadeTexture(): THREE.DataArrayTexture {
  if (!texture) texture = buildTexture();
  return texture;
}

type Ctx = CanvasRenderingContext2D;

function canvas(): [HTMLCanvasElement, Ctx] {
  const c = document.createElement('canvas');
  c.width = c.height = TS;
  return [c, c.getContext('2d', { willReadFrequently: true })!];
}

function noise(ctx: Ctx, base: number, amp: number, seed: number, tint: [number, number, number] = [1, 1, 1]) {
  const rnd = mulberry32(seed);
  const img = ctx.createImageData(TS, TS);
  for (let i = 0; i < TS * TS; i++) {
    const v = base + (rnd() - 0.5) * amp;
    img.data[i * 4] = v * tint[0];
    img.data[i * 4 + 1] = v * tint[1];
    img.data[i * 4 + 2] = v * tint[2];
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

/** A glass pane: sky reflection gradient, a soft highlight, maybe curtains. */
function pane(ctx: Ctx, x: number, y: number, w: number, h: number, rnd: () => number, curtains = true) {
  // Paint the reveal before the glass. The asymmetric top/side shadow makes a
  // flat facade read as a window set several centimeters into the wall.
  const reveal = Math.max(4, Math.min(w, h) * 0.08);
  ctx.fillStyle = 'rgba(12,16,20,0.62)';
  ctx.fillRect(x - reveal, y - reveal, w + reveal * 2, h + reveal * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  ctx.beginPath();
  ctx.moveTo(x - reveal, y - reveal);
  ctx.lineTo(x + w + reveal, y - reveal);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x, y);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.beginPath();
  ctx.moveTo(x - reveal, y - reveal);
  ctx.lineTo(x, y);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x - reveal, y + h + reveal);
  ctx.fill();
  const g = ctx.createLinearGradient(x, y, x + w * 0.4, y + h);
  g.addColorStop(0, '#8fa8bc');
  g.addColorStop(0.36, '#50687d');
  g.addColorStop(1, '#182631');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  if (curtains && rnd() < 0.6) {
    ctx.fillStyle = rnd() < 0.5 ? 'rgba(230,220,190,0.55)' : 'rgba(150,60,50,0.45)';
    ctx.fillRect(x, y, w * 0.28, h);
    ctx.fillRect(x + w * 0.72, y, w * 0.28, h);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.beginPath();
  ctx.moveTo(x + w * 0.1, y + h);
  ctx.lineTo(x + w * 0.45, y);
  ctx.lineTo(x + w * 0.6, y);
  ctx.lineTo(x + w * 0.25, y + h);
  ctx.fill();
  // A dark lower return and slim inner highlight complete the recess illusion.
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fillRect(x, y + h - Math.max(2, reveal * 0.35), w, Math.max(2, reveal * 0.35));
  ctx.strokeStyle = 'rgba(220,235,245,0.22)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
}

/** Write the mask channel: every pixel inside the listed rects gets `a`. */
function maskRects(img: ImageData, rects: [number, number, number, number, number][], base = 0) {
  const d = img.data;
  for (let i = 0; i < TS * TS; i++) d[i * 4 + 3] = base;
  for (const [x, y, w, h, a] of rects)
    for (let yy = Math.max(0, Math.floor(y)); yy < Math.min(TS, Math.ceil(y + h)); yy++)
      for (let xx = Math.max(0, Math.floor(x)); xx < Math.min(TS, Math.ceil(x + w)); xx++) d[(yy * TS + xx) * 4 + 3] = a;
}

function lapLines(ctx: Ctx, boards: number, dark = 'rgba(0,0,0,0.22)', light = 'rgba(255,255,255,0.12)') {
  const h = TS / boards;
  for (let k = 0; k < boards; k++) {
    const y = k * h;
    ctx.fillStyle = dark;
    ctx.fillRect(0, y + h - 2, TS, 2);
    ctx.fillStyle = light;
    ctx.fillRect(0, y, TS, 1);
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, 'rgba(255,255,255,0.05)');
    g.addColorStop(1, 'rgba(0,0,0,0.08)');
    ctx.fillStyle = g;
    ctx.fillRect(0, y, TS, h);
  }
}

const painters: ((ctx: Ctx, rnd: () => number) => [number, number, number, number, number][] | void)[] = [];

// STUCCO
painters[T.STUCCO] = (ctx) => {
  noise(ctx, 205, 26, 1);
};
// SIDING
painters[T.SIDING] = (ctx) => {
  noise(ctx, 212, 14, 2);
  lapLines(ctx, 12);
};
// BRICK
painters[T.BRICK] = (ctx, rnd) => {
  ctx.fillStyle = '#c9c4ba';
  ctx.fillRect(0, 0, TS, TS);
  const rows = 16, bh = TS / rows, bw = TS / 8;
  for (let r = 0; r < rows; r++)
    for (let c = -1; c < 9; c++) {
      const x = c * bw + (r % 2 ? bw / 2 : 0);
      const v = 150 + rnd() * 60;
      ctx.fillStyle = `rgb(${v},${v * 0.93},${v * 0.9})`;
      ctx.fillRect(x + 1.5, r * bh + 1.5, bw - 3, bh - 3);
    }
};
// HOUSE_WIN: siding with a double-hung window + shutters
painters[T.HOUSE_WIN] = (ctx, rnd) => {
  noise(ctx, 212, 14, 3);
  lapLines(ctx, 12);
  const w = 88, h = 110, x = (TS - w) / 2, y = 60;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(x - 30, y - 4, 22, h + 8);
  ctx.fillRect(x + w + 8, y - 4, 22, h + 8);
  ctx.fillStyle = '#f4f1ea';
  ctx.fillRect(x - 6, y - 6, w + 12, h + 12);
  pane(ctx, x, y, w, h, rnd);
  ctx.fillStyle = '#f4f1ea';
  ctx.fillRect(x, y + h / 2 - 3, w, 6);
  ctx.fillRect(x + w / 2 - 2, y, 4, h);
  ctx.fillRect(x - 10, y + h + 4, w + 20, 7);
  return [[x, y, w, h, 255]];
};
// APT_WIN: stucco/panel with a wide window and a little balcony rail
painters[T.APT_WIN] = (ctx, rnd) => {
  noise(ctx, 208, 20, 4);
  const w = 132, h = 112, x = (TS - w) / 2, y = 54;
  ctx.fillStyle = '#3a3d42';
  ctx.fillRect(x - 5, y - 5, w + 10, h + 10);
  pane(ctx, x, y, w, h, rnd);
  ctx.fillStyle = '#3a3d42';
  ctx.fillRect(x + w / 3, y, 4, h);
  ctx.fillRect(x + (2 * w) / 3, y, 4, h);
  // floor slab line
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(0, TS - 10, TS, 10);
  return [[x, y, w, h, 255]];
};
// GLASS curtain wall: 2 panes per tile, spandrel band at the floor line
painters[T.GLASS] = (ctx, rnd) => {
  ctx.fillStyle = '#20303c';
  ctx.fillRect(0, 0, TS, TS);
  const sp = 46;
  for (let k = 0; k < 2; k++) {
    const x = k * (TS / 2) + 3, w = TS / 2 - 6, y = 3, h = TS - sp - 6;
    const g = ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, '#8fb3c8');
    g.addColorStop(0.5, '#47687f');
    g.addColorStop(1, '#233746');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    if (rnd() < 0.3) {
      ctx.fillStyle = 'rgba(220,220,210,0.25)';
      ctx.fillRect(x, y, w, h * 0.3);
    }
  }
  ctx.fillStyle = '#1a2229';
  ctx.fillRect(0, TS - sp, TS, sp);
  ctx.fillStyle = '#9aa4ab';
  ctx.fillRect(0, 0, TS, 3);
  ctx.fillRect(TS / 2 - 3, 0, 6, TS);
  ctx.fillRect(0, 0, 3, TS);
  return [[3, 3, TS / 2 - 6, TS - sp - 6, 255], [TS / 2 + 3, 3, TS / 2 - 6, TS - sp - 6, 255]];
};
// STORE: ground-floor shop glass with kickplate and transom
painters[T.STORE] = (ctx, rnd) => {
  noise(ctx, 200, 18, 5);
  const x = 14, w = TS - 28, y = 44, h = 160;
  ctx.fillStyle = '#2a2c30';
  ctx.fillRect(x - 6, y - 6, w + 12, h + 30);
  pane(ctx, x, y, w, h, rnd, false);
  // goods silhouettes behind the glass
  for (let k = 0; k < 7; k++) {
    ctx.fillStyle = `hsla(${rnd() * 360},55%,55%,0.45)`;
    ctx.fillRect(x + 10 + k * 30, y + h - 40 - rnd() * 40, 20, 40);
  }
  ctx.fillStyle = '#2a2c30';
  ctx.fillRect(x + w / 2 - 3, y, 6, h);
  ctx.fillRect(x, y + 34, w, 5);
  return [[x, y, w, h, 255]];
};
// SHINGLE roof
painters[T.SHINGLE] = (ctx, rnd) => {
  noise(ctx, 150, 30, 6);
  const rows = 12, rh = TS / rows;
  for (let r = 0; r < rows; r++) {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, r * rh + rh - 3, TS, 3);
    for (let c = 0; c < 10; c++) {
      const x = c * 26 + (r % 2 ? 13 : 0);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(x, r * rh, 2, rh);
      const v = rnd() * 40 - 20;
      ctx.fillStyle = `rgba(${128 + v},${128 + v},${128 + v},0.25)`;
      ctx.fillRect(x + 2, r * rh, 24, rh - 3);
    }
  }
};
// ROOF_FLAT: membrane seams + gravel + a few stains
painters[T.ROOF_FLAT] = (ctx, rnd) => {
  noise(ctx, 150, 40, 7);
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  for (let k = 0; k < 4; k++) ctx.fillRect(0, k * 64, TS, 2);
  for (let k = 0; k < 6; k++) {
    ctx.fillStyle = 'rgba(40,40,40,0.08)';
    ctx.beginPath();
    ctx.ellipse(rnd() * TS, rnd() * TS, 10 + rnd() * 30, 8 + rnd() * 20, 0, 0, Math.PI * 2);
    ctx.fill();
  }
};
// METAL corrugated
painters[T.METAL] = (ctx) => {
  noise(ctx, 196, 12, 8);
  for (let x = 0; x < TS; x += 16) {
    const g = ctx.createLinearGradient(x, 0, x + 16, 0);
    g.addColorStop(0, 'rgba(0,0,0,0.18)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.14)');
    g.addColorStop(1, 'rgba(0,0,0,0.18)');
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, 16, TS);
  }
};
// PARKING stall: asphalt + stripe on the left edge + end stripe
painters[T.PARKING] = (ctx, rnd) => {
  noise(ctx, 78, 22, 9);
  for (let k = 0; k < 5; k++) {
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.beginPath();
    ctx.ellipse(rnd() * TS, rnd() * TS, 20 + rnd() * 30, 10 + rnd() * 20, rnd() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#e8e6df';
  ctx.fillRect(0, 0, 6, TS);
  ctx.fillRect(0, 0, TS, 4);
};
// CONCRETE with joints
painters[T.CONCRETE] = (ctx) => {
  noise(ctx, 186, 20, 10);
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.fillRect(0, 0, TS, 2);
  ctx.fillRect(0, 0, 2, TS);
};
// LAWN
painters[T.LAWN] = (ctx, rnd) => {
  noise(ctx, 150, 50, 11, [0.62, 0.95, 0.5]);
  for (let k = 0; k < 900; k++) {
    ctx.fillStyle = `rgba(${40 + rnd() * 40},${90 + rnd() * 60},${30 + rnd() * 20},0.5)`;
    ctx.fillRect(rnd() * TS, rnd() * TS, 1, 3);
  }
};
// GARAGE door
painters[T.GARAGE] = (ctx) => {
  noise(ctx, 228, 8, 12);
  for (let k = 0; k < 4; k++) {
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(0, k * 64 + 60, TS, 4);
    for (let c = 0; c < 4; c++) {
      ctx.strokeStyle = 'rgba(0,0,0,0.12)';
      ctx.strokeRect(c * 64 + 8, k * 64 + 8, 48, 46);
    }
  }
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillRect(0, 0, 8, TS);
  ctx.fillRect(TS - 8, 0, 8, TS);
};
// TRAILER: white corrugated with a small window and rust streaks
painters[T.TRAILER] = (ctx, rnd) => {
  noise(ctx, 226, 10, 13);
  for (let x = 0; x < TS; x += 12) {
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    ctx.fillRect(x, 0, 3, TS);
  }
  for (let k = 0; k < 4; k++) {
    ctx.fillStyle = 'rgba(120,70,30,0.18)';
    ctx.fillRect(rnd() * TS, 120 + rnd() * 60, 3 + rnd() * 3, 80 + rnd() * 60);
  }
  const w = 74, h = 66, x = (TS - w) / 2, y = 56;
  ctx.fillStyle = '#8a8a86';
  ctx.fillRect(x - 5, y - 5, w + 10, h + 10);
  pane(ctx, x, y, w, h, rnd);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(0, TS - 14, TS, 14);
  return [[x, y, w, h, 255]];
};
// OFFICE_WIN: precast bands + ribbon windows
painters[T.OFFICE_WIN] = (ctx, rnd) => {
  noise(ctx, 214, 14, 14);
  const y = 70, h = 150;
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, '#89a7bb');
  g.addColorStop(1, '#2e4252');
  ctx.fillStyle = g;
  ctx.fillRect(0, y, TS, h);
  if (rnd() < 0.5) {
    ctx.fillStyle = 'rgba(230,230,220,0.2)';
    ctx.fillRect(0, y, TS, h * 0.25);
  }
  ctx.fillStyle = '#7d858c';
  ctx.fillRect(0, y, 4, h);
  ctx.fillRect(TS / 2 - 2, y, 4, h);
  return [[4, y, TS / 2 - 6, h, 255], [TS / 2 + 2, y, TS / 2 - 2, h, 255]];
};
// SOLID white (vertex color carries the look)
painters[T.SOLID] = (ctx) => {
  noise(ctx, 236, 6, 15);
};
// CAR_GLASS
painters[T.CAR_GLASS] = (ctx) => {
  const g = ctx.createLinearGradient(0, 0, TS, TS);
  g.addColorStop(0, '#7f93a4');
  g.addColorStop(1, '#1b242c');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, TS, TS);
  return [[0, 0, TS, TS, 110]];
};
// DOCK: loading dock doors on metal
painters[T.DOCK] = (ctx) => {
  noise(ctx, 196, 12, 16);
  for (let x = 0; x < TS; x += 16) {
    ctx.fillStyle = 'rgba(0,0,0,0.1)';
    ctx.fillRect(x, 0, 3, TS);
  }
  ctx.fillStyle = '#50565c';
  ctx.fillRect(48, 70, 160, 186);
  for (let k = 0; k < 8; k++) {
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(48, 70 + k * 23, 160, 3);
  }
  ctx.fillStyle = '#e0b83a';
  ctx.fillRect(40, 70, 8, 186);
  ctx.fillRect(208, 70, 8, 186);
  ctx.fillStyle = '#111';
  ctx.fillRect(56, 236, 144, 20);
};
// PANEL: fiber-cement "5-over-1" panels, windows, grid reveals
painters[T.PANEL] = (ctx, rnd) => {
  noise(ctx, 206, 10, 17);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(0, 0, TS, 2);
  ctx.fillRect(0, TS / 2, TS, 2);
  ctx.fillRect(0, 0, 2, TS);
  ctx.fillRect(TS / 3, 0, 2, TS);
  const w = 96, h = 120, x = 120, y = 56;
  ctx.fillStyle = '#222';
  ctx.fillRect(x - 4, y - 4, w + 8, h + 8);
  pane(ctx, x, y, w, h, rnd);
  return [[x, y, w, h, 255]];
};
// DIRT
painters[T.DIRT] = (ctx) => {
  noise(ctx, 128, 50, 18, [1.05, 0.9, 0.7]);
};
// WATER (pools)
painters[T.WATER] = (ctx, rnd) => {
  noise(ctx, 180, 20, 19, [0.45, 0.85, 1.1]);
  for (let k = 0; k < 30; k++) {
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    const x = rnd() * TS, y = rnd() * TS;
    ctx.moveTo(x, y);
    ctx.bezierCurveTo(x + 10, y - 6, x + 20, y + 6, x + 30, y);
    ctx.stroke();
  }
  return [[0, 0, TS, TS, 110]];
};

// CANVAS: off-white duck canvas, weave noise, the lattice wall showing through
painters[T.CANVAS] = (ctx, rnd) => {
  noise(ctx, 214, 16, 23, [1.0, 0.98, 0.92]);
  ctx.strokeStyle = 'rgba(90,70,50,0.10)';
  ctx.lineWidth = 3;
  for (let k = -4; k < 8; k++) {
    ctx.beginPath(); ctx.moveTo(k * 48, 0); ctx.lineTo(k * 48 + TS, TS); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(k * 48 + TS, 0); ctx.lineTo(k * 48, TS); ctx.stroke();
  }
  for (let k = 0; k < 400; k++) {
    ctx.fillStyle = `rgba(80,60,40,${0.02 + rnd() * 0.04})`;
    ctx.fillRect(rnd() * TS, rnd() * TS, 1 + rnd() * 3, 1);
  }
  // weather staining from the top
  const g = ctx.createLinearGradient(0, 0, 0, TS);
  g.addColorStop(0, 'rgba(70,60,40,0.10)');
  g.addColorStop(0.3, 'rgba(70,60,40,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, TS, TS);
};
// WOOD: vertical rough-sawn planks
painters[T.WOOD] = (ctx, rnd) => {
  noise(ctx, 170, 20, 24, [1.0, 0.82, 0.62]);
  const n = 6, w = TS / n;
  for (let i = 0; i < n; i++) {
    const v = rnd() * 40 - 20;
    ctx.fillStyle = `rgba(${120 + v},${80 + v},${50 + v},0.35)`;
    ctx.fillRect(i * w, 0, w, TS);
    for (let k = 0; k < 14; k++) {
      ctx.strokeStyle = `rgba(60,35,20,${0.12 + rnd() * 0.15})`;
      ctx.lineWidth = 1;
      const x = i * w + rnd() * w;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.bezierCurveTo(x + 4, TS * 0.3, x - 4, TS * 0.6, x + 2, TS); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(30,18,10,0.55)';
    ctx.fillRect(i * w, 0, 3, TS);
    if (rnd() < 0.5) { ctx.fillStyle = 'rgba(40,25,15,0.5)'; ctx.beginPath(); ctx.ellipse(i * w + w / 2, rnd() * TS, 4, 6, 0, 0, Math.PI * 2); ctx.fill(); }
  }
};
// CROPS: tilled soil and two rows of leafy greens per tile
painters[T.CROPS] = (ctx, rnd) => {
  noise(ctx, 90, 40, 25, [1.0, 0.78, 0.58]);
  for (let row = 0; row < 2; row++) {
    const cx = TS * (0.25 + row * 0.5);
    ctx.fillStyle = 'rgba(40,25,15,0.35)';
    ctx.fillRect(cx - 30, 0, 60, TS);
    for (let k = 0; k < 9; k++) {
      const y = (k + 0.5) * (TS / 9);
      const sz = 16 + rnd() * 10;
      for (let l = 0; l < 7; l++) {
        const a = rnd() * Math.PI * 2;
        ctx.fillStyle = `rgb(${50 + rnd() * 40},${110 + rnd() * 60},${40 + rnd() * 30})`;
        ctx.beginPath();
        ctx.ellipse(cx + Math.cos(a) * sz * 0.5, y + Math.sin(a) * sz * 0.5, sz * 0.45, sz * 0.22, a, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
};
// SOLAR: blue cells with silver busbars
painters[T.SOLAR] = (ctx) => {
  ctx.fillStyle = '#c9ced4';
  ctx.fillRect(0, 0, TS, TS);
  const n = 4, m = 6;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < m; j++) {
      const x = 6 + i * ((TS - 12) / n), y = 6 + j * ((TS - 12) / m), w = (TS - 12) / n - 4, h = (TS - 12) / m - 4;
      const g = ctx.createLinearGradient(x, y, x + w, y + h);
      g.addColorStop(0, '#2b4a7a');
      g.addColorStop(1, '#101c33');
      ctx.fillStyle = g;
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = 'rgba(200,210,220,0.35)';
      ctx.fillRect(x + w / 3, y, 1, h);
      ctx.fillRect(x + (2 * w) / 3, y, 1, h);
    }
  return [[0, 0, TS, TS, 110]];
};
// PSYCHE: hand-painted flower-power livery, window band on top
painters[T.PSYCHE] = (ctx, rnd) => {
  const g = ctx.createLinearGradient(0, 0, TS, 0);
  ['#ff5e78', '#ffb347', '#ffe66d', '#7ae582', '#4cc9f0', '#b388ff', '#ff5e78'].forEach((c, i) => g.addColorStop(i / 6, c));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, TS, TS);
  for (let k = 0; k < 7; k++) {
    // flowers
    const x = rnd() * TS, y = TS * 0.45 + rnd() * TS * 0.5, r = 10 + rnd() * 16;
    ctx.fillStyle = rnd() < 0.5 ? '#fff4e0' : '#ff3d7f';
    for (let p = 0; p < 6; p++) {
      const a = (p / 6) * Math.PI * 2;
      ctx.beginPath(); ctx.ellipse(x + Math.cos(a) * r * 0.7, y + Math.sin(a) * r * 0.7, r * 0.45, r * 0.3, a, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = '#ffd23a';
    ctx.beginPath(); ctx.arc(x, y, r * 0.35, 0, Math.PI * 2); ctx.fill();
  }
  // a peace sign
  ctx.strokeStyle = '#111';
  ctx.lineWidth = 5;
  const px = TS * 0.62, py = TS * 0.72, pr = 26;
  ctx.beginPath(); ctx.arc(px, py, pr, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(px, py - pr); ctx.lineTo(px, py + pr); ctx.moveTo(px, py); ctx.lineTo(px - pr * 0.7, py + pr * 0.7); ctx.moveTo(px, py); ctx.lineTo(px + pr * 0.7, py + pr * 0.7); ctx.stroke();
  // window band
  const wy = 10, wh = TS * 0.32;
  ctx.fillStyle = '#f2ead8';
  ctx.fillRect(0, 0, TS, wh + 20);
  const rects: [number, number, number, number, number][] = [];
  for (let i = 0; i < 2; i++) {
    const x = 10 + i * (TS / 2), w = TS / 2 - 20;
    pane(ctx, x, wy, w, wh, rnd);
    rects.push([x, wy, w, wh, 255]);
  }
  return rects;
};
// TIEDYE: spiral
painters[T.TIEDYE] = (ctx) => {
  const img = ctx.createImageData(TS, TS);
  const cols = [[255, 70, 120], [255, 170, 60], [255, 235, 90], [90, 220, 120], [70, 180, 255], [170, 110, 255]];
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const dx = x - TS / 2, dy = y - TS / 2;
      const a = Math.atan2(dy, dx) / (Math.PI * 2) + Math.hypot(dx, dy) / 90;
      const t = ((a % 1) + 1) % 1;
      const f = t * cols.length;
      const i0 = Math.floor(f) % cols.length, i1 = (i0 + 1) % cols.length, w = f - Math.floor(f);
      const o = (y * TS + x) * 4;
      for (let c = 0; c < 3; c++) img.data[o + c] = cols[i0][c] * (1 - w) + cols[i1][c] * w;
      img.data[o + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
};
// STONE: rounded fieldstones in mortar
painters[T.STONE] = (ctx, rnd) => {
  ctx.fillStyle = '#7a756c';
  ctx.fillRect(0, 0, TS, TS);
  for (let k = 0; k < 60; k++) {
    const x = rnd() * TS, y = rnd() * TS, r = 14 + rnd() * 20;
    const v = 110 + rnd() * 70;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(x + 2, y + 3, r, r * 0.75, rnd() * 3, 0, Math.PI * 2); ctx.fill();
    const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 1, x, y, r);
    g.addColorStop(0, `rgb(${v + 30},${v + 26},${v + 20})`);
    g.addColorStop(1, `rgb(${v - 25},${v - 28},${v - 30})`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.75, rnd() * 3, 0, Math.PI * 2); ctx.fill();
  }
};

// CLAY_TILE: staggered barrel tiles with dark overlaps and sunlit crowns.
painters[T.CLAY_TILE] = (ctx, rnd) => {
  noise(ctx, 186, 18, 29, [1.08, 0.58, 0.38]);
  const rows = 9;
  const rh = TS / rows;
  const tw = 34;
  for (let row = 0; row < rows; row++) {
    const y = row * rh;
    const off = row % 2 ? -tw / 2 : 0;
    ctx.fillStyle = 'rgba(55,20,10,0.34)';
    ctx.fillRect(0, y, TS, 4);
    for (let x = off; x < TS + tw; x += tw) {
      const warm = 0.08 + rnd() * 0.08;
      const g = ctx.createLinearGradient(x, y, x + tw, y);
      g.addColorStop(0, 'rgba(70,24,12,0.34)');
      g.addColorStop(0.48, `rgba(255,205,158,${warm})`);
      g.addColorStop(1, 'rgba(65,20,10,0.38)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(x + 2, y + 2);
      ctx.lineTo(x + tw - 2, y + 2);
      ctx.lineTo(x + tw - 5, y + rh);
      ctx.quadraticCurveTo(x + tw / 2, y + rh + 5, x + 5, y + rh);
      ctx.closePath();
      ctx.fill();
    }
  }
};

type SignStyle = 'box' | 'rainbow' | 'glow' | 'flame';
function paintSign(ctx: Ctx, y0: number, text: string, colors: [string, string], font: SignFont, style: SignStyle = 'box') {
  const h = 64;
  if (style === 'glow') {
    // solid warm light (string-light bulbs, lanterns): uniform so any sub-quad glows
    ctx.fillStyle = colors[0];
    ctx.fillRect(0, y0, TS, h);
    return;
  }
  if (style === 'flame') {
    const g = ctx.createLinearGradient(0, y0 + h, 0, y0);
    g.addColorStop(0, '#fff3b0');
    g.addColorStop(0.35, '#ffb02e');
    g.addColorStop(0.75, '#ff5a14');
    g.addColorStop(1, '#8a1a05');
    ctx.fillStyle = g;
    ctx.fillRect(0, y0, TS, h);
    return;
  }
  if (style === 'rainbow') {
    // hand-painted plank sign: wood frame, rainbow field, marker lettering
    ctx.fillStyle = '#6b4a2b';
    ctx.fillRect(0, y0, TS, h);
    const g = ctx.createLinearGradient(0, 0, TS, 0);
    ['#ff4d6d', '#ffb347', '#fff275', '#7dff8a', '#5ec8ff', '#b388ff'].forEach((c, i) => g.addColorStop(i / 5, c));
    ctx.fillStyle = g;
    ctx.fillRect(5, y0 + 5, TS - 10, h - 10);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    for (let k = 0; k < 3; k++) ctx.fillRect(5, y0 + 5 + k * 18, TS - 10, 1);
    ctx.fillStyle = '#2a1a0a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const fam = "'Permanent Marker', 'Comic Sans MS', cursive";
    const words = text.split(' ');
    const lines = text.length > 16 && words.length > 1 ? [words.slice(0, Math.ceil(words.length / 2)).join(' '), words.slice(Math.ceil(words.length / 2)).join(' ')] : [text];
    let size = lines.length > 1 ? 22 : 30;
    ctx.font = `${size}px ${fam}`;
    while (Math.max(...lines.map((l) => ctx.measureText(l).width)) > TS - 22 && size > 10) {
      size -= 1;
      ctx.font = `${size}px ${fam}`;
    }
    lines.forEach((l, i) => ctx.fillText(l, TS / 2, y0 + h / 2 + (lines.length > 1 ? (i - 0.5) * (size + 2) : 1)));
    return;
  }
  ctx.fillStyle = colors[0];
  ctx.fillRect(0, y0, TS, h);
  // border + subtle lightbox gradient
  const g = ctx.createLinearGradient(0, y0, 0, y0 + h);
  g.addColorStop(0, 'rgba(255,255,255,0.18)');
  g.addColorStop(1, 'rgba(0,0,0,0.15)');
  ctx.fillStyle = g;
  ctx.fillRect(0, y0, TS, h);
  ctx.strokeStyle = colors[1];
  ctx.globalAlpha = 0.6;
  ctx.lineWidth = 3;
  ctx.strokeRect(3, y0 + 3, TS - 6, h - 6);
  ctx.globalAlpha = 1;
  let size = font === 'Yellowtail' ? 52 : 40;
  const family = `'${font}', Impact, sans-serif`;
  ctx.font = `${size}px ${family}`;
  while (ctx.measureText(text).width > TS - 18 && size > 12) {
    size -= 2;
    ctx.font = `${size}px ${family}`;
  }
  ctx.fillStyle = colors[1];
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, TS / 2, y0 + h / 2 + (font === 'Yellowtail' ? 2 : 3));
}

function buildTexture(): THREE.DataArrayTexture {
  const signs: { id: string; text: string; colors: [string, string]; font: SignFont; style?: SignStyle }[] = [
    ...BRANDS.map((b) => ({ id: b.id, text: b.name, colors: b.colors, font: b.font ?? 'Bungee' })),
    ...GENERIC_SIGNS,
    ...EXTRA_SIGNS,
    ...ALL_COMMUNE_NAMES.map((n) => ({ id: `commune:${n}`, text: n, colors: ['#000', '#000'] as [string, string], font: 'Permanent Marker' as SignFont, style: 'rainbow' as SignStyle })),
    { id: 'glowWarm', text: '', colors: ['#ffd27a', '#000'], font: 'Bungee', style: 'glow' },
    { id: 'glowCool', text: '', colors: ['#bfe3ff', '#000'], font: 'Bungee', style: 'glow' },
    { id: 'glowPink', text: '', colors: ['#ff7ad0', '#000'], font: 'Bungee', style: 'glow' },
    { id: 'flame', text: '', colors: ['#000', '#000'], font: 'Bungee', style: 'flame' },
  ];
  const signLayers = Math.ceil(signs.length / 4);
  const layers = SIGN_BASE + signLayers;
  const data = new Uint8Array(TS * TS * 4 * layers);
  for (let L = 0; L < SIGN_BASE; L++) {
    const [, ctx] = canvas();
    const rnd = mulberry32(1000 + L * 17);
    const rects = painters[L]?.(ctx, rnd) ?? [];
    const img = ctx.getImageData(0, 0, TS, TS);
    maskRects(img, rects as [number, number, number, number, number][], 0);
    // canvas rows run top-down; flip so v=0 is the bottom of the tile
    for (let y = 0; y < TS; y++) data.set(img.data.subarray((TS - 1 - y) * TS * 4, (TS - y) * TS * 4), (L * TS * TS + y * TS) * 4);
  }
  for (let s = 0; s < signLayers; s++) {
    const [, ctx] = canvas();
    for (let k = 0; k < 4; k++) {
      const sg = signs[s * 4 + k];
      if (!sg) break;
      paintSign(ctx, k * 64, sg.text, sg.colors, sg.font, sg.style);
      // slot k occupies canvas rows [k*64, k*64+64) -> after flip v in [1-(k+1)/4, 1-k/4]
      signSlots.set(sg.id, { layer: SIGN_BASE + s, v0: 1 - (k + 1) / 4 + 0.004, v1: 1 - k / 4 - 0.004 });
    }
    const img = ctx.getImageData(0, 0, TS, TS);
    const L = SIGN_BASE + s;
    for (let y = 0; y < TS; y++) data.set(img.data.subarray((TS - 1 - y) * TS * 4, (TS - y) * TS * 4), (L * TS * TS + y * TS) * 4);
  }
  const tex = new THREE.DataArrayTexture(data, TS, TS, layers);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Wait for sign fonts so canvas text doesn't fall back to Impact. */
export async function loadSignFonts() {
  const fams: SignFont[] = ['Bungee', 'Anton', 'Titan One', 'Permanent Marker', 'Yellowtail', 'Overpass'];
  if (!document.fonts?.load) return;
  const t = new Promise((res) => setTimeout(res, 2500));
  await Promise.race([Promise.all(fams.map((f) => document.fonts.load(`40px '${f}'`).catch(() => undefined))), t]);
}
