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
  flameGeometry: THREE.BufferGeometry;
  bulbGeometry: THREE.BufferGeometry;
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

export function buildCommune(name: string, radius: number, members: number, seed: number, ground: (lx: number, lz: number) => number, mapId: string,
  level?: (lx: number, lz: number, radius: number) => number, cover?: (lx: number, lz: number) => number): CommuneLayout {
  const k = new Kit();
  const fireKit = new Kit();
  const bulbs = new Kit();
  const rng = new Rng(seed);
  const r = () => rng.float();
  const pick = <X>(a: X[]) => a[Math.floor(r() * a.length) % a.length];
  const clear: CommuneLayout['clear'] = [];
  const dirt: CommuneLayout['dirt'] = [];
  const R = radius;
  const wood = col(0x8a6a4a), darkWood = col(0x5a4230), metal = col(0x8f969c), rope = col(0xcbb89a);

  // ---------------------------------------------------------------- fire circle
  const fy = level?.(0, 0, 6.5) ?? ground(0, 0);
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
  fireKit.glowBox(0, fy + 0.12, 0, 0.9, 'flame', 2.5);
  fireKit.flame(0, fy + 0.1, 0, 1.6, 1.2, 5);
  fireKit.flame(0.25, fy + 0.1, -0.2, 1.0, 0.8, 5);
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
  // A few actual seats leave the dance and drum space open for members.
  for (const a of [0.43, 2.48, 4.65]) {
    const x = Math.sin(a) * 6.2, z = Math.cos(a) * 6.2;
    lawnChair(k, x, z, ground(x, z), a + Math.PI, col(0x8a9b72));
  }
  for (const a of [1.1, 3.1, 5.25]) {
    const x = Math.sin(a) * 7.1, z = Math.cos(a) * 7.1, gy = ground(x, z);
    k.cyl(x, z, 0.38, gy - 0.04, gy + 0.23, 7, T.STONE, col(a < 2 ? 0xc77b6b : 0x9c8fb0));
    k.cyl(x, z, 0.27, gy + 0.24, gy + 0.27, 7, T.TIEDYE, col(0xffffff));
  }

  // ---------------------------------------------------------------- geodesic dome
  const da = r() * Math.PI * 2, dd = R * 0.3 + 5;
  const dx = Math.cos(da) * dd, dz = Math.sin(da) * dd;
  dome(k, dx, dz, level?.(dx, dz, 8) ?? ground(dx, dz), 7, r);
  clear.push({ x: dx, z: dz, r: 8.5 });
  dirt.push({ x: dx * 0.5, z: dz * 0.5, r: 2.2 });

  // ---------------------------------------------------------------- yurts + teepees
  const n = Math.min(9, 3 + Math.floor(members / 6));
  const used: { x: number; z: number; r: number }[] = [{ x: 0, z: 0, r: 8 }, { x: dx, z: dz, r: 8.5 }];
  const spot = (minD: number, maxD: number, rr: number, accept?: (x: number, z: number) => boolean) => {
    for (let t = 0; t < 40; t++) {
      const a = r() * Math.PI * 2, d = minD + r() * (maxD - minD);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if ((!accept || accept(x, z)) && used.every((u) => Math.hypot(u.x - x, u.z - z) > u.r + rr + 1.5)) {
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
    yurt(k, s.x, s.z, level?.(s.x, s.z, yr + 0.4) ?? ground(s.x, s.z), yr, face, col(pick(CANVAS_TINTS)), r);
    clear.push({ x: s.x, z: s.z, r: yr + 2 });
    // trampled path toward the fire
    for (let t = 0.25; t < 0.9; t += 0.22) dirt.push({ x: s.x * t, z: s.z * t, r: 1.1 });
  }
  const teepees = 1 + Math.floor(r() * 2);
  for (let i = 0; i < teepees; i++) {
    const s = spot(R * 0.4, R * 0.85, 3);
    if (!s) continue;
    teepee(k, s.x, s.z, level?.(s.x, s.z, 3) ?? ground(s.x, s.z), 2.6 + r() * 0.6, r);
    clear.push({ x: s.x, z: s.z, r: 3.5 });
  }

  // ---------------------------------------------------------------- vehicles
  {
    const s = spot(R * 0.7, R * 0.95, 3.2);
    if (s) {
      vwBus(k, s.x, s.z, level?.(s.x, s.z, 3) ?? ground(s.x, s.z), r() * Math.PI * 2, col(pick(BUS_PAINT)));
      clear.push({ x: s.x, z: s.z, r: 3.5 });
    }
    if (members > 18) {
      const s2 = spot(R * 0.6, R * 0.95, 6);
      if (s2) {
        skoolie(k, s2.x, s2.z, level?.(s2.x, s2.z, 6) ?? ground(s2.x, s2.z), r() * Math.PI * 2, r);
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
          // Top faces up; underside is separated enough to avoid z-fighting.
          k.quad([a[0], a[1], wa], [b[0], b[1], wb], [b[0], b[1], -wb], [a[0], a[1], -wa], [[0, 0], [0.2, 0], [0.2, 0.4], [0, 0.4]], col(0xffffff), T.TIEDYE);
          k.quad([a[0], a[1] - 0.025, -wa], [b[0], b[1] - 0.025, -wb], [b[0], b[1] - 0.025, wb], [a[0], a[1] - 0.025, wa], [[0, 0], [0.2, 0], [0.2, 0.4], [0, 0.4]], col(0xffffff), T.TIEDYE);
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

  // ---------------------------------------------------------------- lived-in corners
  {
    const s = spot(R * 0.45, R * 0.86, 4.6);
    if (s) {
      const gy = level?.(s.x, s.z, 4) ?? ground(s.x, s.z);
      k.at(s.x, s.z, s.a, () => {
        // Raised hen house and a fenced run, with a deliberately crooked roof.
        k.box(-1.1, -0.7, 2.1, 1.8, gy + 0.65, gy + 2.1, T.WOOD, col(0x8d6647), T.WOOD);
        k.gable(-1.1, -0.7, 2.1, 1.8, gy + 2.1, 0.65, false, col(0x695e50), col(0x8d6647), T.WOOD, 0.2);
        for (const xx of [-1.9, -0.3]) for (const zz of [-1.35, -0.05]) k.tube([xx, gy - 0.15, zz], [xx, gy + 0.7, zz], 0.07, 4, darkWood);
        k.box(-1.1, 0.28, 0.65, 0.08, gy + 0.7, gy + 1.35, T.SOLID, col(0x302b25), null);
        k.slab(-0.95, 0.34, -0.2, 1.1, gy + 0.5, T.WOOD, wood);
        fence(k, -2.8, -2.2, 3.0, 2.8, gy, 1.1, col(0x97785c));
        for (let i = 0; i < 4; i++) {
          const xx = 0.5 + (i % 2) * 0.75, zz = -0.85 + Math.floor(i / 2) * 0.85;
          k.cyl(xx, zz, 0.18, gy + 0.1, gy + 0.42, 6, T.CANVAS, col(i % 2 ? 0xc8a47d : 0xe0d3ad), null, 0.12);
          k.cyl(xx, zz + 0.14, 0.1, gy + 0.38, gy + 0.56, 5, T.CANVAS, col(0xd8bb95));
        }
      });
      clear.push({ x: s.x, z: s.z, r: 5.2 }); dirt.push({ x: s.x, z: s.z, r: 3.8 });
    }
  }
  {
    const s = spot(R * 0.45, R * 0.84, 4.1);
    if (s) {
      const gy = level?.(s.x, s.z, 3.7) ?? ground(s.x, s.z);
      k.at(s.x, s.z, s.a, () => {
        fence(k, -3, -2.4, 3, 2.4, gy, 1.2, col(0x806248));
        for (const gx of [-1.25, 1.35]) {
          k.box(gx, 0, 1.05, 1.65, gy + 0.75, gy + 1.5, T.CANVAS, col(0xbcb8a5), T.CANVAS);
          for (const xx of [-0.37, 0.37]) for (const zz of [-0.56, 0.56]) k.tube([gx + xx, gy + 0.05, zz], [gx + xx, gy + 0.95, zz], 0.07, 4, col(0x77786b));
          k.cyl(gx, 0.97, 0.26, gy + 1.28, gy + 1.73, 6, T.CANVAS, col(0xbcb8a5));
          for (const xx of [-0.16, 0.16]) k.tube([gx + xx, gy + 1.65, 1.02], [gx + xx * 1.65, gy + 1.98, 1.08], 0.035, 4, col(0x5c5647));
        }
      });
      clear.push({ x: s.x, z: s.z, r: 4.8 }); dirt.push({ x: s.x, z: s.z, r: 3.4 });
    }
  }
  {
    const s = spot(R * 0.32, R * 0.76, 3.6);
    if (s) {
      const gy = level?.(s.x, s.z, 3.3) ?? ground(s.x, s.z);
      k.at(s.x, s.z, s.a, () => {
        // Kombucha bar and its hand-painted, reversible mural backing.
        k.box(0, 0, 4.4, 0.85, gy + 0.75, gy + 1.05, T.WOOD, col(0x816044), T.WOOD);
        k.box(0, -0.46, 4.7, 0.16, gy + 0.45, gy + 2.85, T.WOOD, col(0x71533e), null);
        k.quad([-2.2, gy + 0.6, -0.57], [2.2, gy + 0.6, -0.57], [2.2, gy + 2.6, -0.57], [-2.2, gy + 2.6, -0.57], [[0, 0], [1, 0], [1, 1], [0, 1]], col(0xffffff), T.TIEDYE);
        for (let i = 0; i < 7; i++) {
          const xx = -1.7 + i * 0.57;
          k.cyl(xx, 0, 0.12, gy + 1.03, gy + 1.52 + (i % 3) * 0.12, 7, T.GLASS, col(0xb8a068), col(0xd5b789));
        }
        k.quad([-2.7, gy + 3.0, 0.4], [2.7, gy + 3.0, 0.4], [2.5, gy + 3.2, -1.0], [-2.5, gy + 3.2, -1.0], [[0, 0], [1.6, 0], [1.6, 0.8], [0, 0.8]], col(0xe8c88b), T.CANVAS);
        for (const xx of [-2.5, 2.5]) k.tube([xx, gy, 0.4], [xx, gy + 3.05, 0.4], 0.06, 4, wood);
      });
      clear.push({ x: s.x, z: s.z, r: 4.1 }); dirt.push({ x: s.x, z: s.z, r: 3.3 });
    }
  }
  {
    const s = spot(R * 0.36, R * 0.78, 3.7);
    if (s) {
      const gy = level?.(s.x, s.z, 3.5) ?? ground(s.x, s.z);
      k.at(s.x, s.z, s.a, () => {
        k.cyl(0, 0, 3.15, gy - 0.2, gy + 0.16, 12, T.WOOD, col(0x907251), col(0x9d805d));
        for (const xx of [-1.3, 0, 1.3]) {
          k.slab(xx - 0.46, -1.5, xx + 0.46, 1.45, gy + 0.18, T.TIEDYE, col(0xd6b78c));
          k.cyl(xx, -1.55, 0.2, gy + 0.2, gy + 0.48, 6, T.STONE, col(0xbab1a2));
        }
        for (const zz of [-2.2, 2.2]) planter(k, 2.1, zz, gy + 0.16);
      });
      clear.push({ x: s.x, z: s.z, r: 4.2 }); dirt.push({ x: s.x, z: s.z, r: 3.2 });
    }
  }
  if (cover && mapId !== 'florida') {
    const s = spot(R * 0.56, R * 0.9, 3.8, (x, z) => cover(x, z) > 0.48);
    if (s) {
      const gy = ground(s.x, s.z);
      k.at(s.x, s.z, s.a, () => {
        k.tube([0, gy - 0.5, 0], [0, gy + 6.8, 0], 0.55, 9, col(0x68513d), T.WOOD);
        k.box(0.4, 0.15, 3.3, 3.1, gy + 4.25, gy + 6.4, T.WOOD, col(0x93734e), T.WOOD);
        k.gable(0.4, 0.15, 3.3, 3.1, gy + 6.4, 1.15, false, col(0x676553), col(0x93734e), T.WOOD, 0.25);
        k.slab(-1.7, -1.8, 2.5, 2, gy + 4.2, T.WOOD, col(0x816447));
        for (const xx of [-1.4, 2.1]) for (const zz of [-1.5, 1.7]) k.tube([xx, gy + 4.2, zz], [xx, gy + 5.25, zz], 0.06, 5, darkWood);
        for (let j = 0; j < 8; j++) k.tube([-2, gy + j * 0.52, 1.8], [-1.25, gy + j * 0.52, 1.8], 0.05, 4, wood);
        for (const xx of [-0.55, 1.15]) k.quad([xx, gy + 5.0, 1.72], [xx + 0.65, gy + 5.0, 1.72], [xx + 0.65, gy + 5.65, 1.72], [xx, gy + 5.65, 1.72], [[0, 0], [1, 0], [1, 1], [0, 1]], col(0xffffff), T.HOUSE_WIN);
      });
      clear.push({ x: s.x, z: s.z, r: 2 });
    }
  }

  // ---------------------------------------------------------------- flags + lights
  const poles: V3[] = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + r() * 0.25, d = R * 0.62 + r() * 5;
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
      for (let j = 1; j < pts.length - 1; j++) bulbs.glowBox(pts[j][0], pts[j][1] - 0.12, pts[j][2], 0.15, j % 5 === 0 ? 'glowPink' : 'glowWarm', 5);
    }
  }
  // lights from each pole to the fire circle center pole
  const cp: V3 = [0.5, fy + 5.5, 6.5];
  k.tube([cp[0], fy, cp[2]], cp, 0.08, 5, darkWood);
  for (const p of poles.slice(0, 2)) {
    const pts = catenary(cp, p, 0.8, 14);
    for (let j = 0; j < pts.length - 1; j++) k.tube(pts[j], pts[j + 1], 0.012, 3, rope);
    for (let j = 1; j < pts.length - 1; j++) bulbs.glowBox(pts[j][0], pts[j][1] - 0.12, pts[j][2], 0.15, 'glowWarm', 5);
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

  return { geometry: k.build(), flameGeometry: fireKit.build(), bulbGeometry: bulbs.build(), emitters: k.emitters, clear, dirt, fire: [0, fy + 1.2, 0] };
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
    const eaveY = y0 + wallH - 0.05, crownY = eaveY + rad * 0.42;
    const roof = tint.clone().multiplyScalar(0.92);
    const roofP = (a: number, rr: number, y: number): V3 => [Math.sin(a) * rr, y, Math.cos(a) * rr];
    for (let i = 0; i < seg; i++) {
      const a = i * Math.PI * 2 / seg, b = (i + 1) * Math.PI * 2 / seg;
      const r0 = rad * 1.12, rm = rad * 0.62, rt = 0.55;
      const ym = eaveY + (crownY - eaveY) * 0.52 - 0.09;
      // Two courses of slightly sagging canvas with a dark stitched seam.
      k.quad(roofP(a, r0, eaveY), roofP(b, r0, eaveY), roofP(b, rm, ym), roofP(a, rm, ym), [[0, 0], [0.62, 0], [0.62, 0.55], [0, 0.55]], roof, T.CANVAS);
      k.quad(roofP(a, rm, ym), roofP(b, rm, ym), roofP(b, rt, crownY), roofP(a, rt, crownY), [[0, 0.55], [0.62, 0.55], [0.62, 1], [0, 1]], roof, T.CANVAS);
      const seam = col(0x9a917b);
      k.tube(roofP(a, r0 + 0.025, eaveY + 0.025), roofP(a, rm + 0.025, ym + 0.025), 0.013, 3, seam);
      k.tube(roofP(a, rm + 0.025, ym + 0.025), roofP(a, rt + 0.025, crownY + 0.025), 0.013, 3, seam);
      k.tube(roofP(a, rad + 0.025, y0 + 0.23), roofP(a, rad + 0.025, y0 + wallH - 0.49), 0.012, 3, seam);
      if (i % 3 === 0) k.tube(roofP(a, 0.56, crownY + 0.14), roofP(a + Math.PI, 0.56, crownY + 0.14), 0.035, 4, col(0x8a6a4a));
    }
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
    // A weathered runner and two planters make the threshold readable at night.
    k.slab(-0.54, rad + 0.3, 0.54, rad + 2.25, gy + 0.05, T.TIEDYE, col(0xe5c7a3));
    planter(k, -1.15, rad + 0.56, gy + 0.06);
    planter(k, 1.15, rad + 0.56, gy + 0.06);
    for (const px of [-rad * 0.72, rad * 0.72]) {
      const pz = -rad * 0.7;
      k.tube([px, y0 + wallH + 0.05, pz], [px, y0 + wallH - 0.6, pz], 0.02, 4, col(0x5a4230));
      planter(k, px, pz, y0 + wallH - 0.78, true);
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
  k.tri([x - 0.58, gy + 0.03, z + rad * 0.94], [x + 0.58, gy + 0.03, z + rad * 0.94], [x, gy + 1.62, z + rad * 0.7], [[0, 0], [1, 0], [0.5, 1]], col(0x27201b), T.SOLID);
  for (const sign of [-1, 1]) k.tube([x + sign * 0.59, gy + 0.02, z + rad * 0.96], [x, gy + 1.66, z + rad * 0.72], 0.02, 3, col(0x9a7954));
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
    // Window tile includes a shallow room mask and warm window emission at night.
    const tile = glass ? T.HOUSE_WIN : T.CANVAS;
    const c0 = glass ? col(0xffffff) : col(idx % 7 === 0 ? 0xd8e6f0 : 0xf2f0ea);
    const uvs: [number, number][] = glass ? [[0, 0], [1, 0], [0.5, 1]] : [[0, 0], [1, 0], [0.5, 0.86]];
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

function planter(k: Kit, x: number, z: number, y: number, hanging = false) {
  const radius = hanging ? 0.25 : 0.34;
  k.cyl(x, z, radius, y, y + (hanging ? 0.26 : 0.34), 7, T.STONE, col(0x9e765f), col(0x443d31), radius * 1.08);
  for (let i = 0; i < 5; i++) {
    const a = i * Math.PI * 2 / 5;
    k.tube([x, y + 0.27, z], [x + Math.sin(a) * radius * 1.3, y + 0.53 + (i % 2) * 0.12, z + Math.cos(a) * radius * 1.3], 0.035, 3, col(0x4f7545));
  }
}

function fence(k: Kit, x0: number, z0: number, x1: number, z1: number, y: number, h: number, wood: Col) {
  for (const [a, b, c, d] of [[x0, z0, x1, z0], [x1, z0, x1, z1], [x1, z1, x0, z1], [x0, z1, x0, z0]]) {
    const n = Math.max(1, Math.ceil(Math.hypot(c - a, d - b) / 1.5));
    for (let i = 0; i <= n; i++) {
      const t = i / n, xx = a + (c - a) * t, zz = b + (d - b) * t;
      k.tube([xx, y - 0.15, zz], [xx, y + h, zz], 0.035, 4, wood);
    }
    for (const yy of [0.35, 0.88]) k.tube([a, y + yy * h, b], [c, y + yy * h, d], 0.018, 3, wood);
  }
}

function lawnChair(k: Kit, x: number, z: number, gy: number, yaw: number, fabric: Col) {
  k.at(x, z, yaw, () => {
    const steel = col(0x777b78);
    for (const xx of [-0.35, 0.35]) {
      k.tube([xx, gy - 0.08, -0.32], [xx, gy + 0.48, 0.25], 0.025, 4, steel);
      k.tube([xx, gy - 0.08, 0.39], [xx, gy + 0.48, 0.25], 0.025, 4, steel);
      k.tube([xx, gy + 0.5, -0.2], [xx, gy + 1.15, -0.5], 0.025, 4, steel);
    }
    k.slab(-0.36, -0.22, 0.36, 0.36, gy + 0.5, T.CANVAS, fabric);
    k.quad([0.36, gy + 0.5, -0.2], [-0.36, gy + 0.5, -0.2], [-0.36, gy + 1.15, -0.5], [0.36, gy + 1.15, -0.5], [[0, 0], [1, 0], [1, 1], [0, 1]], fabric, T.CANVAS);
  });
}
