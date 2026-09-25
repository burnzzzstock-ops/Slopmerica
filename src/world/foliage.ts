// Procedural foliage atlas + realistic card-based tree models.
// Atlas regions are painted in neutral light grays so instance colors (and the
// seasons) supply the hue. Alpha cuts out the leaf silhouettes.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../core/rng';
import type { TreeKind } from './maps';

export const ATLAS = 1024;
export interface Rect { u0: number; v0: number; u1: number; v1: number }
const R = (x: number, y: number, w: number, h: number): Rect => ({ u0: x / ATLAS, v0: 1 - (y + h) / ATLAS, u1: (x + w) / ATLAS, v1: 1 - y / ATLAS });
export const REGIONS = {
  leafA: R(4, 4, 504, 504),
  leafB: R(516, 4, 504, 504),
  needles: R(4, 516, 504, 248),
  frond: R(516, 516, 504, 248),
  bark: R(4, 772, 248, 248),
  moss: R(260, 772, 248, 248),
  shrub: R(516, 772, 504, 248),
};

export function createFoliageAtlas(renderer: THREE.WebGLRenderer): THREE.DataTexture {
  const c = document.createElement('canvas');
  c.width = c.height = ATLAS;
  const ctx = c.getContext('2d')!;
  const rnd = mulberry32(99);
  const shade = (base: number, spread: number) => {
    const v = Math.max(0, Math.min(255, base + (rnd() - 0.5) * spread));
    return `rgb(${v * 0.96},${v},${v * 0.9})`;
  };
  // broadleaf clusters: twig sprays radiating from the base, each carrying real
  // leaf shapes (pointed ovate with a midrib, or lobed maple), lighter toward the
  // top and tip, denser at the center so the card has a natural ragged outline
  const leafPath = (s: number, lobed: boolean) => {
    ctx.beginPath();
    if (!lobed) {
      ctx.moveTo(0, 0);
      ctx.bezierCurveTo(s * 0.55, -s * 0.18, s * 0.72, -s * 0.9, 0, -s * 1.5);
      ctx.bezierCurveTo(-s * 0.72, -s * 0.9, -s * 0.55, -s * 0.18, 0, 0);
    } else {
      // five-lobed maple-ish outline
      const pts = 15;
      for (let i = 0; i <= pts; i++) {
        const a = -Math.PI / 2 + ((i / pts) * 2 - 1) * Math.PI * 0.95;
        const lobe = 0.62 + 0.38 * Math.pow(Math.abs(Math.cos(((i / pts) * 5) * Math.PI)), 0.6);
        const r = s * 1.05 * lobe;
        const px = Math.cos(a) * r, py = Math.sin(a) * r - s * 0.45;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
    }
  };
  const cluster = (x: number, y: number, w: number, h: number, leaves: number, seed: number, lobed = false) => {
    const rr = mulberry32(seed);
    const cx = x + w / 2, by = y + h * 0.78;
    const sprays = Math.round(leaves / 26);
    for (let sp = 0; sp < sprays; sp++) {
      // twig from near the base out toward a point in the crown
      const ang = -Math.PI / 2 + (rr() - 0.5) * 2.6;
      const len = (0.25 + Math.sqrt(rr()) * 0.5) * Math.min(w, h);
      const ex = cx + Math.cos(ang) * len * 0.9, ey = by + Math.sin(ang) * len;
      const mx = (cx + ex) / 2 + (rr() - 0.5) * 30, my = (by + ey) / 2 + (rr() - 0.5) * 30;
      ctx.strokeStyle = 'rgb(74,62,50)';
      ctx.lineWidth = 1.2 + rr() * 1.6;
      ctx.beginPath();
      ctx.moveTo(cx + (rr() - 0.5) * 20, by);
      ctx.quadraticCurveTo(mx, my, ex, ey);
      ctx.stroke();
      const n = 16 + Math.floor(rr() * 20);
      const sprayTone = (rr() - 0.5) * 30;
      for (let k = 0; k < n; k++) {
        const t = 0.35 + (k / n) * 0.7;
        // point on the quadratic twig
        const it = 1 - t;
        const tx = it * it * cx + 2 * it * t * mx + t * t * ex, ty = it * it * by + 2 * it * t * my + t * t * ey;
        const side = k % 2 ? 1 : -1;
        const la = ang + side * (0.5 + rr() * 0.7) + (rr() - 0.5) * 0.4;
        const sz = (lobed ? 7 : 6) + rr() * (lobed ? 7 : 6);
        const lx = tx + Math.cos(la) * sz * 0.4, ly = ty + Math.sin(la) * sz * 0.4;
        if (lx < x + 4 || lx > x + w - 4 || ly < y + 4 || ly > y + h - 4) continue;
        const top = 1 - (ly - y) / h;
        const rim = Math.hypot((lx - cx) / (w / 2), (ly - (y + h / 2)) / (h / 2));
        const base = 105 + top * 90 - rim * 22 + sprayTone;
        ctx.save();
        ctx.translate(lx, ly);
        ctx.rotate(la + Math.PI / 2);
        const g = ctx.createLinearGradient(0, 0, 0, -sz * 1.5);
        const v0 = Math.max(0, Math.min(255, base - 22 + (rr() - 0.5) * 30)), v1 = Math.max(0, Math.min(255, base + 18 + (rr() - 0.5) * 30));
        g.addColorStop(0, `rgb(${v0 * 0.95},${v0},${v0 * 0.88})`);
        g.addColorStop(1, `rgb(${v1 * 0.97},${v1},${v1 * 0.9})`);
        ctx.fillStyle = g;
        leafPath(sz, lobed);
        ctx.fill();
        // midrib + a darker edge on the shadow side
        ctx.strokeStyle = `rgba(40,45,30,${0.25 + rr() * 0.2})`;
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, -sz * (lobed ? 1.2 : 1.35));
        ctx.stroke();
        ctx.restore();
      }
    }
  };
  cluster(4, 4, 504, 504, 2600, 3);
  cluster(516, 4, 504, 504, 2100, 7, true);
  // conifer branch: a fan of needles from the left edge
  {
    const x = 4, y = 516, w = 504, h = 248;
    for (let k = 0; k < 3; k++) {
      ctx.strokeStyle = 'rgb(80,64,50)';
      ctx.lineWidth = 3 - k;
      ctx.beginPath();
      ctx.moveTo(x, y + h * 0.5);
      ctx.lineTo(x + w * (0.95 - k * 0.1), y + h * (0.5 + (k - 1) * 0.08));
      ctx.stroke();
    }
    for (let k = 0; k < 5200; k++) {
      const t = rnd();
      const px = x + t * w * 0.97;
      const spread = (1 - t) * h * 0.46 + 6;
      const py = y + h * 0.5 + (rnd() - 0.5) * 2 * spread;
      const a = (rnd() - 0.5) * 1.6 + (py < y + h / 2 ? -0.6 : 0.6);
      ctx.strokeStyle = shade(130 + (1 - Math.abs(py - (y + h / 2)) / (h / 2)) * 70, 60);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + Math.cos(a) * 9, py + Math.sin(a) * 9);
      ctx.stroke();
    }
  }
  // palm frond: rib + drooping leaflets
  {
    const x = 516, y = 516, w = 504, h = 248;
    ctx.strokeStyle = 'rgb(150,140,110)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x, y + h * 0.5);
    ctx.quadraticCurveTo(x + w * 0.5, y + h * 0.42, x + w, y + h * 0.55);
    ctx.stroke();
    for (let k = 0; k < 120; k++) {
      const t = k / 120;
      const px = x + t * w, py = y + h * 0.5 - Math.sin(t * Math.PI) * h * 0.05;
      const len = Math.sin(t * Math.PI) * h * 0.46 + 10;
      for (const sgn of [-1, 1]) {
        ctx.strokeStyle = shade(175, 50);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + len * 0.35, py + sgn * len);
        ctx.stroke();
      }
    }
  }
  // bark (tiles vertically)
  {
    const x = 4, y = 772, w = 248, h = 248;
    ctx.fillStyle = 'rgb(150,142,132)';
    ctx.fillRect(x, y, w, h);
    for (let k = 0; k < 420; k++) {
      const bx = x + rnd() * w;
      ctx.strokeStyle = `rgba(40,34,28,${0.2 + rnd() * 0.4})`;
      ctx.lineWidth = 1 + rnd() * 3;
      ctx.beginPath();
      ctx.moveTo(bx, y);
      ctx.bezierCurveTo(bx + (rnd() - 0.5) * 20, y + h * 0.3, bx + (rnd() - 0.5) * 20, y + h * 0.7, bx, y + h);
      ctx.stroke();
    }
  }
  // spanish moss
  {
    const x = 260, y = 772, w = 248;
    for (let k = 0; k < 900; k++) {
      const sx = x + 10 + rnd() * (w - 20);
      const len = 40 + rnd() * 190;
      ctx.strokeStyle = shade(185, 50);
      ctx.lineWidth = 1 + rnd();
      ctx.beginPath();
      ctx.moveTo(sx, y + 4);
      ctx.quadraticCurveTo(sx + (rnd() - 0.5) * 20, y + len * 0.5, sx + (rnd() - 0.5) * 16, y + len);
      ctx.stroke();
    }
  }
  cluster(516, 772, 504, 248, 1800, 11);
  // Canvas pixels with alpha 0 are black, which mipmapping would smear into
  // dark leaf fringes. Re-upload as data with the transparent texels padded.
  const img = ctx.getImageData(0, 0, ATLAS, ATLAS).data;
  const flipped = new Uint8Array(ATLAS * ATLAS * 4);
  for (let y = 0; y < ATLAS; y++) flipped.set(img.subarray((ATLAS - 1 - y) * ATLAS * 4, (ATLAS - y) * ATLAS * 4), y * ATLAS * 4);
  padTransparent(flipped, ATLAS, ATLAS);
  const tex = new THREE.DataTexture(flipped, ATLAS, ATLAS, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  tex.generateMipmaps = true;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/** Fill the RGB of (nearly) transparent texels with the average color of nearby
 *  opaque ones, so filtering and mipmaps don't pull edges toward black. */
export function padTransparent(d: Uint8Array, w: number, h: number, block = 16) {
  const bw = Math.ceil(w / block), bh = Math.ceil(h / block);
  const acc = new Float32Array(bw * bh * 4);
  let gr = 0, gg = 0, gb = 0, gn = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (d[i + 3] < 128) continue;
      const b = (Math.floor(y / block) * bw + Math.floor(x / block)) * 4;
      acc[b] += d[i]; acc[b + 1] += d[i + 1]; acc[b + 2] += d[i + 2]; acc[b + 3]++;
      gr += d[i]; gg += d[i + 1]; gb += d[i + 2]; gn++;
    }
  if (!gn) return;
  gr /= gn; gg /= gn; gb /= gn;
  // spread block averages outward a few rings so empty blocks borrow from neighbors
  const avg = new Float32Array(bw * bh * 3);
  for (let by = 0; by < bh; by++)
    for (let bx = 0; bx < bw; bx++) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let ring = 0; ring < 4 && n === 0; ring++)
        for (let oy = -ring; oy <= ring; oy++)
          for (let ox = -ring; ox <= ring; ox++) {
            const x = bx + ox, y = by + oy;
            if (x < 0 || y < 0 || x >= bw || y >= bh) continue;
            const k = (y * bw + x) * 4;
            r += acc[k]; g += acc[k + 1]; b += acc[k + 2]; n += acc[k + 3];
          }
      const o = (by * bw + bx) * 3;
      if (n) { avg[o] = r / n; avg[o + 1] = g / n; avg[o + 2] = b / n; }
      else { avg[o] = gr; avg[o + 1] = gg; avg[o + 2] = gb; }
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = d[i + 3];
      if (a >= 128) continue;
      const o = (Math.floor(y / block) * bw + Math.floor(x / block)) * 3;
      const t = a / 128;
      d[i] = d[i] * t + avg[o] * (1 - t);
      d[i + 1] = d[i + 1] * t + avg[o + 1] * (1 - t);
      d[i + 2] = d[i + 2] * t + avg[o + 2] * (1 - t);
    }
}

// ------------------------------------------------------------------ geometry
class GeoB {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  can: number[] = [];
  idx: number[] = [];
  private vtx(p: THREE.Vector3, n: THREE.Vector3, u: number, v: number, c: THREE.Color, canopy: number) {
    this.pos.push(p.x, p.y, p.z);
    this.nor.push(n.x, n.y, n.z);
    this.uv.push(u, v);
    this.col.push(c.r, c.g, c.b);
    this.can.push(canopy);
    return this.pos.length / 3 - 1;
  }
  /** A foliage card centered at c, spanned by axes ax (width) and ay (height). Normals bent toward `from`. */
  card(c: THREE.Vector3, ax: THREE.Vector3, ay: THREE.Vector3, r: Rect, from: THREE.Vector3 | null, color: THREE.Color, canopy = 1, bend = 0.75) {
    const corners = [
      [-0.5, -0.5, r.u0, r.v0], [0.5, -0.5, r.u1, r.v0], [0.5, 0.5, r.u1, r.v1], [-0.5, 0.5, r.u0, r.v1],
    ];
    const face = new THREE.Vector3().crossVectors(ax, ay).normalize();
    const ids = corners.map(([a, b, u, v]) => {
      const p = c.clone().addScaledVector(ax, a).addScaledVector(ay, b);
      const n = from ? p.clone().sub(from).normalize().lerp(face, 1 - bend).normalize() : face.clone();
      if (n.y < -0.2) n.y = -0.2;
      return this.vtx(p, n.normalize(), u, v, color, canopy);
    });
    this.idx.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]);
  }
  /** Tapered cylinder from a to b (bark). */
  limb(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number, sides: number, color: THREE.Color, reg: Rect, vScale = 0.25) {
    const axis = b.clone().sub(a);
    const len = axis.length();
    axis.normalize();
    const t1 = Math.abs(axis.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const u = new THREE.Vector3().crossVectors(axis, t1).normalize();
    const w = new THREE.Vector3().crossVectors(axis, u).normalize();
    const base = this.pos.length / 3;
    for (let ring = 0; ring < 2; ring++) {
      const center = ring === 0 ? a : b;
      const rad = ring === 0 ? r0 : r1;
      for (let s = 0; s <= sides; s++) {
        const ang = (s / sides) * Math.PI * 2;
        const n = u.clone().multiplyScalar(Math.cos(ang)).addScaledVector(w, Math.sin(ang));
        const p = center.clone().addScaledVector(n, rad);
        const uu = reg.u0 + (reg.u1 - reg.u0) * (s / sides);
        const vv = reg.v0 + (reg.v1 - reg.v0) * Math.min(1, ring * len * vScale);
        this.vtx(p, n, uu, vv, color, 0);
      }
    }
    for (let s = 0; s < sides; s++) {
      const a0 = base + s, a1 = base + s + 1, b0 = base + sides + 1 + s, b1 = b0 + 1;
      this.idx.push(a0, b0, a1, a1, b0, b1);
    }
  }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('canopy', new THREE.Float32BufferAttribute(this.can, 1));
    g.setIndex(this.idx);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const WHITE = new THREE.Color(1, 1, 1);

function randomCard(b: GeoB, rnd: () => number, center: THREE.Vector3, crown: THREE.Vector3, size: number, reg: Rect, color = WHITE) {
  const out = center.clone().sub(crown).normalize();
  // orient mostly facing outward with random roll
  const ax = new THREE.Vector3().crossVectors(out, V(0, 1, 0));
  if (ax.lengthSq() < 0.01) ax.set(1, 0, 0);
  ax.normalize().applyAxisAngle(out, (rnd() - 0.5) * 2.4).multiplyScalar(size);
  const ay = new THREE.Vector3().crossVectors(ax, out).normalize().multiplyScalar(size);
  b.card(center, ax, ay, reg, crown, color);
}

export function makeTreeModel(kind: TreeKind, variant: number): THREE.BufferGeometry {
  const rnd = mulberry32(1000 + variant * 31 + kind.length * 7);
  const b = new GeoB();
  const bark = new THREE.Color(0.55, 0.47, 0.4);
  const reg = REGIONS;
  switch (kind) {
    case 'decid': {
      const th = 4.2 + rnd() * 1.4;
      b.limb(V(0, -0.3, 0), V(0, th, 0), 0.34, 0.22, 7, bark, reg.bark);
      const crown = V(0, th + 3.4, 0);
      for (let k = 0; k < 5; k++) {
        const a = rnd() * Math.PI * 2;
        b.limb(V(0, th - 0.4, 0), V(Math.cos(a) * 2.4, th + 2 + rnd() * 1.5, Math.sin(a) * 2.4), 0.16, 0.06, 5, bark, reg.bark);
      }
      for (let k = 0; k < 28; k++) {
        const a = rnd() * Math.PI * 2, e = (rnd() - 0.35) * 1.3, r = 2.6 + rnd() * 1.7;
        const c = V(Math.cos(a) * Math.cos(e) * r * 1.1, Math.sin(e) * r * 0.85, Math.sin(a) * Math.cos(e) * r * 1.1).add(crown);
        randomCard(b, rnd, c, crown, 3.3 + rnd() * 1.4, rnd() < 0.5 ? reg.leafA : reg.leafB);
      }
      break;
    }
    case 'oak': {
      const th = 2.6;
      b.limb(V(0, -0.3, 0), V(0, th, 0), 0.5, 0.38, 8, bark, reg.bark);
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + rnd() * 0.6;
        b.limb(V(0, th - 0.2, 0), V(Math.cos(a) * 3.8, th + 2.2, Math.sin(a) * 3.8), 0.3, 0.12, 6, bark, reg.bark);
      }
      const crown = V(0, th + 3.2, 0);
      for (let k = 0; k < 34; k++) {
        const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 5.6;
        const c = V(Math.cos(a) * r, (rnd() - 0.3) * 2.2, Math.sin(a) * r).add(crown);
        randomCard(b, rnd, c, crown.clone().setY(crown.y - 1.5), 3.2 + rnd() * 1.3, rnd() < 0.5 ? reg.leafA : reg.leafB);
      }
      break;
    }
    case 'pine':
    case 'redwood': {
      const tall = kind === 'redwood';
      const H = tall ? 36 + rnd() * 8 : 11 + rnd() * 4;
      const start = tall ? H * 0.4 : 2.2;
      b.limb(V(0, -0.4, 0), V(0, H, 0), tall ? 1.3 : 0.32, tall ? 0.25 : 0.08, tall ? 9 : 6, tall ? new THREE.Color(0.62, 0.36, 0.26) : bark, reg.bark, 0.08);
      const tiers = tall ? 14 : 10;
      for (let t = 0; t < tiers; t++) {
        const f = t / (tiers - 1);
        const y = start + f * (H - start - 0.8);
        const len = (tall ? 4.4 : 3.8) * (1 - f * 0.78) + 0.5;
        const n = 3 + (t % 2);
        const rot = rnd() * Math.PI * 2;
        for (let k = 0; k < n; k++) {
          const a = rot + (k / n) * Math.PI * 2;
          const dir = V(Math.cos(a), -0.22, Math.sin(a)).normalize();
          const ax = dir.clone().multiplyScalar(len);
          const ay = new THREE.Vector3().crossVectors(dir, V(0, 1, 0)).normalize().multiplyScalar(len * 0.62);
          // card center half a length out from the trunk
          const c = V(0, y, 0).addScaledVector(dir, len * 0.5);
          b.card(c, ax, ay, reg.needles, V(0, y + len * 0.3, 0), WHITE, 1, 0.55);
          // a second, tilted card so tiers don't look paper-thin from the side
          const ay2 = V(0, 1, 0).multiplyScalar(len * 0.45);
          b.card(c.clone().setY(c.y + 0.1), ax, ay2, reg.needles, V(0, y, 0), WHITE, 1, 0.55);
        }
      }
      break;
    }
    case 'palm': {
      const H = 8 + rnd() * 3;
      const lean = (rnd() - 0.5) * 1.6;
      const segs = 6;
      for (let s = 0; s < segs; s++) {
        const t0 = s / segs, t1 = (s + 1) / segs;
        b.limb(V(Math.pow(t0, 2) * lean, t0 * H, 0), V(Math.pow(t1, 2) * lean, t1 * H, 0), 0.3 - t0 * 0.08, 0.3 - t1 * 0.08, 7, new THREE.Color(0.6, 0.55, 0.45), reg.bark);
      }
      const top = V(lean, H, 0);
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2 + rnd() * 0.3;
        const dir = V(Math.cos(a), 0.25, Math.sin(a)).normalize();
        const side = new THREE.Vector3().crossVectors(dir, V(0, 1, 0)).normalize();
        // inner, rising half and outer, drooping half
        b.card(top.clone().addScaledVector(dir, 1.3).add(V(0, 0.3, 0)), dir.clone().multiplyScalar(2.8), side.clone().multiplyScalar(1.6), reg.frond, top, WHITE, 1, 0.5);
        const d2 = V(dir.x, -0.55, dir.z).normalize();
        b.card(top.clone().addScaledVector(dir, 3.2).add(V(0, -0.5, 0)), d2.clone().multiplyScalar(2.6), side.clone().multiplyScalar(1.5), reg.frond, top, WHITE, 1, 0.5);
      }
      break;
    }
    case 'cypress': {
      const H = 12 + rnd() * 3;
      b.limb(V(0, -0.6, 0), V(0, 1.5, 0), 1.3, 0.5, 8, new THREE.Color(0.55, 0.5, 0.45), reg.bark);
      b.limb(V(0, 1.5, 0), V(0, H, 0), 0.5, 0.2, 7, new THREE.Color(0.55, 0.5, 0.45), reg.bark);
      const crown = V(0, H - 0.5, 0);
      for (let k = 0; k < 20; k++) {
        const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 4.2;
        const c = V(Math.cos(a) * r, (rnd() - 0.5) * 1.6, Math.sin(a) * r).add(crown);
        randomCard(b, rnd, c, crown.clone().setY(crown.y - 2), 2.8 + rnd(), reg.needles);
      }
      for (let k = 0; k < 7; k++) {
        const a = rnd() * Math.PI * 2, r = 1.5 + rnd() * 2.5;
        const c = V(Math.cos(a) * r, H - 3.6, Math.sin(a) * r);
        const ax = V(-Math.sin(a), 0, Math.cos(a)).multiplyScalar(1.8);
        b.card(c, ax, V(0, 3.2, 0), reg.moss, null, new THREE.Color(0.75, 0.78, 0.7), 0);
      }
      break;
    }
    case 'mangrove': {
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        b.limb(V(Math.cos(a) * 1.6, -0.5, Math.sin(a) * 1.6), V(0, 1.6, 0), 0.08, 0.14, 4, bark, reg.bark);
      }
      const crown = V(0, 2.8, 0);
      for (let k = 0; k < 18; k++) {
        const a = rnd() * Math.PI * 2, e = rnd() * 0.9, r = 1.4 + rnd() * 1.4;
        randomCard(b, rnd, V(Math.cos(a) * r * 1.3, Math.sin(e) * r * 0.6, Math.sin(a) * r * 1.3).add(crown), crown, 2.4 + rnd(), reg.leafB);
      }
      break;
    }
    case 'shrub': {
      const crown = V(0, 0.9, 0);
      for (let k = 0; k < 8; k++) {
        const a = rnd() * Math.PI * 2, r = 0.4 + rnd() * 0.8;
        randomCard(b, rnd, V(Math.cos(a) * r, rnd() * 0.6, Math.sin(a) * r).add(crown), crown.clone().setY(0.3), 1.8 + rnd() * 0.6, reg.shrub);
      }
      break;
    }
  }
  return b.build();
}

export function mergeVariants(geos: THREE.BufferGeometry[]) {
  return mergeGeometries(geos, false);
}
