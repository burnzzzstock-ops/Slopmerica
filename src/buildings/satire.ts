// The satire prop catalog: the things that make a lot read as America at
// neighbourhood zoom. Yard signs and inflatables, boats on blocks and lifted
// trucks, dealership balloon arches and dumpster fires, "days since last
// incident: 0". Generators call decorate() with a context (front yard, shop
// front, industrial yard, ...) and a free area; it scatters props that fit,
// by the lot's level (junk on the cheap lots, HOA menace on the rich ones).
// Signs come from art/satireArt.ts (their own atlas sheet).
import { M, S, Mat, rgb, WHITE, type RGB } from './mesh';
import { GenCtx, emit, mats } from './props';
import { YARD, BANNER, MARQUEE, NEON, ROAD, AFRAME } from '../art/satireArt';

export type SatCtx = 'frontYard' | 'backYard' | 'driveway' | 'roof' | 'shopFront' | 'parking' | 'industrial' | 'apartment' | 'office' | 'farm' | 'curb';
export interface Area { x0: number; x1: number; z0: number; z1: number }

const P = (c: number | RGB) => M('plain', 2, 2, c);
const METAL = (c = 0xb8bcc0) => M('metal', 2, 2, c);
const WOOD = (c = 0xb08a5a) => M('wood', 3, 3, c);
const pick = <T,>(g: GenCtx, a: readonly T[]) => a[Math.floor(g.rng.float() * a.length)];
const LOUD = [0xff3b3b, 0xffd23f, 0x3fd0ff, 0x39ff7a, 0xff7ad0, 0xff7a1a, 0xffffff, 0x2a6fb0];

interface Prop {
  id: string;
  ctx: SatCtx[];
  /** footprint (m), facing +Z */
  w: number; d: number;
  lvl?: [number, number];
  weight?: number;
  build(g: GenCtx): void;
}

// ------------------------------------------------------------------ parts
function signOnStakes(g: GenCtx, tile: string, w = 1.3, h = 0.8, y = 0.4) {
  const { mb } = g;
  const wire = METAL(0x6a6a6a);
  for (const dx of [-w * 0.3, w * 0.3]) mb.boxC(dx, 0, 0.03, 0.03, 0, y + 0.1, { side: wire, top: null });
  const s = S(tile);
  mb.box(-w / 2, w / 2, y, y + h, -0.01, 0.01, { f: s, b: s, l: null, r: null, top: null, bottom: null });
}
function postSign(g: GenCtx, tile: string, w: number, h: number, y: number, posts = 1) {
  const { mb } = g;
  const post = METAL(0x8a8e92);
  if (posts === 1) mb.boxC(0, -0.06, 0.08, 0.08, 0, y + h * 0.5, { side: post, top: null });
  else for (const dx of [-w * 0.35, w * 0.35]) mb.boxC(dx, -0.06, 0.1, 0.1, 0, y + h * 0.5, { side: post, top: null });
  const s = S(tile);
  mb.box(-w / 2, w / 2, y, y + h, -0.03, 0.03, { f: s, b: s, l: P(0xdddddd), r: P(0xdddddd), top: P(0xdddddd) });
}
function wheel(g: GenCtx, x: number, y: number, z: number, r: number, wdt: number) {
  g.mb.push().translate(x, y, z).rotZ(Math.PI / 2);
  g.mb.cyl(0, 0, r, -wdt / 2, wdt / 2, 8, P(0x1b1b1c));
  g.mb.pop();
}
function inflatable(g: GenCtx, parts: [number, number, number, number, number, number, number][]) {
  // [x, y, z, rx, ry, rz, color] blobs: slightly saggy, very loud
  for (const [x, y, z, rx, ry, rz, c] of parts) g.mb.blob(x, y, z, rx, ry, rz, M('plain', 2, 2, c, { ao: false }), 1, 0.06, Math.floor(x * 13 + y * 7 + z * 3));
}
function person(g: GenCtx, x: number, z: number, shirt: number, h = 1.75) {
  // a static figure (costumed wavers, sign spinners)
  const { mb } = g;
  for (const dx of [-0.1, 0.1]) mb.boxC(x + dx, z, 0.14, 0.16, 0, h * 0.47, P(0x2a3a5a));
  mb.boxC(x, z, 0.42, 0.24, h * 0.47, h * 0.36, P(shirt));
  mb.blob(x, h * 0.92, z, 0.12, 0.14, 0.12, P(0xd9a57a), 0);
}

// ------------------------------------------------------------------ the catalog
const PROPS: Prop[] = [];
const add = (p: Prop) => PROPS.push(p);

// yard signs: every slogan is its own prop; clusters are political season
for (const y of YARD) add({ id: 'yard:' + y.k, ctx: ['frontYard', 'curb'], w: 1.4, d: 0.4, weight: 0.4, build: (g) => signOnStakes(g, 'sat:yard:' + y.k) });
add({ id: 'signField', ctx: ['frontYard', 'curb'], w: 4.4, d: 1.2, lvl: [1, 5], weight: 1.6, build(g) {
  const n = 3 + Math.floor(g.rng.float() * 3);
  for (let i = 0; i < n; i++) { g.mb.push().translate(-1.6 + (i * 3.2) / Math.max(1, n - 1), 0, (g.rng.float() - 0.5) * 0.6).rotY((g.rng.float() - 0.5) * 0.5); signOnStakes(g, 'sat:yard:' + pick(g, YARD).k, 1.0, 0.62, 0.35); g.mb.pop(); }
} });
// banners on fences / frames (shop fronts, dealerships, apartments, offices)
for (const b of BANNER) add({ id: 'banner:' + b.k, ctx: ['shopFront', 'parking', 'apartment', 'office', 'industrial'], w: 4.6, d: 0.3, weight: 0.3, build(g) {
  const { mb } = g;
  for (const dx of [-2.2, 2.2]) mb.boxC(dx, 0, 0.1, 0.1, 0, 2.3, { side: METAL(0x9a9ea2), top: null });
  const s = S('sat:banner:' + b.k);
  mb.box(-2.15, 2.15, 1.25, 2.2, -0.01, 0.01, { f: s, b: s, l: null, r: null, top: null, bottom: null });
} });
for (const m of MARQUEE) add({ id: 'marquee:' + m.k, ctx: ['shopFront', 'curb', 'parking'], w: 3, d: 0.8, weight: 0.5, build(g) {
  const { mb } = g;
  mb.boxC(0, 0, 3.2, 0.7, 0, 0.8, M('brickTan', 2, 2));
  const s = S('sat:marquee:' + m.k);
  mb.box(-1.5, 1.5, 0.8, 2.0, -0.12, 0.12, { f: s, b: s, l: P(0x1d1d1f), r: P(0x1d1d1f), top: P(0x1d1d1f) });
} });
for (const r of ROAD) add({ id: 'road:' + r.k, ctx: ['curb'], w: 1.2, d: 0.3, weight: 0.4, build: (g) => postSign(g, 'sat:road:' + r.k, 1.1, 0.86, 1.5) });
for (const a of AFRAME) add({ id: 'aframe:' + a.k, ctx: ['shopFront'], w: 0.8, d: 0.8, weight: 0.45, build(g) {
  const { mb } = g;
  const s = S('sat:aframe:' + a.k);
  mb.push().rotX(-0.18); mb.box(-0.32, 0.32, 0, 0.95, 0.12, 0.16, { f: s, b: WOOD(), l: WOOD(), r: WOOD(), top: WOOD() }); mb.pop();
  mb.push().rotX(0.18); mb.box(-0.32, 0.32, 0, 0.95, -0.16, -0.12, { f: WOOD(), b: s, l: WOOD(), r: WOOD(), top: WOOD() }); mb.pop();
} });
for (const n of NEON) add({ id: 'neon:' + n.k, ctx: ['shopFront'], w: 1.6, d: 0.3, weight: 0.4, build(g) {
  // a neon box on a post by the door (the shopfront glass is the building's)
  const { mb } = g;
  mb.boxC(0, 0, 0.1, 0.1, 0, 2.2, { side: METAL(0x3a3a3a), top: null });
  const s = S('sat:neon:' + n.k);
  mb.box(-0.75, 0.75, 2.2, 2.76, -0.08, 0.08, { f: s, b: s, l: P(0x111111), r: P(0x111111), top: P(0x111111), bottom: P(0x111111) });
} });

// --- yards
add({ id: 'flamingos', ctx: ['frontYard'], w: 2.4, d: 1.4, lvl: [1, 4], build(g) {
  const pink = M('plain', 2, 2, 0xff5fa8, { ao: false });
  for (let i = 0; i < 5 + Math.floor(g.rng.float() * 6); i++) {
    const x = (g.rng.float() - 0.5) * 2.2, z = (g.rng.float() - 0.5) * 1.2;
    g.mb.boxC(x, z, 0.02, 0.02, 0, 0.45, P(0x333333));
    g.mb.blob(x, 0.55, z, 0.16, 0.12, 0.08, pink, 0);
    g.mb.boxC(x + 0.08, z, 0.04, 0.04, 0.6, 0.25, pink);
  }
} });
add({ id: 'gnomeArmy', ctx: ['frontYard', 'backYard'], w: 2.2, d: 1.6, lvl: [1, 4], build(g) {
  for (let i = 0; i < 6 + Math.floor(g.rng.float() * 8); i++) {
    const x = (g.rng.float() - 0.5) * 2, z = (g.rng.float() - 0.5) * 1.4;
    g.mb.cyl(x, z, 0.1, 0, 0.18, 5, P(0x2a4a8a));
    g.mb.blob(x, 0.24, z, 0.08, 0.08, 0.08, P(0xf2d0b0), 0);
    g.mb.cone(x, z, 0.09, 0.3, 0.2, 5, P(0xd01818));
  }
} });
add({ id: 'inflatableSanta', ctx: ['frontYard'], w: 2.2, d: 2.2, lvl: [2, 5], build: (g) => inflatable(g, [[0, 1.2, 0, 0.9, 1.1, 0.8, 0xd01818], [0, 2.6, 0, 0.55, 0.55, 0.5, 0xf2d0b0], [0, 3.2, 0, 0.5, 0.35, 0.45, 0xd01818], [0, 2.3, 0.35, 0.5, 0.3, 0.3, 0xffffff]]) });
add({ id: 'inflatableEagle', ctx: ['frontYard'], w: 4.6, d: 1.8, lvl: [2, 5], build: (g) => inflatable(g, [[0, 1.6, 0, 0.6, 1.3, 0.55, 0x5a3a1a], [0, 3.1, 0.1, 0.45, 0.4, 0.45, 0xffffff], [0, 3.05, 0.55, 0.14, 0.1, 0.22, 0xffc21a], [-1.2, 2.2, 0, 1.0, 0.3, 0.2, 0x5a3a1a], [1.2, 2.2, 0, 1.0, 0.3, 0.2, 0x5a3a1a]]) });
add({ id: 'inflatablePumpkin', ctx: ['frontYard'], w: 2, d: 2, lvl: [2, 5], build: (g) => inflatable(g, [[0, 0.9, 0, 0.95, 0.85, 0.95, 0xff7a1a], [0, 1.85, 0, 0.12, 0.25, 0.12, 0x2f7a2a]]) });
add({ id: 'inflatableDino', ctx: ['frontYard', 'shopFront'], w: 5, d: 1.6, lvl: [2, 5], build: (g) => inflatable(g, [[0, 1.2, 0, 1.2, 0.9, 0.7, 0x39c24a], [1.3, 2.4, 0, 0.35, 0.9, 0.35, 0x39c24a], [1.55, 3.3, 0.1, 0.5, 0.35, 0.4, 0x39c24a], [-1.5, 0.9, 0, 0.9, 0.35, 0.3, 0x39c24a]]) });
add({ id: 'inflatableSnowman', ctx: ['frontYard'], w: 1.8, d: 1.8, lvl: [2, 5], build: (g) => inflatable(g, [[0, 0.8, 0, 0.8, 0.75, 0.8, 0xffffff], [0, 2, 0, 0.55, 0.55, 0.55, 0xffffff], [0, 2.85, 0, 0.4, 0.4, 0.4, 0xffffff], [0, 3.35, 0, 0.35, 0.25, 0.35, 0x111111]]) });
add({ id: 'liftedTruck', ctx: ['driveway'], w: 2.8, d: 6, lvl: [1, 4], weight: 1.4, build(g) {
  const { mb, rng } = g;
  const body = P(pick(g, [0x1a1a1c, 0xf2f2ee, 0x7a1d1d, 0x2a4a2a, 0x1d2b4a]));
  for (const [x, z] of [[-1.05, 1.8], [1.05, 1.8], [-1.05, -1.6], [1.05, -1.6]] as [number, number][]) wheel(g, x, 0.62, z, 0.62, 0.5);
  mb.box(-1.05, 1.05, 1.0, 1.9, -2.8, 2.8, body);
  mb.box(-1.0, 1.0, 1.9, 2.75, -0.4, 1.4, { side: M('carWin', 2, 1), top: body });
  if (rng.chance(0.7)) for (const dx of [-0.8, 0, 0.8]) { mb.boxC(dx, -2.6, 0.05, 0.05, 1.9, 2.2, { side: METAL(0x9a9a9a), top: null }); mb.poly([[dx, 3.5, -2.6], [dx + 0.9, 3.45, -2.6], [dx + 0.9, 4.0, -2.6], [dx, 4.1, -2.6]], S(rng.chance(0.5) ? 'flag' : 'sat:flag:lawn')); }
} });
add({ id: 'boatOnBlocks', ctx: ['backYard', 'driveway'], w: 2.2, d: 6, lvl: [1, 3], build(g) {
  const { mb } = g;
  for (const z of [-2, 0, 2]) mb.boxC(0, z, 1.4, 0.4, 0, 0.4, P(0x8a8a88));
  mb.box(-0.95, 0.95, 0.4, 1.3, -2.6, 1.8, { side: M('plain', 2, 2, 0xe8e4d8), top: P(0x6a8aa0) });
  mb.poly([[-0.95, 0.4, 1.8], [0.95, 0.4, 1.8], [0, 1.3, 3.0]], P(0xe8e4d8));
  mb.box(-0.9, 0.9, 1.3, 1.9, -1.4, -0.4, P(0x3a5a7a));
} });
add({ id: 'couchOnLawn', ctx: ['frontYard'], w: 2.2, d: 1, lvl: [1, 2], build(g) {
  const c = P(pick(g, [0x7a5a3a, 0x3a5a3a, 0x8a3a3a, 0x9a8a6a]));
  g.mb.box(-1, 1, 0.1, 0.5, -0.4, 0.4, c); g.mb.box(-1, 1, 0.5, 1.0, -0.45, -0.15, c);
  for (const dx of [-1, 0.8]) g.mb.box(dx, dx + 0.2, 0.5, 0.75, -0.45, 0.4, c);
} });
add({ id: 'fridgeOnPorch', ctx: ['frontYard', 'backYard'], w: 0.9, d: 0.8, lvl: [1, 2], build: (g) => g.mb.box(-0.4, 0.4, 0, 1.8, -0.35, 0.35, { side: P(0xe8e4d0), f: P(0xd8d4c0) }) });
add({ id: 'tireStack', ctx: ['backYard', 'industrial', 'curb'], w: 1.4, d: 1.4, lvl: [1, 3], build(g) {
  for (let i = 0; i < 3 + Math.floor(g.rng.float() * 3); i++) g.mb.cyl((g.rng.float() - 0.5) * 0.2, (g.rng.float() - 0.5) * 0.2, 0.55, i * 0.24, i * 0.24 + 0.24, 8, P(0x1b1b1c));
} });
add({ id: 'jetSkis', ctx: ['driveway', 'backYard'], w: 2.6, d: 3.6, lvl: [3, 5], build(g) {
  const { mb } = g;
  mb.boxC(0, 0, 2.2, 3.2, 0.3, 0.1, METAL(0x6a6a6a));
  for (const dx of [-0.6, 0.6]) { mb.box(dx - 0.4, dx + 0.4, 0.4, 0.95, -1.4, 1.2, { side: P(pick(g, [0xffd23f, 0x3fd0ff, 0x39ff7a, 0xff3b3b])), top: P(0x1b1b1c) }); mb.boxC(dx, -0.4, 0.5, 0.6, 0.95, 0.35, P(0x1b1b1c)); }
  wheel(g, -1.1, 0.3, 0, 0.3, 0.2); wheel(g, 1.1, 0.3, 0, 0.3, 0.2);
} });
add({ id: 'rvDriveway', ctx: ['driveway'], w: 3, d: 10, lvl: [3, 5], weight: 0.7, build(g) {
  const { mb } = g;
  mb.box(-1.25, 1.25, 0.6, 3.6, -4.8, 4.2, { side: M('trailer', 3.2, 2.6, 0xf2efe4), top: P(0xdedad0) });
  mb.box(-1.2, 1.2, 0.6, 2.2, 4.2, 5, { side: M('carWin', 2, 1), top: P(0xdedad0) });
  mb.box(-1.26, 1.26, 1.6, 2.0, -4.8, 4.2, P(pick(g, [0x2a6fb0, 0xb3151d, 0x6a4a2a])));
  for (const z of [-3.6, 2.6]) { wheel(g, -1.1, 0.55, z, 0.55, 0.4); wheel(g, 1.1, 0.55, z, 0.55, 0.4); }
} });
add({ id: 'atv', ctx: ['backYard', 'farm', 'driveway'], w: 1.4, d: 2.2, lvl: [1, 4], build(g) {
  for (const [x, z] of [[-0.55, 0.7], [0.55, 0.7], [-0.55, -0.7], [0.55, -0.7]] as [number, number][]) wheel(g, x, 0.32, z, 0.32, 0.3);
  g.mb.box(-0.45, 0.45, 0.45, 0.9, -0.9, 0.9, P(pick(g, [0x2a5a2a, 0xb3151d, 0x3a3a3a, 0xff7a1a])));
  g.mb.boxC(0, 0.5, 0.9, 0.08, 1.1, 0.06, METAL(0x2a2a2a));
} });
add({ id: 'dirtRamp', ctx: ['backYard', 'frontYard'], w: 2, d: 3, lvl: [1, 3], build(g) {
  g.mb.poly([[-0.9, 0.02, 1.4], [0.9, 0.02, 1.4], [0.9, 1.1, -1.2], [-0.9, 1.1, -1.2]], WOOD(0xc8a870));
  for (const dx of [-0.8, 0.8]) g.mb.boxC(dx, -1.1, 0.12, 0.12, 0, 1.1, WOOD(0x8a6a40));
} });
add({ id: 'hotTub', ctx: ['backYard'], w: 2.4, d: 2.4, lvl: [3, 5], build(g) {
  g.mb.box(-1.1, 1.1, 0, 0.9, -1.1, 1.1, { side: M('deck', 3, 3), top: M('pool', 2, 2) });
  emit(g, 'steam', 0, 1.1, 0);
} });
add({ id: 'firePit', ctx: ['backYard'], w: 3.4, d: 3.4, lvl: [2, 5], build(g) {
  g.mb.cyl(0, 0, 0.6, 0, 0.4, 8, M('stone', 2, 2));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.3, x = Math.cos(a) * 1.5, z = Math.sin(a) * 1.5;
    g.mb.push().translate(x, 0, z).rotY(-a - Math.PI / 2);
    const c = P(pick(g, [0xd01818, 0x2a6fb0, 0xffd23f, 0x2a8a3a, 0xffffff]));
    g.mb.box(-0.35, 0.35, 0.4, 0.5, -0.3, 0.35, c); g.mb.push().rotX(-0.35); g.mb.box(-0.35, 0.35, 0.5, 1.3, -0.45, -0.35, c); g.mb.pop();
    g.mb.pop();
  }
  emit(g, 'fire', 0, 0.5, 0);
} });
add({ id: 'cornhole', ctx: ['backYard', 'frontYard'], w: 1.2, d: 7, lvl: [2, 4], build(g) {
  for (const z of [-3, 3]) { g.mb.push().translate(0, 0, z).rotY(z > 0 ? Math.PI : 0).rotX(-0.25); g.mb.box(-0.3, 0.3, 0.1, 0.18, -0.6, 0.6, { side: WOOD(), top: S('sat:flag:team') }); g.mb.pop(); }
} });
add({ id: 'beerPong', ctx: ['backYard'], w: 1, d: 2.6, lvl: [1, 4], build(g) {
  g.mb.box(-0.4, 0.4, 0.7, 0.76, -1.2, 1.2, P(0xf2f2f2));
  for (const dx of [-0.2, 0.2]) for (const dz of [-1, 1]) g.mb.boxC(dx, dz, 0.05, 0.05, 0, 0.7, METAL(0x9a9a9a));
  for (const z of [-1.05, 1.05]) for (let i = 0; i < 6; i++) g.mb.cyl(-0.12 + (i % 3) * 0.12, z + (i < 3 ? 0 : Math.sign(-z) * 0.1), 0.045, 0.76, 0.88, 5, P(0xd01818));
} });
add({ id: 'ridingMower', ctx: ['backYard', 'frontYard', 'driveway'], w: 1.2, d: 1.8, lvl: [2, 4], build(g) {
  wheel(g, -0.5, 0.35, -0.5, 0.35, 0.25); wheel(g, 0.5, 0.35, -0.5, 0.35, 0.25); wheel(g, -0.45, 0.2, 0.6, 0.2, 0.15); wheel(g, 0.45, 0.2, 0.6, 0.2, 0.15);
  g.mb.box(-0.5, 0.5, 0.35, 0.75, -0.8, 0.9, P(0x2a7a2a)); g.mb.box(-0.35, 0.35, 0.75, 1.15, -0.8, -0.4, P(0x1b1b1c));
} });
add({ id: 'chainsawBear', ctx: ['frontYard', 'shopFront'], w: 1, d: 1, lvl: [1, 4], build(g) {
  const w = WOOD(0x8a5a30);
  g.mb.cyl(0, 0, 0.4, 0, 0.3, 7, w); g.mb.blob(0, 1.0, 0, 0.35, 0.65, 0.3, w, 0); g.mb.blob(0, 1.8, 0.05, 0.28, 0.26, 0.26, w, 0);
  for (const dx of [-0.18, 0.18]) g.mb.blob(dx, 2.05, 0, 0.08, 0.08, 0.06, w, 0);
} });
add({ id: 'eagleStatue', ctx: ['frontYard', 'shopFront'], w: 2.2, d: 1, lvl: [3, 5], build(g) {
  g.mb.boxC(0, 0, 0.8, 0.8, 0, 1.0, M('stone', 2, 2));
  const b = P(0x4a3218), wht = P(0xffffff);
  g.mb.blob(0, 1.45, 0, 0.25, 0.4, 0.22, b, 0); g.mb.blob(0, 1.95, 0.08, 0.16, 0.16, 0.16, wht, 0);
  g.mb.poly([[0, 1.5, 0], [-1.0, 2.2, -0.1], [-0.8, 1.6, -0.1]], b); g.mb.poly([[0, 1.5, 0], [0.8, 1.6, -0.1], [1.0, 2.2, -0.1]], b);
} });
add({ id: 'dressedGoose', ctx: ['frontYard'], w: 0.6, d: 0.6, lvl: [1, 4], build(g) {
  g.mb.blob(0, 0.28, 0, 0.18, 0.2, 0.26, P(0xe8e8e0), 0); g.mb.cyl(0, 0.12, 0.05, 0.4, 0.7, 5, P(0xe8e8e0)); g.mb.blob(0, 0.72, 0.16, 0.07, 0.07, 0.1, P(0xe8e8e0), 0);
  g.mb.cone(0, 0, 0.22, 0.12, 0.3, 6, P(pick(g, [0xd01818, 0x2a6fb0, 0xffd23f, 0x2a8a3a]))); // its little outfit
} });
add({ id: 'deerBlind', ctx: ['backYard', 'farm'], w: 2, d: 2, lvl: [1, 3], build(g) {
  for (const [x, z] of [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]] as [number, number][]) g.mb.boxC(x, z, 0.12, 0.12, 0, 3, WOOD(0x6a4a2a));
  g.mb.box(-0.9, 0.9, 3, 4.6, -0.9, 0.9, { side: M('plain', 2, 2, 0x5a6a3a), top: M('metalRoof', 2, 2, 0x5a5a4a) });
  g.mb.decal('+z', 0, 3.9, 0.91, 1.2, 0.3, P(0x1b1b1c));
} });
add({ id: 'targetRange', ctx: ['backYard', 'farm'], w: 3, d: 1.2, lvl: [1, 3], build(g) {
  g.mb.box(-1.4, 1.4, 0, 1.0, -0.5, 0.5, { side: M('plain', 2, 2, 0xd8c070), top: M('plain', 2, 2, 0xc8b060) });
  g.mb.boxC(0, 0.55, 0.9, 0.05, 1.0, 1.1, P(0xf2f2f2)); g.mb.decal('+z', 0, 1.55, 0.58, 0.6, 0.9, P(0x1b1b1c));
} });
add({ id: 'packagePile', ctx: ['frontYard'], w: 1.6, d: 1.2, lvl: [2, 5], weight: 1.2, build(g) {
  for (let i = 0; i < 6 + Math.floor(g.rng.float() * 8); i++) {
    const w = 0.3 + g.rng.float() * 0.5, h = 0.25 + g.rng.float() * 0.4, x = (g.rng.float() - 0.5) * 1.2, z = (g.rng.float() - 0.5) * 0.8, y = g.rng.float() < 0.4 ? 0.4 : 0;
    g.mb.box(x - w / 2, x + w / 2, y, y + h, z - w * 0.4, z + w * 0.4, { side: S('sat:decal:packages'), top: P(0xc69a5e) });
  }
} });
add({ id: 'dishFarm', ctx: ['backYard', 'roof'], w: 2.6, d: 1.2, lvl: [1, 3], build(g) {
  for (const dx of [-0.9, 0, 0.9]) { g.mb.boxC(dx, 0, 0.06, 0.06, 0, 1.2, METAL()); g.mb.push().translate(dx, 1.35, 0).rotX(-0.6); g.mb.cyl(0, 0, 0.45, 0, 0.08, 10, P(0xe8e8e8)); g.mb.pop(); }
} });
add({ id: 'cryptoShed', ctx: ['backYard'], w: 3.2, d: 2.6, lvl: [2, 4], weight: 1.1, build(g) {
  g.mb.box(-1.5, 1.5, 0, 2.3, -1.2, 1.2, { side: M('corrugated', 2, 2, 0x9aa0a8), top: M('metalRoof', 2, 2) });
  g.mb.decal('+z', 0, 1.5, 1.21, 2.2, 1.0, S('sat:decal:minerStencil'));
  for (const dx of [-1, 0, 1]) g.mb.box(dx - 0.35, dx + 0.35, 0.1, 0.8, -1.8, -1.25, S('acUnit'));
  emit(g, 'steam', 0, 2.5, 0);
} });
add({ id: 'prepperHatch', ctx: ['backYard'], w: 3.4, d: 3, lvl: [2, 5], build(g) {
  g.mb.cyl(0, 0, 0.7, 0, 0.5, 10, M('concrete', 2, 2)); g.mb.cyl(0, 0, 0.5, 0.5, 0.62, 10, P(0x3a4a2a));
  for (const dx of [1.2, 1.55]) g.mb.cyl(dx, -0.8, 0.28, 0, 0.9, 8, P(0x2a4a8a));
  g.mb.push().translate(-1.2, 0.2, 0.6).rotX(-0.5); g.mb.box(-0.8, 0.8, 0, 0.05, -0.5, 0.5, M('solar', 1, 1.6)); g.mb.pop();
  g.mb.push().translate(0.2, 0, 1.3); signOnStakes(g, 'sat:yard:prepared'); g.mb.pop();
} });
add({ id: 'wholeHouseGen', ctx: ['backYard'], w: 1.6, d: 1, lvl: [3, 5], build: (g) => g.mb.box(-0.75, 0.75, 0, 0.95, -0.45, 0.45, { side: P(0xd8d8d0), top: P(0xc8c8c0) }) });
add({ id: 'propanePill', ctx: ['backYard', 'farm'], w: 3.4, d: 1.4, lvl: [1, 3], build(g) {
  g.mb.push().translate(0, 0.75, 0).rotZ(Math.PI / 2); g.mb.cyl(0, 0, 0.6, -1.4, 1.4, 10, P(0xf2f2ee)); g.mb.pop();
  for (const dx of [-1, 1]) g.mb.boxC(dx, 0, 0.2, 0.8, 0, 0.3, M('concrete', 2, 2));
} });
add({ id: 'tireSwing', ctx: ['backYard', 'frontYard'], w: 1.6, d: 1.6, lvl: [1, 3], build(g) {
  g.mb.boxC(0, 0, 0.1, 0.1, 0, 3, WOOD(0x6a4a2a)); g.mb.box(-0.05, 1.2, 2.9, 3.0, -0.05, 0.05, WOOD(0x6a4a2a));
  g.mb.boxC(1.1, 0, 0.02, 0.02, 1.0, 1.9, P(0xc8b890)); g.mb.push().translate(1.1, 0.8, 0).rotX(Math.PI / 2); g.mb.cyl(0, 0, 0.35, -0.12, 0.12, 8, P(0x1b1b1c)); g.mb.pop();
} });
add({ id: 'bouncyHouse', ctx: ['backYard', 'frontYard'], w: 4, d: 4, lvl: [2, 5], build(g) {
  const c = pick(g, [0xff3b3b, 0x3fd0ff, 0xffd23f]);
  g.mb.box(-1.8, 1.8, 0, 1.2, -1.8, 1.8, { side: M('plain', 2, 2, c, { ao: false }), top: P(0x2a6fb0) });
  for (const [x, z] of [[-1.8, -1.8], [1.8, -1.8], [-1.8, 1.8], [1.8, 1.8]] as [number, number][]) { g.mb.cyl(x, z, 0.35, 0, 3.0, 8, M('plain', 2, 2, 0xffd23f, { ao: false })); g.mb.cone(x, z, 0.4, 3.0, 0.6, 8, P(0xff3b3b)); }
} });
add({ id: 'littleLibrary', ctx: ['frontYard', 'curb'], w: 0.8, d: 0.6, lvl: [3, 5], build(g) {
  g.mb.boxC(0, 0, 0.1, 0.1, 0, 1.1, WOOD()); g.mb.box(-0.3, 0.3, 1.1, 1.6, -0.2, 0.2, { side: P(0xd01818), f: M('glassPlain', 1, 1) }); g.mb.gable(-0.35, 0.35, -0.25, 0.25, 1.6, 0.25, 'z', P(0x3a3a3a), P(0xd01818), 0.05, 0.05);
} });
add({ id: 'wishingWell', ctx: ['frontYard'], w: 1.4, d: 1.4, lvl: [2, 4], build(g) {
  g.mb.cyl(0, 0, 0.6, 0, 0.6, 8, M('stone', 2, 2)); for (const dx of [-0.5, 0.5]) g.mb.boxC(dx, 0, 0.08, 0.08, 0.6, 0.9, WOOD()); g.mb.gable(-0.7, 0.7, -0.45, 0.45, 1.45, 0.35, 'x', M('shingles', 2, 2), null, 0.05, 0.05);
} });
add({ id: 'windmill', ctx: ['frontYard', 'farm'], w: 1.2, d: 1.2, lvl: [1, 4], build(g) {
  g.mb.boxC(0, 0, 0.5, 0.5, 0, 1.6, WOOD(0xe8e0d0)); g.mb.push().translate(0, 1.5, 0.3).rotZ(0.4);
  for (let i = 0; i < 4; i++) { g.mb.push().rotZ((i * Math.PI) / 2); g.mb.box(-0.06, 0.06, 0, 0.9, 0, 0.03, WOOD(0xd01818)); g.mb.pop(); }
  g.mb.pop();
} });
add({ id: 'megaFlag', ctx: ['frontYard', 'parking', 'shopFront'], w: 7, d: 1, lvl: [3, 5], weight: 1.2, build(g) {
  // the pole sits at the left end of the footprint; the flag flies across it
  const h = 14 + g.rng.float() * 8, fw = 4.5 + g.rng.float() * 2, fh = fw * 0.6;
  g.mb.push().translate(-3.3, 0, 0);
  g.mb.cyl(0, 0, 0.14, 0, h, 6, METAL(0xe8e8e8));
  g.mb.poly([[0.1, h - fh, 0], [0.1 + fw, h - fh - 0.2, 0], [0.1 + fw, h - 0.2, 0], [0.1, h, 0]], S('flag'));
  g.mb.poly([[0.1 + fw, h - fh - 0.2, 0], [0.1, h - fh, 0], [0.1, h, 0], [0.1 + fw, h - 0.2, 0]], { ...S('flag'), flipU: true });
  g.mb.pop();
} });
add({ id: 'hoaNotice', ctx: ['frontYard'], w: 0.8, d: 0.3, lvl: [3, 5], build: (g) => postSign(g, 'sat:decal:hoaNotice', 0.7, 0.52, 0.8) });
add({ id: 'evCordHazard', ctx: ['driveway'], w: 2, d: 5, lvl: [3, 5], build(g) {
  g.mb.box(-0.9, 0.9, 0.2, 1.3, -2.2, 2.2, { side: P(pick(g, [0xf2f2f2, 0x1b1b1c, 0xb3151d])), top: P(0x2a2a2a) });
  g.mb.box(-0.85, 0.85, 1.3, 1.75, -1.2, 0.8, M('carWin', 2, 1));
  for (let i = 0; i < 8; i++) g.mb.boxC(1.1 + Math.sin(i) * 0.3, -2.2 + i * 0.6, 0.05, 0.6, 0.02, 0.03, P(0xff7a1a)); // the extension cord across the sidewalk
} });
add({ id: 'tikiBar', ctx: ['backYard'], w: 3, d: 2, lvl: [2, 5], build(g) {
  g.mb.box(-1.4, 1.4, 0, 1.1, -0.4, 0.4, { side: M('wood', 1, 1, 0xa07a40), top: WOOD(0x6a4a2a) });
  for (const dx of [-1.3, 1.3]) g.mb.boxC(dx, -0.3, 0.12, 0.12, 0, 2.4, WOOD(0x6a4a2a));
  g.mb.hip(-1.6, 1.6, -0.9, 0.7, 2.4, 0.7, M('plain', 2, 2, 0xc8a860), 0.1);
} });
add({ id: 'bbqTrailer', ctx: ['backYard', 'driveway', 'parking'], w: 2, d: 4.4, lvl: [1, 4], build(g) {
  g.mb.push().translate(0, 1.0, 0).rotX(Math.PI / 2); g.mb.cyl(0, 0, 0.7, -1.8, 1.8, 10, P(0x1b1b1c)); g.mb.pop();
  g.mb.boxC(0, 2.1, 0.3, 0.3, 1.2, 1.6, P(0x1b1b1c)); wheel(g, -0.8, 0.35, 0, 0.35, 0.2); wheel(g, 0.8, 0.35, 0, 0.35, 0.2);
  emit(g, 'smoke', 0, 2.9, 2.1);
} });
add({ id: 'forSaleTruck', ctx: ['frontYard', 'curb'], w: 2.2, d: 5.4, lvl: [1, 3], build(g) {
  const b = P(pick(g, [0x7a1d1d, 0x2a4a6a, 0xc9c1a8, 0x1a1a1c]));
  for (const [x, z] of [[-0.9, 1.7], [0.9, 1.7], [-0.9, -1.6], [0.9, -1.6]] as [number, number][]) wheel(g, x, 0.4, z, 0.4, 0.3);
  g.mb.box(-0.95, 0.95, 0.5, 1.25, -2.6, 2.6, b); g.mb.box(-0.9, 0.9, 1.25, 1.95, -0.2, 1.3, { side: M('carWin', 2, 1), top: b });
  g.mb.decal('+z', 0, 1.6, 1.31, 0.9, 0.4, S('sat:yard:cash4cars'));
} });
add({ id: 'bulkTrashDay', ctx: ['curb'], w: 2.6, d: 1.6, lvl: [1, 4], build(g) {
  g.mb.push().rotX(-0.2); g.mb.box(-0.9, 0.9, 0, 1.9, -0.15, 0.15, P(0xe8e2d0)); g.mb.pop(); // the mattress
  g.mb.box(0.7, 1.3, 0, 0.9, 0.2, 0.8, P(0x9a8a6a)); // a chair
  g.mb.push().translate(-0.6, 0, 0.6); signOnStakes(g, 'sat:yard:freeCouch', 0.6, 0.4, 0.2); g.mb.pop();
} });
add({ id: 'chickenCoop', ctx: ['backYard', 'farm'], w: 2.4, d: 2, lvl: [1, 4], build(g) {
  g.mb.box(-1, 1, 0.5, 1.6, -0.8, 0.8, { side: WOOD(0xc8a070), top: M('metalRoof', 2, 2) }); for (const [x, z] of [[-0.9, -0.7], [0.9, -0.7], [-0.9, 0.7], [0.9, 0.7]] as [number, number][]) g.mb.boxC(x, z, 0.1, 0.1, 0, 0.5, WOOD(0x8a6a40));
  g.mb.gable(-1.1, 1.1, -0.9, 0.9, 1.6, 0.5, 'x', M('metalRoof', 2, 2), WOOD(0xc8a070), 0.1, 0.05);
  for (let i = 0; i < 4; i++) g.mb.blob(-0.8 + g.rng.float() * 1.6, 0.18, 1.1 + g.rng.float() * 0.4, 0.12, 0.14, 0.16, P(i % 2 ? 0xffffff : 0xa05a2a), 0);
  g.mb.push().translate(1.4, 0, 1.0); signOnStakes(g, 'sat:yard:eggs', 0.7, 0.44, 0.3); g.mb.pop();
} });
add({ id: 'giantPumpkin', ctx: ['backYard', 'farm'], w: 2, d: 2, lvl: [1, 4], build: (g) => g.mb.blob(0, 0.7, 0, 0.95, 0.7, 0.9, P(0xff8a1a), 1, 0.08, 3) });
add({ id: 'kiddiePoolSlide', ctx: ['backYard'], w: 3, d: 3.6, lvl: [1, 3], build(g) {
  g.mb.cyl(0, 0.6, 1.2, 0, 0.3, 12, { ...M('pool', 2, 2), c: rgb(0x9adfff) }, M('pool', 2, 2));
  g.mb.push().translate(0, 0, -1.2).rotX(0.55); g.mb.box(-0.3, 0.3, 0.3, 0.4, -1.6, 0.4, M('plain', 2, 2, 0xffd23f, { ao: false })); g.mb.pop();
  g.mb.boxC(0, -2.2, 0.8, 0.8, 0, 1.4, M('plain', 2, 2, 0x3fd0ff, { ao: false }));
} });
add({ id: 'trampolineTree', ctx: ['backYard'], w: 5, d: 4, lvl: [1, 3], build(g) {
  // blown into the tree in the last storm, as is tradition
  g.mb.cyl(-0.8, 0, 0.18, 0, 3.4, 6, WOOD(0x5a3a1a)); g.mb.blob(-0.8, 4.2, 0, 1.6, 1.3, 1.6, mats.leaf(0x4a6a2a), 1);
  g.mb.push().translate(0.2, 3.2, 0).rotZ(0.7); g.mb.cyl(0, 0, 1.5, -0.04, 0.04, 12, P(0x1b1b1c)); g.mb.pop();
} });

// --- shop fronts and parking lots
add({ id: 'inflatableGorilla', ctx: ['shopFront', 'parking'], w: 4, d: 3, lvl: [1, 5], weight: 1.2, build: (g) => inflatable(g, [[0, 2.2, 0, 1.3, 1.9, 1.1, 0x2a2a2a], [0, 4.6, 0.2, 0.85, 0.8, 0.8, 0x2a2a2a], [0, 4.4, 0.85, 0.45, 0.35, 0.2, 0x6a5a4a], [-1.5, 3.2, 0.2, 0.4, 1.4, 0.4, 0x2a2a2a], [1.5, 3.8, 0.2, 0.4, 1.4, 0.4, 0x2a2a2a]]) });
add({ id: 'giantChicken', ctx: ['shopFront'], w: 2.6, d: 2.6, lvl: [1, 5], build(g) {
  g.mb.boxC(0, 0, 1.2, 1.2, 0, 1, M('brickTan', 2, 2)); inflatable(g, [[0, 2.4, 0, 1.0, 1.1, 1.1, 0xffffff], [0, 3.8, 0.5, 0.55, 0.6, 0.55, 0xffffff], [0, 4.5, 0.5, 0.14, 0.25, 0.3, 0xd01818], [0, 3.7, 1.05, 0.14, 0.1, 0.25, 0xffc21a]]);
  g.mb.decal('+z', 0, 0.55, 0.61, 1.1, 0.8, S('sat:decal:chickenHut'));
} });
add({ id: 'dinoStatue', ctx: ['shopFront', 'parking'], w: 7, d: 2.4, lvl: [2, 5], build(g) {
  const c = P(0x4a8a3a);
  g.mb.blob(0, 2.2, 0, 1.6, 1.0, 0.8, c, 0); g.mb.blob(1.7, 3.6, 0, 0.35, 1.2, 0.35, c, 0); g.mb.blob(2.1, 4.7, 0, 0.6, 0.35, 0.35, c, 0); g.mb.blob(-2.2, 1.6, 0, 1.2, 0.35, 0.3, c, 0);
  for (const [x, z] of [[-0.6, -0.4], [0.6, -0.4], [-0.6, 0.4], [0.6, 0.4]] as [number, number][]) g.mb.cyl(x, z, 0.25, 0, 1.6, 6, c);
  g.mb.push().translate(0, 0, 1.3); postSign(g, 'sat:decal:dinoWorld', 1.4, 1, 0.6); g.mb.pop();
} });
add({ id: 'mufflerMan', ctx: ['shopFront', 'parking'], w: 3.8, d: 2, lvl: [1, 5], build(g) {
  const { mb } = g;
  for (const dx of [-0.5, 0.5]) mb.boxC(dx, 0, 0.5, 0.6, 0, 3.2, P(0x2a3a6a));
  mb.boxC(0, 0, 1.8, 1.0, 3.2, 2.6, P(0xffffff)); mb.blob(0, 6.4, 0, 0.55, 0.65, 0.55, P(0xd9a57a), 0); mb.boxC(0, 0, 1.2, 1.2, 6.9, 0.2, P(0xd01818));
  mb.push().translate(1.0, 5.4, 0.4).rotX(-0.9); mb.boxC(0, 0, 0.4, 0.4, 0, 1.8, P(0xd9a57a)); mb.pop();
  mb.push().translate(-1.0, 5.4, 0.4).rotX(-0.9); mb.boxC(0, 0, 0.4, 0.4, 0, 1.8, P(0xd9a57a)); mb.pop();
  mb.push().translate(0, 4.2, 1.6).rotZ(Math.PI / 2); mb.cyl(0, 0, 0.18, -1.8, 1.8, 8, METAL(0x9a9a9a)); mb.pop(); // the muffler / the hot dog / the slop
} });
add({ id: 'signSpinner', ctx: ['curb', 'shopFront'], w: 2.4, d: 0.8, lvl: [1, 4], build(g) {
  person(g, 0, 0, pick(g, [0xff3b3b, 0xffd23f, 0x39ff7a]));
  g.mb.push().translate(0.4, 1.4, 0.1).rotZ(0.6); g.mb.box(-0.8, 0.8, -0.2, 0.2, -0.02, 0.02, { f: S('sat:banner:' + pick(g, ['gold', 'noCredit', 'tax', 'wings'])), b: P(0xffd23f) }); g.mb.pop();
} });
add({ id: 'libertyWaver', ctx: ['curb', 'shopFront'], w: 1, d: 0.8, lvl: [1, 4], build(g) {
  person(g, 0, 0, 0x6ac0a0, 1.8); g.mb.boxC(0.28, 0, 0.08, 0.08, 1.4, 0.9, P(0x6ac0a0)); g.mb.cone(0.28, 0, 0.1, 2.3, 0.25, 5, P(0xffc21a));
  g.mb.cone(0, 0, 0.2, 1.72, 0.22, 7, P(0x6ac0a0)); emit(g, 'fire', 0.28, 2.55, 0);
} });
add({ id: 'cartsAbandoned', ctx: ['parking'], w: 6, d: 6, lvl: [1, 5], weight: 1.3, build(g) {
  for (let i = 0; i < 3 + Math.floor(g.rng.float() * 4); i++) {
    g.mb.push().translate((g.rng.float() - 0.5) * 5, 0, (g.rng.float() - 0.5) * 5).rotY(g.rng.float() * 6.28);
    if (g.rng.chance(0.2)) g.mb.rotZ(1.4); // one's on its side
    g.mb.box(-0.3, 0.3, 0.35, 0.95, -0.45, 0.45, { side: M('chainlink', 1, 1, 0xb8bcc0), top: null });
    g.mb.pop();
  }
} });
add({ id: 'foodTruck', ctx: ['parking', 'shopFront'], w: 2.6, d: 6.5, lvl: [2, 5], build(g) {
  const c = pick(g, LOUD);
  g.mb.box(-1.1, 1.1, 0.5, 3.1, -3, 3, { side: M('plain', 2, 2, c, { ao: false }), top: P(0xe8e8e8) });
  g.mb.decal('+x', 0.5, 1.9, 1.11, 3, 1.0, M('glassPlain', 1, 1)); g.mb.box(1.1, 1.6, 1.6, 1.7, -1.6, 1.4, P(0x9a9a9a));
  g.mb.decal('+x', 0.5, 2.7, 1.12, 3.8, 0.7, S('sat:banner:' + pick(g, ['bbq', 'wings', 'buffet'])));
  for (const z of [-2, 2]) { wheel(g, -1.05, 0.45, z, 0.45, 0.3); wheel(g, 1.05, 0.45, z, 0.45, 0.3); }
  emit(g, 'smoke', 0, 3.3, -2.4);
} });
add({ id: 'fireworksTent', ctx: ['parking'], w: 7, d: 5, lvl: [1, 4], build(g) {
  for (const [x, z] of [[-3.2, -2.2], [3.2, -2.2], [-3.2, 2.2], [3.2, 2.2]] as [number, number][]) g.mb.boxC(x, z, 0.1, 0.1, 0, 2.4, METAL(0xe8e8e8));
  g.mb.gable(-3.4, 3.4, -2.4, 2.4, 2.4, 1.2, 'x', M('plain', 2, 2, 0xd01818), M('plain', 2, 2, 0xffffff), 0.1, 0.05);
  for (let i = 0; i < 5; i++) g.mb.box(-3 + i * 1.3, -2 + i * 1.3, 0, 0.9, -1.8, 1.4, { side: P(pick(g, LOUD)), top: P(0x6a4a2a) });
  g.mb.decal('+z', 0, 2.2, 2.45, 5.5, 1.2, S('sat:banner:fireworks'));
} });
add({ id: 'mattressDisplay', ctx: ['shopFront'], w: 3, d: 2.4, lvl: [1, 4], build(g) {
  for (let i = 0; i < 4; i++) g.mb.box(-1.4, 1.4, i * 0.3, i * 0.3 + 0.28, -1 + i * 0.05, 1 - i * 0.05, P(i % 2 ? 0xf2f2ee : 0xdfe6f2));
} });
add({ id: 'rockingChairs', ctx: ['shopFront'], w: 6, d: 1, lvl: [1, 4], build(g) {
  for (let i = 0; i < 5; i++) { const x = -2.4 + i * 1.2; const w = WOOD(0x6a4a2a); g.mb.box(x - 0.3, x + 0.3, 0.42, 0.5, -0.3, 0.3, w); g.mb.push().translate(x, 0, -0.28).rotX(-0.2); g.mb.box(-0.3, 0.3, 0.5, 1.2, -0.03, 0.03, w); g.mb.pop(); g.mb.box(x - 0.3, x + 0.3, 0, 0.06, -0.4, 0.45, w); }
} });
add({ id: 'dvdKiosk', ctx: ['shopFront'], w: 1.4, d: 0.8, lvl: [1, 4], build: (g) => g.mb.box(-0.65, 0.65, 0, 2.1, -0.35, 0.35, { side: P(0xd01818), f: M('vending', 1.3, 2.1) }) });
add({ id: 'balloonArch', ctx: ['parking'], w: 8, d: 1.2, lvl: [2, 5], build(g) {
  for (let i = 0; i <= 18; i++) { const a = (i / 18) * Math.PI, x = -3.8 * Math.cos(a), y = 0.4 + 3.6 * Math.sin(a); g.mb.blob(x, y, 0, 0.32, 0.36, 0.32, M('plain', 2, 2, [0xd01818, 0xffffff, 0x1d3a8a][i % 3], { ao: false }), 0); }
} });
add({ id: 'carOnRamp', ctx: ['parking'], w: 3, d: 6, lvl: [2, 5], build(g) {
  g.mb.poly([[-1.3, 0.02, 2.8], [1.3, 0.02, 2.8], [1.3, 1.6, -2.4], [-1.3, 1.6, -2.4]], METAL(0x7a7e82));
  g.mb.push().translate(0, 0.9, 0.2).rotX(-0.3); g.mb.box(-0.95, 0.95, 0.3, 1.1, -2.2, 2.2, P(0xd01818)); g.mb.box(-0.85, 0.85, 1.1, 1.6, -1.1, 0.9, M('carWin', 2, 1)); g.mb.pop();
  g.mb.decal('+z', 0, 0.7, 2.9, 1.4, 0.4, S('sat:banner:apr'));
} });
add({ id: 'priceWindshields', ctx: ['parking'], w: 9, d: 5, lvl: [1, 4], build(g) {
  for (let i = 0; i < 4; i++) {
    const x = -3.6 + i * 2.4;
    g.mb.box(x - 0.95, x + 0.95, 0.3, 1.1, -2.2, 2.2, P(pick(g, [0x1a1a1c, 0xf2f2ee, 0x7a1d1d, 0x2a4a6a, 0xc9c1a8])));
    g.mb.box(x - 0.85, x + 0.85, 1.1, 1.55, -1.1, 0.9, M('carWin', 2, 1));
    g.mb.decal('+z', x, 1.35, 0.95, 1.2, 0.35, S('sat:yard:' + pick(g, ['cash4cars', 'reduced', 'weBuy'])));
  }
} });
add({ id: 'evChargersIced', ctx: ['parking'], w: 6, d: 6, lvl: [2, 5], build(g) {
  for (let i = 0; i < 3; i++) {
    const x = -2 + i * 2;
    g.mb.box(x - 0.2, x + 0.2, 0, 1.6, -2.8, -2.5, { side: P(0x2a6fb0), top: P(0xe8e8e8) });
    // a lifted truck parked in every charging spot
    for (const [dx, dz] of [[-0.8, 1.2], [0.8, 1.2], [-0.8, -1.2], [0.8, -1.2]] as [number, number][]) wheel(g, x + dx, 0.55, dz, 0.55, 0.4);
    g.mb.box(x - 0.9, x + 0.9, 0.9, 1.8, -2.3, 2.3, P(pick(g, [0x1a1a1c, 0xf2f2ee, 0x7a1d1d])));
  }
} });
add({ id: 'dumpsterFire', ctx: ['parking', 'industrial', 'apartment'], w: 2.4, d: 1.8, lvl: [1, 5], weight: 1.3, build(g) {
  g.mb.box(-1.1, 1.1, 0, 1.4, -0.8, 0.8, { side: S('dumpster'), top: P(0x2a2a2a) });
  emit(g, 'fire', 0, 1.6, 0); emit(g, 'smoke', 0, 2.4, 0);
} });
add({ id: 'bitcoinAtm', ctx: ['shopFront'], w: 0.8, d: 0.6, lvl: [2, 5], build(g) {
  g.mb.box(-0.35, 0.35, 0, 1.9, -0.25, 0.25, { side: P(0x111111), f: S('sat:neon:atm') });
} });
add({ id: 'payphone', ctx: ['shopFront', 'curb'], w: 0.8, d: 0.6, lvl: [1, 3], build(g) {
  g.mb.boxC(0, 0, 0.12, 0.12, 0, 1.2, METAL(0x9a9a9a)); g.mb.box(-0.3, 0.3, 1.2, 2.0, -0.2, 0.2, { side: METAL(0xc8c8c8), f: P(0x2a2a2a) });
} });
add({ id: 'cartCorral', ctx: ['parking'], w: 2, d: 6, lvl: [2, 5], build(g) {
  g.mb.box(-0.9, 0.9, 0, 1.1, -2.8, 2.8, { side: M('chainlink', 1, 1, 0xb8bcc0), top: null });
  for (let i = 0; i < 9; i++) g.mb.box(-0.35, 0.35, 0.3, 1.0, -2.6 + i * 0.4, -2.3 + i * 0.4, { side: M('chainlink', 1, 1, 0xb8bcc0), top: null });
  for (let i = 0; i < 4; i++) g.mb.box(-0.35 + i * 0.3, 0.35 + i * 0.3, 0.3, 1.0, 2.9 + i * 0.5, 3.2 + i * 0.5, { side: M('chainlink', 1, 1, 0xb8bcc0), top: null }); // overflowing
} });
add({ id: 'churchCross', ctx: ['shopFront', 'parking'], w: 3, d: 1, lvl: [2, 5], build(g) {
  const w = P(0xffffff); g.mb.boxC(0, 0, 0.5, 0.5, 0, 9, w); g.mb.box(-1.8, 1.8, 6.2, 6.8, -0.25, 0.25, w);
} });
add({ id: 'carWashArch', ctx: ['parking'], w: 4.4, d: 2, lvl: [2, 4], build(g) {
  for (const dx of [-2, 2]) g.mb.boxC(dx, 0, 0.3, 1.2, 0, 3.4, P(0x2a6fb0)); g.mb.box(-2.15, 2.15, 3.4, 3.8, -0.6, 0.6, P(0xffd23f));
  for (const dx of [-1, 1]) g.mb.cyl(dx, 0, 0.4, 0.2, 3.3, 8, M('plain', 2, 2, pick(g, [0xff3b3b, 0x3fd0ff]), { ao: false }));
  emit(g, 'steam', 0, 2, 0);
} });
add({ id: 'vapeCloud', ctx: ['shopFront'], w: 1, d: 1, lvl: [1, 5], build(g) { emit(g, 'smoke', 0, 1.8, 0); g.mb.cyl(0, 0, 0.25, 0, 0.9, 8, P(0x2a2a2a)); } });

// --- industry
add({ id: 'daysSince', ctx: ['industrial'], w: 2.4, d: 0.4, lvl: [1, 5], weight: 1.4, build: (g) => postSign(g, 'sat:decal:daysSince', 2.2, 1.65, 0.6, 2) });
add({ id: 'toxicBarrels', ctx: ['industrial'], w: 3, d: 2.4, lvl: [1, 5], weight: 1.3, build(g) {
  for (let i = 0; i < 7; i++) { const x = -1.2 + (i % 4) * 0.8, z = -0.6 + Math.floor(i / 4) * 0.8; g.mb.cyl(x, z, 0.3, 0, 0.9, 8, { ...S('sat:decal:toxic'), c: WHITE }); }
  g.mb.flat(-1.4, 1.4, 0.8, 1.2, 0.02, M('pool', 2, 2, 0x5aff5a)); // the puddle
  g.mb.push().translate(1.2, 0, 1.0); signOnStakes(g, 'sat:decal:toxic', 0.8, 0.6, 0.4); g.mb.pop();
} });
add({ id: 'palletMountain', ctx: ['industrial'], w: 3.4, d: 2.6, lvl: [1, 5], build(g) {
  for (let s = 0; s < 3; s++) for (let i = 0; i < 6 + Math.floor(g.rng.float() * 6); i++) g.mb.box(-1.4 + s * 1.2, -0.4 + s * 1.2, i * 0.15, i * 0.15 + 0.13, -1.1, 1.1, WOOD(0xc8a070));
} });
add({ id: 'forklift', ctx: ['industrial'], w: 1.4, d: 2.8, lvl: [1, 5], build(g) {
  g.mb.box(-0.6, 0.6, 0.3, 1.3, -1.0, 0.6, P(0xffc21a)); g.mb.box(-0.6, 0.6, 1.3, 2.3, -1.0, 0.0, { side: M('chainlink', 1, 1, 0x3a3a3a), top: P(0x2a2a2a) });
  for (const dx of [-0.4, 0.4]) { g.mb.boxC(dx, 0.7, 0.08, 0.08, 0, 2.8, METAL(0x3a3a3a)); g.mb.box(dx - 0.06, dx + 0.06, 0.1, 0.16, 0.75, 1.8, METAL(0x3a3a3a)); }
  wheel(g, -0.6, 0.3, 0.3, 0.3, 0.2); wheel(g, 0.6, 0.3, 0.3, 0.3, 0.2); wheel(g, -0.6, 0.25, -0.8, 0.25, 0.2); wheel(g, 0.6, 0.25, -0.8, 0.25, 0.2);
} });
add({ id: 'containerStack', ctx: ['industrial'], w: 6.4, d: 5, lvl: [2, 5], build(g) {
  for (let i = 0; i < 4; i++) { const y = i < 2 ? 0 : 2.6, z = i % 2 ? -1.2 : 1.2; g.mb.box(-3.05, 3.05, y, y + 2.6, z - 1.2, z + 1.2, M('corrugated', 2, 2, pick(g, [0xb3151d, 0x1d3a8a, 0x2a6a3a, 0xff7a1a, 0x8a8e92]))); }
} });
add({ id: 'tanker', ctx: ['industrial', 'parking'], w: 2.6, d: 12, lvl: [2, 5], build(g) {
  g.mb.box(-1.2, 1.2, 0.6, 3.2, 3.8, 6, { side: P(pick(g, [0xf2f2ee, 0xb3151d, 0x1d3a8a])), top: P(0xd8d8d8) });
  g.mb.push().translate(0, 2.0, -1.4).rotX(Math.PI / 2); g.mb.cyl(0, 0, 1.2, -4.6, 4.6, 12, METAL(0xd8dcdf)); g.mb.pop();
  for (const z of [-4.6, -3.4, 4.8]) { wheel(g, -1.05, 0.5, z, 0.5, 0.4); wheel(g, 1.05, 0.5, z, 0.5, 0.4); }
} });
add({ id: 'flareStack', ctx: ['industrial'], w: 1.4, d: 1.4, lvl: [3, 5], build(g) { g.mb.cyl(0, 0, 0.35, 0, 16, 8, METAL(0x9a9ea2)); emit(g, 'fire', 0, 16.6, 0); emit(g, 'smoke', 0, 18, 0); } });
add({ id: 'happyStack', ctx: ['industrial'], w: 3, d: 3, lvl: [2, 5], build(g) {
  g.mb.cyl(0, 0, 1.3, 0, 18, 12, M('concrete', 2, 2, 0xb8b8b0)); g.mb.decal('+z', 0, 12, 1.32, 2.2, 2.2, S('sat:decal:happyStack'));
  emit(g, 'smoke', 0, 18.5, 0);
} });
add({ id: 'safetyThird', ctx: ['industrial'], w: 1.4, d: 0.3, lvl: [1, 5], build: (g) => postSign(g, 'sat:decal:safetyThird', 1.2, 0.9, 1.2) });
add({ id: 'tireFire', ctx: ['industrial'], w: 4, d: 4, lvl: [1, 3], build(g) {
  for (let i = 0; i < 12; i++) g.mb.cyl((g.rng.float() - 0.5) * 3, (g.rng.float() - 0.5) * 3, 0.5, 0, 0.25 + g.rng.float() * 0.6, 8, P(0x1b1b1c));
  emit(g, 'fire', 0, 1, 0); emit(g, 'smoke', 0, 2.5, 0);
} });
add({ id: 'scrapCrane', ctx: ['industrial'], w: 5, d: 5, lvl: [1, 4], build(g) {
  g.mb.blob(0, 1, 0, 2.2, 1.1, 2, M('rust', 2, 2), 1, 0.3, 7);
  g.mb.boxC(2, -2, 0.5, 0.5, 0, 9, M('plain', 2, 2, 0xffc21a)); g.mb.box(-2, 2.2, 9, 9.5, -2.2, -1.8, M('plain', 2, 2, 0xffc21a));
  g.mb.boxC(-1.6, -2, 0.03, 0.03, 4.5, 4.5, P(0x2a2a2a)); g.mb.cyl(-1.6, -2, 0.8, 4.1, 4.5, 10, P(0x3a3a3a));
} });
add({ id: 'securityBooth', ctx: ['industrial', 'office'], w: 2, d: 2, lvl: [2, 5], build(g) {
  g.mb.box(-0.9, 0.9, 0, 2.6, -0.9, 0.9, { side: M('glassPlain', 1, 1), top: P(0xe8e8e8) }); g.mb.box(-1.0, 1.0, 2.6, 2.8, -1.0, 1.0, P(0xe8e8e8));
  g.mb.push().translate(1.6, 0, 0.6); postSign(g, 'sat:decal:nothingToSee', 1.2, 0.9, 1.0); g.mb.pop();
} });
add({ id: 'drumPuddle', ctx: ['industrial'], w: 2, d: 2, lvl: [1, 4], build(g) {
  g.mb.push().rotZ(Math.PI / 2); g.mb.cyl(0.3, 0, 0.3, -0.45, 0.45, 8, M('rust', 1, 1)); g.mb.pop();
  g.mb.flat(-0.9, 0.9, 0.2, 0.95, 0.02, M('pool', 2, 2, 0x8aff3a));
} });

// --- apartments & offices
add({ id: 'packageLockers', ctx: ['apartment'], w: 3, d: 1.4, lvl: [2, 5], build(g) {
  g.mb.box(-1.4, 1.4, 0, 2.2, -0.35, 0.35, { side: METAL(0xc8ccd0), f: M('garage1', 1.4, 1.1, 0xd8d8d8) });
  for (let i = 0; i < 8; i++) g.mb.box(-1.3 + i * 0.35, -1.0 + i * 0.35, 0, 0.3 + (i % 3) * 0.15, 0.4, 0.85, { side: S('sat:decal:packages'), top: P(0xc69a5e) });
} });
add({ id: 'poopStation', ctx: ['apartment', 'office', 'curb'], w: 0.8, d: 0.4, lvl: [2, 5], build: (g) => postSign(g, 'sat:decal:pickItUp', 0.6, 0.45, 0.8) });
add({ id: 'scooterHeap', ctx: ['apartment', 'office', 'curb', 'shopFront'], w: 2.4, d: 1.6, lvl: [2, 5], build(g) {
  for (let i = 0; i < 4 + Math.floor(g.rng.float() * 4); i++) {
    g.mb.push().translate((g.rng.float() - 0.5) * 2, 0.05, (g.rng.float() - 0.5) * 1.2).rotY(g.rng.float() * 6.28).rotZ(1.45);
    g.mb.box(-0.06, 0.06, -0.3, 0.3, -0.5, 0.5, P(pick(g, [0x39c24a, 0x111111, 0xff7a1a]))); g.mb.boxC(0, 0.45, 0.04, 0.04, 0, 1.0, METAL(0x3a3a3a));
    g.mb.pop();
  }
} });
add({ id: 'tinyPool', ctx: ['apartment'], w: 3, d: 2, lvl: [3, 5], build(g) {
  g.mb.box(-1.2, 1.2, 0, 0.3, -0.8, 0.8, { side: M('concretePad', 2, 2), top: M('pool', 2, 2) });
  g.mb.push().translate(1.8, 0, 0); postSign(g, 'sat:decal:luxuryPool', 0.8, 0.6, 0.8); g.mb.pop();
} });
add({ id: 'pingPong', ctx: ['office'], w: 2, d: 3.4, lvl: [2, 5], build(g) {
  g.mb.box(-0.76, 0.76, 0.72, 0.78, -1.37, 1.37, P(0x1d5a3a)); g.mb.box(-0.8, 0.8, 0.78, 0.93, -0.01, 0.01, P(0xffffff));
  for (const dx of [-0.6, 0.6]) for (const dz of [-1.1, 1.1]) g.mb.boxC(dx, dz, 0.05, 0.05, 0, 0.72, METAL(0x3a3a3a));
} });
add({ id: 'synergySculpture', ctx: ['office'], w: 3, d: 3, lvl: [3, 5], build(g) {
  g.mb.boxC(0, 0, 2, 2, 0, 0.6, M('stone', 2, 2)); g.mb.push().translate(0, 2.4, 0).rotZ(0.5).rotX(0.4);
  g.mb.blob(0, 0, 0, 0.9, 1.6, 0.5, METAL(0xd8a040), 1, 0.35, 11); g.mb.pop();
  g.mb.push().translate(0, 0, 1.3); signOnStakes(g, 'sat:decal:innovation', 0.9, 0.6, 0.35); g.mb.pop();
} });
add({ id: 'ceoParking', ctx: ['office', 'parking'], w: 1, d: 0.3, lvl: [3, 5], build: (g) => postSign(g, 'sat:decal:ceoParking', 0.8, 0.6, 1.2) });
add({ id: 'smokersCorner', ctx: ['office', 'apartment', 'shopFront'], w: 2.4, d: 1, lvl: [1, 5], build(g) {
  g.mb.box(-1.0, 1.0, 0.42, 0.5, -0.25, 0.25, WOOD(0x6a4a2a)); for (const dx of [-0.8, 0.8]) g.mb.boxC(dx, 0, 0.1, 0.4, 0, 0.42, METAL(0x3a3a3a));
  g.mb.cyl(1.4, 0, 0.18, 0, 0.9, 8, METAL(0x9a9a9a)); emit(g, 'cigarette', 1.4, 1.0, 0);
} });
add({ id: 'helipad', ctx: ['roof'], w: 8, d: 8, lvl: [4, 5], build(g) {
  g.mb.cyl(0, 0, 3.8, 0, 0.15, 16, P(0x3a3a3c)); g.mb.decal('+z', 0, 0.15, 0, 0.1, 0.1, P(0x3a3a3c));
  g.mb.box(-0.3, 0.3, 0.16, 0.18, -1.4, 1.4, P(0xffd23f)); g.mb.box(1.2, 1.8, 0.16, 0.18, -1.4, 1.4, P(0xffd23f)); g.mb.box(-1.8, -1.2, 0.16, 0.18, -1.4, 1.4, P(0xffd23f));
} });
add({ id: 'roofBillboardJesus', ctx: ['roof'], w: 6, d: 1, lvl: [2, 5], build(g) {
  for (const dx of [-2.4, 2.4]) g.mb.boxC(dx, 0, 0.2, 0.2, 0, 2.2, METAL(0x6a6a6a));
  const s = S('sat:marquee:jesusSaves'); g.mb.box(-2.8, 2.8, 2.2, 4.2, -0.1, 0.1, { f: s, b: s, l: P(0x1d1d1f), r: P(0x1d1d1f), top: P(0x1d1d1f) });
} });

// --- farm
add({ id: 'votePaintedHay', ctx: ['farm'], w: 3, d: 1.6, lvl: [1, 5], build(g) {
  for (const dx of [-0.9, 0.9]) { g.mb.push().translate(dx, 0.75, 0).rotZ(Math.PI / 2); g.mb.cyl(0, 0, 0.75, -0.6, 0.6, 10, P(0xd8c070)); g.mb.pop(); }
  g.mb.decal('+z', 0, 0.9, 0.62, 2.8, 0.9, S('sat:yard:chad'));
} });
add({ id: 'tractor', ctx: ['farm', 'backYard'], w: 2.4, d: 3.6, lvl: [1, 5], build(g) {
  wheel(g, -1.0, 0.8, -0.8, 0.8, 0.45); wheel(g, 1.0, 0.8, -0.8, 0.8, 0.45); wheel(g, -0.9, 0.45, 1.2, 0.45, 0.3); wheel(g, 0.9, 0.45, 1.2, 0.45, 0.3);
  g.mb.box(-0.55, 0.55, 0.8, 1.6, -0.6, 1.8, P(0x2a7a2a)); g.mb.box(-0.6, 0.6, 1.6, 2.6, -1.2, 0, { side: M('glassPlain', 1, 1), top: P(0xffd23f) });
  g.mb.boxC(0.3, 1.4, 0.12, 0.12, 1.6, 0.8, P(0x1b1b1c));
} });
add({ id: 'siloFeed', ctx: ['farm'], w: 4, d: 4, lvl: [1, 5], build(g) {
  g.mb.cyl(0, 0, 1.8, 0, 11, 12, METAL(0xd8d8d0)); g.mb.cone(0, 0, 1.9, 11, 1.4, 12, METAL(0xb8b8b0));
  g.mb.decal('+z', 0, 7, 1.82, 2.4, 1.8, S('sat:decal:slopFeed'));
} });
add({ id: 'scarecrow', ctx: ['farm', 'backYard'], w: 1.6, d: 0.6, lvl: [1, 5], build(g) {
  g.mb.boxC(0, 0, 0.1, 0.1, 0, 2.2, WOOD(0x6a4a2a)); g.mb.box(-0.8, 0.8, 1.6, 1.7, -0.05, 0.05, WOOD(0x6a4a2a));
  g.mb.box(-0.3, 0.3, 1.0, 1.75, -0.18, 0.18, P(0x3a5a8a)); g.mb.blob(0, 2.0, 0, 0.2, 0.22, 0.2, P(0xd8c070), 0); g.mb.cyl(0, 0, 0.22, 2.2, 2.34, 8, P(0xc01818)); // the red cap
  g.mb.push().translate(0.8, 0, 0.4); signOnStakes(g, 'sat:decal:makeSlop', 0.8, 0.6, 0.3); g.mb.pop();
} });

// ------------------------------------------------------------------ placement
function overlaps(a: Area, b: Area) {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0;
}

type Occ = GenCtx & { satOcc?: Area[]; satUsed?: Set<string> };

/** Mark part of the lot as taken (house, driveway, pool, cars) so props keep off it. */
export function occupy(g: GenCtx, x0: number, x1: number, z0: number, z1: number) {
  ((g as Occ).satOcc ??= []).push({ x0: Math.min(x0, x1), x1: Math.max(x0, x1), z0: Math.min(z0, z1), z1: Math.max(z0, z1) });
}

/** Is this rect free of everything occupied so far? */
export function isFree(g: GenCtx, a: Area) {
  return !((g as Occ).satOcc ?? []).some((b) => overlaps(a, b));
}

/**
 * Scatter up to n props for a context inside an area (lot-local metres),
 * avoiding the given rects and props already placed on this lot. yaw faces
 * the props (0 = toward the street). Returns how many went down.
 */
export function decorate(g: GenCtx, ctx: SatCtx, area: Area, n: number, avoid: Area[] = [], yaw = 0): number {
  const o = g as Occ;
  const occ = (o.satOcc ??= []), used = (o.satUsed ??= new Set());
  const L = g.spec.level;
  const pool = PROPS.filter((p) => p.ctx.includes(ctx) && (!p.lvl || (L >= p.lvl[0] && L <= p.lvl[1])));
  if (!pool.length || n <= 0) return 0;
  // everything already standing on the lot (buildings, cars, trees, fences) as a 0.5 m grid
  const C = 0.5, gx0 = -g.W / 2, gz0 = -g.D / 2, nx = Math.ceil(g.W / C), nz = Math.ceil(g.D / C);
  const grid = g.mb.identity ? g.mb.footprint(0.22, C, gx0, gz0, nx, nz) : null;
  const gridFree = (b: Area) => {
    if (!grid) return true;
    const i0 = Math.max(0, Math.floor((b.x0 - gx0) / C)), i1 = Math.min(nx - 1, Math.floor((b.x1 - gx0) / C));
    const j0 = Math.max(0, Math.floor((b.z0 - gz0) / C)), j1 = Math.min(nz - 1, Math.floor((b.z1 - gz0) / C));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (grid[j * nx + i]) return false;
    return true;
  };
  let placed = 0;
  for (let k = 0; k < n; k++) {
    // weighted pick, not repeating a prop on the same lot
    const cand = pool.filter((p) => !used.has(p.id));
    if (!cand.length) break;
    const tot = cand.reduce((a, p) => a + (p.weight ?? 1), 0);
    let r = g.rng.float() * tot, p = cand[0];
    for (const c of cand) { r -= c.weight ?? 1; if (r <= 0) { p = c; break; } }
    used.add(p.id);
    // a spot where it fits
    const sideways = Math.abs(Math.sin(yaw)) > 0.7;
    const hw = (sideways ? p.d : p.w) / 2 + 0.25, hd = (sideways ? p.w : p.d) / 2 + 0.25;
    if (area.x1 - area.x0 < hw * 2 || area.z1 - area.z0 < hd * 2) continue;
    for (let t = 0; t < 10; t++) {
      const x = area.x0 + hw + g.rng.float() * (area.x1 - area.x0 - hw * 2);
      const z = area.z0 + hd + g.rng.float() * (area.z1 - area.z0 - hd * 2);
      const box = { x0: x - hw, x1: x + hw, z0: z - hd, z1: z + hd };
      if (avoid.some((a) => overlaps(a, box)) || occ.some((a) => overlaps(a, box)) || !gridFree(box)) continue;
      occ.push(box);
      g.mb.push().translate(x, 0, z).rotY(yaw);
      p.build(g);
      g.mb.pop();
      placed++;
      break;
    }
  }
  return placed;
}

/**
 * Dress a whole lot of a non-house zone after its generator ran: the grid of
 * what's already built keeps props off buildings, cars and trees.
 */
export function satirePass(g: GenCtx) {
  const { W, D, rng } = g;
  const zone = g.spec.zone;
  const big = Math.max(1, Math.round((W * D) / 260));
  const front: Area = { x0: -W / 2 + 0.4, x1: W / 2 - 0.4, z0: -D * 0.05, z1: D / 2 - 1.6 };
  const all: Area = { x0: -W / 2 + 0.4, x1: W / 2 - 0.4, z0: -D / 2 + 0.4, z1: D / 2 - 1.6 };
  const curb: Area = { x0: -W / 2 + 0.4, x1: W / 2 - 0.4, z0: D / 2 - 1.5, z1: D / 2 - 0.15 };
  if (zone === 'comLow' || zone === 'comHigh') {
    decorate(g, 'curb', curb, rng.int(1, 2));
    decorate(g, 'shopFront', front, big + rng.int(1, 2));
    decorate(g, 'parking', front, big + rng.int(0, 2));
  } else if (zone === 'industry') {
    decorate(g, 'curb', curb, rng.int(0, 1));
    decorate(g, 'industrial', all, big + rng.int(2, 3));
  } else if (zone === 'resHigh') {
    decorate(g, 'curb', curb, rng.int(1, 2));
    decorate(g, 'apartment', all, big + rng.int(1, 2));
    decorate(g, 'parking', front, rng.int(0, 1));
  } else if (zone === 'office') {
    decorate(g, 'curb', curb, rng.int(0, 1));
    decorate(g, 'office', all, big + rng.int(1, 2));
    decorate(g, 'parking', front, rng.int(0, 1));
  }
}

/** how many distinct satire props exist (the catalog, for tests and the audit) */
export function satireCount() {
  return { props: PROPS.length, geometric: PROPS.filter((p) => !/^(yard|banner|marquee|road|aframe|neon):/.test(p.id)).length };
}
