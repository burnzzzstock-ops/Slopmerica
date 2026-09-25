// Plopable landmarks. Each fits its footprint (cells x 8 m), road on +Z.
import type { LandmarkId } from '../contracts';
import type { MapId } from '../world/maps';
import { COUNTY_NAMES } from '../art/names';
import { M, S, rgb, WHITE, V3 } from './mesh';
import {
  GenCtx, lotPad, parkingLot, car, tree, shrub, poleSign, wallSign, canopy, pumpIsland, flagpole, patch, mats, lampPost,
  poolInground, smoker, fence, monumentSign, hvac, iceBox, propaneCage, vending,
} from './props';
import { FAC, FLOOR, WALL, ROOF, block, roofJunk, balconies } from './blocks';
import { giantCannon } from './comHigh';

export const LANDMARK_FOOTPRINT: Record<LandmarkId, { widthCells: number; depthCells: number }> = {
  slopCannon: { widthCells: 4, depthCells: 4 },
  slop69Field: { widthCells: 10, depthCells: 10 },
  pigCabanaResort: { widthCells: 8, depthCells: 6 },
  neuralFlyDatacenter: { widthCells: 8, depthCells: 6 },
  propaneParadise: { widthCells: 6, depthCells: 4 },
  fillErUpMegaStation: { widthCells: 10, depthCells: 8 },
  megachurch: { widthCells: 8, depthCells: 8 },
  waterTower: { widthCells: 2, depthCells: 2 },
};

let currentMap: MapId | null = null;
export function setLandmarkMap(m: MapId) {
  currentMap = m;
}

// ------------------------------------------------------------------ Slop Cannon
function slopCannon(g: GenCtx) {
  const { mb, W, D } = g;
  lotPad(g, M('concretePad', 4, 4, 0xd8d0c0));
  // plinth + the cannon itself, aimed over the road
  mb.box(-10, 10, 0, 1.6, -14, 4, { side: WALL.concrete(0x3a3a3c), top: M('concretePad', 4, 4, 0x8a8680) });
  // broadside to the street so the silhouette reads; muzzle ends up near x = +7.8
  mb.push().translate(-3, 1.6, 0);
  giantCannon(g, 0, -4, 3.6, Math.PI / 2);
  mb.pop();
  const muzzle = g.em[g.em.length - 1].pos;
  g.em.push({ kind: 'fire', pos: [muzzle[0] + 0.4, muzzle[1] - 0.6, muzzle[2]] });
  // boarding tower beside the muzzle ("GET IN")
  const tx = muzzle[0] + 1.5, tz = 0.5, top = muzzle[1] - 1.6;
  const steel = M('metal', 2, 2, 0xc6f432);
  const grate = M('grille', 2, 2, 0x333333);
  for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) mb.boxC(tx + dx * 1.2, tz + dz * 1.2, 0.3, 0.3, 0, top, { side: steel, top: null });
  for (let y = 3; y < top; y += 3.5) mb.box(tx - 1.4, tx + 1.4, y, y + 0.25, tz - 1.4, tz + 1.4, { side: grate, top: grate });
  mb.box(tx - 1.4, tx + 1.4, top, top + 0.25, muzzle[2] - 0.8, tz + 1.4, { side: grate, top: grate });
  // the slogan, big, on a long base facing the road
  mb.box(-13, 13, 0, 1.2, 9.5, 11, { side: WALL.concrete(0x2a2a2a), top: M('plain', 2, 2, 0x1a1a1a) });
  mb.box(-12.5, 12.5, 1.2, 1.2 + 25 * (160 / 1024), 10, 10.4, { f: S('lm:cannonSign'), b: S('lm:cannonSign'), side: M('plain', 2, 2, 0x111111), top: M('plain', 2, 2, 0x111111) });
  // plaque + ticket booth with the Cannon Boys banner
  mb.box(-9, -5, 1.6, 3.1, 4.02, 4.2, { f: S('lm:cannonPlaque'), side: M('plain', 2, 2, 0x6b4a2a), b: null });
  mb.box(-W / 2 + 2, -W / 2 + 6, 0, 3, D / 2 - 7, D / 2 - 4, { side: M('metalPanel', 4, 4, 0x2a2a2c), top: ROOF.flat() });
  mb.decal('+z', -W / 2 + 4, 3.05, D / 2 - 4, 4, 1, S('lm:cannonBanner'), 0.02);
  mb.decal('+z', -W / 2 + 4, 0.8, D / 2 - 4, 2, 1.2, S('winPictureLit'));
  for (const x of [-W / 2 + 1.2, W / 2 - 1.2]) flagpole(g, x, D / 2 - 1.2, 10, 3);
  for (const x of [-12, 12]) lampPost(g, x, 7.5, 7, 2);
  for (let i = 0; i < 4; i++) tree(g, -W / 2 + 3 + i * ((W - 6) / 3), -D / 2 + 2, 0.7);
  g.label = 'The Slop Cannon (GET IN THE CANNON)';
}

// ------------------------------------------------------------------ Slop 69 Field
function slop69Field(g: GenCtx) {
  const { mb, W, D } = g;
  lotPad(g, mats.asphalt());
  // the field: home plate near the street, outfield away from it
  const fs = Math.min(W, D) - 10;
  const fz1 = D / 2 - 5, fz0 = fz1 - fs;
  mb.flat(-fs / 2, fs / 2, fz0, fz1, 0.1, M('lm:field', 0, 0, WHITE, { ao: false }));
  const hx = 0, hz = fz1 - fs * 0.08;
  // grandstands wrapping home plate along the street side and down the lines
  const seat = M('bleachers', 4, 4);
  const conc = WALL.concrete(0xc8c4bc);
  /** Tiered seating rising toward +Z from zFront; returns the back wall's z and top. */
  const stand = (x0: number, x1: number, zFront: number, rows: number) => {
    for (let t = 0; t < rows; t++) {
      const y = 0.8 + t * 1.1, za = zFront + t * 1.6;
      mb.box(x0, x1, 0, y, za, za + 1.6, { f: null, b: t === 0 ? conc : null, l: conc, r: conc, top: seat });
    }
    const zBack = zFront + rows * 1.6, top = 0.8 + rows * 1.1 + 5;
    mb.box(x0, x1, 0, top, zBack, zBack + 0.6, conc);
    // roof over the upper deck
    mb.box(x0, x1, top, top + 0.6, zBack - 3.2, zBack + 0.6, { side: M('plain', 2, 2, 0x1d3a8a), top: ROOF.metal(0xe8e8e4), bottom: M('canopyLight', 3, 3) });
    return { zBack: zBack + 0.6, top };
  };
  // behind home plate, backed up to the street
  const main = stand(-13, 13, hz + 3, 4);
  // down the foul lines: local +X runs along the line, +Z points into foul territory
  for (const s of [-1, 1] as const) {
    const along = 4, out = 4;
    mb.push().translate(s * (along + out) * Math.SQRT1_2, 0, hz - (along - out) * Math.SQRT1_2).rotY(s * Math.PI * 0.25);
    stand(s > 0 ? 0 : -24, s > 0 ? 24 : 0, 0, 5);
    mb.pop();
  }
  // outfield wall with ads (segments along an arc)
  const R = fs * 0.78, n = 12;
  for (let i = 0; i < n; i++) {
    const a0 = Math.PI * 1.25 + (i / n) * Math.PI * 0.5, a1 = Math.PI * 1.25 + ((i + 1) / n) * Math.PI * 0.5;
    const p0: V3 = [hx + Math.cos(a0) * R, 0, hz + Math.sin(a0) * R];
    const p1: V3 = [hx + Math.cos(a1) * R, 0, hz + Math.sin(a1) * R];
    const ad = M('lm:outfield', 8, 1, WHITE, { ao: false });
    mb.poly([[p1[0], 0, p1[2]], [p0[0], 0, p0[2]], [p0[0], 3, p0[2]], [p1[0], 3, p1[2]]], ad);
    mb.poly([[p0[0], 0, p0[2]], [p1[0], 0, p1[2]], [p1[0], 3, p1[2]], [p0[0], 3, p0[2]]], M('plain', 2, 2, 0x1d4a2a));
  }
  // scoreboard in center field
  const sbz = hz - R - 4;
  for (const x of [-6, 6]) mb.boxC(x, sbz, 0.8, 0.8, 0, 14, M('metal', 2, 2, 0x3a3a3c));
  mb.box(-9, 9, 14, 14 + 18 * (320 / 512), sbz - 0.6, sbz + 0.6, { f: S('lm:scoreboard'), side: M('plain', 2, 2, 0x15251c), top: M('plain', 2, 2, 0x15251c) });
  // home-run cannon on the berm
  giantCannon(g, fs * 0.3, hz - R - 2, 1.2, Math.PI * 0.9);
  // light towers
  for (const [lx, lz] of [[-fs * 0.5, hz - 4], [fs * 0.5, hz - 4], [-fs * 0.45, hz - R * 0.8], [fs * 0.45, hz - R * 0.8]]) {
    mb.lathe(lx, lz, [[0.7, 0], [0.4, 30]], 6, M('metal', 2, 2, 0x9a9ea2));
    mb.box(lx - 3, lx + 3, 30, 33, lz - 0.4, lz + 0.4, { side: M('plain', 2, 2, 0x333333), top: M('plain', 2, 2, 0x333333), f: S('lampWhite'), b: S('lampWhite') });
  }
  // entrance sign on the back of the grandstand, facing the street
  wallSign(g, 0, main.top - 5, main.zBack, 17, 'lm:stadiumSign', 17 / 4);
  // parking in the corners
  parkingLot(g, -W / 2 + 0.5, -fs * 0.34, D / 2 - 14, D / 2 - 4, 0.5, { lamps: false });
  parkingLot(g, fs * 0.34, W / 2 - 0.5, D / 2 - 14, D / 2 - 4, 0.5, { lamps: false });
  g.label = 'Slop 69 Field (Home of the 69ers)';
}

// ------------------------------------------------------------------ Pig Cabana Resort
function pigCabana(g: GenCtx) {
  const { mb, rng, W, D } = g;
  lotPad(g, M('lawn', 8, 8));
  patch(g, -W / 2, W / 2, -D / 2, -D / 2 + 12, M('dirt', 8, 8, 0xf2e2b8), 0.08); // the "beach"
  // L-shaped hotel, pink stucco with teal balconies
  const pink = M('stucco', 4, 4, 0xffc2d1);
  const floors = 6, fh = 3.2, H = 4 + floors * fh;
  const fac = M('aptSiding', 12, 12, 0xffd8e2, { bays: 4, floors: 4 });
  mb.box(-W / 2 + 3, W / 2 - 18, 0, 4, 2, 12, { f: FAC.storefront(rng), side: pink, top: null });
  block(g, -W / 2 + 3, W / 2 - 18, 2, 12, 4, H, fac, { side: pink, parapet: 1, cap: M('plain', 2, 2, 0x12a39a) });
  block(g, W / 2 - 18, W / 2 - 4, -8, 12, 0, H - fh, fac, { side: pink, parapet: 1, cap: M('plain', 2, 2, 0x12a39a) });
  balconies(g, -W / 2 + 3.2, W / 2 - 18.2, 12, 4 + fh, floors - 1, fh, 3.5, { rail: M('plain', 2, 2, 0x12a39a, { ao: false }), depth: 1.2 });
  // rooftop sign
  mb.box(-12, 4, H + 1, H + 7, 11, 11.4, { f: S('lm:pigCabana'), b: S('lm:pigCabana'), side: M('plain', 2, 2, 0x12a39a), top: M('plain', 2, 2, 0x12a39a) });
  // giant pig head statue at the entrance
  const pinkBlob = M('plain', 2, 2, 0xf7a8b8);
  mb.blob(-W / 2 + 8, 4, D / 2 - 7, 3, 2.6, 2.6, pinkBlob, 1, 0.06, 7);
  mb.blob(-W / 2 + 8, 3.3, D / 2 - 4.6, 1.3, 1, 0.6, M('plain', 2, 2, 0xe0748f), 0, 0.05, 8);
  for (const s of [-1, 1]) mb.cone(-W / 2 + 8 + s * 1.9, D / 2 - 7, 0.9, 6.0, 1.8, 5, pinkBlob);
  mb.box(-W / 2 + 6, -W / 2 + 10, 0, 1.4, D / 2 - 9.5, D / 2 - 4.5, WALL.stucco(0x12a39a));
  // pool, loungers, cabanas, tiki bar, palms on the beach side
  poolInground(g, -6, -D / 2 + 7, 16, 6);
  for (let i = 0; i < 8; i++) mb.boxC(-14 + i * 2.2, -D / 2 + 2.6, 0.8, 1.9, 0.1, 0.45, M('plain', 2, 2, 0xffffff));
  const stripe = M('lm:cabanaStripe', 2, 2);
  for (let i = 0; i < 4; i++) {
    const cx = 8 + i * 4.5, cz = -D / 2 + 4;
    for (const [dx, dz] of [[-1.2, -1.2], [1.2, -1.2], [1.2, 1.2], [-1.2, 1.2]]) mb.boxC(cx + dx, cz + dz, 0.12, 0.12, 0, 2.3, { side: M('plain', 2, 2, 0xffffff), top: null });
    mb.gable(cx - 1.4, cx + 1.4, cz - 1.4, cz + 1.4, 2.3, 1.1, 'x', stripe, stripe, 0.1, 0.05);
  }
  const straw = M('wood', 4, 4, 0xd8b878);
  mb.box(W / 2 - 12, W / 2 - 6, 0, 1.2, -D / 2 + 1, -D / 2 + 5, { side: M('wood', 4, 4, 0x8a5a3a), top: M('wood', 4, 4, 0x6a4a2a) });
  mb.hip(W / 2 - 12.5, W / 2 - 5.5, -D / 2 + 0.5, -D / 2 + 5.5, 2.8, 1.6, straw, 0.4);
  for (const [dx, dz] of [[-12.2, 0.8], [-5.8, 0.8], [-12.2, 5.2], [-5.8, 5.2]]) mb.boxC(W / 2 + dx, -D / 2 + dz, 0.2, 0.2, 0, 2.8, { side: straw, top: null });
  smoker(g, W / 2 - 3, -D / 2 + 3);
  for (let i = 0; i < 9; i++) tree(g, -W / 2 + 2 + rng.float() * (W - 4), -D / 2 + 1 + rng.float() * 10, 0.9 + rng.float() * 0.3, 'palm');
  for (let i = 0; i < 5; i++) tree(g, -W / 2 + 14 + i * 6, D / 2 - 1.5, 0.8, 'palm');
  parkingLot(g, W / 2 - 17, W / 2 - 0.5, 13, D / 2 - 0.3, 0.55, { lamps: true });
  g.label = 'Pig Cabana Resort & Spa';
}

// ------------------------------------------------------------------ Neural Fly data center
function neuralFly(g: GenCtx) {
  const { mb, W, D } = g;
  lotPad(g, mats.concrete());
  const wall = WALL.dc();
  const H = 16;
  // two halls
  for (const [x0, x1] of [[-W / 2 + 2, -2], [2, W / 2 - 2]]) {
    mb.box(x0, x1, 0, H, -D / 2 + 2, 6, { side: wall, top: null });
    mb.parapet(x0, x1, -D / 2 + 2, 6, H, 1.4, wall, ROOF.flat(0xd0d0cc));
    for (let x = x0 + 2; x < x1 - 1.5; x += 3.6) for (let z = -D / 2 + 4; z < 5; z += 4) hvac(g, x, H, z, 1.2);
  }
  // the glowing fly between the halls
  mb.box(-2, 2, 0, H + 6, -6, 6, { side: M('metalPanel', 4, 4, 0x2a2a30), top: ROOF.flat() });
  mb.box(-9, 9, H - 16, H + 2, 6, 6.3, { f: S('lm:neuralLogo'), side: M('plain', 2, 2, 0x111111), top: M('plain', 2, 2, 0x111111), b: null });
  mb.box(-W / 2 + 4, -W / 2 + 20, 1.5, 5.5, 6, 6.3, { f: S('lm:neuralSign'), side: M('plain', 2, 2, 0x111111), top: null, b: null });
  // cooling towers in pairs at the ends (keep the logo in view), all steaming
  for (const [cx, cz] of [[-W / 2 + 6, D / 2 - 6], [-W / 2 + 15, D / 2 - 8], [W / 2 - 22, D / 2 - 5]]) {
    const r = 4, h = 13;
    mb.lathe(cx, cz, [[r, 0], [r * 0.82, h * 0.35], [r * 0.62, h * 0.72], [r * 0.66, h]], 14, M('concrete', 4, 4, 0xd8d4cc));
    mb.lathe(cx, cz, [[r * 0.64, h - 0.05], [0.01, h - 0.05]], 14, M('plain', 2, 2, 0x333333));
    g.em.push({ kind: 'steam', pos: [cx, h + 2, cz] });
  }
  // the reservoir it drinks (a sad blue rectangle) + intake pipe
  patch(g, W / 2 - 16, W / 2 - 2, 7, D / 2 - 12.5, M('pool', 4, 4, 0x6a8a9a), 0.12);
  mb.box(W / 2 - 16, W / 2 - 15.2, 0.5, 1.3, 6, 7.5, M('metal', 2, 2, 0x8a8e92));
  monumentSign(g, W / 2 - 9, D / 2 - 1, 7, 'sign:neuralFly', WALL.dc());
  fence(g, -W / 2 + 0.4, D / 2 - 0.4, -W / 2 + 0.4, -D / 2 + 0.4, 2.4, 'chainlink');
  fence(g, W / 2 - 0.4, -D / 2 + 0.4, W / 2 - 0.4, D / 2 - 0.4, 2.4, 'chainlink');
  for (let i = 0; i < 4; i++) lampPost(g, -W / 2 + 4 + i * ((W - 8) / 3), 7.5, 9, 2);
  g.label = 'Neural Fly Hyperscale AI Campus (reservoir sold separately)';
}

// ------------------------------------------------------------------ Propane Paradise
function propaneParadise(g: GenCtx) {
  const { mb, rng, W, D } = g;
  lotPad(g, M('dirt', 8, 8, 0xf0e0b8));
  // the big sphere on legs
  const sx = -W / 2 + 10, sz = -D / 2 + 10, R = 7;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    mb.boxC(sx + Math.sin(a) * R * 0.8, sz + Math.cos(a) * R * 0.8, 0.5, 0.5, 0, R + 1.5, M('metal', 2, 2, 0xd8d8d4));
  }
  const prof: [number, number][] = [];
  for (let i = 0; i <= 8; i++) {
    const t = -Math.PI / 2 + (i / 8) * Math.PI;
    prof.push([Math.max(0.01, Math.cos(t) * R), R + 2 + Math.sin(t) * R]);
  }
  mb.lathe(sx, sz, prof, 14, M('metal', 2, 2, 0xf4f4f0));
  // shirt-print painted band around the equator
  mb.lathe(sx, sz, [[R + 0.03, R + 0.6], [R + 0.03, R + 3.4]], 14, M('lm:shirtPattern', 6, 3));
  // bullets
  for (let i = 0; i < 3; i++) {
    const bx = 6 + (i % 2) * 2, bz = -D / 2 + 4 + i * 5.2;
    const len = 16, r = 1.8;
    for (const s of [-5, 5]) mb.boxC(bx + s, bz, 0.6, 2.8, 0, 1.4, WALL.concrete(0xa8a49c));
    mb.push().translate(bx, 2.2, bz).rotZ(Math.PI / 2);
    mb.lathe(0, 0, [[0.01, -len / 2 - 1], [r * 0.7, -len / 2 - 0.7], [r, -len / 2], [r, len / 2], [r * 0.7, len / 2 + 0.7], [0.01, len / 2 + 1]], 12, M('metal', 2, 2, 0xf4f4f0));
    mb.pop();
    mb.decal('+z', bx, 1.5, bz + r - 0.1, 8, 2, S('lm:tankLabel'), 0.1);
  }
  // shop in the loudest beach button-up pattern
  const shirt = M('lm:shirtPattern', 4, 4);
  mb.box(-W / 2 + 3, -W / 2 + 17, 0, 4.5, D / 2 - 10, D / 2 - 3, { f: FAC.storefront(rng), side: shirt, top: null });
  mb.shed(-W / 2 + 3, -W / 2 + 17, D / 2 - 10, D / 2 - 3, 4.5, 0.8, ROOF.metal(0xff8a3d), shirt, 0.6);
  wallSign(g, -W / 2 + 10, 4.6, D / 2 - 2.6, 9, 'lm:propaneParadise', 9 * 192 / 512);
  for (let i = 0; i < 3; i++) propaneCage(g, -W / 2 + 4.5 + i * 2.2, D / 2 - 2.2);
  poleSign(g, W / 2 - 4, D / 2 - 1.2, 12, 7, 'sign:propaneParadise');
  // flare + palms
  mb.cyl(W / 2 - 2, -D / 2 + 2, 0.3, 0, 14, 6, M('metal', 2, 2, 0x8a8e92));
  g.em.push({ kind: 'fire', pos: [W / 2 - 2, 14.8, -D / 2 + 2] }, { kind: 'smoke', pos: [W / 2 - 2, 16, -D / 2 + 2] });
  for (let i = 0; i < 6; i++) tree(g, -W / 2 + 2 + rng.float() * (W - 4), D / 2 - 1.2 - rng.float() * 1.5, 0.9, 'palm');
  g.label = 'Propane Paradise (sun, sand, pressurized gas)';
}

// ------------------------------------------------------------------ Fill Er Up Mega Station
function fillErUpMega(g: GenCtx) {
  const { mb, rng, W, D } = g;
  lotPad(g, mats.concrete());
  // store the size of a big box
  const sw = W - 18, sz0 = -D / 2 + 2, sz1 = sz0 + 18;
  const wall = WALL.stucco(0xf2ece0);
  mb.box(-W / 2 + 2, -W / 2 + 2 + sw, 0, 9, sz0, sz1, { f: FAC.storefront(rng), side: wall, top: null });
  mb.parapet(-W / 2 + 2, -W / 2 + 2 + sw, sz0, sz1, 9, 1.5, wall, ROOF.flat());
  mb.box(-W / 2 + 1.8, -W / 2 + 2.2 + sw, 7, 10.5, sz1, sz1 + 0.3, { side: M('plain', 2, 2, 0xb3202a), top: null, b: null });
  wallSign(g, -W / 2 + 2 + sw / 2, 9.5, sz1 + 0.3, 22, 'lm:fillErUpBig', 22 / 3);
  roofJunk(g, -W / 2 + 3, -W / 2 + 1 + sw, sz0 + 1, sz1 - 1, 9, 1);
  // car wash tunnel on the side
  const cx0 = W / 2 - 14, cx1 = W / 2 - 2;
  mb.box(cx0, cx1, 0, 5, sz0, sz0 + 18, { f: M('rollup', 4, 4, 0xb3202a), side: M('metalPanel', 4, 4, 0x1d3a8a), top: ROOF.flat() });
  // the canopy of canopies: 120 pumps (give or take)
  const cz0 = sz1 + 6, cz1 = D / 2 - 9;
  const rows = Math.max(1, Math.floor((cz1 - cz0) / 11));
  for (let r = 0; r < rows; r++) {
    const a = cz0 + r * 11, b = a + 10;
    canopy(g, -W / 2 + 3, W / 2 - 3, a, b, 5.6, 'fillErUp');
    const n = Math.floor((W - 6) / 6);
    for (let i = 0; i < n; i++) {
      const px = -W / 2 + 3 + (i + 0.5) * ((W - 6) / n);
      pumpIsland(g, px, (a + b) / 2);
      if (rng.chance(0.55)) car(g, px + (rng.chance(0.5) ? 2.2 : -2.2), (a + b) / 2, rng.chance(0.5) ? 0 : Math.PI);
    }
  }
  // store-front junk, EV chargers "powered by clean coal", smokers out back (brisket)
  for (let i = 0; i < 4; i++) iceBox(g, -W / 2 + 4 + i * 2, sz1 + 0.6);
  for (let i = 0; i < 4; i++) vending(g, -W / 2 + 13 + i * 1, sz1 + 0.5);
  for (let i = 0; i < 6; i++) propaneCage(g, -W / 2 + 20 + i * 2.1, sz1 + 0.6);
  for (let i = 0; i < 5; i++) {
    mb.boxC(W / 2 - 3, sz1 + 2 + i * 2.6, 0.5, 0.8, 0, 1.8, { side: M('plain', 2, 2, 0x2e7d32), top: M('plain', 2, 2, 0x2e7d32) });
  }
  for (let i = 0; i < 3; i++) smoker(g, -W / 2 + 8 + i * 4, sz0 - 1.2 < -D / 2 + 0.5 ? sz0 + 0.8 : sz0 - 1.2);
  // the tallest pole sign in the county + a flag you can see from space
  poleSign(g, W / 2 - 6, D / 2 - 2, 26, 12, 'sign:fillErUp', { price: true });
  flagpole(g, -W / 2 + 3, D / 2 - 3, 34, 16);
  parkingLot(g, -W / 2 + 0.5, W / 2 - 16, D / 2 - 8.5, D / 2 - 0.3, 0.4, { lamps: false });
  for (let i = 0; i < 3; i++) g.em.push({ kind: 'cigarette', pos: [-W / 2 + 6 + i * 8, 1.6, sz1 + 1.5] });
  g.label = 'Fill Er Up Mega Station (120 pumps · 80 toilets · jerky wall)';
}

// ------------------------------------------------------------------ Megachurch
function megachurch(g: GenCtx) {
  const { mb, W, D } = g;
  lotPad(g, mats.asphalt());
  // the arena: a squat drum with a shallow dome
  const cx = 0, cz = -D / 2 + 20, R = 17;
  const wall = WALL.stucco(0xf4efe4);
  mb.lathe(cx, cz, [[R, 0], [R, 11]], 20, wall);
  mb.lathe(cx, cz, [[R + 0.4, 11], [R * 0.85, 14], [R * 0.5, 16.2], [0.01, 17]], 20, ROOF.metal(0xd8dce0));
  // glass lobby + coffee bar wing
  mb.box(-12, 12, 0, 8, cz + R - 4, cz + R + 5, { f: M('glassPlain', 3, 3), side: wall, top: ROOF.flat() });
  mb.box(-12.5, 12.5, 8, 8.8, cz + R - 4.5, cz + R + 5.5, M('plain', 2, 2, 0x6a1b9a));
  wallSign(g, 0, 8.9, cz + R + 5.5, 14, 'lm:church', 3.5);
  // the cross tower
  const tx = 17, tz = cz + R + 2;
  mb.boxC(tx, tz, 2.4, 2.4, 0, 26, { side: M('plain', 2, 2, 0xf4efe4), top: ROOF.flat() });
  mb.boxC(tx, tz, 0.9, 0.9, 26, 9, S('lampWhite'));
  mb.boxC(tx, tz, 5, 0.9, 31, 1, S('lampWhite'));
  // LED marquee at the road + the county's second-biggest parking lot
  mb.box(-W / 2 + 3, -W / 2 + 11, 1.2, 1.2 + 8 * 0.5, D / 2 - 2.4, D / 2 - 2, { f: S('lm:churchMarquee'), b: S('lm:churchMarquee'), side: M('brickTan', 2, 2), top: M('brickTan', 2, 2) });
  mb.boxC(-W / 2 + 7, D / 2 - 2.2, 9, 0.8, 0, 1.2, M('brickTan', 2, 2));
  parkingLot(g, -W / 2 + 0.4, W / 2 - 0.4, cz + R + 7, D / 2 - 3.5, 0.2, { trees: true, lamps: true });
  for (let i = 0; i < 6; i++) tree(g, -W / 2 + 2 + i * ((W - 4) / 5), -D / 2 + 1.5, 0.8);
  g.label = 'Prosperity Dome (Easter parking: all of it)';
}

// ------------------------------------------------------------------ Water tower
function waterTower(g: GenCtx) {
  const { mb, W, D } = g;
  lotPad(g, M('gravel', 4, 4, 0xd0c8b8));
  const legs = 6, R = 4.8, top = 22;
  const steel = M('metal', 2, 2, 0xa8b4bc);
  for (let k = 0; k < legs; k++) {
    const a = (k / legs) * Math.PI * 2;
    const bx = Math.sin(a) * (R + 1.2), bz = Math.cos(a) * (R + 1.2);
    const tx = Math.sin(a) * (R - 0.6), tz = Math.cos(a) * (R - 0.6);
    const dx = tx - bx, dz = tz - bz;
    mb.push().translate(bx, 0, bz).rotY(Math.atan2(dx, dz)).rotX(Math.atan2(Math.hypot(dx, dz), top));
    mb.boxC(0, 0, 0.45, 0.45, 0, Math.hypot(top, Math.hypot(dx, dz)), { side: steel, top: null });
    mb.pop();
  }
  // bracing ring + riser
  mb.lathe(0, 0, [[R + 0.35, 11], [R + 0.35, 11.3]], legs, steel);
  mb.cyl(0, 0, 0.8, 0, top, 8, steel, null);
  // the tank (ellipsoid-ish) + walkway
  const tank = M('metal', 2, 2, 0xdfe6ea);
  const prof: [number, number][] = [[0.8, top], [R * 0.8, top + 1.2], [R, top + 3.2], [R, top + 7], [R * 0.75, top + 9], [0.01, top + 10]];
  mb.lathe(0, 0, prof, 16, tank);
  mb.lathe(0, 0, [[R + 0.8, top + 3.1], [R + 0.8, top + 3.3]], 16, steel);
  mb.lathe(0, 0, [[R + 0.8, top + 3.3], [R + 0.8, top + 4.2]], 16, M('grille', 2, 2, 0x8a949c), {});
  // the county name, painted on the street side
  const id = currentMap ?? (['appalachia', 'norcal', 'florida'] as const)[Math.abs(g.spec.seed) % 3];
  const tile = 'lm:tower:' + (COUNTY_NAMES[id] ? id : 'generic');
  mb.lathe(0, 0, [[R + 0.03, top + 4.4], [R + 0.03, top + 6.8]], 12, M(tile, 0, 0, WHITE, { ao: false }), { a0: -1.1, a1: 1.1 });
  mb.lathe(0, 0, [[R + 0.03, top + 4.4], [R + 0.03, top + 6.8]], 12, M(tile, 0, 0, WHITE, { ao: false }), { a0: Math.PI - 1.1, a1: Math.PI + 1.1 });
  mb.boxC(0, 0, 0.5, 0.5, top + 10, 0.5, S('neonRed'));
  fence(g, -W / 2 + 0.5, D / 2 - 0.5, W / 2 - 0.5, D / 2 - 0.5, 2.2);
  fence(g, W / 2 - 0.5, D / 2 - 0.5, W / 2 - 0.5, -D / 2 + 0.5, 2.2);
  fence(g, W / 2 - 0.5, -D / 2 + 0.5, -W / 2 + 0.5, -D / 2 + 0.5, 2.2);
  fence(g, -W / 2 + 0.5, -D / 2 + 0.5, -W / 2 + 0.5, D / 2 - 0.5, 2.2);
  g.label = `Water Tower (${COUNTY_NAMES[id] ?? 'SLOPMERICA'})`;
}

export function buildLandmark(g: GenCtx, id: LandmarkId) {
  switch (id) {
    case 'slopCannon': return slopCannon(g);
    case 'slop69Field': return slop69Field(g);
    case 'pigCabanaResort': return pigCabana(g);
    case 'neuralFlyDatacenter': return neuralFly(g);
    case 'propaneParadise': return propaneParadise(g);
    case 'fillErUpMegaStation': return fillErUpMega(g);
    case 'megachurch': return megachurch(g);
    case 'waterTower': return waterTower(g);
  }
}
