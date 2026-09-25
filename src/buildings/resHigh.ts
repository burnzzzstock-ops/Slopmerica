// resHigh: garden apartments -> 5-over-1 "luxury" -> mid-rise -> towers ->
// L5 megablocks (Tokyo meets Delhi: laundry, AC units, rooftop tanks, stacked billboards).
import { APT_NAMES, MEGABLOCK_NAMES, RESI_TOWER_NAMES, MIDRISE_NAMES } from '../art/names';
import { M, S, rgb, WHITE, mulRGB } from './mesh';
import { GenCtx, lotPad, parkingLot, dumpster, tree, shrub, car, monumentSign, wallSign, acUnit, mats, patch, fence } from './props';
import { FAC, FLOOR, WALL, ROOF, block, roofJunk, balconies, neonBlade, capFloors } from './blocks';

function aptName(g: GenCtx) {
  const i = g.rng.int(0, APT_NAMES.length - 1);
  return { i, name: APT_NAMES[i], tile: 'apt:' + i };
}

// ------------------------------------------------------------------ L1 garden apartments
function garden(g: GenCtx) {
  const { mb, rng, W, D } = g;
  lotPad(g, M('lawn', 8, 8));
  const floors = rng.chance(0.6) ? 3 : 2;
  const H = floors * FLOOR.apt;
  const fac = rng.chance(0.5) ? FAC.aptSiding(rng, rgb(rng.pick([0xffffff, 0xf0f4ff, 0xfff4e8, 0xeaf2e8]))) : FAC.aptBrick(rng);
  const lotDeep = D >= 24;
  const bd = Math.min(lotDeep ? 12 : D - 4.5, 13);
  const bw = W - (W >= 16 ? 5 : 2);
  const zb = -D / 2 + 1.5;
  const zf = zb + bd;
  const x0 = -bw / 2, x1 = bw / 2;
  block(g, x0, x1, zb, zf, 0, H, fac, { roof: null });
  mb.hip(x0, x1, zb, zf, H, 2.2, ROOF.shingles(rgb(rng.pick([0x9a948e, 0xa89888, 0xb0aaa4]))), 0.5);
  // breezeway stair tower in the middle
  if (bw > 14) {
    mb.box(-1.8, 1.8, 0, H + 0.6, zf - 0.2, zf + 1.4, { f: M('plain', 2, 2, 0x3a3c3e), l: WALL.brickTan(), r: WALL.brickTan(), top: M('metal', 2, 2, 0x555555), b: null });
  }
  balconies(g, x0 + 0.3, x1 - 0.3, zf, FLOOR.apt, floors - 1, FLOOR.apt, 3, { rail: M('plain', 2, 2, 0xe8e4dc, { ao: false }), depth: 1.1, every: 2 });
  const nm = aptName(g);
  if (lotDeep) {
    parkingLot(g, -W / 2 + 0.5, W / 2 - 0.5, zf + 1.5, D / 2 - 0.2, 0.55, { lamps: true });
    monumentSign(g, W / 2 - 4, D / 2 - 1, 5, nm.tile);
  } else {
    patch(g, x0, x1, zf, D / 2, mats.concrete(), 0.1);
    for (let x = x0 + 1; x < x1; x += 4) car(g, x, D / 2 - 2.6, Math.PI);
    wallSign(g, x0 + Math.min(5, bw / 2), H - 1.4, zf, Math.min(6, bw * 0.45), nm.tile, 1.1);
  }
  dumpster(g, x1 + (W >= 16 ? 1.5 : -1.2), zb + 1.4, 0);
  for (let i = 0; i < Math.min(floors * 2, Math.floor((bw - 1) / 1.3)); i++) acUnit(g, x0 + 1 + i * 1.3, zb - 0.6);
  if (W >= 16) tree(g, -W / 2 + 1.8, zb + 3, 0.8);
  g.label = nm.name;
}

// ------------------------------------------------------------------ L2 5-over-1
function fiveOverOne(g: GenCtx) {
  const { mb, rng, W, D } = g;
  lotPad(g, mats.concrete());
  const floors = rng.int(4, 5);
  const P = FLOOR.podium, fh = FLOOR.fiveOver;
  const H = P + floors * fh;
  const x0 = -W / 2 + 1, x1 = W / 2 - 1;
  const zf = D / 2 - 2.2, zb = -D / 2 + 1;
  // podium (concrete, retail that will never be leased)
  mb.box(x0, x1, 0, P, zb, zf, { f: FAC.podium(rng), b: WALL.concrete(), l: WALL.concrete(), r: WALL.concrete(), top: null });
  // wood frame "luxury" floors
  const fac = FAC.fiveOver(rng);
  block(g, x0, x1, zb, zf, P, H, fac, { parapet: 0.9, cap: M('plain', 2, 2, 0x3a3a3c), roof: ROOF.flat() });
  // corner accent tower, one floor taller, different skin
  const cw = Math.min(6, (x1 - x0) * 0.3);
  const left = rng.chance(0.5);
  const ca = left ? x0 - 0.2 : x1 - cw, cb = left ? x0 + cw : x1 + 0.2;
  const accent = rng.chance(0.5) ? WALL.brickDark() : M('metalPanel', 4, 4, rgb(rng.pick([0x3a3a3c, 0x6a4a3a, 0x2a4a5a])));
  const cd = Math.min(cw, zf - zb);
  mb.box(ca, cb, P, H + fh, zf - cd, zf + 0.3, { side: accent, top: null });
  mb.flat(ca, cb, zf - cd, zf + 0.3, H + fh, ROOF.flat());
  mb.box(ca - 0.3, cb + 0.3, H + fh, H + fh + 0.5, zf - cd, zf + 0.6, M('plain', 2, 2, 0x2a2a2c));
  // leasing banner + name
  const nm = aptName(g);
  wallSign(g, left ? x1 - 4 : x0 + 4, P - 1.6, zf, Math.min(6.5, (x1 - x0) * 0.5), nm.tile, 1.2);
  if (W >= 16) mb.decal('+z', (x0 + x1) / 2 + (left ? 2 : -2), P + fh * 2.2, zf, Math.min(10, (x1 - x0) * 0.45), 2.2, S('nowLeasing'), 0.08);
  else mb.decal('+z', (x0 + x1) / 2, P + fh * 1.2, zf, (x1 - x0) * 0.7, 1.4, S('nowLeasing'), 0.08);
  roofJunk(g, x0 + 0.5, x1 - 0.5, zb + 0.5, zf - 0.5, H, 1.4);
  // street trees + parallel parking
  for (let x = -W / 2 + 3; x < W / 2 - 1; x += 7) tree(g, x, D / 2 - 0.9, 0.6, 'round');
  if (rng.chance(0.5)) car(g, (rng.float() - 0.5) * (W - 6), D / 2 - 0.6, Math.PI / 2);
  g.label = `${nm.name} (5-over-1)`;
}

// ------------------------------------------------------------------ L3 mid-rise
function midrise(g: GenCtx) {
  const { mb, rng, W, D } = g;
  lotPad(g, mats.concrete());
  const floors = rng.int(7, 11) + (W >= 24 ? 1 : 0);
  const lobby = 4.2, fh = FLOOR.midrise;
  const H = lobby + floors * fh;
  const x0 = -W / 2 + 1.2, x1 = W / 2 - 1.2, zf = D / 2 - 2, zb = -D / 2 + 1.2;
  const brick = rng.chance(0.5);
  const fac = brick ? FAC.aptBrick(rng) : FAC.midrise(rng, rgb(rng.pick([0xffffff, 0xf0e8dc, 0xe0e4e8])));
  mb.box(x0, x1, 0, lobby, zb, zf, { f: FAC.storefront(rng), side: WALL.concrete(0xc8c0b0), top: null });
  mb.box(x0 - 0.2, x1 + 0.2, lobby - 0.4, lobby, zb - 0.2, zf + 0.4, M('plain', 2, 2, 0x5a5a5a));
  const setback = floors > 9 && D >= 16;
  const hLow = setback ? lobby + (floors - 3) * fh : H;
  block(g, x0, x1, zb, zf, lobby, hLow, fac, { parapet: 1, cap: WALL.concrete(0xb8b0a0) });
  if (setback) block(g, x0 + 2, x1 - 2, zb + 1, zf - 3, hLow, H, fac, { parapet: 1, cap: WALL.concrete(0xb8b0a0) });
  // fire escape down one side
  if (rng.chance(0.6)) {
    const iron = M('plain', 2, 2, 0x1c1c1c, { ao: false });
    const fx = rng.chance(0.5) ? x0 - 0.9 : x1;
    for (let f = 1; f < floors; f += 1) {
      const y = lobby + f * fh;
      mb.box(fx, fx + 0.9, y - 0.1, y, zb + 2, zb + 6, { side: iron, top: iron, bottom: iron });
      mb.box(fx, fx + 0.9, y, y + 0.9, zb + 2, zb + 2.05, iron);
    }
  }
  const top = setback ? { x0: x0 + 2, x1: x1 - 2, z0: zb + 1, z1: zf - 3 } : { x0, x1, z0: zb, z1: zf };
  roofJunk(g, top.x0, top.x1, top.z0, top.z1, H, 0.8, { tanks: rng.int(1, 2), masts: 1 });
  const nm = rng.pick(MIDRISE_NAMES);
  mb.decal('+z', 0, lobby - 1.3, zf + 0.25, Math.min(8, W * 0.4), 0.9, S('apt:' + rng.int(0, APT_NAMES.length - 1)), 0.05);
  for (let x = -W / 2 + 3; x < W / 2 - 1; x += 7) tree(g, x, D / 2 - 0.9, 0.55);
  g.label = nm;
}

// ------------------------------------------------------------------ L4 tower
function tower(g: GenCtx) {
  const { mb, rng, W, D } = g;
  lotPad(g, mats.concrete());
  const pod = W >= 16 && D >= 16 ? 2 : 1;
  const P = pod * FLOOR.shop;
  const fh = FLOOR.tower;
  const floors = capFloors(rng.int(14, 22) + (W >= 24 ? 4 : 0), fh, W, D, P, 7);
  const H = P + floors * fh;
  const x0 = -W / 2 + 0.8, x1 = W / 2 - 0.8, zf = D / 2 - 1.5, zb = -D / 2 + 0.8;
  block(g, x0, x1, zb, zf, 0, P, FAC.storefront(rng), { side: WALL.concrete(0xb0aca4), roof: ROOF.gravel() });
  // point tower centered on the podium
  const tw = Math.min(W - 3, 22), td = Math.min(D - 3, 18);
  const tx0 = -tw / 2, tx1 = tw / 2, tz1 = zf - (D - td) / 2 + 0.6, tz0 = tz1 - td;
  const glass = rng.chance(0.5);
  const fac = glass ? FAC.towerResi(rng) : FAC.midrise(rng, 0xf4f0ea);
  block(g, tx0, tx1, tz0, tz1, P, H, fac, { parapet: 1.2, cap: WALL.concrete(0xd8d4cc) });
  if (!glass) balconies(g, tx0 + 0.2, tx1 - 0.2, tz1, P + fh, Math.min(floors - 1, 14), fh * 1, 3.2, { rail: M('plain', 2, 2, 0x9fb8c4, { ao: false }), depth: 1.2, every: 2 });
  // mechanical penthouse + crown
  mb.boxC(0, (tz0 + tz1) / 2, tw * 0.5, td * 0.5, H, 4, { side: WALL.concrete(0x9a9690), top: ROOF.flat() });
  if (rng.chance(0.5)) mb.box(tx0, tx1, H + 1.2, H + 2.2, tz0, tz1, { side: M('plain', 2, 2, 0xe8e4dc), top: null });
  roofJunk(g, tx0, tx1, tz0, tz1, H, 0.4, { masts: 2 });
  mb.decal('+z', 0, P - 1.4, zf + 0.25, Math.min(10, W * 0.5), 1.1, S('apt:' + rng.int(0, APT_NAMES.length - 1)), 0.05);
  for (let x = -W / 2 + 3; x < W / 2 - 1; x += 7) tree(g, x, D / 2 - 0.7, 0.55);
  g.label = rng.pick(RESI_TOWER_NAMES);
}

// ------------------------------------------------------------------ L5 megablock
function megablock(g: GenCtx) {
  const { mb, rng, W, D } = g;
  lotPad(g, mats.asphalt());
  const fh = FLOOR.mega;
  const x0 = -W / 2 + 0.3, x1 = W / 2 - 0.3, zb = -D / 2 + 0.3, zf = D / 2 - 0.8;
  // base: street-level shops with signs, then the stack
  const base = rng.int(3, 5) * fh;
  mb.box(x0, x1, 0, FLOOR.shop, zb, zf, { f: FAC.storefront(rng), side: WALL.cinder(0xb8b0a0), top: null });
  block(g, x0, x1, zb, zf, FLOOR.shop, base + FLOOR.shop, FAC.megablock(rng), { roof: ROOF.flat(0x9a968e) });
  // stacked towers, jittered, different heights
  const narrow = W < 16 || D < 16;
  const towers = narrow ? 1 : W >= 32 ? rng.int(2, 3) : 2;
  const tops: { x0: number; x1: number; z0: number; z1: number; y: number }[] = [];
  for (let t = 0; t < towers; t++) {
    const tw = narrow ? Math.max(4, W - 4.4) : (W - 2) / towers - rng.float() * 2;
    const td = narrow ? Math.max(4, D - 4.4) : D * (0.5 + rng.float() * 0.35);
    const cx = narrow ? 0 : x0 + ((t + 0.5) * (x1 - x0)) / towers;
    const cz = narrow ? 0 : (rng.float() - 0.5) * Math.max(0, D - td - 2.6); // leave room for blades/AC units
    const y0 = base + FLOOR.shop;
    const floors = capFloors(rng.int(22, 34) + (narrow ? -4 : 0), fh, W, D, y0, 9);
    const y1 = y0 + floors * fh;
    const a = cx - tw / 2, b = cx + tw / 2, c0 = cz - td / 2, c1 = cz + td / 2;
    block(g, a, b, c0, c1, y0, y1, FAC.megablock(rng, rgb(rng.pick([0xffffff, 0xf0e0d0, 0xe0e8f0, 0xe8e0c8]))), { roof: ROOF.flat(0x8a867e) });
    // cantilevered add-ons bolted to the sides (illegal extensions)
    for (let k = 0; k < rng.int(1, 3); k++) {
      const ey = y0 + rng.int(2, floors - 4) * fh, eh = rng.int(1, 3) * fh;
      // bolt-ons only where they stay on the lot
      const room = [c1 + 1.8 <= D / 2 - 0.3, a - 1.8 >= -W / 2 + 0.3, b + 1.8 <= W / 2 - 0.3];
      const side = rng.int(0, 2);
      if (!room[side]) continue;
      const ew = 3 + rng.float() * 3;
      if (side === 0) {
        const ex = a + rng.float() * Math.max(0.1, tw - ew);
        block(g, ex, ex + ew, c1, c1 + 1.8, ey, ey + eh, FAC.megablock(rng, 0xd8c8b0), { roof: M('corrugatedRust', 4, 4) });
      } else {
        const ez = c0 + rng.float() * Math.max(0.1, td - ew);
        const xa = side === 1 ? a - 1.8 : b, xb = side === 1 ? a : b + 1.8;
        block(g, xa, xb, ez, ez + ew, ey, ey + eh, FAC.megablock(rng, 0xc8d0c0), { roof: M('corrugatedRust', 4, 4) });
      }
    }
    // laundry lines strung across the street face
    for (let k = 0; k < (c1 + 1 <= D / 2 ? rng.int(2, 4) : 0); k++) {
      const ly = y0 + rng.int(1, floors - 2) * fh + 1.2;
      mb.panelZ(cx, c1 + 0.9, tw * 0.9, ly - 0.9, ly, M('laundry', 4, 1, WHITE, { ao: false }));
      mb.panelZ(cx, c1 + 0.88, tw * 0.9, ly - 0.9, ly, M('laundry', 4, 1, WHITE, { ao: false }), true);
    }
    // AC units clinging to the facade
    for (let k = 0; k < 6; k++) {
      const ax = a + 0.6 + rng.float() * (tw - 1.2), ay = y0 + rng.int(0, floors - 1) * fh + 1.2;
      mb.box(ax - 0.4, ax + 0.4, ay, ay + 0.6, c1, c1 + 0.5, { side: M('grille', 2, 2, 0xd8d8d0), top: M('plain', 2, 2, 0xc8c8c0) });
    }
    // neon blades
    for (let k = 0; k < rng.int(1, 3); k++) neonBlade(g, a + 1 + rng.float() * (tw - 2), y0 + rng.float() * 10, c1, 5 + rng.float() * 6, rng.pick(['neonPink', 'neonCyan', 'neonLime', 'neonRed']));
    tops.push({ x0: a, x1: b, z0: c0, z1: c1, y: y1 });
    // steam from vents
    g.em.push({ kind: 'steam', pos: [a + 1.5, y1 + 1, c0 + 1.5] });
  }
  // rooftops: water tanks, shacks, masts and billboards stacked on billboards
  for (const t of tops) {
    const bbs = W >= 16 ? rng.int(1, 3) : 1;
    roofJunk(g, t.x0, t.x1, t.z0, t.z1, t.y, 0.7, { tanks: rng.int(1, 3), masts: 2, billboards: bbs });
    // rooftop shack
    const sw = Math.min(4, (t.x1 - t.x0) * 0.4);
    mb.box(t.x0 + 0.5, t.x0 + 0.5 + sw, t.y, t.y + 2.4, t.z0 + 0.5, t.z0 + 3.5, { side: M('corrugatedRust', 4, 4), top: M('corrugatedRust', 4, 4) });
  }
  // street-level signs
  wallSign(g, -W / 4, FLOOR.shop + 0.3, zf, Math.min(6, W * 0.35), 'sign:' + rng.pick(['cloudChasers', 'pawnographer', 'bitcorn', 'kratomHut', 'ezMoney', 'boozeBarn', 'nailedIt']), 1.4);
  if (W >= 16) wallSign(g, W / 4, FLOOR.shop + 0.3, zf, Math.min(6, W * 0.35), 'sign:' + rng.pick(['smokeshow', 'slop', 'badInfluence', 'waffleHut', 'daiquiriDepot']), 1.4);
  for (let k = 0; k < 3; k++) g.em.push({ kind: 'cigarette', pos: [(rng.float() - 0.5) * W * 0.8, 1.6, D / 2 - 0.4] });
  g.label = rng.pick(MEGABLOCK_NAMES);
}

export function genResHigh(g: GenCtx) {
  switch (g.spec.level) {
    case 1: return garden(g);
    case 2: return fiveOverOne(g);
    case 3: return midrise(g);
    case 4: return tower(g);
    default: return megablock(g);
  }
}
