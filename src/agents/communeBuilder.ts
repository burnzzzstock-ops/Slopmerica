// Detailed hippie commune set dressing, built with the building kit so it shares
// the textured building material (lighting, snow, rain, night glow, shadows).
import type * as THREE from 'three';
import type { Emitter } from '../contracts';
import { Rng } from '../core/rng';
import { T } from '../buildings/atlas';
import { col, Kit, type Col } from '../buildings/kit';

type V3 = [number, number, number];

export interface CommuneLayout {
  geometry: THREE.BufferGeometry;
  emitters: Emitter[];
  /** Footprints to clear trees from (local x, z, radius). */
  clear: { x: number; z: number; r: number }[];
  /** Dirt paths / trampled ground to paint (local). */
  dirt: { x: number; z: number; r: number }[];
  /** Local position of the main fire (for the point light). */
  fire: V3;
}

const CANVAS_TINTS = [0xefe6d2, 0xe8d8b0, 0xd9a878, 0xc9d6b8, 0xe0c080, 0xd8b8c8, 0xb8c8d8, 0xf2ece0];
const BUS_PAINT = [0x5ec8ff, 0xff8a3a, 0x7dcf8a, 0xffd23a, 0xe86a8a, 0x9a7ae0];
const FLAG_COLS = [0x2a6ad8, 0xf2f2f2, 0xd83a2a, 0x2ab04a, 0xf2d23a];
const LAUNDRY = [0xe86a8a, 0x5ec8ff, 0xf2f2f2, 0xffd23a, 0x7dcf8a, 0x6a4a8a];

export function buildCommune(name: string, radius: number, members: number, seed: number, ground: (lx: number, lz: number) => number, mapId: string): CommuneLayout {
  const k = new Kit();
  const rng = new Rng(seed);
  const r = () => rng.float();
  const pick = <X>(a: X[]) => a[Math.floor(r() * a.length) % a.length];
  const clear: CommuneLayout['clear'] = [];
  const dirt: CommuneLayout['dirt'] = [];
  const R = radius;
  const wood = col(0x8a6a4a), darkWood = col(0x5a4230), metal = col(0x8f969c), rope = col(0xcbb89a);

  // ---------------------------------------------------------------- fire circle
  const fy = ground(0, 0);
  dirt.push({ x: 0, z: 0, r: 7.5 });
  clear.push({ x: 0, z: 0, r: 9 });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const x = Math.cos(a) * 1.5, z = Math.sin(a) * 1.5;
    k.at(x, z, a, () => k.box(0, 0, 0.55, 0.42, fy - 0.05, fy + 0.3, T.STONE, col(0xb0aaa0), T.STONE, col(0xa8a298), { ao: false }));
  }
  // teepee of burning logs
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    k.tube([Math.cos(a) * 0.9, fy + 0.05, Math.sin(a) * 0.9], [Math.cos(a) * 0.12, fy + 0.9, Math.sin(a) * 0.12], 0.09, 5, col(0x3a2a1e), T.WOOD);
  }
  k.glowBox(0, fy + 0.12, 0, 0.9, 'flame', 2.5);
  k.flame(0, fy + 0.1, 0, 1.6, 1.2, 5);
  k.flame(0.25, fy + 0.1, -0.2, 1.0, 0.8, 5);
  k.emit('fire', 0, fy + 0.9, 0);
  k.emit('smoke', 0, fy + 2.2, 0);
  // log benches around the fire
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + r() * 0.3;
    const x = Math.cos(a) * 4.2, z = Math.sin(a) * 4.2;
    const tx = -Math.sin(a) * 1.3, tz = Math.cos(a) * 1.3;
    const y = ground(x, z) + 0.28;
    k.tube([x - tx, y, z - tz], [x + tx, y, z + tz], 0.28, 7, col(0x7a5a3a), T.WOOD);
  }
  // hand drums
  for (let i = 0; i < 4; i++) {
    const a = r() * Math.PI * 2;
    const x = Math.cos(a) * 3.2, z = Math.sin(a) * 3.2;
    k.cyl(x, z, 0.28, ground(x, z), ground(x, z) + 0.62, 9, T.WOOD, col(0x9a6a3a), col(0xe8dcc0), 0.24);
  }

  // ---------------------------------------------------------------- geodesic dome
  const da = r() * Math.PI * 2, dd = R * 0.3 + 5;
  const dx = Math.cos(da) * dd, dz = Math.sin(da) * dd;
  dome(k, dx, dz, ground(dx, dz), 7, r);
  clear.push({ x: dx, z: dz, r: 8.5 });
  dirt.push({ x: dx * 0.5, z: dz * 0.5, r: 2.2 });

  // ---------------------------------------------------------------- yurts + teepees
  const n = Math.min(9, 3 + Math.floor(members / 6));
  const used: { x: number; z: number; r: number }[] = [{ x: 0, z: 0, r: 8 }, { x: dx, z: dz, r: 8.5 }];
  const spot = (minD: number, maxD: number, rr: number) => {
    for (let t = 0; t < 40; t++) {
      const a = r() * Math.PI * 2, d = minD + r() * (maxD - minD);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (used.every((u) => Math.hypot(u.x - x, u.z - z) > u.r + rr + 1.5)) {
        used.push({ x, z, r: rr });
        return { x, z, a };
      }
    }
    return null;
  };
  for (let i = 0; i < n; i++) {
    const yr = 3 + r() * 1.6;
    const s = spot(R * 0.35, R * 0.8, yr + 1);
    if (!s) continue;
    const face = Math.atan2(-s.x, -s.z); // door faces the fire
    yurt(k, s.x, s.z, ground(s.x, s.z), yr, face, col(pick(CANVAS_TINTS)), r);
    clear.push({ x: s.x, z: s.z, r: yr + 2 });
    // trampled path toward the fire
    for (let t = 0.25; t < 0.9; t += 0.22) dirt.push({ x: s.x * t, z: s.z * t, r: 1.1 });
  }
  const teepees = 1 + Math.floor(r() * 2);
  for (let i = 0; i < teepees; i++) {
    const s = spot(R * 0.4, R * 0.85, 3);
    if (!s) continue;
    teepee(k, s.x, s.z, ground(s.x, s.z), 2.6 + r() * 0.6, r);
    clear.push({ x: s.x, z: s.z, r: 3.5 });
  }

  // ---------------------------------------------------------------- vehicles
  {
    const s = spot(R * 0.7, R * 0.95, 3.2);
    if (s) {
      vwBus(k, s.x, s.z, ground(s.x, s.z), r() * Math.PI * 2, col(pick(BUS_PAINT)));
      clear.push({ x: s.x, z: s.z, r: 3.5 });
    }
    if (members > 18) {
      const s2 = spot(R * 0.6, R * 0.95, 6);
      if (s2) {
        skoolie(k, s2.x, s2.z, ground(s2.x, s2.z), r() * Math.PI * 2, r);
        clear.push({ x: s2.x, z: s2.z, r: 6.5 });
      }
    }
  }

  // ---------------------------------------------------------------- gardens
  {
    const s = spot(R * 0.45, R * 0.8, 6);
    if (s) {
      const yaw = r() * Math.PI;
      const gy = ground(s.x, s.z);
      k.at(s.x, s.z, yaw, () => {
        const beds = 3 + Math.floor(r() * 3);
        for (let b = 0; b < beds; b++) {
          const bx = (b - (beds - 1) / 2) * 2.1;
          k.box(bx, 0, 1.4, 6, gy - 0.1, gy + 0.45, T.WOOD, col(0x9a7a5a), T.CROPS, col(0xffffff), { ao: false });
        }
        // sunflowers along the back
        for (let i = 0; i < 7; i++) {
          const x = -beds * 1.05 + i * ((beds * 2.1) / 6), z = -3.8;
          const h = 1.8 + r() * 0.8;
          k.tube([x, gy, z], [x + (r() - 0.5) * 0.2, gy + h, z], 0.035, 4, col(0x4a7a2a));
          k.cyl(x, z + 0.05, 0.32, gy + h - 0.02, gy + h + 0.05, 10, T.SOLID, col(0xf2c21a), col(0x5a3a1a), 0.15);
        }
        // scarecrow in the patch
        k.tube([0, gy, 3.6], [0, gy + 2.2, 3.6], 0.05, 4, wood);
        k.tube([-0.8, gy + 1.6, 3.6], [0.8, gy + 1.6, 3.6], 0.04, 4, wood);
        k.box(0, 3.6, 0.7, 0.3, gy + 1.0, gy + 1.8, T.TIEDYE, col(0xffffff), T.TIEDYE);
        k.cyl(0, 3.6, 0.2, gy + 1.85, gy + 2.2, 8, T.CANVAS, col(0xe8d8b0));
        k.cyl(0, 3.6, 0.45, gy + 2.2, gy + 2.5, 10, T.SOLID, col(0xc8a860), null, 0.1);
      });
      clear.push({ x: s.x, z: s.z, r: 6.5 });
      dirt.push({ x: s.x, z: s.z, r: 4.5 });
    }
  }
  // greenhouse
  {
    const s = spot(R * 0.5, R * 0.9, 4.2);
    if (s) {
      const gy = ground(s.x, s.z);
      k.at(s.x, s.z, r() * Math.PI, () => {
        k.box(0, 0, 3.6, 6.4, gy - 0.1, gy + 0.4, T.WOOD, col(0x8a6a4a), null);
        k.box(0, 0, 3.6, 6.4, gy + 0.4, gy + 2.2, T.GLASS, col(0xffffff), null, undefined, { fit: true, ao: false });
        const yr = gy + 2.2, top = gy + 3.3;
        k.quad([1.8, yr, 3.2], [-0.0, top, 3.2], [-0.0, top, -3.2], [1.8, yr, -3.2], [[0, 0], [0.4, 0], [0.4, 1.5], [0, 1.5]], col(0xffffff), T.GLASS);
        k.quad([-0.0, top, 3.2], [-1.8, yr, 3.2], [-1.8, yr, -3.2], [-0.0, top, -3.2], [[0, 0], [0.4, 0], [0.4, 1.5], [0, 1.5]], col(0xffffff), T.GLASS);
        k.tri([-1.8, yr, 3.2], [1.8, yr, 3.2], [0, top, 3.2], [[0, 0], [0.9, 0], [0.45, 0.3]], col(0xffffff), T.GLASS);
        k.tri([1.8, yr, -3.2], [-1.8, yr, -3.2], [0, top, -3.2], [[0, 0], [0.9, 0], [0.45, 0.3]], col(0xffffff), T.GLASS);
        for (let i = 0; i < 5; i++) {
          const z = -3.2 + i * 1.6;
          k.tube([1.8, yr, z], [0, top, z], 0.04, 4, col(0xf2f2f2));
          k.tube([-1.8, yr, z], [0, top, z], 0.04, 4, col(0xf2f2f2));
        }
      });
      clear.push({ x: s.x, z: s.z, r: 4.5 });
    }
  }
  // solar array
  {
    const s = spot(R * 0.6, R, 4);
    if (s) {
      const gy = ground(s.x, s.z);
      k.at(s.x, s.z, 0, () => {
        for (let i = 0; i < 3; i++) {
          const x = (i - 1) * 2.3;
          k.tube([x - 0.8, gy, 0.6], [x - 0.8, gy + 0.9, 0.6], 0.05, 4, metal);
          k.tube([x + 0.8, gy, 0.6], [x + 0.8, gy + 0.9, 0.6], 0.05, 4, metal);
          k.tube([x - 0.8, gy, -0.6], [x - 0.8, gy + 1.7, -0.6], 0.05, 4, metal);
          k.tube([x + 0.8, gy, -0.6], [x + 0.8, gy + 1.7, -0.6], 0.05, 4, metal);
          k.quad([x - 1.05, gy + 0.85, 0.85], [x + 1.05, gy + 0.85, 0.85], [x + 1.05, gy + 1.8, -0.85], [x - 1.05, gy + 1.8, -0.85], [[0, 0], [2, 0], [2, 1.2], [0, 1.2]], col(0xffffff), T.SOLAR);
          k.quad([x + 1.05, gy + 0.83, 0.85], [x - 1.05, gy + 0.83, 0.85], [x - 1.05, gy + 1.78, -0.85], [x + 1.05, gy + 1.78, -0.85], [[0, 0], [1, 0], [1, 1], [0, 1]], metal, T.METAL);
        }
      });
      clear.push({ x: s.x, z: s.z, r: 4 });
    }
  }
  // outhouse
  {
    const s = spot(R * 0.75, R, 1.5);
    if (s) {
      const gy = ground(s.x, s.z);
      k.at(s.x, s.z, Math.atan2(-s.x, -s.z), () => {
        k.box(0, 0, 1.3, 1.3, gy, gy + 2.2, T.WOOD, col(0x9a7a5a), null);
        k.gable(0, 0, 1.3, 1.3, gy + 2.2, 0.5, false, col(0x6a6e72), col(0x9a7a5a), T.WOOD, 0.15);
        k.quad([-0.4, gy + 1.7, 0.66], [0.4, gy + 1.7, 0.66], [0.4, gy + 1.95, 0.66], [-0.4, gy + 1.95, 0.66], [[0, 0], [1, 0], [1, 1], [0, 1]], col(0x1a1208), T.SOLID);
      });
    }
  }
  // clothesline
  {
    const s = spot(R * 0.4, R * 0.8, 3);
    if (s) {
      const gy = ground(s.x, s.z);
      const yaw = r() * Math.PI;
      k.at(s.x, s.z, yaw, () => {
        k.tube([-2.8, gy, 0], [-2.8, gy + 2.1, 0], 0.05, 4, wood);
        k.tube([2.8, gy, 0], [2.8, gy + 2.1, 0], 0.05, 4, wood);
        const pts = catenary([-2.8, gy + 2.0, 0], [2.8, gy + 2.0, 0], 0.25, 8);
        for (let i = 0; i < pts.length - 1; i++) k.tube(pts[i], pts[i + 1], 0.012, 3, rope);
        for (let i = 1; i < 7; i++) {
          const p = pts[i];
          const w = 0.45 + r() * 0.3, h = 0.5 + r() * 0.4;
          const tile = r() < 0.4 ? T.TIEDYE : T.CANVAS;
          const c = tile === T.TIEDYE ? col(0xffffff) : col(pick(LAUNDRY));
          k.quad([p[0] - w / 2, p[1] - h, 0], [p[0] + w / 2, p[1] - h, 0], [p[0] + w / 2, p[1], 0], [p[0] - w / 2, p[1], 0], [[0, 0], [0.3, 0], [0.3, 0.3], [0, 0.3]], c, tile);
          k.quad([p[0] + w / 2, p[1] - h, 0], [p[0] - w / 2, p[1] - h, 0], [p[0] - w / 2, p[1], 0], [p[0] + w / 2, p[1], 0], [[0, 0], [0.3, 0], [0.3, 0.3], [0, 0.3]], c, tile);
        }
      });
    }
  }
  // hammock between two posts
  {
    const s = spot(R * 0.3, R * 0.75, 3);
    if (s) {
      const gy = ground(s.x, s.z);
      k.at(s.x, s.z, r() * Math.PI, () => {
        k.tube([-2.2, gy, 0], [-2.2, gy + 1.8, 0], 0.08, 5, darkWood);
        k.tube([2.2, gy, 0], [2.2, gy + 1.8, 0], 0.08, 5, darkWood);
        const pts = catenary([-2.2, gy + 1.5, 0], [2.2, gy + 1.5, 0], 0.9, 8);
        for (let i = 0; i < pts.length - 1; i++) {
          const a = pts[i], b = pts[i + 1];
          const wa = i === 0 ? 0.05 : 0.45, wb = i === pts.length - 2 ? 0.05 : 0.45;
          k.quad([a[0], a[1], -wa], [b[0], b[1], -wb], [b[0], b[1], wb], [a[0], a[1], wa], [[0, 0], [0.2, 0], [0.2, 0.4], [0, 0.4]], col(0xffffff), T.TIEDYE);
          k.quad([a[0], a[1] - 0.01, wa], [b[0], b[1] - 0.01, wb], [b[0], b[1] - 0.01, -wb], [a[0], a[1] - 0.01, -wa], [[0, 0], [0.2, 0], [0.2, 0.4], [0, 0.4]], col(0xffffff), T.TIEDYE);
        }
      });
    }
  }
  // picnic table + firewood stack + compost
  {
    const s = spot(R * 0.2, R * 0.6, 2.2);
    if (s) {
      const gy = ground(s.x, s.z);
      k.at(s.x, s.z, r() * Math.PI, () => {
        k.box(0, 0, 2.2, 0.9, gy + 0.72, gy + 0.8, T.WOOD, wood, T.WOOD, wood, { ao: false });
        k.box(0, 0.8, 2.2, 0.3, gy + 0.42, gy + 0.48, T.WOOD, wood, T.WOOD, wood, { ao: false });
        k.box(0, -0.8, 2.2, 0.3, gy + 0.42, gy + 0.48, T.WOOD, wood, T.WOOD, wood, { ao: false });
        for (const sx of [-0.9, 0.9]) {
          k.tube([sx, gy, -0.9], [sx, gy + 0.78, 0.2], 0.05, 4, wood);
          k.tube([sx, gy, 0.9], [sx, gy + 0.78, -0.2], 0.05, 4, wood);
        }
        k.cyl(0.4, 0, 0.12, gy + 0.8, gy + 1.0, 8, T.SOLID, col(0x7a9a4a)); // kombucha jar
      });
    }
    const w = spot(R * 0.3, R * 0.9, 1.6);
    if (w) {
      const gy = ground(w.x, w.z);
      k.at(w.x, w.z, r() * Math.PI, () => {
        for (let row = 0; row < 4; row++)
          for (let i = 0; i < 6 - row; i++) {
            const y = gy + 0.13 + row * 0.24, x = (i - (5 - row) / 2) * 0.26;
            k.tube([x, y, -0.6], [x, y, 0.6], 0.12, 6, col(0x8a6040), T.WOOD);
          }
      });
    }
  }

  // ---------------------------------------------------------------- flags + lights
  const poles: V3[] = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + r() * 0.6, d = R * 0.3 + r() * 4;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const gy = ground(x, z);
    k.tube([x, gy, z], [x, gy + 5.2, z], 0.08, 5, darkWood);
    poles.push([x, gy + 5.0, z]);
  }
  for (let i = 0; i < poles.length; i++) {
    const a = poles[i], b = poles[(i + 1) % poles.length];
    const pts = catenary(a, b, 0.9, 16);
    for (let j = 0; j < pts.length - 1; j++) k.tube(pts[j], pts[j + 1], 0.012, 3, rope);
    if (i % 2 === 0) {
      // prayer flags
      for (let j = 1; j < pts.length - 1; j++) {
        const p = pts[j], q = pts[j + 1];
        const tx = q[0] - p[0], tz = q[2] - p[2], tl = Math.hypot(tx, tz) || 1;
        const hx = (tx / tl) * 0.28, hz = (tz / tl) * 0.28;
        const c = col(FLAG_COLS[j % FLAG_COLS.length]);
        k.quad([p[0] - hx, p[1] - 0.55, p[2] - hz], [p[0] + hx, p[1] - 0.55, p[2] + hz], [p[0] + hx, p[1], p[2] + hz], [p[0] - hx, p[1], p[2] - hz], [[0, 0], [1, 0], [1, 1], [0, 1]], c, T.CANVAS);
        k.quad([p[0] + hx, p[1] - 0.55, p[2] + hz], [p[0] - hx, p[1] - 0.55, p[2] - hz], [p[0] - hx, p[1], p[2] - hz], [p[0] + hx, p[1], p[2] + hz], [[0, 0], [1, 0], [1, 1], [0, 1]], c, T.CANVAS);
      }
    } else {
      // warm string lights
      for (let j = 1; j < pts.length - 1; j++) k.glowBox(pts[j][0], pts[j][1] - 0.12, pts[j][2], 0.12, j % 5 === 0 ? 'glowPink' : 'glowWarm', 4);
    }
  }
  // lights from each pole to the fire circle center pole
  const cp: V3 = [0.5, fy + 5.5, 6.5];
  k.tube([cp[0], fy, cp[2]], cp, 0.08, 5, darkWood);
  for (const p of poles.slice(0, 2)) {
    const pts = catenary(cp, p, 0.8, 14);
    for (let j = 0; j < pts.length - 1; j++) k.tube(pts[j], pts[j + 1], 0.012, 3, rope);
    for (let j = 1; j < pts.length - 1; j++) k.glowBox(pts[j][0], pts[j][1] - 0.12, pts[j][2], 0.12, 'glowWarm', 4);
  }

  // ---------------------------------------------------------------- entrance sign
  {
    const a = r() * Math.PI * 2, d = R + 2;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const gy = ground(x, z);
    const yaw = Math.atan2(x, z); // face outward
    k.at(x, z, yaw, () => {
      k.tube([-2.4, gy, 0], [-2.4, gy + 3.4, 0], 0.12, 6, darkWood);
      k.tube([2.4, gy, 0], [2.4, gy + 3.4, 0], 0.12, 6, darkWood);
      k.box(0, 0, 5.2, 0.12, gy + 2.2, gy + 3.5, T.WOOD, col(0x6b4a2b), T.WOOD);
      k.sign(0, gy + 2.85, 0.03, 5, 1.25, `commune:${name}`, 0, false, undefined, 1.2);
      k.sign(0, gy + 2.85, -0.03, 5, 1.25, `commune:${name}`, Math.PI, false, undefined, 1.2);
      k.sign(0, gy + 1.6, 0.03, 2.8, 0.55, 'noStroads', 0, false);
      k.box(0, 0, 3, 0.1, gy + 1.3, gy + 1.9, T.WOOD, col(0x6b4a2b), T.WOOD);
      k.glowBox(-2.4, gy + 3.55, 0, 0.18, 'glowWarm', 4);
      k.glowBox(2.4, gy + 3.55, 0, 0.18, 'glowWarm', 4);
    });
    dirt.push({ x: x * 0.95, z: z * 0.95, r: 2 });
  }

  // map flavor
  if (mapId === 'norcal' && r() < 0.6) {
    // a small wooden effigy ("Burning Mini")
    const s = spot(R * 0.5, R * 0.9, 3);
    if (s) {
      const gy = ground(s.x, s.z);
      k.at(s.x, s.z, 0, () => {
        k.tube([-0.9, gy, 0], [0, gy + 3.2, 0], 0.12, 5, wood);
        k.tube([0.9, gy, 0], [0, gy + 3.2, 0], 0.12, 5, wood);
        k.tube([0, gy + 3.2, 0], [0, gy + 5.4, 0], 0.14, 5, wood);
        k.tube([-1.4, gy + 5.6, 0], [0, gy + 4.6, 0], 0.1, 5, wood);
        k.tube([1.4, gy + 5.6, 0], [0, gy + 4.6, 0], 0.1, 5, wood);
        k.box(0, 0, 0.8, 0.8, gy + 5.4, gy + 6.3, T.WOOD, wood, T.WOOD);
      });
    }
  }

  return { geometry: k.build(), emitters: k.emitters, clear, dirt, fire: [0, fy + 1.2, 0] };
}

// ------------------------------------------------------------------ pieces
function catenary(a: V3, b: V3, sag: number, n: number): V3[] {
  const out: V3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - Math.sin(t * Math.PI) * sag, a[2] + (b[2] - a[2]) * t]);
  }
  return out;
}

function yurt(k: Kit, x: number, z: number, gy: number, rad: number, face: number, tint: Col, r: () => number) {
  k.at(x, z, face, () => {
    const wallH = 2.2, seg = 18;
    // wooden platform
    k.cyl(0, 0, rad + 0.35, gy - 0.3, gy + 0.25, seg, T.WOOD, col(0x8a6a4a), col(0x9a7a5a));
    const y0 = gy + 0.25;
    k.cyl(0, 0, rad, y0, y0 + wallH, seg, T.CANVAS, tint, null);
    // painted band under the eave
    k.cyl(0, 0, rad + 0.02, y0 + wallH - 0.45, y0 + wallH - 0.1, seg, r() < 0.5 ? T.TIEDYE : T.CANVAS, r() < 0.5 ? col(0xffffff) : col(0xb84a3a), null);
    // conical roof, crown and stovepipe
    k.cyl(0, 0, rad * 1.12, y0 + wallH - 0.05, y0 + wallH + rad * 0.42, seg, T.CANVAS, tint.clone().multiplyScalar(0.92), null, 0.55);
    k.cyl(0, 0, 0.6, y0 + wallH + rad * 0.42, y0 + wallH + rad * 0.42 + 0.35, 10, T.WOOD, col(0x6a4a30), col(0x8fb8d0));
    const px = rad * 0.45, pz = -rad * 0.3;
    const pipeTop = y0 + wallH + rad * 0.42 + 1.1;
    k.tube([px, y0 + wallH + rad * 0.2, pz], [px, pipeTop, pz], 0.1, 6, col(0x55595e));
    k.cyl(px, pz, 0.18, pipeTop, pipeTop + 0.12, 6, T.SOLID, col(0x3a3d40));
    k.emit('smoke', px, pipeTop + 0.3, pz);
    // door + frame facing +Z (the fire)
    k.box(0, rad - 0.05, 1.1, 0.25, y0, y0 + 1.9, T.WOOD, col(0xa06a3a), T.WOOD, undefined, { ao: false });
    k.quad([-0.45, y0 + 0.05, rad + 0.09], [0.45, y0 + 0.05, rad + 0.09], [0.45, y0 + 1.8, rad + 0.09], [-0.45, y0 + 1.8, rad + 0.09], [[0, 0], [0.45, 0], [0.45, 0.9], [0, 0.9]], col(r() < 0.5 ? 0xd84a3a : 0x3a6ad8), T.WOOD);
    // windows (small, glowing at night)
    for (const a of [1.2, -1.2, 2.4]) {
      const wx = Math.sin(a) * (rad + 0.02), wz = Math.cos(a) * (rad + 0.02);
      k.at(wx, wz, a, () => k.quad([-0.35, y0 + 1.0, 0.01], [0.35, y0 + 1.0, 0.01], [0.35, y0 + 1.6, 0.01], [-0.35, y0 + 1.6, 0.01], [[0.1, 0.25], [0.45, 0.25], [0.45, 0.62], [0.1, 0.62]], col(0xffffff), T.HOUSE_WIN));
    }
    // porch steps + a chair
    k.box(0, rad + 0.7, 1.6, 0.9, gy - 0.1, gy + 0.12, T.WOOD, col(0x8a6a4a), T.WOOD);
    if (r() < 0.6) {
      k.at(1.3, rad + 0.9, 0.4, () => {
        k.box(0, 0, 0.6, 0.6, gy + 0.35, gy + 0.42, T.SOLID, col(0x2a8a6a), T.SOLID);
        k.box(0, -0.28, 0.6, 0.06, gy + 0.42, gy + 1.0, T.SOLID, col(0x2a8a6a), T.SOLID);
        for (const [a, b] of [[-0.27, -0.27], [0.27, -0.27], [-0.27, 0.27], [0.27, 0.27]]) k.tube([a, gy, b], [a, gy + 0.36, b], 0.02, 3, col(0x333333));
      });
    }
  });
}

function teepee(k: Kit, x: number, z: number, gy: number, rad: number, r: () => number) {
  const h = rad * 2.4;
  k.cyl(x, z, rad, gy, gy + h * 0.86, 12, r() < 0.5 ? T.TIEDYE : T.CANVAS, r() < 0.5 ? col(0xffffff) : col(0xe8d8b0), null, rad * 0.14);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    k.tube([x + Math.cos(a) * rad * 0.96, gy, z + Math.sin(a) * rad * 0.96], [x - Math.cos(a) * 0.35, gy + h * 1.05, z - Math.sin(a) * 0.35], 0.05, 4, col(0x8a6a4a));
  }
  k.quad([x - 0.5, gy + 0.02, z + rad * 0.92], [x + 0.5, gy + 0.02, z + rad * 0.92], [x, gy + 1.5, z + rad * 0.62], [x, gy + 1.5, z + rad * 0.62], [[0, 0], [1, 0], [0.5, 1], [0.5, 1]], col(0x2a1a10), T.SOLID);
}

/** Half-geodesic dome (2-frequency icosahedron) with struts, glass panels and a door. */
function dome(k: Kit, cx: number, cz: number, gy: number, rad: number, r: () => number) {
  const t = (1 + Math.sqrt(5)) / 2;
  const V: V3[] = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
  const F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  // rotate so a vertex points up (y axis)
  const norm = (p: V3): V3 => {
    const l = Math.hypot(p[0], p[1], p[2]);
    return [p[0] / l, p[1] / l, p[2] / l];
  };
  const ang = Math.atan2(1, t);
  const rot = (p: V3): V3 => [p[0] * Math.cos(ang) - p[1] * Math.sin(ang), p[0] * Math.sin(ang) + p[1] * Math.cos(ang), p[2]];
  const tris: [V3, V3, V3][] = [];
  for (const f of F) {
    const a = norm(rot(V[f[0]])), b = norm(rot(V[f[1]])), c = norm(rot(V[f[2]]));
    const ab = norm([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);
    const bc = norm([(b[0] + c[0]) / 2, (b[1] + c[1]) / 2, (b[2] + c[2]) / 2]);
    const ca = norm([(c[0] + a[0]) / 2, (c[1] + a[1]) / 2, (c[2] + a[2]) / 2]);
    tris.push([a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]);
  }
  const y0 = gy + 0.3;
  const P = (p: V3): V3 => [cx + p[0] * rad, y0 + Math.max(0, p[1]) * rad * 0.95, cz + p[2] * rad];
  const edges = new Set<string>();
  const strut = col(0x5a5f66);
  let idx = 0;
  for (const [a, b, c] of tris) {
    const cyc = (a[1] + b[1] + c[1]) / 3;
    if (cyc < -0.05) continue;
    idx++;
    const pa = P(a), pb = P(b), pc = P(c);
    // outward winding check
    const mid = [(pa[0] + pb[0] + pc[0]) / 3 - cx, 0, (pa[2] + pb[2] + pc[2]) / 3 - cz];
    const e1 = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]], e2 = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const outward = n[0] * mid[0] + n[1] * ((pa[1] + pb[1] + pc[1]) / 3 - y0 + 0.01) + n[2] * mid[2] > 0;
    const glass = r() < 0.28 && cyc > 0.25;
    const tile = glass ? T.GLASS : T.CANVAS;
    const c0 = glass ? col(0xffffff) : col(idx % 7 === 0 ? 0xd8e6f0 : 0xf2f0ea);
    const uvs: [number, number][] = glass ? [[0.05, 0.25], [0.45, 0.25], [0.25, 0.8]] : [[0, 0], [1, 0], [0.5, 0.86]];
    if (outward) k.tri(pa, pb, pc, uvs, c0, tile);
    else k.tri(pa, pc, pb, uvs, c0, tile);
    for (const [u, v] of [[a, b], [b, c], [c, a]] as [V3, V3][]) {
      const key = [u, v].map((p) => p.map((q) => q.toFixed(3)).join(',')).sort().join('|');
      if (edges.has(key)) continue;
      edges.add(key);
      k.tube(P(u), P(v), 0.07, 4, strut);
    }
  }
  // base ring + entry vestibule
  k.cyl(cx, cz, rad + 0.25, gy - 0.2, y0 + 0.1, 20, T.WOOD, col(0x8a6a4a), col(0x9a7a5a));
  k.at(cx, cz, r() * Math.PI * 2, () => {
    k.box(0, rad + 0.4, 1.8, 1.6, y0, y0 + 2.3, T.CANVAS, col(0xf2f0ea), null);
    k.gable(0, rad + 0.4, 1.8, 1.6, y0 + 2.3, 0.6, false, col(0xd8d4cc), col(0xf2f0ea), T.CANVAS, 0.1);
    k.quad([-0.5, y0, rad + 1.21], [0.5, y0, rad + 1.21], [0.5, y0 + 2, rad + 1.21], [-0.5, y0 + 2, rad + 1.21], [[0, 0], [0.5, 0], [0.5, 1], [0, 1]], col(0x3a6ad8), T.WOOD);
    k.glowBox(0.8, y0 + 2.1, rad + 1.25, 0.16, 'glowWarm', 4);
  });
}

function vwBus(k: Kit, x: number, z: number, gy: number, yaw: number, paint: Col) {
  const cream = col(0xf2ead8);
  k.at(x, z, yaw, () => {
    const y0 = gy + 0.35;
    // lower body in paint, upper in cream with the window band (psychedelic side art)
    k.box(0, 0, 1.8, 4.3, y0, y0 + 0.95, [T.SOLID, T.PSYCHE, T.SOLID, T.PSYCHE], paint, null, undefined, { ao: false, floors: 0.55 });
    k.box(0, 0, 1.8, 4.3, y0 + 0.95, y0 + 1.7, [T.CAR_GLASS, T.CAR_GLASS, T.CAR_GLASS, T.CAR_GLASS], cream, T.SOLID, cream, { ao: false });
    // roof bevel + roof rack
    k.box(0, 0, 1.7, 4.1, y0 + 1.7, y0 + 1.82, T.SOLID, cream, T.SOLID, cream, { ao: false });
    for (const rz of [-1.4, 0, 1.4]) k.tube([-0.75, y0 + 1.95, rz], [0.75, y0 + 1.95, rz], 0.03, 4, col(0x777777));
    k.box(0.1, -0.4, 1.2, 1.5, y0 + 1.84, y0 + 2.2, T.CANVAS, col(0xc88a3a), T.CANVAS, col(0xc88a3a), { ao: false });
    // V-front panel + round headlights + peace badge
    k.tri([-0.9, y0 + 0.2, 2.16], [0.9, y0 + 0.2, 2.16], [0, y0 + 0.95, 2.16], [[0, 0], [1, 0], [0.5, 1]], cream, T.SOLID);
    k.cyl(-0.6, 2.17, 0.14, y0 + 0.45, y0 + 0.47, 8, T.SOLID, col(0xe8e8e8));
    for (const hx of [-0.62, 0.62]) k.glowBox(hx, y0 + 0.5, 2.18, 0.16, 'glowCool', 1.2);
    // bumpers
    k.box(0, 2.2, 1.9, 0.14, y0 - 0.05, y0 + 0.12, T.SOLID, col(0xd8d8d8), T.SOLID);
    k.box(0, -2.2, 1.9, 0.14, y0 - 0.05, y0 + 0.12, T.SOLID, col(0xd8d8d8), T.SOLID);
    // wheels with hubcaps
    for (const [wx, wz] of [[-0.82, 1.45], [0.82, 1.45], [-0.82, -1.45], [0.82, -1.45]]) {
      k.hcyl(wx, gy + 0.36, wz, 0.36, 0.22, 10, col(0x1a1a1c));
      k.hcyl(wx + Math.sign(wx) * 0.1, gy + 0.36, wz, 0.18, 0.04, 8, col(0xe0e0e0));
    }
  });
}

function skoolie(k: Kit, x: number, z: number, gy: number, yaw: number, r: () => number) {
  const yellow = col(0xf2b21a);
  k.at(x, z, yaw, () => {
    const y0 = gy + 0.55;
    const L = 9.5, W = 2.45, H = 2.2;
    k.box(0, -0.6, W, L - 1.4, y0, y0 + H, [T.SOLID, T.PSYCHE, T.SOLID, T.PSYCHE], col(0xffffff), null, undefined, { ao: false, floors: 1 });
    // rounded roof: three slabs
    k.box(0, -0.6, W - 0.3, L - 1.4, y0 + H, y0 + H + 0.18, T.SOLID, col(0xf2ead8), T.SOLID, col(0xf2ead8), { ao: false });
    // hood
    k.box(0, L / 2 - 0.7, W - 0.2, 1.5, y0, y0 + 1.1, T.SOLID, yellow, T.SOLID, yellow, { ao: false });
    k.box(0, L / 2 - 1.3, W, 0.2, y0 + 1.1, y0 + H, T.CAR_GLASS, col(0xffffff), T.SOLID, yellow, { ao: false });
    // rooftop deck with solar + railing + a lawn chair
    for (let i = 0; i < 3; i++) k.quad([-1.0, y0 + H + 0.25, -4 + i * 2.1], [1.0, y0 + H + 0.25, -4 + i * 2.1], [1.0, y0 + H + 0.55, -2.4 + i * 2.1], [-1.0, y0 + H + 0.55, -2.4 + i * 2.1], [[0, 0], [2, 0], [2, 1], [0, 1]], col(0xffffff), T.SOLAR);
    k.tube([-1.15, y0 + H + 0.7, -5.2], [-1.15, y0 + H + 0.7, 2.6], 0.03, 4, col(0x444444));
    k.tube([1.15, y0 + H + 0.7, -5.2], [1.15, y0 + H + 0.7, 2.6], 0.03, 4, col(0x444444));
    // back door ladder + stovepipe
    k.tube([0.7, y0 + H + 0.2, -L / 2 + 1.5], [0.7, y0 + H + 1.3, -L / 2 + 1.5], 0.08, 6, col(0x55595e));
    k.emit('smoke', 0.7, y0 + H + 1.5, -L / 2 + 1.5);
    for (const [wx, wz] of [[-1.05, 3.1], [1.05, 3.1], [-1.05, -3.0], [1.05, -3.0], [-1.05, -3.9], [1.05, -3.9]]) {
      k.hcyl(wx, gy + 0.5, wz, 0.5, 0.3, 10, col(0x1a1a1c));
      k.hcyl(wx + Math.sign(wx) * 0.14, gy + 0.5, wz, 0.24, 0.04, 8, col(0xb0b0b0));
    }
    // awning + rug out the side door
    k.quad([W / 2, y0 + 2.0, 1.0], [W / 2 + 2.2, y0 + 1.6, 1.0], [W / 2 + 2.2, y0 + 1.6, -2.5], [W / 2, y0 + 2.0, -2.5], [[0, 0], [1, 0], [1, 1.5], [0, 1.5]], col(0xffffff), T.TIEDYE);
    k.quad([W / 2 + 2.2, y0 + 1.6, 1.0], [W / 2, y0 + 2.0, 1.0], [W / 2, y0 + 2.0, -2.5], [W / 2 + 2.2, y0 + 1.6, -2.5], [[0, 0], [1, 0], [1, 1.5], [0, 1.5]], col(0xffffff), T.TIEDYE);
    for (const az of [1.0, -2.5]) k.tube([W / 2 + 2.2, gy, az], [W / 2 + 2.2, y0 + 1.6, az], 0.03, 4, col(0x666666));
    k.slab(W / 2 + 0.2, -2.3, W / 2 + 2.0, 0.8, gy + 0.04, T.TIEDYE, col(0xffffff));
    void r;
  });
}
