// comLow: the stroad. Gas stations with canopies, fast food with drive-thru
// lanes and pole signs, Dollar Colonel, smoke/vape/pawn/liquor, strip malls with
// a sign for every tenant. Parking goes out front.
import { brandById, brandsFor, BRANDS, Brand, Archetype } from '../art/brands';
import { hasTile } from '../art';
import { M, S, Mat, rgb, WHITE, RGB } from './mesh';
import {
  GenCtx, lotPad, parkingLot, car, tree, shrub, poleSign, wallSign, sideSign, canopy, pumpIsland, dumpster, iceBox, propaneCage,
  vending, flagpole, tubeMan, picnicTable, smoker, lampPost, patch, mats, monumentSign, hvac, fence,
} from './props';
import { FAC, WALL, ROOF } from './blocks';
import { pickArch } from './archetypes';

function chooseArch(g: GenCtx): Archetype {
  const { spec } = g;
  return pickArch(g.rng, 'comLow', spec.level, spec.widthCells, spec.depthCells, spec.brand);
}

function pickBrand(g: GenCtx, arch: Archetype): Brand {
  const given = brandById(g.spec.brand);
  if (given && (given.arch ?? []).includes(arch)) return given; // generator already checked the level fit
  let pool = brandsFor('comLow', arch, g.spec.level);
  if (!pool.length) pool = BRANDS.filter((b) => (b.arch ?? []).includes(arch));
  if (!pool.length) pool = [brandById('dollarColonel')!];
  return g.rng.weighted(pool, (b) => b.weight ?? 1);
}

export const hexNum = (s: string) => parseInt(s.slice(1), 16);

const sign = (b: Brand | string) => {
  const id = typeof b === 'string' ? b : b.id;
  return hasTile('sign:' + id) ? 'sign:' + id : 'sign:vacant';
};

/** A store volume at the back of the lot with storefront, parapet band and wall sign. */
function store(g: GenCtx, x0: number, x1: number, z0: number, z1: number, h: number, o: { front?: Mat; side?: Mat; band?: RGB | number | null; sign?: string; signW?: number; roof?: Mat; awning?: RGB | number }) {
  const { mb } = g;
  const side = o.side ?? WALL.stucco();
  const front = o.front ?? FAC.storefront(g.rng);
  mb.box(x0, x1, 0, Math.min(h, 4), z0, z1, { f: front, b: side, l: side, r: side, top: null });
  if (h > 4) mb.box(x0, x1, 4, h, z0, z1, { side, top: null });
  mb.parapet(x0, x1, z0, z1, h, 0.8, side, o.roof ?? ROOF.flat());
  if (o.band !== null && o.band !== undefined) {
    const bm = M('plain', 2, 2, o.band, { ao: false });
    mb.box(x0 - 0.15, x1 + 0.15, h - 0.2, h + 0.9, z1, z1 + 0.25, { side: bm, top: bm, b: null });
  }
  if (o.awning !== undefined) {
    const am = M('metal', 2, 2, o.awning, { ao: false });
    mb.poly([[x0, 3.1, z1 + 1.4], [x1, 3.1, z1 + 1.4], [x1, 3.7, z1], [x0, 3.7, z1]], am);
    mb.poly([[x1, 3.1, z1 + 1.4], [x0, 3.1, z1 + 1.4], [x0, 3.7, z1], [x1, 3.7, z1]], am); // underside
  }
  if (o.sign) {
    const sw = o.signW ?? Math.min(x1 - x0 - 1, 9);
    wallSign(g, (x0 + x1) / 2, h - 0.05 + (o.band !== null && o.band !== undefined ? 0 : -1.2), z1 + 0.25, sw, o.sign, sw / 4.6);
  }
}

// ------------------------------------------------------------------ gas
function gas(g: GenCtx, b: Brand) {
  const { mb, rng, W, D, spec } = g;
  lotPad(g, mats.concrete());
  const dump = spec.level === 1 || b.id === 'possumPetes' || b.id === 'kwikSketchy';
  const small = D < 16 || W < 16;
  const sw = Math.min(W - 3, small ? 7 : 14 + rng.float() * 4), sd = small ? Math.min(D - 5, 5) : Math.min(D * 0.35, 10);
  const sz0 = -D / 2 + 1.2, sz1 = sz0 + sd;
  const sx = small ? -W / 2 + sw / 2 + 1 : (rng.float() - 0.5) * (W - sw - 3);
  const side = dump ? WALL.cinder(0xd8d0c0) : WALL.stucco(rgb(0xf0ece4));
  store(g, sx - sw / 2, sx + sw / 2, sz0, sz1, 4.4, { side, band: hexNum(b.colors[0]), sign: sign(b), signW: Math.min(sw - 1, 8) });
  // canopy + pumps
  const cz1 = D / 2 - (small ? 0.8 : 2.5), cz0 = Math.max(sz1 + 2.5, cz1 - (small ? 5 : 10));
  const cx0 = -W / 2 + (small ? 1 : 2), cx1 = W / 2 - (small ? 1 : 2);
  const cw = Math.min(cx1 - cx0, 28);
  const ca = (cx0 + cx1) / 2 - cw / 2, cb = ca + cw;
  if (cz1 - cz0 >= 4) {
    canopy(g, ca, cb, cz0, cz1, 5.2, b.id);
    const n = Math.max(1, Math.floor(cw / 6.5));
    for (let i = 0; i < n; i++) {
      const px = ca + ((i + 0.5) * cw) / n;
      pumpIsland(g, px, (cz0 + cz1) / 2);
      if (rng.chance(0.5)) car(g, px + (rng.chance(0.5) ? 2.2 : -2.2), (cz0 + cz1) / 2 + (rng.float() - 0.5), rng.chance(0.5) ? 0 : Math.PI);
    }
  }
  // front-of-store junk: ice, propane (My Own Propane!), vending machine, air pump
  iceBox(g, sx - sw / 2 + 1.2, sz1 + 0.6);
  propaneCage(g, sx + sw / 2 - 1.3, sz1 + 0.6);
  if (!small) vending(g, sx + sw / 2 - 3, sz1 + 0.5);
  g.em.push({ kind: 'cigarette', pos: [sx + 0.8, 1.6, sz1 + 1.2] });
  // pole sign with prices, taller with level (and traffic)
  const ph = 7 + spec.level * 2.2;
  poleSign(g, W / 2 - 3.4, D / 2 - 1.2, ph, small ? 4.4 : 6, sign(b), { price: true });
  if (b.id === 'petroPatriot') flagpole(g, -W / 2 + 1.5, D / 2 - 1.5, 26, 12);
  else if (rng.chance(0.3)) flagpole(g, -W / 2 + 1.2, D / 2 - 1.2, 9, 2.6);
  dumpster(g, sx + sw / 2 + 1.6 > W / 2 - 1 ? sx - sw / 2 - 1.6 : sx + sw / 2 + 1.6, sz0 + 1, Math.PI / 2);
  if (!small) car(g, sx - sw / 2 + 2, sz1 + 3.5, Math.PI, rng.pick(['pickup', 'lifted']));
  g.label = b.name;
}

// ------------------------------------------------------------------ fast food
function fastFood(g: GenCtx, b: Brand) {
  const { mb, rng, W, D, spec } = g;
  lotPad(g, mats.asphalt());
  const bw = Math.min(W - 7, 13), bd = Math.min(D * 0.4, 9);
  const bz0 = -D / 2 + 3.5, bz1 = bz0 + bd;
  const bx = -W / 2 + 1.5 + bw / 2;
  const h = 4.2;
  const brick = rng.chance(0.4);
  const side = brick ? WALL.brickTan() : WALL.stucco(rgb(0xf2ece0));
  const front = FAC.storefront(rng);
  mb.box(bx - bw / 2, bx + bw / 2, 0, h, bz0, bz1, { f: front, b: side, l: side, r: side, top: null });
  const prim = M('metal', 2, 2, hexNum(b.colors[0]), { ao: false });
  const sec = M('metal', 2, 2, hexNum(b.colors[1]), { ao: false });
  if (b.id === 'waddaBurger') {
    // the orange-striped A-frame
    const n = 6;
    for (let i = 0; i < n; i++) {
      const a = bx - bw / 2 + (i * bw) / n, c = a + bw / n;
      mb.gable(a, c, bz0, bz1, h, 3.6, 'x', i % 2 ? M('metal', 2, 2, 0xffffff) : M('metal', 2, 2, 0xff6b00), null, 0.4, 0.1);
    }
    mb.poly([[bx - bw / 2, h, bz0], [bx - bw / 2, h, bz1], [bx - bw / 2, h + 3.6, (bz0 + bz1) / 2]], M('plain', 2, 2, 0xff6b00));
    mb.poly([[bx + bw / 2, h, bz1], [bx + bw / 2, h, bz0], [bx + bw / 2, h + 3.6, (bz0 + bz1) / 2]], M('plain', 2, 2, 0xff6b00));
  } else {
    // mansard band in the brand color, flat roof behind
    const t = 1.2;
    mb.poly([[bx - bw / 2 - t, h, bz1 + t], [bx + bw / 2 + t, h, bz1 + t], [bx + bw / 2, h + 1.4, bz1], [bx - bw / 2, h + 1.4, bz1]], prim);
    mb.poly([[bx + bw / 2 + t, h, bz0 - t], [bx - bw / 2 - t, h, bz0 - t], [bx - bw / 2, h + 1.4, bz0], [bx + bw / 2, h + 1.4, bz0]], prim);
    mb.poly([[bx - bw / 2 - t, h, bz0 - t], [bx - bw / 2 - t, h, bz1 + t], [bx - bw / 2, h + 1.4, bz1], [bx - bw / 2, h + 1.4, bz0]], prim);
    mb.poly([[bx + bw / 2 + t, h, bz1 + t], [bx + bw / 2 + t, h, bz0 - t], [bx + bw / 2, h + 1.4, bz0], [bx + bw / 2, h + 1.4, bz1]], prim);
    mb.flat(bx - bw / 2, bx + bw / 2, bz0, bz1, h + 1.4, ROOF.flat());
    mb.box(bx - bw / 2 - t, bx + bw / 2 + t, h - 0.3, h, bz0 - t, bz1 + t, { side: sec, top: null, bottom: sec });
  }
  // sign rides on the mansard / gable front so it reads from the stroad
  wallSign(g, bx, h + 0.15, bz1 + 1.3, Math.min(bw - 2, 7), sign(b), 1.3);
  sideSign(g, bx + bw / 2, h - 1.4, (bz0 + bz1) / 2, Math.min(bd - 1, 5), sign(b), 1, 1.1);
  hvac(g, bx - 2, h + 1.4, (bz0 + bz1) / 2, 0.8);
  g.em.push({ kind: 'smoke', pos: [bx + 2, h + 2.6, bz0 + 1.5] });
  mb.cyl(bx + 2, bz0 + 1.5, 0.3, h + 1.4, h + 2.4, 6, M('metal', 2, 2, 0x999999));
  // drive-thru lane wrapping around the back and the right side, with the line of cars
  const lx = bx + bw / 2 + 1.8;
  patch(g, lx - 1.6, lx + 1.6, bz0 - 3, D / 2 - 5, mats.asphalt(), 0.09);
  patch(g, bx - bw / 2 - 1.5, lx + 1.6, bz0 - 3.2, bz0 - 0.2, mats.asphalt(), 0.09);
  const mbrd = S('menuBoard');
  mb.box(lx + 1.8, lx + 2.0, 0.4, 2.2, bz0 + 1, bz0 + 3.6, { r: null, l: mbrd, side: M('plain', 2, 2, 0x222222), top: M('plain', 2, 2, 0x222222) });
  mb.decal('+x', (bz0 + bz1) / 2 + 1, 1.0, bx + bw / 2, 1.4, 1.2, S('winPictureLit'));
  const queue = rng.int(2, 3 + spec.level);
  for (let i = 0; i < queue; i++) {
    const qz = bz0 + 2 + i * 5.4;
    if (qz > D / 2 - 6) break;
    car(g, lx, qz, Math.PI);
  }
  // pole sign + parking in front
  poleSign(g, W / 2 - 2.8, D / 2 - 1.2, 8 + spec.level * 2, 5.5, sign(b));
  if (D >= 24) parkingLot(g, -W / 2 + 0.5, lx - 2, bz1 + 3.5, D / 2 - 0.3, 0.35, { lamps: true });
  else for (let x = -W / 2 + 2; x < lx - 3; x += 3) if (rng.chance(0.5)) car(g, x, bz1 + 3, Math.PI);
  if (b.id === 'chickFilEh') g.label = `${b.name} (closed Sundays)`;
  else g.label = b.name;
  if (rng.chance(0.5)) picnicTable(g, bx - bw / 2 + 1.5, bz1 + 1.6);
  shrub(g, bx - bw / 2 - 0.8, bz1 - 0.5);
}

// ------------------------------------------------------------------ standalone shop
function shop(g: GenCtx, b: Brand) {
  const { mb, rng, W, D, spec } = g;
  lotPad(g, mats.asphalt());
  const dollar = b.id === 'dollarColonel';
  const smoke = b.kind === 'smoke';
  const bw = Math.min(W - 2, dollar ? 16 : 7 + rng.float() * 6), bd = Math.min(D - (D >= 16 ? 9 : 3), dollar ? 14 : 10);
  const z0 = -D / 2 + 1, z1 = z0 + bd;
  const x = (rng.float() - 0.5) * (W - bw - 2);
  const side = dollar ? M('metalPanel', 4, 4, 0xe6dcc0) : smoke ? WALL.cinder(rgb(rng.pick([0xffffff, 0xe0d8f0, 0xd8e8e0]))) : rng.chance(0.5) ? WALL.stucco(rgb(0xece4d4)) : WALL.brick();
  store(g, x - bw / 2, x + bw / 2, z0, z1, dollar ? 5.2 : 4.4, { side, band: dollar ? 0x111111 : hexNum(b.colors[0]), sign: sign(b), signW: Math.min(bw - 0.8, dollar ? 12 : 7), awning: smoke || rng.chance(0.3) ? hexNum(b.colors[0]) : undefined });
  if (smoke) {
    for (let i = 0; i < 2; i++) g.em.push({ kind: 'cigarette', pos: [x - bw / 2 + 1 + i * 1.3, 1.6, z1 + 1] });
    g.em.push({ kind: 'smoke', pos: [x + bw / 2 - 1, 1.7, z1 + 1.2] });
  }
  if (D >= 16) {
    parkingLot(g, -W / 2 + 0.5, W / 2 - 0.5, z1 + 2, D / 2 - 0.3, 0.3, { lamps: W >= 16 });
    if (W >= 16) poleSign(g, W / 2 - 2.6, D / 2 - 0.9, 6 + spec.level * 1.5, 4.4, sign(b));
    else monumentSign(g, W / 2 - 2.4, D / 2 - 0.8, 3.2, sign(b));
  } else {
    patch(g, -W / 2 + 0.2, W / 2 - 0.2, z1, D / 2, mats.concrete(), 0.1);
  }
  if (dollar && W - bw >= 3.5 && rng.chance(0.6)) {
    // pallets of stock blocking the fire exit
    const cardboard = M('plain', 2, 2, 0xc8a26a);
    for (let i = 0; i < 3; i++) mb.boxC(x + bw / 2 + 1 > W / 2 - 0.5 ? x - bw / 2 - 1 : x + bw / 2 + 1, z0 + 1.5 + i * 1.3, 1.1, 1.1, 0, 1.1, cardboard);
  }
  if (b.id === 'myOwnPropane' || b.id === 'propaneParadise') for (let i = 0; i < 2; i++) propaneCage(g, x - bw / 2 + 1.2 + i * 2.2, z1 + 0.6);
  if (b.id === 'slopEnergy') for (let i = 0; i < 3; i++) vending(g, x - bw / 2 + 0.8 + i * 1, z1 + 0.5);
  dumpster(g, x + bw / 2 + 1.2 > W / 2 - 1 ? x - bw / 2 - 1.2 : x + bw / 2 + 1.2, z0 + 1, Math.PI / 2);
  g.label = b.name;
}

// ------------------------------------------------------------------ strip mall
function strip(g: GenCtx) {
  const { mb, rng, W, D, spec } = g;
  lotPad(g, mats.asphalt());
  const bd = Math.min(D * 0.4, 14), bz0 = -D / 2 + 1, bz1 = bz0 + bd;
  const x0 = -W / 2 + 1, x1 = W / 2 - 1;
  const h = spec.level >= 4 ? 6 : 5;
  const n = Math.max(2, Math.round((x1 - x0) / (spec.level >= 5 ? 9 : 7)));
  const uw = (x1 - x0) / n;
  const fancy = spec.level >= 5;
  const wall = fancy ? WALL.brickTan() : WALL.stucco(rgb(rng.pick([0xe8dcc8, 0xd8d0c0, 0xece4d4])));
  mb.box(x0, x1, 0, h, bz0, bz1, { f: null, b: wall, l: wall, r: wall, top: null });
  mb.parapet(x0, x1, bz0, bz1, h, 1, wall, ROOF.flat());
  // tenants
  const pool = BRANDS.filter((b) => b.zones.includes('comLow') && (b.arch ?? []).some((a) => a === 'strip' || a === 'shop') && b.kind !== 'gas');
  const tenants: string[] = [];
  const given = brandById(spec.brand);
  for (let i = 0; i < n; i++) {
    const r = rng.float();
    let t: string;
    if (i === 0 && given) t = given.id;
    else if (r < 0.1) t = 'vacant';
    else if (r < 0.14) t = 'spiritHalloween';
    else if (r < 0.2) t = rng.pick(['mattressKingdom', 'dollarColonel', 'slop']);
    else t = rng.weighted(pool, (b) => b.weight ?? 1).id;
    tenants.push(t);
  }
  for (let i = 0; i < n; i++) {
    const a = x0 + i * uw, c = a + uw;
    const vacant = tenants[i] === 'vacant';
    mb.poly([[a, 0, bz1], [c, 0, bz1], [c, 4, bz1], [a, 4, bz1]], vacant ? M('storefront', 8, 4, 0x8a8a8a, { bays: 2, floors: 1 }) : FAC.storefront(rng));
    mb.poly([[a, 4, bz1], [c, 4, bz1], [c, h, bz1], [a, h, bz1]], wall);
    if (vacant) mb.decal('+z', (a + c) / 2, 1.6, bz1, 2.2, 0.8, S('forLease'));
    // divider pilaster
    mb.box(a - 0.25, a + 0.25, 0, h + 0.4, bz1, bz1 + 0.5, { side: fancy ? M('stone', 3, 3) : wall, top: wall, b: null });
  }
  // covered walkway + fascia with the tenant signs on it
  const cz = bz1 + 2.6;
  const col = fancy ? M('stone', 3, 3) : M('plain', 2, 2, 0xe8e4dc);
  for (let i = 0; i <= n; i++) mb.boxC(x0 + i * uw, cz - 0.3, 0.4, 0.4, 0, 3.9, { side: col, top: null });
  const fascia = M('plain', 2, 2, rgb(rng.pick([0x8a3a2a, 0x2a4a6a, 0x3a3a3a, 0x6a5a4a])));
  mb.box(x0 - 0.3, x1 + 0.3, 3.9, 5.0, bz1, cz, { f: fascia, l: fascia, r: fascia, top: M('metalRoof', 4, 4, 0x9a9a94), bottom: M('plain', 2, 2, 0xd8d4cc), b: null });
  if (fancy) for (let i = 0; i < n; i += 2) mb.gable(x0 + i * uw, x0 + (i + 1) * uw, bz1 - 1, cz, 5.0, 1.8, 'z', M('metalRoof', 4, 4, 0x3a4a3a), M('plain', 2, 2, 0xe8e4dc), 0.2);
  for (let i = 0; i < n; i++) {
    const t = tenants[i];
    const tile = t === 'vacant' ? 'sign:vacant' : sign(t);
    wallSign(g, x0 + (i + 0.5) * uw, 4.0, cz + 0.02, Math.min(uw - 1.2, 6.5), tile, 0.95);
  }
  // parking: lots of it
  parkingLot(g, -W / 2 + 0.4, W / 2 - 0.4, cz + 1.2, D / 2 - 0.4, 0.28, { trees: true, lamps: true });
  // tenant pylon at the road
  const px = W / 2 - 3.2, pz = D / 2 - 1;
  const steel = M('metal', 2, 2, 0x8a8e92);
  const pw = 5, rows = Math.min(n, 4);
  const top = 6 + spec.level * 1.5 + rows * 1.3;
  mb.boxC(px, pz, pw + 0.6, 0.8, 0, top, { side: M(fancy ? 'stone' : 'brickTan', 3, 3), top: null });
  mb.boxC(px, pz, pw + 1.2, 1.2, top, 0.4, M('plain', 2, 2, 0x2a2a2c));
  for (let i = 0; i < rows; i++) {
    const y = top - 1.35 - i * 1.3;
    const tile = tenants[i] === 'vacant' ? 'sign:vacant' : sign(tenants[i]);
    mb.box(px - pw / 2, px + pw / 2, y, y + 1.25, pz - 0.45, pz + 0.45, { f: S(tile), b: S(tile), l: steel, r: steel, top: null });
  }
  dumpster(g, x0 + 1.2, bz0 - 0.5 < -D / 2 + 1 ? bz0 + 1 : bz0 - 1.2, 0);
  for (let i = 0; i < 2; i++) g.em.push({ kind: 'cigarette', pos: [x0 + rng.float() * (x1 - x0), 1.6, bz1 + 1.5] });
  const names = ['Sprawl Pointe Plaza', 'Creekside Commons', 'Oak Hollow Shoppes', 'Exit 9 Marketplace', 'The Shoppes at Deer Run', 'Parkway Crossing'];
  g.label = `${rng.pick(names)} (${n} units, ${tenants.filter((t) => t === 'vacant').length} vacant)`;
}

// ------------------------------------------------------------------ Waffle Hut & friends
function diner(g: GenCtx, b: Brand) {
  const { mb, rng, W, D, spec } = g;
  lotPad(g, mats.asphalt());
  const bw = Math.min(W - 4, 12), bd = Math.min(D - 6, 7);
  const z0 = -D / 2 + 2, z1 = z0 + bd;
  const x = -W / 2 + 2 + bw / 2;
  const side = WALL.stucco(0xf0ead8);
  mb.box(x - bw / 2, x + bw / 2, 0, 3.6, z0, z1, { f: M('storefront', 8, 4, WHITE, { bays: 2, floors: 1 }), side, top: null });
  mb.box(x - bw / 2, x + bw / 2, 1.0, 1.25, z1, z1 + 0.05, M('plain', 2, 2, 0xffd400));
  mb.gable(x - bw / 2, x + bw / 2, z0, z1, 3.6, 1.2, 'x', M('metalRoof', 4, 4, 0x6a4a3a), side, 0.5);
  // roof-mounted tile sign
  mb.box(x - 4, x + 4, 4.9, 6.9, (z0 + z1) / 2 - 0.2, (z0 + z1) / 2 + 0.2, { f: S(sign(b)), b: S(sign(b)), side: M('plain', 2, 2, 0x111111) });
  poleSign(g, W / 2 - 2.6, D / 2 - 1, 8 + spec.level * 2, 5, sign(b));
  for (let i = 0; i < 4; i++) if (rng.chance(0.7)) car(g, x - bw / 2 + 1.5 + i * 3, z1 + 3.2, Math.PI);
  g.em.push({ kind: 'smoke', pos: [x + 2, 5.4, z0 + 1] });
  g.label = b.id === 'waffleHut' ? 'Waffle Hut (index: GREEN)' : b.name;
}

// ------------------------------------------------------------------ bars
function bar(g: GenCtx, b: Brand) {
  const { mb, rng, W, D, spec } = g;
  lotPad(g, mats.asphalt());
  const bw = Math.min(W - 3, 12), bd = Math.min(D - (D >= 16 ? 8 : 3), 10);
  const z0 = -D / 2 + 1, z1 = z0 + bd;
  const x = (rng.float() - 0.5) * (W - bw - 2);
  const side = rng.chance(0.5) ? WALL.brickDark() : WALL.cinder(0x6a6a70);
  mb.box(x - bw / 2, x + bw / 2, 0, 4.2, z0, z1, { side, top: null });
  mb.parapet(x - bw / 2, x + bw / 2, z0, z1, 4.2, 0.6, side, ROOF.flat());
  mb.decal('+z', x - bw / 4, 0, z1, 1.1, 2.2, S('doorMetal'));
  mb.decal('+z', x + bw / 5, 1.2, z1, 2.2, 1.0, S('winBoard'));
  wallSign(g, x, 2.6, z1, Math.min(bw - 1.5, 6), sign(b), 1.4);
  if (b.id === 'badLuckClub') mb.box(x + bw / 2 - 2.2, x + bw / 2 - 0.4, 2.2, 3.2, z1, z1 + 0.1, S('neonLime'));
  for (let i = 0; i < 3; i++) g.em.push({ kind: 'cigarette', pos: [x - bw / 2 + 1 + i * 1.1, 1.6, z1 + 0.9] });
  if (D >= 16) {
    parkingLot(g, -W / 2 + 0.5, W / 2 - 0.5, z1 + 2, D / 2 - 0.3, 0.6, { lamps: false });
    lampPost(g, W / 2 - 1.5, z1 + 1.5, 7, 1);
  }
  car(g, x + bw / 2 + 1.5 > W / 2 - 1 ? x - bw / 2 - 1.5 : x + bw / 2 + 1.5, z0 + 3, 0, 'lifted');
  g.label = b.name;
}

// ------------------------------------------------------------------ coffee / donut / daiquiri drive-thru kiosk
function coffee(g: GenCtx, b: Brand) {
  const { mb, rng, W, D, spec } = g;
  lotPad(g, mats.asphalt());
  const oneLane = W < 14;
  const kw = oneLane ? Math.min(W - 4.5, 4) : Math.min(W - 8, 7), kd = Math.min(D - 5, 4.5);
  const kx = oneLane ? -W / 2 + 0.5 + kw / 2 : 0;
  const z0 = -D / 2 + 2.5, z1 = z0 + kd;
  const side = M('metalPanel', 4, 4, hexNum(b.colors[1]));
  mb.box(kx - kw / 2, kx + kw / 2, 0, 3.4, z0, z1, { f: M('storefront', 8, 4, WHITE, { bays: 2, floors: 1 }), side, top: null });
  mb.shed(kx - kw / 2, kx + kw / 2, z0, z1, 3.4, 0.8, M('metal', 2, 2, hexNum(b.colors[0])), side, 0.5);
  wallSign(g, kx, 2.7, z1 + 0.4, Math.min(kw - 0.4, 5.5), sign(b), 1.1);
  // drive-thru lanes (two if there's room), always full
  for (const lx of oneLane ? [kx + kw / 2 + 1.9] : [-kw / 2 - 2, kw / 2 + 2]) {
    patch(g, lx - 1.5, lx + 1.5, -D / 2 + 0.5, D / 2 - 0.3, mats.asphalt(), 0.09);
    for (let z = -D / 2 + 3; z < D / 2 - 3; z += 5.4) if (rng.chance(0.85)) car(g, lx, z, Math.PI);
  }
  poleSign(g, W / 2 - 1.8, D / 2 - 1, 6 + spec.level, 3.6, sign(b));
  g.label = `${b.name} (drive-thru only)`;
}

// ------------------------------------------------------------------ sit-down chains
function restaurant(g: GenCtx, b: Brand) {
  const { mb, rng, W, D, spec } = g;
  lotPad(g, mats.asphalt());
  const bw = Math.min(W - 4, 20), bd = Math.min(D * 0.45, 14);
  const z0 = -D / 2 + 1.5, z1 = z0 + bd;
  const x = (rng.float() - 0.5) * (W - bw - 3);
  const barn = b.id === 'crackerBarn';
  const side = barn ? M('wood', 4, 4, 0xc08a5a) : rng.chance(0.5) ? WALL.stucco(0xe8d8b8) : WALL.brick();
  mb.box(x - bw / 2, x + bw / 2, 0, 4.6, z0, z1, { f: FAC.storefront(rng), side, top: null });
  mb.decal('+z', x - bw / 4, 1, z1, 3, 1.8, S('winPictureLit'));
  mb.decal('+z', x + bw / 4, 1, z1, 3, 1.8, S('winPictureLit'));
  if (barn) {
    mb.gable(x - bw / 2, x + bw / 2, z0, z1, 4.6, 3, 'x', M('metalRoof', 4, 4, 0x8a8a84), side, 0.5);
    // porch with rocking chairs
    mb.box(x - bw / 2, x + bw / 2, 0, 0.5, z1, z1 + 3, { side: M('deck', 4, 4), top: M('deck', 4, 4) });
    for (let i = 0; i < 6; i++) mb.boxC(x - bw / 2 + 1.5 + i * ((bw - 3) / 5), z1 + 2.2, 0.6, 0.6, 0.5, 0.9, { side: M('wood', 4, 4, 0x6a4a2a), top: M('wood', 4, 4, 0x6a4a2a) });
    mb.shed(x - bw / 2, x + bw / 2, z1, z1 + 3, 3.2, 0.4, M('metalRoof', 4, 4, 0x8a8a84), null, 0.2);
  } else {
    mb.hip(x - bw / 2, x + bw / 2, z0, z1, 4.6, 2.2, ROOF.shingles(rgb(rng.pick([0x9a4a3a, 0x6a5a4a, 0x4a5a3a]))), 0.6);
    mb.box(x - 2.5, x + 2.5, 0, 5.4, z1, z1 + 2.2, { f: side, l: side, r: side, top: null, b: null });
    mb.gable(x - 2.5, x + 2.5, z1 - 1, z1 + 2.2, 5.4, 1.8, 'z', ROOF.shingles(0x8a6a5a), side, 0.2);
    mb.decal('+z', x, 0, z1 + 2.2, 1.8, 2.3, S('doorDouble'));
  }
  wallSign(g, x, barn ? 5.2 : 3.2, z1 + (barn ? 0 : 2.2), Math.min(bw * 0.5, 8), sign(b), barn ? 1.8 : 1.2);
  if (b.id === 'pigCabana' || b.id === 'hoots' || b.id === 'goldenTrough') smoker(g, x + bw / 2 - 1, z0 - 1 < -D / 2 + 0.5 ? z0 + 1 : z0 - 1);
  g.em.push({ kind: 'smoke', pos: [x - bw / 3, 7, z0 + 2] });
  parkingLot(g, -W / 2 + 0.4, W / 2 - 0.4, z1 + (barn ? 4 : 3.2), D / 2 - 0.3, 0.45, { trees: true, lamps: true });
  poleSign(g, -W / 2 + 3, D / 2 - 1, 7 + spec.level * 1.5, 5, sign(b));
  g.label = b.name;
}

// ------------------------------------------------------------------ car lots
function carLot(g: GenCtx, b: Brand) {
  const { mb, rng, W, D, spec } = g;
  lotPad(g, mats.asphalt());
  const ow = Math.min(W * 0.35, 9), od = Math.min(D * 0.3, 7);
  const z0 = -D / 2 + 1, z1 = z0 + od;
  const cyber = b.id === 'cyberslop';
  const x = -W / 2 + 1 + ow / 2;
  if (cyber) {
    mb.box(x - ow / 2, x + ow / 2, 0, 5, z0, z1, { f: M('glassPlain', 3, 3), side: M('metal', 2, 2, 0xd8dadc), top: ROOF.flat() });
  } else {
    mb.box(x - ow / 2, x + ow / 2, 0, 3.2, z0, z1, { f: FAC.storefront(rng), side: M('trailer', 4, 3, 0xf4f4f0), top: ROOF.flat() });
  }
  wallSign(g, x, cyber ? 3.8 : 3.2, z1, Math.min(ow, 7), sign(b), 1.2);
  // inventory in tight rows
  const kinds = cyber ? ['cyber'] : b.id === 'coalRollin' ? ['lifted', 'pickup'] : ['sedan', 'suv', 'pickup', 'van', 'lifted'];
  let stock = 0;
  for (let z = z1 + 3; z < D / 2 - 2 && stock < 26; z += 5.8) for (let cx = -W / 2 + 2; cx < W / 2 - 1.5 && stock < 26; cx += 2.6) {
    if (cx < x + ow / 2 + 1 && z < z1 + 1) continue;
    car(g, cx, z, Math.PI, rng.pick(kinds as ('cyber' | 'lifted' | 'pickup' | 'sedan' | 'suv' | 'van')[]), rng.pick([0xe8e8e6, 0x1a1a1c, 0xa9adb1, 0xc0392b, 0x2980b9]));
    stock++;
  }
  // tube men, flags, the works
  for (let i = 0; i < (cyber ? 0 : 3); i++) tubeMan(g, -W / 2 + 2 + rng.float() * (W - 4), D / 2 - 1.2, rng.pick([0xff3b3b, 0x3bd1ff, 0xffd400, 0x6fe36f]));
  flagpole(g, W / 2 - 1.2, D / 2 - 1.2, cyber ? 10 : 18, cyber ? 3 : 8);
  poleSign(g, 0, D / 2 - 0.8, 8 + spec.level * 1.5, 6, sign(b));
  g.label = b.name;
}

export function genComLow(g: GenCtx) {
  const arch = chooseArch(g);
  if (arch === 'strip') return strip(g);
  const b = pickBrand(g, arch);
  g.brand = b.id;
  switch (arch) {
    case 'gas': return gas(g, b);
    case 'fastFood': return fastFood(g, b);
    case 'diner': return diner(g, b);
    case 'bar': return bar(g, b);
    case 'coffee': return coffee(g, b);
    case 'restaurant': return restaurant(g, b);
    case 'carLot': return carLot(g, b);
    default: return shop(g, b);
  }
}

export { store, sign as signTile };
