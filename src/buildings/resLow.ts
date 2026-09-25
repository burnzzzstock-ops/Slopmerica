// resLow: single-wides and holler shacks -> ranch -> tract homes -> McMansions
// (garage-forward, too many gables, stone on the front only) -> mega-McMansions
// and modern farmhouses with pools.
import { FLOOR_PLANS, HOUSE_KIND } from '../art/names';
import { M, S, Mat, rgb, WHITE, mulRGB } from './mesh';
import {
  GenCtx, lotPad, patch, car, tree, shrub, fence, poolInground, poolAbove, trampoline, burnBarrel, smoker, flagpole, dish,
  boatTrailer, hoop, mailbox, porchSteps, acUnit, mats, picnicTable,
} from './props';

const SIDING = [0xe8e2d0, 0xd8d2c4, 0xc9c3b3, 0xb7c1c9, 0x9fb0a0, 0xe6d8a8, 0xc4b19a, 0xf2f0ea, 0xa9b8c7, 0x8f9a8a, 0xd9c3b0];
const TRACT = [0xd8d2c4, 0xcfc6b4, 0xc9c3b3, 0xbfb7a6, 0xd6cdb9, 0xb9b2a4];
// multiplied into the mid-gray shingle tile, so keep these light
const ROOF = [0xc8c4c0, 0xa89888, 0x9a9896, 0xb8a898, 0xaaa49e, 0xb0a090, 0x8e8a86];
const TRAILER = [0xf1efe8, 0xe8f0e0, 0xf0e6c8, 0xe0ecf2, 0xf2e2d8, 0xdad6c8];

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Front yard, back yard and usable house depth for a lot depth D. */
function setbacks(D: number, front = 0) {
  const fs = clamp(D * 0.28, 2.2, 7);
  const bs = clamp(D * 0.16, 0.8, 9);
  const hd = clamp(D - fs - bs - front, 4.2, 11);
  const gz = D / 2 - fs; // street-most face (garage / porch front)
  return { fs, bs, hd, gz, zf: gz - front };
}

function win(g: GenCtx, name: string, litP = 0.35) {
  return S(g.rng.chance(litP) ? name + 'Lit' : name);
}

/** Evenly spaced windows on the +Z face at depth z between x0..x1. */
function windowsZ(g: GenCtx, x0: number, x1: number, z: number, y: number, n: number, tile: string, w: number, h: number, back = false) {
  for (let i = 0; i < n; i++) {
    const x = x0 + ((i + 0.5) * (x1 - x0)) / n;
    g.mb.decal(back ? '-z' : '+z', x, y, z, w, h, win(g, tile));
  }
}
function windowsX(g: GenCtx, z0: number, z1: number, x: number, y: number, n: number, tile: string, w: number, h: number, neg: boolean) {
  for (let i = 0; i < n; i++) {
    const z = z0 + ((i + 0.5) * (z1 - z0)) / n;
    g.mb.decal(neg ? '-x' : '+x', z, y, x, w, h, win(g, tile));
  }
}

function driveway(g: GenCtx, x: number, w: number, zFrom: number, mat = mats.concrete()) {
  patch(g, x - w / 2, x + w / 2, zFrom, g.D / 2, mat, 0.1);
}

function yardTrees(g: GenCtx, n: number, zmin: number, zmax: number, avoidX: [number, number][] = []) {
  const { rng, W } = g;
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 6; k++) {
      const x = (rng.float() - 0.5) * (W - 2), z = zmin + rng.float() * (zmax - zmin);
      if (avoidX.some(([a, b]) => x > a - 1.5 && x < b + 1.5)) continue;
      tree(g, x, z, 0.6 + rng.float() * 0.5, rng.chance(0.25) ? 'cone' : 'round');
      break;
    }
  }
}

// ------------------------------------------------------------------ L1: trailers & shacks
function trailer(g: GenCtx) {
  const { mb, rng, W, D } = g;
  lotPad(g, rng.chance(0.6) ? M('lawnDry', 8, 8) : M('dirt', 8, 8));
  const wide = W >= 14 && rng.chance(0.5);
  const tw = wide ? 7.6 : 3.8;
  const len = Math.min(D - 4, wide ? 16 : 18, Math.max(7, D - 3));
  const along = len <= W - 3 && D >= tw + 6 && rng.chance(0.35); // parallel to the road
  const col = rgb(rng.pick(TRAILER));
  const wallM = M('trailer', 4, 3, col);
  const skirt = M('lattice', 4, 0.8);
  const roofM = M('metalRoof', 4, 4, 0xb8b8b2);
  const cx = along ? (rng.float() - 0.5) * (W - len - 2) : (rng.float() < 0.5 ? -1 : 1) * Math.max(0, (W - tw) / 2 - 1.2);
  const cz = along ? -D / 2 + tw / 2 + 2 + rng.float() * Math.max(0, D - tw - 6) : -0.5;
  mb.push().translate(cx, 0, cz);
  if (along) mb.rotY(Math.PI / 2);
  else if (cx > 0) mb.rotY(Math.PI); // keep the deck side away from the lot line
  const hx = tw / 2, hz = len / 2;
  mb.box(-hx, hx, 0, 0.6, -hz, hz, { side: skirt, top: null });
  mb.box(-hx, hx, 0.6, 3.3, -hz, hz, { side: wallM, top: null });
  mb.gable(-hx, hx, -hz, hz, 3.3, 0.35, 'z', roofM, wallM, 0.15, 0.12);
  // windows & door on the +X side (faces the yard) and ends
  const side = '+x';
  const nw = Math.max(2, Math.floor(len / 4));
  for (let i = 0; i < nw; i++) {
    const z = -hz + ((i + 0.5) * len) / nw;
    if (i === Math.floor(nw / 2)) {
      mb.decal(side, z, 0.6, hx, 0.9, 2.0, S('doorTrailer'));
      mb.box(hx, hx + 1.8, 0, 0.6, z - 1.1, z + 1.1, { side: M('deck', 4, 4), top: M('deck', 4, 4) });
    } else mb.decal(side, z, 1.6, hx, 1.3, 0.75, win(g, 'winTrailer', 0.4));
  }
  for (let i = 0; i < nw - 1; i++) mb.decal('-x', -hz + ((i + 0.7) * len) / nw, 1.6, -hx, 1.3, 0.75, win(g, 'winTrailer', 0.3));
  mb.decal('+z', 0, 1.7, hz, 1.3, 0.75, win(g, 'winTrailer', 0.4));
  if (rng.chance(0.6)) dish(g, hx - 0.6, 3.6, hz - 1.5, 0.8);
  acUnit(g, -hx - 0.6, -hz + 2);
  mb.pop();
  // yard junk
  const yardX = along ? cx : cx > 0 ? cx - tw / 2 - 3.5 : cx + tw / 2 + 3.5;
  const junkZ = D / 2 - 3;
  car(g, Math.max(-W / 2 + 2, Math.min(W / 2 - 2, yardX)), junkZ, rng.float() * 0.6 - 0.3, rng.chance(0.5) ? 'junk' : rng.pick(['pickup', 'lifted', 'sedan']));
  if (W >= 12 && rng.chance(0.6)) car(g, (rng.float() - 0.5) * (W - 6), -D / 2 + 3, rng.float() * 3, 'junk');
  if (rng.chance(0.55) && W >= 10) poolAbove(g, along ? (cx > 0 ? -W / 4 : W / 4) : yardX, -D / 4, 1.8 + rng.float() * 0.6);
  else if (rng.chance(0.5)) trampoline(g, yardX, -D / 4);
  burnBarrel(g, along ? cx + len / 2 - 1 : yardX + 1.5, -D / 2 + 1.6);
  if (rng.chance(0.4)) flagpole(g, W / 2 - 1, D / 2 - 1.2, 6, 1.8);
  if (rng.chance(0.5)) boatTrailer(g, -W / 2 + 1.6, 0, 0.1);
  const gx = Math.max(-W / 2 + 2, Math.min(W / 2 - 2, yardX));
  patch(g, gx - 1.6, gx + 1.6, D / 2 - 6, D / 2, mats.gravel(), 0.1);
  return HOUSE_KIND[1][wide ? 2 : 0];
}

function shack(g: GenCtx) {
  const { mb, rng, W, D } = g;
  lotPad(g, M('dirt', 8, 8));
  const w = Math.min(W - 2, 5 + rng.float() * 2), d = clamp(D - 5, 4, 6 + rng.float() * 2);
  const cz = -D / 2 + d / 2 + 1.5 + rng.float() * Math.max(0, D - d - 7);
  const cx = (rng.float() - 0.5) * Math.max(0, W - w - 2);
  const wood = M('wood', 4, 4, rgb(rng.pick([0xffffff, 0xd8ccb8, 0xb8c0b0])));
  mb.box(cx - w / 2, cx + w / 2, 0, 2.6, cz - d / 2, cz + d / 2, { side: wood, top: null });
  const roof = M('corrugatedRust', 4, 4);
  mb.gable(cx - w / 2, cx + w / 2, cz - d / 2, cz + d / 2, 2.6, 1.3, 'x', roof, wood, 0.4, 0.08);
  // porch
  const pz = cz + d / 2;
  mb.box(cx - w / 2, cx + w / 2, 0, 0.4, pz, pz + 1.8, { side: M('wood', 4, 4, 0x9a8a78), top: M('deck', 4, 4, 0xb0a090) });
  for (const px of [cx - w / 2 + 0.2, cx + w / 2 - 0.2]) mb.boxC(px, pz + 1.6, 0.15, 0.15, 0.4, 2.2, { side: M('wood', 4, 4), top: null });
  mb.poly([[cx - w / 2 - 0.2, 2.5, pz + 2.0], [cx + w / 2 + 0.2, 2.5, pz + 2.0], [cx + w / 2 + 0.2, 2.75, pz], [cx - w / 2 - 0.2, 2.75, pz]], roof);
  mb.decal('+z', cx - w / 4, 0.4, pz, 0.9, 2.0, S('doorFront', 0x9a8a78));
  mb.decal('+z', cx + w / 4, 1.1, pz, 0.9, 1.2, rng.chance(0.3) ? S('winBoard') : win(g, 'winHouse', 0.5));
  mb.decal('+x', cz, 1.1, cx + w / 2, 0.9, 1.2, win(g, 'winHouse', 0.3));
  // stovepipe
  const sx = cx + w / 4, sz = cz - d / 4;
  mb.cyl(sx, sz, 0.15, 3.0, 4.6, 6, M('plain', 2, 2, 0x333333));
  g.em.push({ kind: 'smoke', pos: [sx, 4.8, sz] });
  // yard: junk cars, woodpile, grill
  if (D >= 14 || W >= 14) car(g, cx + (cx > 0 ? -w / 2 - 3 : w / 2 + 3), D / 2 - 3.2, rng.float() * 1.2 - 0.6, 'junk');
  if (W >= 12) car(g, (rng.float() - 0.5) * (W - 6), -D / 2 + 2.5, rng.float() * 3, 'junk');
  if (W - w >= 3) mb.boxC(cx - w / 2 - 0.8, cz, 0.9, 2.4, 0, 1.0, { side: M('wood', 4, 4, 0x7a5a3a), top: M('wood', 4, 4, 0x6a4a2a) });
  if (rng.chance(0.5)) burnBarrel(g, cx + w / 2 + 1.5, cz - d / 2);
  if (W >= 14 && rng.chance(0.5)) poolAbove(g, cx + (cx > 0 ? -w / 2 - 3 : w / 2 + 3), -D / 2 + 3, 1.6);
  return HOUSE_KIND[1][1];
}

// ------------------------------------------------------------------ L2: ranch
function ranch(g: GenCtx) {
  const { mb, rng, W, D } = g;
  lotPad(g, M('lawn', 8, 8));
  const brick = rng.chance(0.55);
  const wallCol = brick ? WHITE : rgb(rng.pick(SIDING));
  const wall = brick ? M(rng.chance(0.6) ? 'brick' : 'brickTan', 2, 2) : M('siding', 4, 4, wallCol);
  const roof = M('shingles', 4, 4, rgb(rng.pick(ROOF)));
  const garage = W >= 12;
  const gw = garage ? (W >= 16 && rng.chance(0.5) ? 6.4 : 3.8) : 0;
  const hw = Math.min(W - 2 - gw, 9 + rng.float() * 5);
  const sb = setbacks(D);
  const hd = Math.min(sb.hd, 7.5 + rng.float() * 2);
  const zf = sb.zf;
  const zb = zf - hd;
  const flip = rng.chance(0.5); // garage on the left
  const left = -(hw + gw) / 2 + (rng.float() - 0.5) * Math.max(0, W - hw - gw - 2);
  const x0 = flip ? left + gw : left;
  const x1 = x0 + hw;
  const H = 2.8;
  mb.box(x0, x1, 0, H, zb, zf, { side: wall, top: null });
  if (rng.chance(0.6)) mb.hip(x0, x1, zb, zf, H, 1.6 + rng.float() * 0.6, roof, 0.5);
  else mb.gable(x0, x1, zb, zf, H, 1.8, 'x', roof, wall, 0.5);
  // garage / carport
  let gx = x1;
  if (garage) {
    const ga = flip ? x0 - gw : x1, gb = flip ? x0 : x1 + gw;
    gx = (ga + gb) / 2;
    if (rng.chance(0.25)) {
      // carport
      for (const px of [ga + 0.2, gb - 0.2]) for (const pz of [zb + 0.5, zf - 0.3]) mb.boxC(px, pz, 0.15, 0.15, 0, 2.5, { side: M('metal', 2, 2), top: null });
      mb.shed(ga, gb, zb, zf, 2.5, 0.3, M('metalRoof', 4, 4, 0xa8a8a2), null, 0.2);
      car(g, gx, (zb + zf) / 2, 0, rng.pick(['pickup', 'sedan', 'suv']));
    } else {
      mb.box(ga, gb, 0, 2.6, zb + 1, zf, { side: wall, top: null });
      mb.gable(ga, gb, zb + 1, zf, 2.6, 1.3, 'x', roof, wall, 0.4);
      mb.decal('+z', gx, 0, zf, gw - 1, 2.2, S(gw > 5 ? 'garage2' : 'garage1'));
      if (rng.chance(0.4)) hoop(g, gx + gw / 2 - 0.5, zf + 0.4);
    }
    driveway(g, gx, Math.min(gw, 5.5), zf);
    if (rng.chance(0.7)) car(g, gx, D / 2 - 2.8, Math.PI, rng.pick(['pickup', 'suv', 'sedan', 'lifted']));
  } else {
    // no room for a garage: gravel strip in the front yard
    const dx = Math.min(x1 + 1.6, W / 2 - 1.6);
    driveway(g, dx, 3, zf + 0.3, mats.gravel());
    car(g, dx, D / 2 - 3, Math.PI, rng.pick(['pickup', 'sedan']));
  }
  // front: picture window, door, windows
  const doorX = x0 + hw * (0.38 + rng.float() * 0.2);
  mb.decal('+z', doorX, 0, zf, 1.0, 2.1, S(rng.pick(['doorFront', 'doorBlue', 'doorBlack'])));
  porchSteps(g, doorX, zf, 1.6, 0.3);
  mb.decal('+z', x0 + hw * 0.18, 0.8, zf, 2.6, 1.5, win(g, 'winPicture', 0.4));
  windowsZ(g, doorX + 1.2, x1 - 0.4, zf, 1.0, Math.max(1, Math.floor((x1 - doorX) / 3)), rng.chance(0.5) ? 'winShutter' : 'winHouse', 1.3, 1.3);
  windowsX(g, zb, zf, x0, 1.0, 2, 'winHouse', 1.0, 1.3, true);
  windowsZ(g, x0, x1, zb, 1.0, 3, 'winHouse', 1.0, 1.3, true);
  // yard
  for (let i = 0; i < 3; i++) shrub(g, x0 + 0.8 + i * 1.4, zf + 0.9, 0.8);
  mailbox(g, W / 2 - 0.8, D / 2 - 0.6);
  yardTrees(g, rng.int(0, 2), zf + 2, D / 2 - 2, [[gx - 3, gx + 3]]);
  if (rng.chance(0.5)) acUnit(g, x1 - 1, zb - 0.8);
  if (rng.chance(0.3)) smoker(g, x0 + 1.5, zb - 2);
  if (D >= 16) {
    fence(g, -W / 2 + 0.3, zb - 0.5, -W / 2 + 0.3, -D / 2 + 0.3, 1.2, 'fence');
    fence(g, W / 2 - 0.3, -D / 2 + 0.3, W / 2 - 0.3, zb - 0.5, 1.2, 'fence');
    fence(g, -W / 2 + 0.3, -D / 2 + 0.3, W / 2 - 0.3, -D / 2 + 0.3, 1.2, 'fence');
  }
  return rng.pick(HOUSE_KIND[2]);
}

// ------------------------------------------------------------------ L3: tract home
function tract(g: GenCtx) {
  const { mb, rng, W, D } = g;
  lotPad(g, M('lawn', 8, 8));
  const plan = rng.int(0, 2);
  const wall = M('siding', 4, 4, rgb(rng.pick(TRACT)));
  const trim = M('plain', 2, 2, 0xf2f0ea);
  const roof = M('shingles', 4, 4, rgb(rng.pick([0xb0aaa4, 0xa09a94, 0xbab4ae])));
  const gw = W >= 12 ? 6.0 : Math.max(3.2, W - 4.5);
  const hw = Math.min(W - 1.6, gw + 3 + rng.float() * 2 + (W >= 16 ? 2 : 0));
  const prot = D >= 16 ? 2.6 : 1.2;
  const sb = setbacks(D, prot);
  const hd = Math.min(sb.hd, 9);
  const zf = sb.zf;
  const zb = zf - hd;
  const x0 = -hw / 2, x1 = hw / 2;
  const H = 5.6;
  mb.box(x0, x1, 0, H, zb, zf, { side: wall, top: null });
  mb.gable(x0, x1, zb, zf, H, 2.2, 'x', roof, wall, 0.4);
  // garage-forward: the garage sticks out toward the street
  const left = plan !== 1;
  const ga = left ? x0 : x1 - gw, gb = left ? x0 + gw : x1;
  const gz = sb.gz;
  mb.box(ga, gb, 0, 2.8, zf - 0.1, gz, { side: wall, top: null, b: null });
  mb.gable(ga, gb, zf - 1, gz, 2.8, 1.6, 'z', roof, wall, 0.35);
  mb.decal('+z', (ga + gb) / 2, 0, gz, gw - 1.2, 2.2, S(gw > 5 ? 'garage2' : 'garage1'));
  driveway(g, (ga + gb) / 2, gw - 0.6, gz);
  // entry
  const ex = left ? (gb + x1) / 2 : (x0 + ga) / 2;
  mb.decal('+z', ex, 0.2, zf, 1.0, 2.1, S(rng.pick(['doorBlack', 'doorFront', 'doorBlue'])));
  mb.boxC(ex, zf + 0.9, 2.2, 1.8, 0, 0.2, M('concretePad', 4, 4));
  if (plan === 2) {
    mb.boxC(ex, zf + 1.6, 0.2, 0.2, 0.2, 2.6, { side: trim, top: null });
    mb.gable(ex - 1.3, ex + 1.3, zf, zf + 1.8, 2.8, 0.9, 'z', roof, trim, 0.1);
  }
  patch(g, ex - 0.6, ex + 0.6, zf + 1.8, D / 2, mats.concrete(), 0.1);
  // windows: second floor across the front, one downstairs by the door
  windowsZ(g, x0 + 0.3, x1 - 0.3, zf, 3.4, Math.max(2, Math.floor(hw / 3)), 'winHouse', 1.0, 1.4);
  mb.decal('+z', left ? Math.min(x1 - 1, ex + 1.8) : Math.max(x0 + 1, ex - 1.8), 0.9, zf, 1.1, 1.4, win(g, 'winHouse'));
  windowsX(g, zb, zf, left ? x1 : x0, 3.4, 2, 'winHouse', 1.0, 1.3, !left);
  windowsZ(g, x0, x1, zb, 3.4, 3, 'winHouse', 1.0, 1.3, true);
  windowsZ(g, x0, x1, zb, 0.9, 2, 'winPicture', 2.2, 1.4, true);
  // builder-grade landscaping: one twig tree, mulch strip, fence
  patch(g, x0, x1, zf + 0.05, zf + 1.2, M('mulch', 2, 2), 0.11);
  for (let x = x0 + 0.6; x < x1 - 0.5; x += 1.3) if (Math.abs(x - ex) > 1.4 && (x < ga || x > gb)) shrub(g, x, zf + 0.6, 0.6);
  tree(g, left ? x1 - 1 : x0 + 1, D / 2 - 2.4, 0.55, 'sad');
  fence(g, -W / 2 + 0.2, zb - 0.2, -W / 2 + 0.2, -D / 2 + 0.2);
  fence(g, W / 2 - 0.2, -D / 2 + 0.2, W / 2 - 0.2, zb - 0.2);
  fence(g, -W / 2 + 0.2, -D / 2 + 0.2, W / 2 - 0.2, -D / 2 + 0.2);
  acUnit(g, left ? x1 - 1 : x0 + 1, zb - 0.7);
  if (rng.chance(0.6)) car(g, (ga + gb) / 2 + (rng.float() - 0.5), D / 2 - 2.8, Math.PI, rng.pick(['suv', 'van', 'pickup', 'sedan']));
  if (rng.chance(0.3)) trampoline(g, 0, -D / 2 + 3);
  return `${FLOOR_PLANS[(plan + rng.int(0, 1) * 3) % FLOOR_PLANS.length]} (Tract Home)`;
}

// ------------------------------------------------------------------ L4/L5: McMansions
function mcmansion(g: GenCtx, mega: boolean) {
  const { mb, rng, W, D } = g;
  lotPad(g, M('lawn', 8, 8));
  const sideCol = rgb(rng.pick([0xd8cfbf, 0xcfc4ae, 0xe2dccd, 0xc4b8a2, 0xbfb6a6]));
  const side = M(rng.chance(0.35) ? 'stucco' : 'siding', 4, 4, sideCol);
  const front = M('stone', 3, 3); // fake stone veneer: front faces only
  const roof = M('shingles', 4, 4, rgb(rng.pick([0x9a948e, 0x8a8886, 0xa89888, 0xb4b0ac])));
  const narrow = W < 14;
  const floors = narrow ? 3 : 2;
  const H = floors * 3.1;
  const cars = mega ? (W >= 24 ? 4 : 3) : narrow ? 2 : 3;
  const gw = Math.min(W - 3, cars * 3.1);
  const hw = Math.min(W - 1.6, narrow ? W - 1.6 : gw + 6 + rng.float() * 4 + (mega ? 4 : 0));
  const prot = narrow || D < 16 ? 1.2 : 3.2;
  const sb = setbacks(D, prot);
  const hd = Math.min(sb.hd, 10 + (mega ? 3 : 0));
  const zf = sb.zf;
  const zb = zf - hd;
  const x0 = -hw / 2, x1 = hw / 2;
  // main mass (front stone, sides siding)
  mb.box(x0, x1, 0, H, zb, zf, { f: front, side, top: null });
  mb.hip(x0, x1, zb, zf, H, Math.min(3.2, hd * 0.4), roof, 0.45);
  // garage wing, forward
  const left = rng.chance(0.5);
  const ga = left ? x0 : x1 - gw, gb = left ? x0 + gw : x1;
  const gz = sb.gz;
  mb.box(ga, gb, 0, 3.0, zf - 0.2, gz, { f: front, side, top: null, b: null });
  mb.gable(ga, gb, zf - 2, gz, 3.0, 2.0, 'z', roof, front, 0.4);
  const bays = narrow ? 1 : Math.min(cars, Math.floor(gw / 3));
  for (let i = 0; i < bays; i++) {
    const cw = (gb - ga) / bays;
    mb.decal('+z', ga + (i + 0.5) * cw, 0, gz, cw - 0.7, 2.3, S(cw > 4.5 ? 'garage2' : 'garage1'));
  }
  driveway(g, (ga + gb) / 2, gw, gz);
  // two-story foyer with its own steep gable and the tall arched window
  const fx = left ? Math.min(x1 - 2.2, gb + 2.4) : Math.max(x0 + 2.2, ga - 2.4);
  const fw = 3.6;
  const fz = zf + 1.4;
  mb.box(fx - fw / 2, fx + fw / 2, 0, H + 0.6, zf - 0.2, fz, { f: front, l: side, r: side, top: null, b: null });
  mb.gable(fx - fw / 2, fx + fw / 2, zf - 1.5, fz, H + 0.6, 2.8, 'z', roof, front, 0.3);
  mb.decal('+z', fx, 2.6, fz, 1.2, 2.8, win(g, 'winTall', 0.55));
  mb.decal('+z', fx, 0.15, fz, 1.6, 2.3, S(mega ? 'doorDouble' : 'doorSide'));
  const stoop = Math.min(2.4, D / 2 - fz - 0.1);
  if (stoop > 0.6) mb.box(fx - fw / 2 - 0.3, fx + fw / 2 + 0.3, 0, 0.25, fz, fz + stoop, M('concretePad', 4, 4, 0xe0d8c8));
  patch(g, fx - 0.7, fx + 0.7, fz + 2.4, D / 2, mats.concrete(), 0.1);
  // too many gables: little cross gables popping out of the hip roof
  const gCount = rng.int(1, 3) + (mega ? 1 : 0);
  for (let i = 0; i < gCount; i++) {
    const cx = x0 + 1.8 + rng.float() * (hw - 3.6);
    if (Math.abs(cx - fx) < 2.8) continue;
    const cw = 2.4 + rng.float() * 1.4;
    mb.box(cx - cw / 2, cx + cw / 2, H - 1.2, H + 0.4, zf - 2.5, zf - 0.6, { f: front, l: side, r: side, top: null, b: null });
    mb.gable(cx - cw / 2, cx + cw / 2, zf - 3, zf - 0.6, H + 0.4, 1.4, 'z', roof, front, 0.25);
    mb.decal('+z', cx, H - 0.9, zf - 0.6, 0.9, 1.1, win(g, 'winHouse'));
  }
  // windows
  const wn = Math.max(2, Math.floor(hw / 3.2));
  for (let f = 0; f < floors; f++) {
    for (let i = 0; i < wn; i++) {
      const x = x0 + ((i + 0.5) * hw) / wn;
      if (Math.abs(x - fx) < 2.3) continue;
      if (f === 0 && x > ga - 0.5 && x < gb + 0.5) continue;
      mb.decal('+z', x, 0.9 + f * 3.1, zf, 1.1, 1.5, win(g, f === 0 && rng.chance(0.3) ? 'winShutter' : 'winHouse', 0.4));
    }
    windowsX(g, zb, zf, x0, 0.9 + f * 3.1, 2, 'winHouse', 1.0, 1.4, true);
    windowsX(g, zb, zf, x1, 0.9 + f * 3.1, 2, 'winHouse', 1.0, 1.4, false);
    windowsZ(g, x0, x1, zb, 0.9 + f * 3.1, wn, 'winHouse', 1.0, 1.4, true);
  }
  // one turret, because of course
  if (!narrow && rng.chance(mega ? 0.8 : 0.45)) {
    const tx = left ? x1 - 1.7 : x0 + 1.7, tz = zf - 0.3;
    mb.cyl(tx, tz, 1.5, 0, H + 1.2, 10, front, null);
    mb.cone(tx, tz, 1.8, H + 1.2, 3.8, 10, roof);
    mb.decal('+z', tx, 3.6, tz + 1.5, 0.7, 1.2, win(g, 'winHouse'));
  }
  // chimney (fake stone, of course)
  const chx = left ? x1 - 1.2 : x0 + 1.2;
  mb.boxC(chx, zb + 1.5, 1.2, 1.0, 0, H + 3.8, { side: front });
  if (rng.chance(0.3)) g.em.push({ kind: 'smoke', pos: [chx, H + 4.1, zb + 1.5] });
  // yard
  patch(g, x0, x1, zf + 0.05, zf + 1.3, M('mulch', 2, 2), 0.11);
  for (let x = x0 + 0.7; x < x1; x += 1.2) if ((x < ga - 0.4 || x > gb + 0.4) && Math.abs(x - fx) > 2.4) shrub(g, x, zf + 0.7, 0.7);
  tree(g, left ? W / 2 - 2 : -W / 2 + 2, D / 2 - 3, 0.6, 'sad');
  if (rng.chance(0.7)) car(g, (ga + gb) / 2, D / 2 - 3, Math.PI, rng.pick(['suv', 'lifted', 'cyber', 'van']));
  if (D / 2 - gz >= 7.5 && rng.chance(0.4)) boatTrailer(g, ga + 1.2, (gz + D / 2) / 2, Math.PI);
  // backyard: pool for the big ones, a smoker for everyone
  if (mega || (D >= 24 && rng.chance(0.5))) {
    const pw = Math.min(hw - 2, 9), pd = Math.min(zb + D / 2 - 3, 4.5);
    if (pd > 2.5) {
      poolInground(g, 0, zb - pd / 2 - 1.6, pw, pd);
      picnicTable(g, x0 + 1.5, zb - 1);
    }
  }
  smoker(g, left ? x0 + 1 : x1 - 1, zb - 1.2);
  acUnit(g, left ? x1 - 1 : x0 + 1, zb - 0.7);
  acUnit(g, left ? x1 - 2.2 : x0 + 2.2, zb - 0.7);
  fence(g, -W / 2 + 0.2, zb, -W / 2 + 0.2, -D / 2 + 0.2);
  fence(g, W / 2 - 0.2, -D / 2 + 0.2, W / 2 - 0.2, zb);
  fence(g, -W / 2 + 0.2, -D / 2 + 0.2, W / 2 - 0.2, -D / 2 + 0.2);
  return mega ? 'Mega-McMansion' : narrow ? 'Skinny McMansion (3 Stories, All Garage)' : rng.pick(HOUSE_KIND[4]);
}

function farmhouse(g: GenCtx) {
  const { mb, rng, W, D } = g;
  lotPad(g, M('lawn', 8, 8));
  const wall = M('sidingV', 4, 4, 0xf4f3ef);
  const roof = M('metalRoof', 4, 4, 0x2a2a2c);
  const black = M('plain', 2, 2, 0x1c1c1c);
  const sb = setbacks(D, 2.6);
  const barn = W >= 22;
  const hw = Math.min(W - (barn ? 11 : 2), 12 + rng.float() * 6), hd = Math.min(sb.hd, 9);
  const zf = sb.zf, zb = zf - hd;
  const x0 = barn ? -W / 2 + 1 : -hw / 2, x1 = x0 + hw;
  const H = 5.8;
  mb.box(x0, x1, 0, H, zb, zf, { side: wall, top: null });
  mb.gable(x0, x1, zb, zf, H, 3.2, 'x', roof, wall, 0.35);
  // big front-facing gable
  const gx = x0 + hw * (rng.chance(0.5) ? 0.3 : 0.7), gwid = Math.min(6, hw * 0.45);
  mb.box(gx - gwid / 2, gx + gwid / 2, 0, H + 0.3, zf - 0.3, zf + 1.2, { f: wall, l: wall, r: wall, top: null, b: null });
  mb.gable(gx - gwid / 2, gx + gwid / 2, zf - 3, zf + 1.2, H + 0.3, 3.8, 'z', roof, wall, 0.3);
  mb.decal('+z', gx, 3.3, zf + 1.2, 1.3, 1.9, win(g, 'winModern', 0.5));
  mb.decal('+z', gx, 6.8, zf + 1.2, 0.9, 1.2, win(g, 'winModern', 0.4));
  // wrap porch with black posts
  const pz = zf + 2.6;
  mb.box(x0, x1, 0, 0.35, zf, pz, { side: M('concretePad', 4, 4), top: M('deck', 4, 4, 0x8a6a4a) });
  for (let x = x0 + 0.3; x <= x1 - 0.2; x += (hw - 0.6) / Math.max(2, Math.round(hw / 3))) mb.boxC(x, pz - 0.2, 0.22, 0.22, 0.35, 2.9, { side: black, top: null });
  mb.shed(x0, x1, zf + 0.2, pz, 3.1, 0.5, roof, null, 0.25);
  const doorX = gx > 0 ? x0 + hw * 0.3 : x0 + hw * 0.7;
  mb.decal('+z', doorX, 0.35, zf, 1.2, 2.3, S('doorBlack'));
  mb.decal('+z', doorX, 2.9, zf + 0.15, 1.6, 0.4, S('gather'), 0.1);
  windowsZ(g, x0 + 0.4, x1 - 0.4, zf, 0.9, Math.max(2, Math.floor(hw / 3.5)), 'winModern', 1.1, 1.5);
  windowsX(g, zb, zf, x0, 3.6, 2, 'winModern', 1.0, 1.4, true);
  windowsX(g, zb, zf, x1, 3.6, 2, 'winModern', 1.0, 1.4, false);
  windowsZ(g, x0, x1, zb, 3.6, 3, 'winModern', 1.0, 1.4, true);
  windowsZ(g, x0, x1, zb, 0.9, 2, 'winModern', 1.8, 2.1, true);
  // detached garage-barn
  if (barn) {
    const bx = x1 + 4.5;
    const bw = 6;
    mb.box(bx - bw / 2, bx + bw / 2, 0, 3.2, zf - 6, zf, { side: wall, top: null });
    mb.gable(bx - bw / 2, bx + bw / 2, zf - 6, zf, 3.2, 2.4, 'z', roof, wall, 0.3);
    mb.decal('+z', bx, 0, zf, bw - 1.2, 2.4, S('garage2', 0x2a2a2a));
    driveway(g, bx, bw - 0.8, zf);
    car(g, bx, D / 2 - 3, Math.PI, rng.pick(['cyber', 'suv', 'lifted']));
  } else patch(g, x1 - 3, x1 - 0.5, pz, D / 2, mats.gravel(), 0.1);
  patch(g, doorX - 0.6, doorX + 0.6, pz, D / 2, mats.concrete(), 0.1);
  // pool, of course
  const pd = Math.min(zb + D / 2 - 3, 5);
  if (pd > 2.5) poolInground(g, 0, zb - pd / 2 - 1.5, Math.min(hw - 3, 10), pd);
  for (let i = 0; i < 4; i++) tree(g, -W / 2 + 1.5 + ((W - 3) * i) / 3, D / 2 - 1.8, 0.7, 'round');
  smoker(g, x1 - 1, zb - 1);
  return rng.chance(0.2) ? 'Barndominium Estate' : 'Modern Farmhouse';
}

export function genResLow(g: GenCtx) {
  const L = g.spec.level;
  const r = g.rng.float();
  if (L <= 1) g.label = r < 0.62 ? trailer(g) : shack(g);
  else if (L === 2) g.label = ranch(g);
  else if (L === 3) g.label = tract(g);
  else if (L === 4) g.label = mcmansion(g, false);
  else g.label = r < 0.5 && g.W >= 14 && g.D >= 16 ? farmhouse(g) : mcmansion(g, g.W >= 14);
}
