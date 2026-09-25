// The one texture atlas every building, landmark and billboard samples.
//
// Tiles are registered by name with a painter. Layout (packing) is synchronous
// and deterministic, so geometry can be generated before the art is painted;
// loadArt() waits for fonts, then paints the albedo atlas (4096²) and a
// half-resolution emissive atlas (night windows, signs, screens) with the
// same layout. Every tile gets an 8px gutter (wrapped for repeating
// facades, edge-clamped for signs) so mipmaps don't bleed between tiles.
import * as THREE from 'three';
import type { Ctx } from './draw';

export type Layer = 'a' | 'e'; // albedo | emissive
export type Painter = (c: Ctx, w: number, h: number, layer: Layer) => void;

export interface Tile {
  name: string;
  /** UV rect: u0..u1 left to right, v0 (bottom) .. v1 (top) */
  u0: number;
  u1: number;
  v0: number;
  v1: number;
  /** logical size in px (aspect ratio source) */
  w: number;
  h: number;
}

interface TileDef {
  name: string;
  w: number; // logical px (painter coordinates)
  h: number;
  res: number; // physical px per logical px
  wrap: boolean;
  emissive: boolean;
  shrink: boolean; // may be scaled down if the atlas overflows
  paint: Painter;
  // layout results (physical px in the albedo atlas)
  x: number;
  y: number;
  pw: number;
  ph: number;
}

export const ATLAS_SIZE = 4096;
const EMI_SCALE = 0.5;
const PAD = 6;

const defs: TileDef[] = [];
const byName = new Map<string, TileDef>();
const tiles = new Map<string, Tile>();
let registrars: (() => void)[] = [];
let laidOut = false;
let painted = false;
let usedHeight = 0;

/** Register a tile. Called by the art modules' register functions. */
export function defTile(name: string, w: number, h: number, paint: Painter, o: { wrap?: boolean; emissive?: boolean; shrink?: boolean; res?: number } = {}) {
  if (byName.has(name)) return;
  const d: TileDef = { name, w, h, res: o.res ?? 1, wrap: !!o.wrap, emissive: !!o.emissive, shrink: o.shrink ?? !o.wrap, paint, x: 0, y: 0, pw: 0, ph: 0 };
  defs.push(d);
  byName.set(name, d);
}

/** Art modules add their register function here; run once at layout time. */
export function addRegistrar(fn: () => void) {
  registrars.push(fn);
}

function even(n: number) {
  return Math.max(2, Math.round(n / 2) * 2);
}

interface Seg {
  x: number;
  y: number;
  w: number;
}

function pack(scale: number): boolean {
  // Skyline bottom-left packer, tallest first. Shrinkable tiles are scaled by `scale`.
  for (const d of defs) {
    const k = (d.shrink ? scale : 1) * d.res;
    d.pw = even(d.w * k);
    d.ph = even(d.h * k);
  }
  const order = [...defs].sort((a, b) => b.ph - a.ph || b.pw - a.pw || (a.name < b.name ? -1 : 1));
  let sky: Seg[] = [{ x: 0, y: 0, w: ATLAS_SIZE }];
  let maxY = 0;
  for (const d of order) {
    const W = d.pw + PAD * 2, H = d.ph + PAD * 2;
    let bestY = Infinity, bestX = 0;
    for (let i = 0; i < sky.length; i++) {
      const x = sky[i].x;
      if (x + W > ATLAS_SIZE) break;
      let y = 0, left = W, j = i;
      while (left > 0 && j < sky.length) {
        y = Math.max(y, sky[j].y);
        left -= sky[j].w;
        j++;
      }
      if (left > 0) continue;
      if (y + H <= ATLAS_SIZE && y < bestY) {
        bestY = y;
        bestX = x;
      }
    }
    if (bestY === Infinity) return false;
    d.x = bestX;
    d.y = bestY;
    const seg: Seg = { x: bestX, y: bestY + H, w: W };
    const next: Seg[] = [];
    for (const s of sky) {
      const sEnd = s.x + s.w, nEnd = seg.x + seg.w;
      if (sEnd <= seg.x || s.x >= nEnd) next.push(s);
      else {
        if (s.x < seg.x) next.push({ x: s.x, y: s.y, w: seg.x - s.x });
        if (sEnd > nEnd) next.push({ x: nEnd, y: s.y, w: sEnd - nEnd });
      }
    }
    next.push(seg);
    next.sort((a, b) => a.x - b.x);
    sky = [];
    for (const s of next) {
      const last = sky[sky.length - 1];
      if (last && last.y === s.y && last.x + last.w === s.x) last.w += s.w;
      else sky.push({ ...s });
    }
    maxY = Math.max(maxY, bestY + H);
  }
  usedHeight = maxY;
  return true;
}

function ensureLayout() {
  if (laidOut) return;
  laidOut = true;
  const regs = registrars;
  registrars = [];
  for (const r of regs) r();
  let scale = 1;
  while (!pack(scale) && scale > 0.4) scale *= 0.92;
  if (scale < 1) console.warn(`[atlas] shrank signs/billboards to ${(scale * 100).toFixed(0)}% to fit`);
  for (const d of defs) {
    tiles.set(d.name, {
      name: d.name,
      u0: (d.x + PAD) / ATLAS_SIZE,
      u1: (d.x + PAD + d.pw) / ATLAS_SIZE,
      v1: 1 - (d.y + PAD) / ATLAS_SIZE,
      v0: 1 - (d.y + PAD + d.ph) / ATLAS_SIZE,
      w: d.w,
      h: d.h,
    });
  }
}

const warned = new Set<string>();
/** Look up a tile by name (falls back to 'plain'). */
export function T(name: string): Tile {
  ensureLayout();
  const t = tiles.get(name);
  if (t) return t;
  if (!warned.has(name)) {
    warned.add(name);
    console.warn(`[atlas] missing tile "${name}"`);
  }
  return tiles.get('plain')!;
}

export function hasTile(name: string) {
  ensureLayout();
  return tiles.has(name);
}

export function tileNames(prefix = '') {
  ensureLayout();
  return [...tiles.keys()].filter((n) => n.startsWith(prefix));
}

export function atlasStats() {
  ensureLayout();
  let area = 0;
  const byPrefix: Record<string, number> = {};
  for (const d of defs) {
    const a = (d.pw + PAD * 2) * (d.ph + PAD * 2);
    area += a;
    const p = d.name.includes(':') ? d.name.split(':')[0] : d.wrap ? 'wall' : 'decal';
    byPrefix[p] = (byPrefix[p] ?? 0) + a / (ATLAS_SIZE * ATLAS_SIZE);
  }
  return { tiles: defs.length, usedHeight, fill: area / (ATLAS_SIZE * ATLAS_SIZE), byPrefix };
}

// ------------------------------------------------------------------ canvases & textures
let canvasA: HTMLCanvasElement | null = null;
let canvasE: HTMLCanvasElement | null = null;
let texA: THREE.CanvasTexture | null = null;
let texE: THREE.CanvasTexture | null = null;

function makeCanvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function setupTex(t: THREE.CanvasTexture) {
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** The albedo and emissive atlas textures (blank until loadArt() paints them). */
export function atlasTextures() {
  if (!texA) {
    canvasA = makeCanvas(ATLAS_SIZE, ATLAS_SIZE);
    canvasE = makeCanvas(ATLAS_SIZE * EMI_SCALE, ATLAS_SIZE * EMI_SCALE);
    const a = canvasA.getContext('2d')!;
    a.fillStyle = '#9a948a';
    a.fillRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);
    const e = canvasE.getContext('2d')!;
    e.fillStyle = '#000';
    e.fillRect(0, 0, canvasE.width, canvasE.height);
    texA = setupTex(new THREE.CanvasTexture(canvasA));
    texE = setupTex(new THREE.CanvasTexture(canvasE));
  }
  return { map: texA, emissive: texE!, canvas: canvasA!, emissiveCanvas: canvasE! };
}

let tmpA: HTMLCanvasElement | null = null;
let tmpE: HTMLCanvasElement | null = null;

function blit(dst: Ctx, src: HTMLCanvasElement, x: number, y: number, w: number, h: number, pad: number, wrap: boolean) {
  dst.drawImage(src, 0, 0, w, h, x, y, w, h);
  dst.imageSmoothingEnabled = false;
  if (wrap) {
    dst.drawImage(src, w - pad, 0, pad, h, x - pad, y, pad, h);
    dst.drawImage(src, 0, 0, pad, h, x + w, y, pad, h);
    dst.drawImage(src, 0, h - pad, w, pad, x, y - pad, w, pad);
    dst.drawImage(src, 0, 0, w, pad, x, y + h, w, pad);
    dst.drawImage(src, w - pad, h - pad, pad, pad, x - pad, y - pad, pad, pad);
    dst.drawImage(src, 0, h - pad, pad, pad, x + w, y - pad, pad, pad);
    dst.drawImage(src, w - pad, 0, pad, pad, x - pad, y + h, pad, pad);
    dst.drawImage(src, 0, 0, pad, pad, x + w, y + h, pad, pad);
  } else {
    dst.drawImage(src, 0, 0, 1, h, x - pad, y, pad, h);
    dst.drawImage(src, w - 1, 0, 1, h, x + w, y, pad, h);
    dst.drawImage(src, 0, 0, w, 1, x, y - pad, w, pad);
    dst.drawImage(src, 0, h - 1, w, 1, x, y + h, w, pad);
    dst.drawImage(src, 0, 0, 1, 1, x - pad, y - pad, pad, pad);
    dst.drawImage(src, w - 1, 0, 1, 1, x + w, y - pad, pad, pad);
    dst.drawImage(src, 0, h - 1, 1, 1, x - pad, y + h, pad, pad);
    dst.drawImage(src, w - 1, h - 1, 1, 1, x + w, y + h, pad, pad);
  }
  dst.imageSmoothingEnabled = true;
}

function paintOne(d: TileDef, a: Ctx, e: Ctx) {
  if (!tmpA) tmpA = makeCanvas(64, 64);
  if (!tmpE) tmpE = makeCanvas(64, 64);
  // albedo
  tmpA.width = d.pw;
  tmpA.height = d.ph;
  const ca = tmpA.getContext('2d')!;
  ca.save();
  ca.scale(d.pw / d.w, d.ph / d.h);
  try {
    d.paint(ca, d.w, d.h, 'a');
  } catch (err) {
    console.error(`[atlas] painter ${d.name} failed`, err);
  }
  ca.restore();
  blit(a, tmpA, d.x + PAD, d.y + PAD, d.pw, d.ph, PAD, d.wrap);
  if (!d.emissive) return;
  const ew = d.pw * EMI_SCALE, eh = d.ph * EMI_SCALE;
  tmpE.width = ew;
  tmpE.height = eh;
  const ce = tmpE.getContext('2d')!;
  ce.fillStyle = '#000';
  ce.fillRect(0, 0, ew, eh);
  ce.save();
  ce.scale(ew / d.w, eh / d.h);
  try {
    d.paint(ce, d.w, d.h, 'e');
  } catch (err) {
    console.error(`[atlas] emissive painter ${d.name} failed`, err);
  }
  ce.restore();
  blit(e, tmpE, (d.x + PAD) * EMI_SCALE, (d.y + PAD) * EMI_SCALE, ew, eh, PAD * EMI_SCALE, d.wrap);
}

/** fonts: CSS font shorthands, e.g. '900 40px "Overpass"'. Never blocks longer than timeoutMs. */
async function fontsReady(fonts: string[], timeoutMs = 4000) {
  if (typeof document === 'undefined' || !document.fonts) return;
  const loads = fonts.map((f) => document.fonts.load(f).catch(() => []));
  await Promise.race([Promise.all(loads), new Promise((r) => setTimeout(r, timeoutMs))]);
}

let painting: Promise<void> | null = null;

/** Paint every registered tile into the atlases (once). */
export function paintAtlas(fonts: string[]): Promise<void> {
  if (painting) return painting;
  painting = (async () => {
    ensureLayout();
    await fontsReady(fonts);
    const { map, emissive, canvas, emissiveCanvas } = atlasTextures();
    const a = canvas.getContext('2d')!;
    const e = emissiveCanvas.getContext('2d')!;
    const t0 = performance.now();
    for (const d of defs) paintOne(d, a, e);
    map.needsUpdate = true;
    emissive.needsUpdate = true;
    painted = true;
    const st = atlasStats();
    console.info(`[atlas] painted ${st.tiles} tiles in ${(performance.now() - t0).toFixed(0)}ms, ${(st.fill * 100).toFixed(0)}% full, height ${st.usedHeight}`);
  })();
  return painting;
}

export function atlasPainted() {
  return painted;
}
