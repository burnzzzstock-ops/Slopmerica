import { GLOW } from '../config';
// Turns the road network into meshes: textured ribbons per road type, junction
// polygons, concrete skirts / bridge decks / barriers / pillars, and street lights.
import * as THREE from 'three';
import { litByLamps } from '../world/nightLights';
import { clamp, convexHull, lerp, locate, norm, sub, V2 } from '../core/math';
import { mulberry32 } from '../core/rng';
import { carriageHalf, laneOffset, ROAD_TYPES, RoadType, RoadTypeId, ROAD_ORDER } from './roadTypes';
import type { RNode, RoadNetwork, RSeg } from './network';
import { StreetDetails } from './streetDetails';
import { isSimple, junctionShape, legPaint, triangulate, visualTrim } from './roadJunction';
import type { Junction } from './roadJunction';
import {
  CURB_REVEAL, DRIVE_FLARE, DRIVE_FLAT, GROUND_BELOW, GUTTER, SURF_LIFT, VERGE_RUN, ZEBRA_EDGE, curbLipAt, curbOffset, driveRamp, edgeLift,
} from './roadSection';
import type { SignalStateProvider } from './streetDetails';

const REPEAT = 12; // meters per texture repeat along the road

class Buf {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  idx: number[] = [];
  get count() {
    return this.pos.length / 3;
  }
  v(x: number, y: number, z: number, nx: number, ny: number, nz: number, u = 0, w = 0, c?: [number, number, number]) {
    this.pos.push(x, y, z);
    this.nor.push(nx, ny, nz);
    this.uv.push(u, w);
    if (c) this.col.push(c[0], c[1], c[2]);
    return this.count - 1;
  }
  tri(a: number, b: number, c: number) {
    this.idx.push(a, b, c);
  }
  /** Append another buffer's geometry (its indices shifted to follow this one's vertices). */
  absorb(o: Buf) {
    const at = this.count;
    for (const v of o.pos) this.pos.push(v);
    for (const v of o.nor) this.nor.push(v);
    for (const v of o.uv) this.uv.push(v);
    for (const v of o.col) this.col.push(v);
    for (const i of o.idx) this.idx.push(i + at);
  }
  quad(a: number, b: number, c: number, d: number) {
    // a-b-c-d in screen-CCW order
    this.idx.push(a, b, c, a, c, d);
  }
  /** A quad wound so its front side faces (nx, ny, nz): the concrete is double-sided and lit by its normals, so the winding decides which side is the front */
  quadN(a: number, b: number, c: number, d: number, nx: number, ny: number, nz: number) {
    const P = this.pos;
    const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
    const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
    const dot = (uy * vz - uz * vy) * nx + (uz * vx - ux * vz) * ny + (ux * vy - uy * vx) * nz;
    if (dot >= 0) this.idx.push(a, b, c, a, c, d);
    else this.idx.push(a, c, b, a, d, c);
  }
  /** Axis-aligned-ish box given center, half sizes and yaw. */
  box(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, yaw: number, color: [number, number, number]) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const P = (x: number, y: number, z: number): [number, number, number] => [cx + x * c - z * s, cy + y, cz + x * s + z * c];
    const faces: [number[], number[][]][] = [
      [[0, 1, 0], [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]]],
      [[0, -1, 0], [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]]],
      [[1, 0, 0], [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]]],
      [[-1, 0, 0], [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]]],
      [[0, 0, 1], [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]],
      [[0, 0, -1], [[-1, -1, -1], [-1, 1, -1], [1, 1, -1], [1, -1, -1]]],
    ];
    for (const [n, corners] of faces) {
      const nx = n[0] * c - n[2] * s, nz = n[0] * s + n[2] * c;
      const ids = corners.map(([x, y, z]) => {
        const p = P(x * hx, y * hy, z * hz);
        return this.v(p[0], p[1], p[2], nx, n[1], nz, 0, 0, color);
      });
      this.idx.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]);
    }
  }
}

/** The points (and their heights) with any that sit within a centimetre of the one before dropped. */
/** A street lamp: foot position, and the yaw that swings its arm (local -z) over the road. */
type Lamp = { x: number; y: number; z: number; yaw: number };

function dedupe(pts: V2[], hs: number[]): { pts: V2[]; hs: number[] } {
  const P: V2[] = [], H: number[] = [];
  for (let k = 0; k < pts.length; k++) {
    const q = P[P.length - 1];
    if (q && Math.hypot(pts[k].x - q.x, pts[k].z - q.z) < 0.01) continue;
    P.push(pts[k]); H.push(hs[k]);
  }
  while (P.length > 1 && Math.hypot(P[0].x - P[P.length - 1].x, P[0].z - P[P.length - 1].z) < 0.01) { P.pop(); H.pop(); }
  return { pts: P, hs: H };
}

/** A triangle wound so its front side faces up, whichever way the strip runs (the crosswalk is double-sided, and a back face is lit as its flipped normal: dark). */
function upTri(b: Buf, a: number, c: number, d: number) {
  const P = b.pos;
  const cross = (P[c * 3 + 2] - P[a * 3 + 2]) * (P[d * 3] - P[a * 3]) - (P[c * 3] - P[a * 3]) * (P[d * 3 + 2] - P[a * 3 + 2]);
  // (y of (c-a) x (d-a)) is  (cz-az)(dx-ax) - (cx-ax)(dz-az)
  if (cross >= 0) b.tri(a, c, d);
  else b.tri(a, d, c);
}

function concat(bufs: Buf[], withColor: boolean, withUv: boolean): THREE.BufferGeometry {
  let nv = 0, ni = 0;
  for (const b of bufs) { nv += b.count; ni += b.idx.length; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3);
  const uv = withUv ? new Float32Array(nv * 2) : null;
  const col = withColor ? new Float32Array(nv * 3) : null;
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let ov = 0, oi = 0;
  for (const b of bufs) {
    pos.set(b.pos, ov * 3);
    nor.set(b.nor, ov * 3);
    if (uv) uv.set(b.uv, ov * 2);
    if (col && b.col.length) col.set(b.col, ov * 3);
    for (let k = 0; k < b.idx.length; k++) idx[oi + k] = b.idx[k] + ov;
    ov += b.count;
    oi += b.idx.length;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  if (uv) g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (col) g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}

// ------------------------------------------------------------------ textures
function noiseFill(ctx: CanvasRenderingContext2D, w: number, h: number, base: [number, number, number], amp: number) {
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const n = (Math.random() - 0.5) * amp;
    img.data[i * 4] = base[0] + n;
    img.data[i * 4 + 1] = base[1] + n;
    img.data[i * 4 + 2] = base[2] + n;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

// ------------------------------------------------------------------ asphalt and concrete wear
// Graphics only: every random number here comes from a seeded generator (core/rng's mulberry32, one per road type), so a road looks the same
// on every load and the sim never sees any of it. Everything is painted into the road's own canvas, so it costs no
// geometry and no draw call.
function seedOf(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
const WEAR_LIGHT = '132,130,128', WEAR_DARK = '40,40,44';

/** A soft elliptical stain (rx across, ry along), drawn again on the far side of any edge it crosses so a tiling texture stays seamless. */
function blotch(ctx: CanvasRenderingContext2D, W: number, H: number, wrapX: boolean, x: number, y: number, rx: number, ry: number, rgb: string, a: number) {
  for (const dy of [0, -H, H]) for (const dx of wrapX ? [0, -W, W] : [0]) {
    const cx = x + dx, cy = y + dy;
    if (cx + rx < 0 || cx - rx > W || cy + ry < 0 || cy - ry > H) continue;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, ry / rx);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    g.addColorStop(0, `rgba(${rgb},${a})`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(-rx, -rx, rx * 2, rx * 2);
    ctx.restore();
  }
}

/** Patchy asphalt: equal numbers of paler and darker stains, so the mean tone stays where it was. */
function mottle(ctx: CanvasRenderingContext2D, W: number, H: number, wrapX: boolean, x0: number, x1: number, count: number, size: number, rnd: () => number, strength = 1) {
  for (let i = 0; i < count; i++) {
    const rx = size * (0.5 + rnd() * 0.9), ry = rx * (1 + rnd() * 1.4);
    blotch(ctx, W, H, wrapX, x0 + rnd() * (x1 - x0), rnd() * H, rx, ry, i & 1 ? WEAR_LIGHT : WEAR_DARK, (0.1 + rnd() * 0.09) * strength);
  }
}

/** A tar-filled crack: a thin dark line with a faint paler lip, wandering along the road in a way that repeats exactly once per tile. */
function tarSeam(ctx: CanvasRenderingContext2D, W: number, H: number, x: number, amp: number, rnd: () => number) {
  const k1 = 1 + Math.floor(rnd() * 2), k2 = 3 + Math.floor(rnd() * 3), p1 = rnd() * 6.28, p2 = rnd() * 6.28;
  const path = (off: number) => {
    ctx.beginPath();
    for (let y = 0; y <= H; y += 4) {
      const t = (y / H) * 6.283;
      const px = x + off + amp * Math.sin(k1 * t + p1) + amp * 0.35 * Math.sin(k2 * t + p2);
      if (y === 0) ctx.moveTo(px, y); else ctx.lineTo(px, y);
    }
    ctx.stroke();
  };
  const dash: number[] = [];
  for (let n = 0; n < 8; n++) dash.push(30 + rnd() * 90, 4 + rnd() * 26);
  ctx.setLineDash(dash);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(150,148,146,0.12)';
  path(1.6);
  ctx.strokeStyle = 'rgba(16,16,18,0.36)';
  ctx.lineWidth = 1;
  path(0);
  ctx.setLineDash([]);
}

/** A resurfaced patch: a rectangle a shade off the surrounding tone with a sealed, darker edge. */
function patch(ctx: CanvasRenderingContext2D, H: number, x: number, y: number, w: number, h: number, dark: boolean) {
  for (const dy of [0, -H, H]) {
    if (y + dy + h < 0 || y + dy > H) continue;
    ctx.fillStyle = dark ? 'rgba(30,30,34,0.16)' : 'rgba(150,148,146,0.13)';
    ctx.fillRect(x, y + dy, w, h);
    ctx.strokeStyle = 'rgba(14,14,16,0.26)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + dy + 0.5, w - 1, h - 1);
  }
}

const srgbToLinear = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };

/** Histogram of a rectangle's luminance (Rec. 709 weights on the sRGB bytes), one bin per byte value. */
function lumaHist(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const d = ctx.getImageData(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h))).data;
  const hist = new Float64Array(256);
  for (let i = 0; i < d.length; i += 4) hist[Math.min(255, Math.round(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]))]++;
  return hist;
}

/** Mean linear-light luminance of a rectangle: what the lighting, and the eye at a distance, average. */
function linearTone(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const hist = lumaHist(ctx, x, y, w, h);
  let s = 0, n = 0;
  for (let v = 0; v < 256; v++) { s += hist[v] * srgbToLinear(v); n += hist[v]; }
  return s / n;
}

/**
 * Put a rectangle's tone back after wear was painted into it: a flat wash of white or black, its strength solved so the
 * rectangle's mean linear-light luminance is `target` again (measured before the wear). Averaging the sRGB bytes
 * instead leaves the surface measurably lighter or darker once it is lit, because stains of equal size in bytes are
 * not equal in light.
 */
function holdTone(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, target: number) {
  const hist = lumaHist(ctx, x, y, w, h);
  let n = 0;
  for (let v = 0; v < 256; v++) n += hist[v];
  const after = (a: number, white: boolean) => {
    let s = 0;
    for (let v = 0; v < 256; v++) if (hist[v]) s += hist[v] * srgbToLinear(white ? v + a * (255 - v) : v * (1 - a));
    return s / n;
  };
  const white = after(0, true) < target;
  let lo = 0, hi = 0.6;
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2;
    if ((after(mid, white) < target) === white) lo = mid; else hi = mid;
  }
  ctx.fillStyle = white ? `rgba(255,255,255,${lo})` : `rgba(0,0,0,${lo})`;
  ctx.fillRect(x, y, w, h);
}

/** Speckle worn paint: flakes of the asphalt showing through a painted rectangle. */
function wornPaint(ctx: CanvasRenderingContext2D, rnd: () => number, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = 'rgba(92,92,96,0.62)';
  const n = Math.round(w * h * 0.09);
  for (let i = 0; i < n; i++) ctx.fillRect(x + rnd() * w, y + rnd() * h, 1, 1 + Math.floor(rnd() * 3));
}

/** Where a block's driveway aprons are (arc length, side): the curb dips there and nothing stands in them. */
export function segDriveways(net: RoadNetwork, seg: RSeg): { d: number; side: number }[] {
  const t = ROAD_TYPES[seg.type];
  const out: { d: number; side: number }[] = [];
  if (t.sidewalk <= 0) return out;
  const s0 = visualTrim(net, seg, seg.a), s1 = seg.length - visualTrim(net, seg, seg.b);
  for (let d = s0 + 18 + (seg.id % 5) * 4; d < s1 - 12; d += 34 + (seg.id % 3) * 5) out.push({ d, side: ((Math.floor(d / 30) + seg.id) & 1) ? 1 : -1 });
  return out;
}

/** Where a block's street lamps stand (arc length, side), alternating sides. */
export function segLamps(net: RoadNetwork, seg: RSeg): { d: number; side: number }[] {
  const t = ROAD_TYPES[seg.type];
  const out: { d: number; side: number }[] = [];
  if (!(t.sidewalk > 0 || t.id === 'highway')) return out;
  const s0 = visualTrim(net, seg, seg.a), s1 = seg.length - visualTrim(net, seg, seg.b);
  const spacing = t.id === 'highway' ? 40 : 30;
  let side = 1;
  for (let d = s0 + 8; d < s1 - 4; d += spacing) { out.push({ d, side }); side = -side; }
  return out;
}

function roadTexture(t: RoadType, maxAniso: number): THREE.CanvasTexture {
  const W = 256, H = 512;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  const px = (m: number) => (m / t.width) * W; // meters across -> px
  const py = (m: number) => (m / REPEAT) * H;
  if (t.id === 'gravel') {
    noiseFill(ctx, W, H, [132, 112, 86], 50);
    ctx.fillStyle = 'rgba(90,72,52,0.35)';
    for (const x of [0.28, 0.72]) ctx.fillRect(W * x - 14, 0, 28, H); // tire ruts
  } else {
    noiseFill(ctx, W, H, [84, 84, 88], 22);
    const half = t.width / 2;
    const sw = t.sidewalk;
    if (sw > 0) {
      // sidewalk (expansion joints every 2 m), a paler curb top along its inner edge, a darker back-of-walk
      // edge, and the concrete gutter pan between the asphalt and the curb: all in the road's own metres
      const gut = px(GUTTER), curbTop = px(0.16), back = px(0.14);
      ctx.fillStyle = '#9d9a92';
      ctx.fillRect(0, 0, px(sw), H);
      ctx.fillRect(W - px(sw), 0, px(sw), H);
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      for (let y = 0; y < H; y += py(2)) { ctx.fillRect(0, y, px(sw), 2); ctx.fillRect(W - px(sw), y, px(sw), 2); }
      ctx.fillStyle = '#b3b0a7';
      ctx.fillRect(px(sw) - curbTop, 0, curbTop, H);
      ctx.fillRect(W - px(sw), 0, curbTop, H);
      ctx.fillStyle = '#8a877f';
      ctx.fillRect(0, 0, back, H);
      ctx.fillRect(W - back, 0, back, H);
      ctx.fillStyle = '#8f8d87'; // gutter pan
      ctx.fillRect(px(sw), 0, gut, H);
      ctx.fillRect(W - px(sw) - gut, 0, gut, H);
      ctx.fillStyle = '#56565a'; // the seam where the asphalt meets it
      ctx.fillRect(px(sw) + gut - 1, 0, 1.5, H);
      ctx.fillRect(W - px(sw) - gut - 0.5, 0, 1.5, H);
    }
    const ch = carriageHalf(t);
    const cx = W / 2;
    const inner = (t.centerTurn ? t.laneW / 2 : 0) + t.median / 2;
    // ---- wear, under the paint (see the notes above mulberry32): patchy asphalt, worn wheel paths, grime along the
    // gutter, tar seams and a patch or two, then dirt on the walks. The carriageway's tone, and the walks', are put back
    // afterwards (holdTone: mean linear-light luminance), so the wear adds texture without making the road lighter or
    // darker (the night targets in docs/ART_DIRECTION.md are set on that tone)
    const rnd = mulberry32(seedOf(t.id));
    const cx0 = px(sw) + (sw > 0 ? px(GUTTER) : 0), cx1 = W - cx0;
    const widthM = (cx1 - cx0) / px(1); // carriageway width in metres: every count below scales with it, so a six-lane road is as patchy per square metre as a two-lane one
    // the tone to hold: what this road averaged before, with the flat oil-stain band the old texture ran down each lane's centre
    const scratch = document.createElement('canvas');
    scratch.width = W;
    scratch.height = H;
    const sctx = scratch.getContext('2d')!;
    sctx.drawImage(c, 0, 0);
    sctx.fillStyle = 'rgba(20,20,20,0.12)';
    for (let k = 0; k < t.lanesPerDir; k++) {
      const off = inner + (k + 0.5) * t.laneW;
      sctx.fillRect(cx + px(off) - 6, 0, 12, H);
      sctx.fillRect(cx - px(off) - 6, 0, 12, H);
    }
    const toneRoad = linearTone(sctx, cx0, 0, cx1 - cx0, H);
    const walkW = px(sw) + (sw > 0 ? px(GUTTER) : 0); // (a sidewalk and its gutter pan, which the wear below also touches)
    const toneWalk = sw > 0 ? [linearTone(ctx, 0, 0, walkW, H), linearTone(ctx, W - walkW, 0, walkW, H)] : [0, 0];
    ctx.save();
    ctx.beginPath();
    ctx.rect(cx0, 0, cx1 - cx0, H);
    ctx.clip();
    mottle(ctx, W, H, false, cx0, cx1, Math.round(widthM * 3.4), px(2.1), rnd, 0.8); // broad cloudy areas, the scale you see from the gameplay camera
    mottle(ctx, W, H, false, cx0, cx1, Math.round(widthM * 9), px(0.85), rnd);
    for (let k = 0; k < t.lanesPerDir; k++) {
      const lanes = t.oneWay ? [laneOffset(t, k)] : [-laneOffset(t, k), laneOffset(t, k)];
      for (const lane of lanes) {
        for (const w of [-0.78, 0.78]) {
          // the two wheel paths: dark rubber and oil, in broken lengths with a soft edge
          let y = rnd() * py(3);
          while (y < H) {
            const len = py(2 + rnd() * 9);
            for (const wm of [0.62, 0.44, 0.26]) { ctx.fillStyle = 'rgba(28,26,24,0.055)'; ctx.fillRect(cx + px(lane + w) - px(wm) / 2, y, px(wm), Math.min(len, H - y)); }
            y += len + py(rnd() * 3.5);
          }
        }
        if (rnd() < 0.5) blotch(ctx, W, H, false, cx + px(lane) + (rnd() - 0.5) * px(0.3), rnd() * H, px(0.17), py(0.5 + rnd() * 0.9), '16,14,12', 0.32);
      }
    }
    for (const side of [-1, 1]) {
      const edge = side < 0 ? cx0 : cx1, grime = px(0.55);
      const inward = edge - side * grime, gr = ctx.createLinearGradient(edge, 0, inward, 0);
      gr.addColorStop(0, 'rgba(30,26,20,0.32)');
      gr.addColorStop(1, 'rgba(30,26,20,0)');
      ctx.fillStyle = gr;
      ctx.fillRect(Math.min(edge, inward), 0, grime, H);
    }
    for (let i = 0; i < Math.max(1, Math.round(widthM / 3.5)); i++) tarSeam(ctx, W, H, cx0 + px(0.7) + rnd() * (cx1 - cx0 - px(1.4)), px(0.22), rnd);
    for (let i = 0; i < Math.max(1, Math.round((widthM / 8) * (1 + rnd() * 1.4))); i++) patch(ctx, H, cx0 + rnd() * (cx1 - cx0 - px(2.4)), rnd() * H, px(1.0 + rnd() * 1.4), py(1.6 + rnd() * 2.2), rnd() < 0.6);
    ctx.restore();
    holdTone(ctx, cx0, 0, cx1 - cx0, H, toneRoad);
    if (sw > 0) {
      const walks: [number, number][] = [[0, px(sw)], [W - px(sw), W]];
      ctx.save();
      for (const [a, b] of walks) {
        ctx.beginPath(); ctx.rect(a, 0, b - a, H); ctx.clip();
        for (let i = 0; i < 26; i++) {
          const rx = px(0.32 + rnd() * 0.5), ry = rx * (1 + rnd() * 1.6);
          blotch(ctx, W, H, false, a + rnd() * (b - a), rnd() * H, rx, ry, i & 1 ? '196,194,186' : '92,90,84', 0.12 + rnd() * 0.1);
        }
      }
      ctx.restore();
      ctx.fillStyle = 'rgba(58,50,38,0.24)'; // dirt and leaf litter in the gutter pans
      ctx.fillRect(px(sw), 0, px(GUTTER), H);
      ctx.fillRect(W - px(sw) - px(GUTTER), 0, px(GUTTER), H);
      holdTone(ctx, 0, 0, walkW, H, toneWalk[0]);
      holdTone(ctx, W - walkW, 0, walkW, H, toneWalk[1]);
    }
    const line = (mOff: number, color: string, dashed: boolean, wPx = 3) => {
      ctx.fillStyle = color;
      const x = cx + px(mOff) - wPx / 2;
      if (!dashed) { ctx.fillRect(x, 0, wPx, H); wornPaint(ctx, rnd, x, 0, wPx, H); }
      else for (let y = 0; y < H; y += py(12)) { ctx.fillRect(x, y, wPx, py(3.5)); wornPaint(ctx, rnd, x, y, wPx, py(3.5)); }
    };
    if (t.oneWay) {
      // one-way: yellow on the left edge, white on the right, dashes between lanes, arrows the way it runs
      line(-ch + 0.3, '#e8c33a', false);
      line(ch - 0.3, '#e8e8e2', false);
      for (let k = 1; k < t.lanesPerDir; k++) line(-ch + k * t.laneW, '#e8e8e2', true);
      ctx.fillStyle = '#ecece6';
      for (let k = 0; k < t.lanesPerDir; k++) {
        const x = cx + px(-ch + (k + 0.5) * t.laneW);
        const aw = px(1.3), sw = px(0.36), y0 = py(3.4), y1 = py(8.6), head = py(2.2);
        // (v runs up the canvas: the texture's top is further along a -> b)
        ctx.fillRect(x - sw / 2, y0 + head * 0.9, sw, y1 - y0 - head * 0.9);
        ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x + aw / 2, y0 + head); ctx.lineTo(x - aw / 2, y0 + head); ctx.closePath(); ctx.fill();
        wornPaint(ctx, rnd, x - aw / 2, y0, aw, head);
        wornPaint(ctx, rnd, x - sw / 2, y0 + head * 0.9, sw, y1 - y0 - head * 0.9);
      }
      const tex = new THREE.CanvasTexture(c);
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.anisotropy = maxAniso;
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    }
    // edge lines
    line(-ch + 0.3, '#e8e8e2', false);
    line(ch - 0.3, '#e8e8e2', false);
    if (t.centerTurn) {
      const h2 = t.laneW / 2;
      line(-h2, '#e8c33a', false);
      line(-h2 + 0.35, '#e8c33a', true);
      line(h2, '#e8c33a', false);
      line(h2 - 0.35, '#e8c33a', true);
    } else if (t.median > 0) {
      ctx.fillStyle = '#4a4a4c';
      ctx.fillRect(cx - px(t.median / 2), 0, px(t.median), H);
      line(-t.median / 2 - 0.3, '#e8c33a', false);
      line(t.median / 2 + 0.3, '#e8c33a', false);
    } else {
      line(-0.15, '#e8c33a', false);
      line(0.15, '#e8c33a', false);
    }
    for (let k = 1; k < t.lanesPerDir; k++) {
      line(inner + k * t.laneW, '#e8e8e2', true);
      line(-(inner + k * t.laneW), '#e8e8e2', true);
    }
    // (the old flat oil-stain bands down each lane's centre are now the broken wheel paths painted under the lines)
    void half;
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = maxAniso;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function asphaltTexture(maxAniso: number) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  noiseFill(ctx, 256, 256, [84, 84, 88], 22);
  // the same wear as the roads' own canvases (linear-light tone put back, so it meets them without a seam in tone); the tile
  // is 8 m across and repeats in both directions, so the stains wrap and the seam wanders to match
  const rnd = mulberry32(seedOf('junction'));
  const tone = linearTone(ctx, 0, 0, 256, 256);
  mottle(ctx, 256, 256, true, 0, 256, 10, 62, rnd, 0.8);
  mottle(ctx, 256, 256, true, 0, 256, 34, 26, rnd);
  for (let i = 0; i < 2; i++) tarSeam(ctx, 256, 256, 40 + rnd() * 176, 9, rnd);
  holdTone(ctx, 0, 0, 256, 256, tone);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = maxAniso;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Zebra bars for crosswalks: u runs across the road in metres (one bar per metre). */
function crosswalkTexture(maxAniso: number) {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 32;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, 64, 32);
  const img = ctx.createImageData(64, 32);
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 64; x++) {
      const i = (y * 64 + x) * 4;
      const bar = x >= 6 && x < 40;
      // worn paint on the road's own asphalt: opaque, so the lane lines and
      // centre line underneath don't show between the bars (the review's
      // 'stripe lattice' at street level)
      const paint = bar && Math.random() > 0.06;
      const v = paint ? 228 - Math.random() * 26 : 84 + (Math.random() - 0.5) * 22;
      img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = paint ? v - 6 : v + 4;
      img.data[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = maxAniso;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ------------------------------------------------------------------ renderer
interface SegGeo {
  surf: Buf;
  conc: Buf;
  lights: { x: number; y: number; z: number; yaw: number }[];
}

const CONCRETE: [number, number, number] = [0.62, 0.61, 0.58];
/** the curb's vertical face and the walk's raised ends: light concrete (linear), a shade under the top so the step reads */
const CURB_FACE: [number, number, number] = [0.5, 0.49, 0.46];
/** a corner slab's top: the sidewalk texture's average (linear), so it matches the walks it joins */
const WHITE_TINT: [number, number, number] = [1, 1, 1];
const BANK_TOP: [number, number, number] = [0.3, 0.255, 0.19], BANK_FOOT: [number, number, number] = [0.235, 0.195, 0.14];

export class RoadRenderer {
  readonly group = new THREE.Group();
  private segGeo = new Map<number, SegGeo>();
  private nodeGeo = new Map<number, { j: Buf; cw: Buf; conc: Buf; walk: Map<RoadTypeId, Buf>; lights: Lamp[] }>();
  private crosswalkMesh: THREE.Mesh;
  private typeMeshes = new Map<RoadTypeId, THREE.Mesh>();
  private junctionMesh: THREE.Mesh;
  private concMesh: THREE.Mesh;
  private dirty = true;
  private lampPoles: THREE.InstancedMesh;
  private lampHeads: THREE.InstancedMesh;
  private lampMat: THREE.MeshStandardMaterial;
  private details = new StreetDetails();
  readonly typeMats = new Map<RoadTypeId, THREE.MeshStandardMaterial>();
  /** where the street lamps stand (for the pools of light they throw, world/nightLights.ts) */
  lampSpots: Lamp[] = [];

  constructor(private net: RoadNetwork, renderer: THREE.WebGLRenderer) {
    const aniso = renderer.capabilities.getMaxAnisotropy();
    for (const id of ROAD_ORDER) {
      const mat = new THREE.MeshStandardMaterial({ map: roadTexture(ROAD_TYPES[id], aniso), vertexColors: true, roughness: 0.92, metalness: 0, envMapIntensity: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
      litByLamps(mat);
      this.typeMats.set(id, mat);
      const m = new THREE.Mesh(new THREE.BufferGeometry(), mat);
      m.receiveShadow = true;
      this.typeMeshes.set(id, m);
      this.group.add(m);
    }
    const jt = asphaltTexture(aniso);
    // the same asphalt as the roads (sky reflection included): with the default
    // env intensity junctions read as lighter grey discs
    this.junctionMesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ map: jt, roughness: 0.92, metalness: 0, envMapIntensity: 0.5, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 }));
    this.junctionMesh.receiveShadow = true;
    litByLamps(this.junctionMesh.material as THREE.MeshStandardMaterial);
    this.group.add(this.junctionMesh);
    this.crosswalkMesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ map: crosswalkTexture(aniso), alphaTest: 0.5, roughness: 0.8, metalness: 0, envMapIntensity: 0.5, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }));
    this.crosswalkMesh.receiveShadow = true;
    litByLamps(this.crosswalkMesh.material as THREE.MeshStandardMaterial);
    this.group.add(this.crosswalkMesh);
    this.concMesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }));
    this.concMesh.castShadow = true;
    this.concMesh.receiveShadow = true;
    litByLamps(this.concMesh.material as THREE.MeshStandardMaterial);
    this.group.add(this.concMesh);

    const pole = new THREE.CylinderGeometry(0.09, 0.13, 8, 5);
    pole.translate(0, 4, 0);
    const arm = new THREE.BoxGeometry(0.12, 0.12, 2.2);
    arm.translate(0, 7.9, -1.0);
    const poleGeo = mergeSimple([pole, arm]);
    this.lampPoles = new THREE.InstancedMesh(poleGeo, new THREE.MeshStandardMaterial({ color: 0x55585c, roughness: 0.6, metalness: 0.4 }), 4000);
    const head = new THREE.BoxGeometry(0.5, 0.18, 0.9);
    head.translate(0, 7.8, -2.0);
    this.lampMat = new THREE.MeshStandardMaterial({ color: 0x333333, emissive: 0xffc27a, emissiveIntensity: 0 });
    this.lampHeads = new THREE.InstancedMesh(head, this.lampMat, 4000);
    this.lampPoles.count = this.lampHeads.count = 0;
    this.lampPoles.castShadow = true;
    this.group.add(this.lampPoles, this.lampHeads);
    this.group.add(this.details.group);

    net.events.on('segAdded', (s) => this.invalidateSeg(s));
    net.events.on('segChanged', (s) => this.invalidateSeg(s));
    net.events.on('segTrimmed', (s) => this.invalidateSeg(s));
    net.events.on('segRemoved', (s) => {
      this.segGeo.delete(s.id);
      this.invalidateJunction(s.a);
      this.invalidateJunction(s.b);
    });
    net.events.on('nodeChanged', (n) => this.invalidateJunction(n.id));
  }

  private invalidateSeg(s: RSeg) {
    this.segGeo.delete(s.id);
    this.invalidateNode(s.a);
    this.invalidateNode(s.b);
  }
  private invalidateNode(id: number) {
    this.nodeGeo.delete(id);
    this.dirty = true;
  }
  /** Visual approach trims depend on every road meeting at the node. */
  private invalidateJunction(id: number) {
    const node = this.net.nodes.get(id);
    if (node) for (const segId of node.segs) this.segGeo.delete(segId);
    this.invalidateNode(id);
  }

  setNight(n: number) {
    this.lampMat.emissiveIntensity = n * 4 * GLOW.value;
  }

  /** Connects visible traffic lights to the simulation without coupling render and traffic modules. */
  setSignalStateProvider(provider?: SignalStateProvider) {
    this.details.setSignalStateProvider(provider);
  }

  private wetWas = -1;
  /** Rain makes asphalt dark and glossy. */
  setWet(w: number) {
    if (Math.abs(w - this.wetWas) < 0.02) return;
    this.wetWas = w;
    const mats = [...this.typeMats.values(), this.junctionMesh.material as THREE.MeshStandardMaterial, this.crosswalkMesh.material as THREE.MeshStandardMaterial];
    for (const m of mats) {
      m.roughness = 0.92 - w * 0.55;
      m.color.setScalar(1 - w * 0.35);
    }
  }

  update() {
    this.details.updateSignals();
    if (!this.dirty) return;
    this.dirty = false;
    const perType = new Map<RoadTypeId, Buf[]>();
    const conc: Buf[] = [];
    const junc: Buf[] = [];
    const lights: Lamp[] = [];
    const cornerLights: Lamp[] = [];
    for (const seg of this.net.segs.values()) {
      let g = this.segGeo.get(seg.id);
      if (!g) this.segGeo.set(seg.id, (g = this.buildSeg(seg)));
      let arr = perType.get(seg.type);
      if (!arr) perType.set(seg.type, (arr = []));
      arr.push(g.surf);
      conc.push(g.conc);
      lights.push(...g.lights);
    }
    const walks: Buf[] = [];
    for (const n of this.net.nodes.values()) {
      let b = this.nodeGeo.get(n.id);
      if (!b) this.nodeGeo.set(n.id, (b = this.buildNode(n)));
      if (b.j.count) junc.push(b.j);
      if (b.cw.count) walks.push(b.cw);
      if (b.conc.count) conc.push(b.conc);
      for (const [id, w] of b.walk) {
        let arr = perType.get(id);
        if (!arr) perType.set(id, (arr = []));
        arr.push(w);
      }
      cornerLights.push(...b.lights);
    }
    // (corner lamps first: if a huge network ever passes the instance cap it is the block lamps that go, not the ones that light a junction)
    lights.unshift(...cornerLights);
    for (const [id, mesh] of this.typeMeshes) {
      mesh.geometry.dispose();
      const list = perType.get(id);
      mesh.geometry = list && list.length ? concat(list, true, true) : new THREE.BufferGeometry();
    }
    this.junctionMesh.geometry.dispose();
    this.junctionMesh.geometry = junc.length ? concat(junc, false, true) : new THREE.BufferGeometry();
    this.crosswalkMesh.geometry.dispose();
    this.crosswalkMesh.geometry = walks.length ? concat(walks, false, true) : new THREE.BufferGeometry();
    this.concMesh.geometry.dispose();
    this.concMesh.geometry = conc.length ? concat(conc, true, true) : new THREE.BufferGeometry();

    const m = new THREE.Matrix4();
    const n = Math.min(lights.length, 4000);
    for (let i = 0; i < n; i++) {
      const L = lights[i];
      m.makeRotationY(L.yaw).setPosition(L.x, L.y, L.z);
      this.lampPoles.setMatrixAt(i, m);
      this.lampHeads.setMatrixAt(i, m);
    }
    this.lampPoles.count = this.lampHeads.count = n;
    this.lampSpots = lights.slice(0, n);
    this.lampPoles.instanceMatrix.needsUpdate = this.lampHeads.instanceMatrix.needsUpdate = true;
    this.lampPoles.computeBoundingSphere();
    this.lampHeads.computeBoundingSphere();
    this.details.rebuild(this.net);
  }

  /** Point, tangent, height at arc length d along a segment. */
  static frame(seg: RSeg, d: number) {
    const { i, f } = locate(seg.samp, d);
    const a = seg.samp.pts[i], b = seg.samp.pts[i + 1];
    const p: V2 = { x: lerp(a.x, b.x, f), z: lerp(a.z, b.z, f) };
    const t = norm(sub(b, a));
    const y = lerp(seg.hs[i], seg.hs[i + 1], f);
    const g = lerp(seg.ground[i], seg.ground[i + 1], f);
    return { p, t, y, ground: g };
  }

  /** Where the earth bank beside a road or corner meets the ground: from the walk's edge (px, pz) outwards along (ox, oz). */
  private bankFoot(px: number, pz: number, ox: number, oz: number, topY: number, yDefault: number): { run: number; yB: number } {
    const T = this.net.terrain;
    let run = VERGE_RUN, yB = yDefault;
    for (let it = 0; it < 3; it++) {
      const g = T.h(px + ox * run, pz + oz * run) - 0.02;
      if (g >= yB) break;
      yB = g;
      run = clamp(topY - yB, VERGE_RUN, 3.2);
    }
    return { run, yB };
  }

  private buildSeg(seg: RSeg): SegGeo {
    const t = ROAD_TYPES[seg.type];
    const hw = t.width / 2;
    const surf = new Buf(), conc = new Buf();
    const lights: SegGeo['lights'] = [];
    // Network trims reserve curb, sidewalk and clearance space. Rendering only
    // needs the overlap of the intersecting carriageways.
    const s0 = visualTrim(this.net, seg, seg.a);
    const s1 = seg.length - visualTrim(this.net, seg, seg.b);
    if (s1 - s0 < 0.5) return { surf, conc, lights };
    const driveways = segDriveways(this.net, seg);
    const steps: number[] = [s0];
    for (const c of seg.samp.cum) if (c > s0 + 0.2 && c < s1 - 0.2) steps.push(c);
    // A driveway's curb drops to road level with a flat middle and a flare either side (curbLipAt).
    const rowsAt = [-(DRIVE_FLAT + DRIVE_FLARE), -DRIVE_FLAT, 0, DRIVE_FLAT, DRIVE_FLAT + DRIVE_FLARE];
    for (const drive of driveways) for (const o of rowsAt) if (drive.d + o > s0 && drive.d + o < s1) steps.push(drive.d + o);
    steps.push(s1);
    steps.sort((a, b) => a - b);
    for (let i = steps.length - 1; i > 0; i--) if (steps[i] - steps[i - 1] < 0.01) steps.splice(i, 1);

    // The section (roadSection.ts): carriageway + gutter, a curb face, the raised walk, then an earth bank
    // down to the graded ground. Roads without sidewalks just get the bank.
    const walk = t.sidewalk > 0;
    const co = curbOffset(t), ramp = driveRamp(t);
    const uOf = (off: number) => (off + hw) / (2 * hw);
    const WHITE: [number, number, number] = [1, 1, 1], APRON: [number, number, number] = [1.1, 1.08, 1.03];
    interface SideIds { face: [number, number]; wedge: [number, number, number]; fascia: [number, number]; }
    interface Row { road: number[]; walkL: number[]; walkR: number[]; L: SideIds; R: SideIds; elevated: boolean; bl: number; br: number; }
    let prev: Row | undefined;
    const join = (a: number[], b: number[]) => {
      for (let i = 0; i + 1 < a.length; i++) { surf.tri(a[i], a[i + 1], b[i]); surf.tri(a[i + 1], b[i + 1], b[i]); }
    };
    const nodeA = this.net.nodes.get(seg.a), nodeB = this.net.nodes.get(seg.b);
    for (let k = 0; k < steps.length; k++) {
      const d = steps[k];
      const F = RoadRenderer.frame(seg, d);
      const r = { x: -F.t.z, z: F.t.x };
      const y = F.y + SURF_LIFT;
      // slope for normal
      const F2 = RoadRenderer.frame(seg, Math.min(seg.length, d + 1));
      const grade = F2.y - F.y;
      const nl = Math.hypot(grade, 1);
      const nx = (-grade * F.t.x) / nl, ny = 1 / nl, nz = (-grade * F.t.z) / nl;
      const elevated = F.y - F.ground > 2.6;
      const sv = (off: number, yy: number, col: [number, number, number]) => surf.v(F.p.x + r.x * off, yy, F.p.z + r.z * off, nx, ny, nz, uOf(off), d / REPEAT, col);
      const cv = (off: number, yy: number, n: number[], col: [number, number, number]) => conc.v(F.p.x + r.x * off, yy, F.p.z + r.z * off, n[0], n[1], n[2], 0, 0, col);
      const lipOf = (side: number) => (walk ? curbLipAt(driveways, side, d) : 0);
      const walkStrip = (side: number): number[] => {
        const lip = lipOf(side), col = walk && lip < CURB_REVEAL - 1e-4 ? APRON : WHITE;
        const ids = [sv(side * hw, y + CURB_REVEAL, col), sv(side * (co + ramp), y + CURB_REVEAL, col), sv(side * co, y + lip, col)];
        return side < 0 ? ids : ids.reverse();
      };
      const row: Row = { road: [], walkL: [], walkR: [], L: { face: [-1, -1], wedge: [-1, -1, -1], fascia: [-1, -1] }, R: { face: [-1, -1], wedge: [-1, -1, -1], fascia: [-1, -1] }, elevated, bl: -1, br: -1 };
      if (walk) {
        row.road = [sv(-co, y, WHITE), sv(co, y, WHITE)];
        row.walkL = walkStrip(-1);
        row.walkR = walkStrip(1);
      } else row.road = [sv(-hw, y, WHITE), sv(hw, y, WHITE)];
      const topY = y + (walk ? CURB_REVEAL : 0);
      for (const side of [-1, 1] as const) {
        const S = side < 0 ? row.L : row.R;
        const out = { x: side * r.x, z: side * r.z };
        if (walk) {
          // the curb face: from the road's level up to the walk, facing the road
          const n = [-out.x, 0, -out.z];
          S.face = [cv(side * co, y, n, CURB_FACE), cv(side * co, y + lipOf(side), n, CURB_FACE)];
        }
        if (elevated) {
          // a bridge deck's edge: a plain concrete fascia
          const n = [out.x, 0, out.z];
          S.fascia = [cv(side * hw, topY, n, CONCRETE), cv(side * hw, F.y - 1.3, n, CONCRETE)];
        } else {
          // an earth bank from the walk's edge down to the graded ground (terrain.gradeRoad leaves it GROUND_BELOW
          // under the road's height, but only on the grid's vertices: across a hillside it can sit a few tens of
          // centimetres lower, so the foot is placed on the terrain itself and the bank runs long enough to keep
          // to about 45 degrees), then a skirt for the times the ground has dropped away since
          const { run, yB } = this.bankFoot(F.p.x + out.x * hw, F.p.z + out.z * hw, out.x, out.z, topY, F.y - GROUND_BELOW - 0.03);
          const drop = topY - yB;
          const ln = Math.hypot(drop, run);
          const n = [(out.x * drop) / ln, run / ln, (out.z * drop) / ln];
          S.wedge = [cv(side * hw, topY, n, BANK_TOP), cv(side * (hw + run), yB, n, BANK_FOOT), cv(side * (hw + run), yB - 1.0, [out.x, 0, out.z], BANK_FOOT)];
        }
      }
      if (elevated) {
        // underside of the deck
        const bottom = F.y - 1.3;
        row.bl = cv(-hw, bottom, [0, -1, 0], CONCRETE);
        row.br = cv(hw, bottom, [0, -1, 0], CONCRETE);
      }
      if (prev) {
        join(prev.road, row.road);
        if (walk) { join(prev.walkL, row.walkL); join(prev.walkR, row.walkR); }
        for (const side of [-1, 1] as const) {
          const P = side < 0 ? prev.L : prev.R, S = side < 0 ? row.L : row.R;
          const out = { x: side * r.x, z: side * r.z };
          if (walk) conc.quadN(P.face[0], P.face[1], S.face[1], S.face[0], -out.x, 0, -out.z);
          if (elevated && prev.elevated) conc.quadN(P.fascia[0], P.fascia[1], S.fascia[1], S.fascia[0], out.x, 0, out.z);
          if (!elevated && !prev.elevated) {
            const nw = [conc.nor[S.wedge[0] * 3], conc.nor[S.wedge[0] * 3 + 1], conc.nor[S.wedge[0] * 3 + 2]];
            conc.quadN(P.wedge[0], P.wedge[1], S.wedge[1], S.wedge[0], nw[0], nw[1], nw[2]);
            conc.quadN(P.wedge[1], P.wedge[2], S.wedge[2], S.wedge[1], out.x, 0, out.z);
          }
        }
        if (elevated && prev.elevated) conc.quadN(prev.bl, prev.br, row.br, row.bl, 0, -1, 0);
      }
      // where a real junction starts or ends the block, close the walk's raised end (the corner slabs come with the junction)
      if (walk && (k === 0 || k === steps.length - 1)) {
        const nd = k === 0 ? nodeA : nodeB;
        if (nd && nd.segs.length >= 3) {
          const dirn = k === 0 ? -1 : 1;
          const n = [F.t.x * dirn, 0, F.t.z * dirn];
          for (const side of [-1, 1] as const) {
            const lip = lipOf(side);
            const a = cv(side * hw, y, n, CURB_FACE), b = cv(side * hw, y + CURB_REVEAL, n, CURB_FACE);
            const c = cv(side * co, y + lip, n, CURB_FACE), e = cv(side * co, y, n, CURB_FACE);
            conc.quadN(a, b, c, e, n[0], n[1], n[2]);
          }
        }
      }
      prev = row;
    }
    // Pillars and lighting. Guardrails and median rails are instanced by StreetDetails.
    const yaw = (d: number) => {
      const F = RoadRenderer.frame(seg, d);
      return Math.atan2(F.t.x, F.t.z);
    };
    for (let d = s0 + 10; d < s1 - 6; d += 22) {
      const F = RoadRenderer.frame(seg, d);
      if (F.y - F.ground <= 2.6) continue;
      const r = { x: -F.t.z, z: F.t.x };
      const ya = yaw(d);
      const top = F.y - 1.3;
      const bot = Math.min(F.ground, 0) - 3;
      const cols = hw > 9 ? [-hw * 0.55, hw * 0.55] : [0];
      for (const o of cols) {
        conc.box(F.p.x + r.x * o, bot, F.p.z + r.z * o, 0.9, (top - bot) / 2, 0.9, ya, CONCRETE);
      }
      conc.box(F.p.x, top - 0.6, F.p.z, hw * 0.9, 0.5, 1.1, ya, CONCRETE);
    }
    for (const { d, side } of segLamps(this.net, seg)) {
      const F = RoadRenderer.frame(seg, d);
      const r = { x: -F.t.z, z: F.t.x };
      const off = hw - 0.5;
      const x = F.p.x + r.x * off * side, z = F.p.z + r.z * off * side;
      // lamp arm points toward the road center (arm is along local -Z)
      const ang = Math.atan2(r.x * side, r.z * side);
      lights.push({ x, y: F.y + edgeLift(t, off), z, yaw: ang });
    }
    return { surf, conc, lights };
  }

  private buildNode(n: RNode): { j: Buf; cw: Buf; conc: Buf; walk: Map<RoadTypeId, Buf>; lights: Lamp[] } {
    const b = new Buf(), cw = new Buf(), conc = new Buf();
    const walk = new Map<RoadTypeId, Buf>();
    const lights: Lamp[] = [];
    const out = { j: b, cw, conc, walk, lights };
    const segs = n.segs.map((id) => this.net.segs.get(id)!).filter(Boolean);
    if (!segs.length) return out;
    const y = n.y + 0.08;
    if (segs.length === 1) {
      // dead end: round cap; residential roads get a cul-de-sac bulb
      const s = segs[0];
      const t = ROAD_TYPES[s.type];
      const r = t.width / 2 * (t.id === 'twoLane' || t.id === 'gravel' ? 1.55 : 1.0);
      const c = b.v(n.x, y, n.z, 0, 1, 0, n.x / 8, n.z / 8);
      const N = 20;
      const ids: number[] = [];
      for (let k = 0; k < N; k++) {
        const a = (k / N) * Math.PI * 2;
        const px = n.x + Math.cos(a) * r, pz = n.z + Math.sin(a) * r;
        ids.push(b.v(px, y, pz, 0, 1, 0, px / 8, pz / 8));
      }
      for (let k = 0; k < N; k++) b.tri(c, ids[(k + 1) % N], ids[k]);
      return out;
    }
    const trims = segs.map((s) => (s.a === n.id ? s.trimA : s.trimB));
    if (trims.every((t) => t < 0.01)) return out;
    const J = segs.length >= 3 ? junctionShape(this.net, n.id) : null;
    if (!J || !this.buildJunction(n, J, b, conc, walk, lights)) this.buildHull(n, segs, b, y);
    // crosswalks where each street enters a real junction (not highways or
    // gravel, not bends): the edge of the junction reads as intended
    if (segs.length >= 3 && !segs.some((s) => s.type === 'highway')) {
      const cy = n.y + SURF_LIFT + 0.004; // (the asphalt fan's height at the node: the zebra rides on it where it lies over the junction)
      for (const s of segs) {
        const t = ROAD_TYPES[s.type];
        if (t.sidewalk <= 0) continue;
        const atA = s.a === n.id;
        const trim = visualTrim(this.net, s, n.id);
        // where the paint goes is roadJunction.ts's call (legMarks): past the crossing road's kerb, short of a stopped car's nose
        const m = legPaint(this.net, s, n.id, J);
        const d0 = m.z0 + ZEBRA_EDGE, d1 = m.z1 - ZEBRA_EDGE; // (the transverse lines at each end are streetDetails')
        if (m.bar > s.length * 0.45) continue;
        const hw = m.half;
        const row = (d: number, v: number) => {
          const F = RoadRenderer.frame(s, clamp(atA ? d : s.length - d, 0, s.length));
          const r = { x: -F.t.z, z: F.t.x };
          let y = F.y + 0.075;
          if (d < trim) {
            // over the junction's asphalt, which slopes from the node's height to the leg's at its mouth
            const Ft = RoadRenderer.frame(s, clamp(atA ? trim : s.length - trim, 0, s.length));
            y = Math.max(y, lerp(cy, Ft.y + SURF_LIFT + 0.004, d / Math.max(trim, 0.1)) + 0.02);
          }
          return [cw.v(F.p.x - r.x * hw, y, F.p.z - r.z * hw, 0, 1, 0, 0, v), cw.v(F.p.x + r.x * hw, y, F.p.z + r.z * hw, 0, 1, 0, hw * 2, v)];
        };
        const [a0, b0] = row(d0, 0), [a1, b1] = row(d1, 1);
        upTri(cw, a0, b0, a1);
        upTri(cw, b0, b1, a1);
      }
    }
    return out;
  }

  /** The plain junction disc: the convex hull of the roads' edges at their trims (bends, highways, ramps, gravel). */
  private buildHull(n: RNode, segs: RSeg[], b: Buf, y: number) {
    const pts: V2[] = [{ x: n.x, z: n.z }];
    const edgeHeights: { p: V2; y: number }[] = [];
    for (const s of segs) {
      const atA = s.a === n.id;
      const t = ROAD_TYPES[s.type];
      const trim = visualTrim(this.net, s, n.id);
      const d = atA ? trim : s.length - trim;
      const F = RoadRenderer.frame(s, clamp(d, 0, s.length));
      const r = { x: -F.t.z, z: F.t.x };
      const hw = carriageHalf(t);
      const left = { x: F.p.x + r.x * hw, z: F.p.z + r.z * hw };
      const right = { x: F.p.x - r.x * hw, z: F.p.z - r.z * hw };
      pts.push(left, right);
      edgeHeights.push({ p: left, y: F.y + 0.08 }, { p: right, y: F.y + 0.08 });
    }
    let hull = convexHull(pts);
    // screen-CCW (x right, -z up) needs negative xz signed area
    let area = 0;
    for (let k = 0; k < hull.length; k++) {
      const p = hull[k], q = hull[(k + 1) % hull.length];
      area += p.x * q.z - q.x * p.z;
    }
    if (area > 0) hull = hull.reverse();
    const c = b.v(n.x, y, n.z, 0, 1, 0, n.x / 14, n.z / 14);
    // Approach profiles can differ noticeably on hills. Keep the center pinned
    // to the averaged node height, but meet each road at its sampled edge height.
    const ids = hull.map((p) => {
      let best = edgeHeights[0], d2 = Infinity;
      for (const edge of edgeHeights) {
        const dx = p.x - edge.p.x, dz = p.z - edge.p.z, dd = dx * dx + dz * dz;
        if (dd < d2) { best = edge; d2 = dd; }
      }
      return b.v(p.x, best?.y ?? y, p.z, 0, 1, 0, p.x / 14, p.z / 14);
    });
    for (let k = 0; k < ids.length; k++) b.tri(c, ids[k], ids[(k + 1) % ids.length]);
  }

  /**
   * A junction of three or more streets as drawn (roadJunction.ts has the plan): the asphalt out to the curb,
   * with a curb-return arc at each corner, the curb face round it, the sidewalk slab behind it, and the earth
   * bank beyond. Everything starts from the legs' own ribbon ends, so the seams close.
   */
  private buildJunction(n: RNode, J: Junction, bOut: Buf, concOut: Buf, walkOut: Map<RoadTypeId, Buf>, lightsOut: Lamp[]): boolean {
    const b = new Buf(), conc = new Buf();
    const walk = new Map<RoadTypeId, Buf>();
    const lamps: Lamp[] = [];
    const legs = J.legs;
    const A = legs.map((L) => {
      const F = RoadRenderer.frame(L.seg, clamp(L.atA ? L.trim : L.seg.length - L.trim, 0, L.seg.length));
      const ux = L.atA ? F.t.x : -F.t.x, uz = L.atA ? F.t.z : -F.t.z;
      return { p: F.p, r: { x: -uz, z: ux }, y: F.y, e: L.e, h: L.h, type: L.seg.type };
    });
    const at = (a: { p: V2; r: V2 }, lat: number): V2 => ({ x: a.p.x + a.r.x * lat, z: a.p.z + a.r.z * lat });
    const C: V2 = { x: n.x, z: n.z };
    const pts: V2[] = [], hs: number[] = [];
    for (const c of J.corners) {
      const Li = A[c.i], Lj = A[c.j];
      const yi = Li.y + SURF_LIFT, yj = Lj.y + SURF_LIFT;
      const curb = c.curb.map((p) => p);
      curb[0] = at(Li, Li.e);
      curb[curb.length - 1] = at(Lj, -Lj.e);
      // where a tangent point coincides with the leg's mouth (trim == tangent distance) it merges into it: the legs
      // bend a little, so the two would otherwise sit a few centimetres apart and make the outline double back
      let a0 = c.kind === 'fillet' ? 1 : 0, a1 = c.kind === 'fillet' ? curb.length - 2 : curb.length - 1;
      if (c.kind === 'fillet') {
        if (Math.hypot(c.curb[0].x - c.curb[1].x, c.curb[0].z - c.curb[1].z) < 0.3) { curb.splice(1, 1); a0 = 0; a1--; }
        const q = curb.length;
        if (Math.hypot(c.curb[c.curb.length - 1].x - c.curb[c.curb.length - 2].x, c.curb[c.curb.length - 1].z - c.curb[c.curb.length - 2].z) < 0.3) { curb.splice(q - 2, 1); a1 = q - 2; }
      }
      const N = curb.length;
      const hCurb = curb.map((_, m) => (m <= a0 ? yi : m >= a1 ? yj : lerp(yi, yj, (m - a0) / (a1 - a0))));
      for (let m = 0; m < N; m++) { pts.push(curb[m]); hs.push(hCurb[m]); }
      if (c.kind === 'none') continue;
      // curb face, smoothly shaded round the arc, facing the road
      const nrm = curb.map(() => ({ x: 0, z: 0 }));
      for (let m = 0; m + 1 < N; m++) {
        const p = curb[m], q = curb[m + 1];
        const dx = q.x - p.x, dz = q.z - p.z, len = Math.hypot(dx, dz);
        if (len < 1e-4) continue;
        let nx = -dz / len, nz = dx / len;
        if (nx * (C.x - (p.x + q.x) / 2) + nz * (C.z - (p.z + q.z) / 2) < 0) { nx = -nx; nz = -nz; }
        nrm[m].x += nx; nrm[m].z += nz; nrm[m + 1].x += nx; nrm[m + 1].z += nz;
      }
      const fb: number[] = [], ft: number[] = [];
      for (let m = 0; m < N; m++) {
        const l = Math.hypot(nrm[m].x, nrm[m].z) || 1, nx = nrm[m].x / l, nz = nrm[m].z / l;
        fb.push(conc.v(curb[m].x, hCurb[m] - 0.004, curb[m].z, nx, 0, nz, 0, 0, CURB_FACE));
        ft.push(conc.v(curb[m].x, hCurb[m] + CURB_REVEAL, curb[m].z, nx, 0, nz, 0, 0, CURB_FACE));
      }
      for (let m = 0; m + 1 < N; m++) {
        const l = Math.hypot(nrm[m].x + nrm[m + 1].x, nrm[m].z + nrm[m + 1].z) || 1;
        conc.quadN(fb[m], fb[m + 1], ft[m + 1], ft[m], (nrm[m].x + nrm[m + 1].x) / l, 0, (nrm[m].z + nrm[m + 1].z) / l);
      }
      // the walk slab between the curb and the walks' outer edges, and the bank beyond it
      const outer = c.kind === 'fillet' ? [at(Lj, -Lj.h), c.pOut!, at(Li, Li.h)] : [at(Lj, -Lj.h), at(Li, Li.h)];
      const K = outer.length;
      const yo = outer.map((_, m) => (K === 2 ? (m === 0 ? yj : yi) : m === 0 ? yj : m === 2 ? yi : (yi + yj) / 2));
      const dir = outer.map((p, m) => {
        if (m === 0) return { x: -Lj.r.x, z: -Lj.r.z };
        if (m === K - 1) return { x: Li.r.x, z: Li.r.z };
        const dx = p.x - C.x, dz = p.z - C.z, l = Math.hypot(dx, dz) || 1;
        return { x: dx / l, z: dz / l };
      });
      const { pts: poly, hs: hp } = dedupe([...curb, ...outer], [...hCurb.map((v) => v + CURB_REVEAL), ...yo.map((v) => v + CURB_REVEAL)]);
      // (drawn in the road type's own mesh, with the sidewalk part of that road's texture and its joints running on round
      // the corner: it is the same paving as the walks along the legs, and it stays in the surface the walks belong to)
      const lt = A[c.i].type, wb = walk.get(lt) ?? walk.set(lt, new Buf()).get(lt)!;
      const wu = (ROAD_TYPES[lt].sidewalk * 0.5) / ROAD_TYPES[lt].width, ax = A[c.i].r.z, az = -A[c.i].r.x;
      const ids = poly.map((p, m) => wb.v(p.x, hp[m], p.z, 0, 1, 0, wu, (p.x * ax + p.z * az) / REPEAT, WHITE_TINT));
      const tri = triangulate(poly);
      for (let k = 0; k < tri.length; k += 3) wb.tri(ids[tri[k]], ids[tri[k + 1]], ids[tri[k + 2]]);
      // a street lamp on the slab at the middle of the curb return, its arm over the junction. The block lamps start
      // 8 m past the visual trim, and the trims grew with the corner radii, so without these the middle of a junction
      // (the biggest single stretch of asphalt at night) sat between lamp pools. Only where the corner has a walk.
      if (c.kind === 'fillet' && ROAD_TYPES[lt].sidewalk > 0) {
        const mid = Math.floor((N - 1) / 2), mp = curb[mid];
        const ox = mp.x - C.x, oz = mp.z - C.z, ol = Math.hypot(ox, oz) || 1;
        const lx = mp.x + (ox / ol) * 0.7, lz = mp.z + (oz / ol) * 0.7;
        lamps.push({ x: lx, y: hCurb[mid] + CURB_REVEAL, z: lz, yaw: Math.atan2(lx - C.x, lz - C.z) });
      }
      const wt: number[] = [], wf: number[] = [], ws: number[] = [];
      for (let m = 0; m < K; m++) {
        const o = outer[m], d = dir[m], topY = yo[m] + CURB_REVEAL;
        const yDef = (m === 0 ? Lj.y : m === K - 1 ? Li.y : (Li.y + Lj.y) / 2) - GROUND_BELOW - 0.03;
        const { run, yB } = this.bankFoot(o.x, o.z, d.x, d.z, topY, yDef);
        const drop = topY - yB, ln = Math.hypot(drop, run), nb = [(d.x * drop) / ln, run / ln, (d.z * drop) / ln];
        wt.push(conc.v(o.x, topY, o.z, nb[0], nb[1], nb[2], 0, 0, BANK_TOP));
        wf.push(conc.v(o.x + d.x * run, yB, o.z + d.z * run, nb[0], nb[1], nb[2], 0, 0, BANK_FOOT));
        ws.push(conc.v(o.x + d.x * run, yB - 1.0, o.z + d.z * run, d.x, 0, d.z, 0, 0, BANK_FOOT));
      }
      for (let m = 0; m + 1 < K; m++) {
        const ox = dir[m].x + dir[m + 1].x, oz = dir[m].z + dir[m + 1].z;
        conc.quadN(wt[m], wf[m], wf[m + 1], wt[m + 1], ox, 1.2, oz);
        conc.quadN(wf[m], ws[m], ws[m + 1], wf[m + 1], ox, 0, oz);
      }
    }
    // the asphalt inside the curbs, pinned to the node's height at the middle and meeting each road at its own
    const cy = n.y + SURF_LIFT + 0.004;
    const uvx = (x: number) => x / 14;
    const dd = dedupe(pts, hs);
    pts.length = 0; pts.push(...dd.pts); hs.length = 0; hs.push(...dd.hs);
    let area = 0;
    for (let k = 0; k < pts.length; k++) { const p = pts[k], q = pts[(k + 1) % pts.length]; area += p.x * q.z - q.x * p.z; }
    let fan = true;
    for (let k = 0; k < pts.length && fan; k++) {
      const p = pts[k], q = pts[(k + 1) % pts.length];
      if (((p.x - C.x) * (q.z - C.z) - (q.x - C.x) * (p.z - C.z)) * Math.sign(area) < 1e-5) fan = false;
    }
    if (!isSimple(pts)) return false; // folded (very curved legs): the plain hull draws this one
    const ids = pts.map((p, k) => b.v(p.x, hs[k] + 0.004, p.z, 0, 1, 0, uvx(p.x), uvx(p.z)));
    if (fan) {
      const c0 = b.v(C.x, cy, C.z, 0, 1, 0, uvx(C.x), uvx(C.z));
      for (let k = 0; k < ids.length; k++) {
        if (area > 0) b.tri(c0, ids[(k + 1) % ids.length], ids[k]);
        else b.tri(c0, ids[k], ids[(k + 1) % ids.length]);
      }
    } else {
      const tri = triangulate(pts);
      for (let k = 0; k < tri.length; k += 3) b.tri(ids[tri[k]], ids[tri[k + 1]], ids[tri[k + 2]]);
    }
    bOut.absorb(b);
    concOut.absorb(conc);
    for (const [id, w] of walk) { const o = walkOut.get(id) ?? walkOut.set(id, new Buf()).get(id)!; o.absorb(w); }
    lightsOut.push(...lamps);
    return true;
  }

}

function mergeSimple(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const parts = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  for (const g of parts) n += g.getAttribute('position').count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  let o = 0;
  for (const g of parts) {
    pos.set(g.getAttribute('position').array as Float32Array, o * 3);
    nor.set(g.getAttribute('normal').array as Float32Array, o * 3);
    o += g.getAttribute('position').count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}
