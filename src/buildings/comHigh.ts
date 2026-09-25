// comHigh: big boxes with huge parking lots, the dying mall, the Slop flagship,
// freeway hotels, and at L5 neon high-rises with Times Square screens.
import { brandById, brandsFor, BRANDS, Brand, Archetype } from '../art/brands';
import { SCREEN_ADS } from '../art/names';
import { M, S, Mat, rgb, WHITE } from './mesh';
import { GenCtx, lotPad, parkingLot, car, tree, wallSign, sideSign, poleSign, dumpster, hvac, flagpole, patch, mats, fence, lampPost, monumentSign, emit } from './props';
import { FAC, FLOOR, WALL, ROOF, block, roofJunk, neonBlade, capFloors } from './blocks';
import { hexNum, signTile as sign, store } from './comLow';

function chooseArch(g: GenCtx): Archetype {
  const { rng, spec } = g;
  const b = brandById(spec.brand);
  const valid: Archetype[] = ['bigBox', 'mall', 'flagship', 'hotel', 'neonTower'];
  if (b?.arch?.length) {
    const ok = b.arch.filter((a) => valid.includes(a));
    if (ok.length) return rng.pick(ok);
  }
  const L = spec.level;
  const small = spec.widthCells <= 1 || spec.depthCells <= 1;
  if (small) return L >= 4 ? 'neonTower' : L === 3 ? 'flagship' : 'bigBox';
  const w: Record<Archetype, number>[] = [
    {} as Record<Archetype, number>,
    { bigBox: 6, mall: 0.5, flagship: 0.5 } as Record<Archetype, number>,
    { bigBox: 3, mall: 3, flagship: 1 } as Record<Archetype, number>,
    { flagship: 4, mall: 1, hotel: 1.5, bigBox: 0.5 } as Record<Archetype, number>,
    { hotel: 2, neonTower: 2.5, flagship: 1 } as Record<Archetype, number>,
    { neonTower: 5, hotel: 1 } as Record<Archetype, number>,
  ];
  const table = w[L] ?? w[1];
  const opts = valid.filter((a) => (table[a] ?? 0) > 0);
  return rng.weighted(opts, (a) => table[a]);
}

function pickBrand(g: GenCtx, arch: Archetype): Brand {
  const given = brandById(g.spec.brand);
  if (given && (given.arch ?? []).includes(arch)) return given;
  let pool = brandsFor('comHigh', arch, g.spec.level);
  if (!pool.length) pool = BRANDS.filter((b) => b.zones.includes('comHigh') && (b.arch ?? []).includes(arch));
  if (!pool.length) pool = [brandById('sprawlmart')!];
  return g.rng.weighted(pool, (b) => b.weight ?? 1);
}

function cartCorral(g: GenCtx, x: number, z: number) {
  const m = M('metal', 2, 2, 0xb8bcc0, { ao: false });
  g.mb.box(x - 0.8, x + 0.8, 0.1, 1.0, z - 3, z + 3, { side: M('grille', 2, 2, 0xc8ccd0, { ao: false }), top: m });
}

// ------------------------------------------------------------------ big box
function bigBox(g: GenCtx, b: Brand) {
  const { mb, rng, W, D, spec } = g;
  lotPad(g, mats.asphalt());
  if (W < 16 || D < 16) {
    // cramped infill version: store up front, parking on the roof (lol)
    store(g, -W / 2 + 0.6, W / 2 - 0.6, -D / 2 + 0.6, D / 2 - 2, 8, { side: WALL.tiltup(), band: hexNum(b.colors[0]), sign: sign(b), signW: W - 2 });
    for (let i = 0; i < 3; i++) car(g, -W / 2 + 2 + i * 2.6, -1, 0);
    g.label = `${b.name} Express`;
    return;
  }
  // the store hugs the back of the lot so the parking can sprawl
  const garden = W >= 24 ? 7 : 0;
  const bw = Math.min(W - 2 - garden, 28), bd = Math.min(D * 0.4, 16);
  const z0 = -D / 2 + 1.2, z1 = z0 + bd;
  const x0 = -W / 2 + 1, x1 = x0 + bw;
  const H = 9;
  const wall = WALL.tiltup(rgb(rng.pick([0xffffff, 0xf2eee4, 0xe8e4dc])));
  mb.box(x0, x1, 0, H, z0, z1, { side: wall, top: null });
  mb.parapet(x0, x1, z0, z1, H, 1.2, wall, ROOF.flat());
  // brand fascia band + entrance vestibule
  const band = M('plain', 2, 2, hexNum(b.colors[0]), { ao: false });
  mb.box(x0 - 0.1, x1 + 0.1, H - 1.6, H + 1.2, z1, z1 + 0.2, { side: band, top: band, b: null });
  const vx = (x0 + x1) / 2 + (rng.chance(0.5) ? 0 : -bw * 0.2);
  mb.box(vx - 5, vx + 5, 0, H + 2.5, z1, z1 + 2, { f: band, l: band, r: band, top: ROOF.flat(), b: null });
  mb.decal('+z', vx, 0, z1 + 2, 6, 3.2, M('storefront', 8, 4, WHITE, { bays: 2, floors: 1 }), 0.05);
  wallSign(g, vx, H - 1.2, z1 + 2.05, 9, sign(b), 2.3);
  mb.decal('+z', x1 - 4, 0, z1, 5, 3.2, M('storefront', 8, 4, WHITE, { bays: 2, floors: 1 }), 0.05);
  // garden center: fenced yard beside the building
  if (garden) {
    const gc0 = x1 + 0.3, gc1 = W / 2 - 0.5, gz0 = z1 - Math.min(bd - 1, 10);
    fence(g, gc0, z1, gc1, z1, 3, 'fence');
    fence(g, gc1, z1, gc1, gz0, 3, 'fence');
    fence(g, gc1, gz0, gc0, gz0, 3, 'fence');
    mb.flat(gc0, gc1, gz0, z1, 0.1, M('mulch', 2, 2));
    for (let i = 0; i < 6; i++) tree(g, gc0 + 1 + (i % 3) * 2, gz0 + 2 + Math.floor(i / 3) * 3, 0.4, 'cone');
  }
  sideSign(g, x0, H - 3, (z0 + z1) / 2, 7, 'sign:' + b.id, -1, 1.75);
  roofJunk(g, x0 + 1.5, x1 - 1.5, z0 + 1.5, z1 - 1.5, H, 0.9);
  // loading dock + trailers behind
  mb.decal('-z', x0 + 6, 0, z0, 12, 5, FAC.docks(), 0.05);
  // parking: the ocean of asphalt (sized for Black Friday, 20% full)
  const stalls = parkingLot(g, -W / 2 + 0.3, W / 2 - 0.3, z1 + 3.2, D / 2 - 0.3, 0.2, { trees: true, lamps: true });
  for (let i = 0; i < Math.min(3, Math.floor(stalls.length / 12)); i++) {
    const s = stalls[Math.floor(rng.float() * stalls.length)];
    cartCorral(g, s.x, s.z);
  }
  poleSign(g, W / 2 - 3.5, D / 2 - 1, 14 + spec.level * 2, 7, sign(b));
  g.label = b.id === 'sprawlmart' ? 'SprawlMart Supercenter' : b.name;
}

// ------------------------------------------------------------------ mall
function mall(g: GenCtx, b: Brand) {
  const { mb, rng, W, D, spec } = g;
  lotPad(g, mats.asphalt());
  const bd = Math.min(D * 0.5, 20), z0 = -D / 2 + 1, z1 = z0 + bd;
  const x0 = -W / 2 + 1, x1 = W / 2 - 1;
  const H = 8;
  const wall = WALL.stucco(rgb(rng.pick([0xe8d8c0, 0xd8ccb8, 0xe0d4c4])));
  mb.box(x0, x1, 0, H, z0, z1, { side: wall, top: null });
  mb.parapet(x0, x1, z0, z1, H, 1, wall, ROOF.flat());
  // anchor stores: taller boxes at each end
  const aw = Math.min(10, (x1 - x0) * 0.3);
  const anchors = ['bullseye', rng.chance(0.5) ? 'specter' : 'vacant'];
  [[x0, x0 + aw], [x1 - aw, x1]].forEach(([a, c], i) => {
    const aw2 = WALL.tiltup(i ? 0xd8d4cc : 0xf0ece4);
    mb.box(a - 0.4, c + 0.4, 0, H + 3, z0 - 0.5, z1 + 0.8, { side: aw2, top: ROOF.flat() });
    const t = anchors[i] === 'vacant' ? 'sign:vacant' : anchors[i] === 'specter' ? 'sign:spiritHalloween' : sign(anchors[i]);
    wallSign(g, (a + c) / 2, H - 0.5, z1 + 0.8, Math.min(8, aw - 1), t, 2);
    mb.decal('+z', (a + c) / 2, 0, z1 + 0.8, 4, 3, M('storefront', 8, 4, WHITE, { bays: 2, floors: 1 }), 0.05);
  });
  // central entrance with glass atrium + mall name
  const cx = (x0 + x1) / 2;
  mb.box(cx - 5, cx + 5, 0, H + 1.5, z1, z1 + 3, { f: M('glassPlain', 3, 3), l: wall, r: wall, top: null, b: null });
  mb.gable(cx - 5, cx + 5, z0 + 3, z1 + 3, H + 1.5, 3.5, 'z', M('glassPlain', 3, 3, 0xd8e8f0), wall, 0.3);
  wallSign(g, cx, H + 1.6, z1 + 3.2, 9, sign(b.arch?.includes('mall') ? b : 'sprawlGalleria'), 1.6);
  for (let i = 0; i < 4; i++) {
    const sx = x0 + aw + 3 + i * ((x1 - x0 - aw * 2 - 6) / 3);
    if (Math.abs(sx - cx) < 6) continue;
    mb.decal('+z', sx, 1.4, z1, 3, 1.1, S(rng.chance(0.5) ? 'forLease' : 'closingSale'), 0.06);
  }
  roofJunk(g, x0 + 2, x1 - 2, z0 + 2, z1 - 2, H, 1.1);
  parkingLot(g, -W / 2 + 0.3, W / 2 - 0.3, z1 + 5, D / 2 - 0.3, 0.12, { trees: true, lamps: true });
  poleSign(g, W / 2 - 4, D / 2 - 1, 12 + spec.level * 2, 7, sign(b.arch?.includes('mall') ? b : 'sprawlGalleria'));
  g.label = 'The Galleria at Sprawl Pointe (60% occupied)';
}

// ------------------------------------------------------------------ flagship
export function giantCannon(g: GenCtx, x: number, z: number, s: number, yaw = 0.4) {
  const { mb } = g;
  const iron = M('metal', 2, 2, 0x55565c);
  const brass = M('metal', 2, 2, 0xcaa24a);
  const wood = M('wood', 4, 4, 0x7a4a24);
  mb.push().translate(x, 0, z).rotY(yaw);
  // carriage
  mb.box(-0.9 * s, 0.9 * s, 0.6 * s, 1.6 * s, -2.2 * s, 1.0 * s, { side: wood, top: wood });
  for (const sx of [-1.15, 1.15]) {
    mb.push().translate(sx * s, 1.1 * s, 0.3 * s).rotZ(Math.PI / 2);
    mb.lathe(0, 0, [[0.01, -0.12 * s], [1.1 * s, -0.12 * s], [1.1 * s, 0.12 * s], [0.01, 0.12 * s]], 12, wood);
    mb.pop();
  }
  // barrel pointing up at the sky, toward the street
  mb.push().translate(0, 1.9 * s, -0.4 * s).rotX(Math.PI / 2 - 0.55);
  mb.lathe(0, 0, [[0.55 * s, -1.6 * s], [0.75 * s, -1.2 * s], [0.62 * s, 0], [0.5 * s, 2.6 * s], [0.62 * s, 2.7 * s], [0.62 * s, 3.0 * s]], 12, iron, { capBottom: iron });
  mb.lathe(0, 0, [[0.66 * s, 0.4 * s], [0.66 * s, 0.6 * s]], 12, brass);
  mb.lathe(0, 0, [[0.58 * s, 2.0 * s], [0.58 * s, 2.2 * s]], 12, brass);
  emit(g, 'smoke', 0, 3.4 * s, 0); // just past the muzzle
  mb.pop();
  mb.pop();
}

function flagship(g: GenCtx, b: Brand) {
  const { mb, rng, W, D, spec } = g;
  const slop = b.merch || b.id === 'slop' || b.id === 'slopLightning' || b.id === 'imagineSupply';
  lotPad(g, slop ? mats.concrete() : mats.asphalt());
  if (b.id === 'bassBros' && W >= 24 && D >= 24) return pyramid(g, b);
  const bw = Math.min(W - 3, 26), bd = Math.min(D * 0.5, 16);
  const z0 = -D / 2 + 1.5, z1 = z0 + bd;
  const H = W >= 24 ? 13 : 10;
  if (slop) {
    const black = M('metalPanel', 4, 4, 0x2a2a2c);
    mb.box(-bw / 2, bw / 2, 0, H, z0, z1, { f: null, side: black, top: null });
    mb.parapet(-bw / 2, bw / 2, z0, z1, H, 0.8, black, ROOF.flat(0x6a6a6a));
    // two-storey glass front full of hoodies
    mb.poly([[-bw / 2, 0, z1], [bw / 2, 0, z1], [bw / 2, H * 0.55, z1], [-bw / 2, H * 0.55, z1]], FAC.storefront(rng, 0xd8d8d8));
    mb.poly([[-bw / 2, H * 0.55, z1], [bw / 2, H * 0.55, z1], [bw / 2, H, z1], [-bw / 2, H, z1]], black);
    // the big distressed Slop script, lit
    const sw = Math.min(bw - 2, 16);
    wallSign(g, 0, H * 0.58, z1, sw, 'sign:slop', sw / 4);
    // lime neon edges
    mb.box(-bw / 2 - 0.1, bw / 2 + 0.1, H * 0.55 - 0.15, H * 0.55, z1, z1 + 0.15, S('neonLime'));
    for (const x of [-bw / 2, bw / 2]) mb.box(x - 0.1, x + 0.1, 0, H, z1, z1 + 0.15, S('neonLime'));
    sideSign(g, bw / 2, H * 0.6, (z0 + z1) / 2, Math.min(bd - 2, 8), 'sign:slopLightning', 1);
    sideSign(g, -bw / 2, H * 0.6, (z0 + z1) / 2, Math.min(bd - 2, 8), 'sign:slopCannon', -1);
    // plaza with the cannon sculpture
    patch(g, -W / 2 + 0.5, W / 2 - 0.5, z1, Math.min(z1 + 8, D / 2 - 0.2), M('concretePad', 4, 4, 0xd8d0c0), 0.12);
    if (D >= 24) giantCannon(g, -bw / 4, z1 + 4, W >= 24 ? 1.6 : 1.1);
    if (D >= 24) {
      mb.boxC(bw / 4, z1 + 4, 6, 0.6, 0, 0.8, WALL.concrete(0x2a2a2a));
      mb.box(bw / 4 - 3, bw / 4 + 3, 0.8, 2.3, z1 + 3.9, z1 + 4.1, { f: S('lm:cannonSign'), b: S('lm:cannonSign'), side: M('plain', 2, 2, 0x111111) });
    }
    g.em.push({ kind: 'sparkle', pos: [0, H + 1, z1] });
    if (D >= 24) parkingLot(g, -W / 2 + 0.3, W / 2 - 0.3, z1 + 9, D / 2 - 0.3, 0.55, { lamps: true });
    flagpole(g, -W / 2 + 1.5, D / 2 - 1.5, 10, 3);
    g.label = b.id === 'imagineSupply' ? 'Imagine Supply Co. Flagship' : 'SLOP Flagship Store';
    return;
  }
  // everyone else: glass box + big sign
  const cyber = b.id === 'cyberslop';
  mb.box(-bw / 2, bw / 2, 0, H, z0, z1, { f: M('glassPlain', 3, 3), side: cyber ? M('metal', 2, 2, 0xd8dadc) : WALL.tiltup(), top: null });
  mb.parapet(-bw / 2, bw / 2, z0, z1, H, 0.8, M('metal', 2, 2, 0xd8dadc), ROOF.flat());
  wallSign(g, 0, H - 2.4, z1 + 0.05, Math.min(bw - 2, 12), sign(b), 2.2);
  if (cyber) for (let i = 0; i < 4; i++) car(g, -bw / 2 + 3 + i * ((bw - 6) / 3), z1 - 3, Math.PI * 0.8, 'cyber', 0xb8bcc0);
  if (D >= 24) parkingLot(g, -W / 2 + 0.3, W / 2 - 0.3, z1 + 3, D / 2 - 0.3, 0.4, { trees: true, lamps: true });
  poleSign(g, W / 2 - 3, D / 2 - 1, 10 + spec.level * 2, 6, sign(b));
  g.label = b.name;
}

function pyramid(g: GenCtx, b: Brand) {
  const { mb, W, D } = g;
  const s = Math.min(W, D) * 0.55, cz = -D / 2 + s / 2 + 1.5;
  const glass = M('glassPlain', 3, 3, 0xc8d8e0);
  const h = s * 0.62, a = s / 2;
  mb.box(-a, a, 0, 2.5, cz - a, cz + a, { side: WALL.concrete(0x5a5a5a), top: null });
  const apex: [number, number, number] = [0, 2.5 + h, cz];
  mb.poly([[-a, 2.5, cz + a], [a, 2.5, cz + a], apex], glass);
  mb.poly([[a, 2.5, cz - a], [-a, 2.5, cz - a], apex], glass);
  mb.poly([[a, 2.5, cz + a], [a, 2.5, cz - a], apex], glass);
  mb.poly([[-a, 2.5, cz - a], [-a, 2.5, cz + a], apex], glass);
  wallSign(g, 0, 2.6, cz + a + 0.1, Math.min(10, s * 0.6), sign(b), 2);
  parkingLot(g, -W / 2 + 0.3, W / 2 - 0.3, cz + a + 3, D / 2 - 0.3, 0.35, { trees: true, lamps: true });
  g.label = 'Bass Bros. Outdoor Pyramid';
}

// ------------------------------------------------------------------ hotel
function hotel(g: GenCtx, b: Brand) {
  const { mb, rng, W, D, spec } = g;
  lotPad(g, mats.asphalt());
  const fh = FLOOR.band;
  const floors = capFloors(spec.level >= 4 ? rng.int(10, 16) : rng.int(6, 9), fh, W, D, 4.5, 7);
  const bw = Math.min(W - 2, 26), bd = Math.min(D - (D >= 24 ? 12 : 3), 14);
  const z0 = -D / 2 + 1, z1 = z0 + bd;
  const H = 4.5 + floors * fh;
  const fac = rng.chance(0.5) ? FAC.officeBand(rng) : FAC.midrise(rng, rgb(rng.pick([0xf4ece0, 0xe8e4f0])));
  mb.box(-bw / 2, bw / 2, 0, 4.5, z0, z1, { f: FAC.storefront(rng), side: WALL.stucco(), top: null });
  block(g, -bw / 2, bw / 2, z0, z1, 4.5, H, fac, { parapet: 1.2, cap: WALL.concrete(0xd8d4cc) });
  // rooftop channel letters
  const rw = Math.min(bw - 2, 14);
  mb.box(-rw / 2, rw / 2, H + 1.2, H + 1.2 + rw / 4, z1 - 1.2, z1 - 0.9, { f: S(sign(b)), b: S(sign(b)), side: M('plain', 2, 2, 0x1a1a1a) });
  for (const x of [-rw * 0.35, rw * 0.35]) mb.boxC(x, z1 - 1, 0.2, 0.2, H + 1.2, 0.2, M('metal', 2, 2));
  // porte-cochere
  const pc = Math.min(6, D / 2 - z1 - 0.6);
  if (pc >= 3) {
    mb.box(-5, 5, 4.2, 4.8, z1, z1 + pc, { side: M('plain', 2, 2, hexNum(b.colors[0])), top: ROOF.flat(), bottom: M('canopyLight', 3, 3) });
    for (const x of [-4.6, 4.6]) mb.boxC(x, z1 + pc - 0.4, 0.5, 0.5, 0, 4.2, WALL.stucco());
    car(g, 1.5, z1 + pc / 2, Math.PI / 2, 'suv');
  }
  roofJunk(g, -bw / 2 + 1, bw / 2 - 1, z0 + 1, z1 - 2.5, H, 0.5, { masts: 1 });
  if (D >= 24) parkingLot(g, -W / 2 + 0.3, W / 2 - 0.3, z1 + 7, D / 2 - 0.3, 0.5, { lamps: true });
  poleSign(g, W / 2 - 3, D / 2 - 1, 16, 6, sign(b));
  g.label = b.name;
}

// ------------------------------------------------------------------ neon high-rise
function neonTower(g: GenCtx, b: Brand) {
  const { mb, rng, W, D, spec } = g;
  lotPad(g, mats.asphalt());
  const L5 = spec.level >= 5;
  const fh = FLOOR.neon;
  const floors = capFloors(L5 ? rng.int(20, 30) + (W >= 24 ? 4 : 0) : rng.int(10, 16), fh, W, D, 3 * FLOOR.shop, 8);
  const x0 = -W / 2 + 0.6, x1 = W / 2 - 0.6, z0 = -D / 2 + 0.6, z1 = D / 2 - 1.2;
  const podH = 3 * FLOOR.shop;
  // podium wrapped in screens
  mb.box(x0, x1, 0, podH, z0, z1, { f: FAC.storefront(rng), side: WALL.concrete(0x3a3a40), top: ROOF.flat(0x5a5a5a) });
  const nScr = Math.max(1, Math.floor((x1 - x0) / 7));
  const scrW = (x1 - x0) / nScr - 0.4;
  for (let i = 0; i < nScr; i++) {
    const sx = x0 + (i + 0.5) * ((x1 - x0) / nScr);
    const ad = SCREEN_ADS[(i + rng.int(0, 7)) % SCREEN_ADS.length];
    mb.box(sx - scrW / 2, sx + scrW / 2, 4.3, 4.3 + scrW * 0.62, z1, z1 + 0.3, { f: S('scr:' + ad), side: M('plain', 2, 2, 0x111111), top: M('plain', 2, 2, 0x111111), b: null });
  }
  // shaft with a setback crown
  const tx0 = x0 + (W >= 16 ? 1.5 : 0.3), tx1 = x1 - (W >= 16 ? 1.5 : 0.3), tz0 = z0 + 0.5, tz1 = z1 - (D >= 16 ? 2 : 0.3);
  const H1 = podH + floors * fh * 0.7, H2 = podH + floors * fh;
  const fac = FAC.neon(rng);
  block(g, tx0, tx1, tz0, tz1, podH, H1, fac, { roof: ROOF.flat() });
  const inset = Math.min(3, (tx1 - tx0) * 0.15);
  block(g, tx0 + inset, tx1 - inset, tz0 + inset, tz1 - inset, H1, H2, L5 ? FAC.glassB(rng) : fac, { parapet: 1, cap: M('plain', 2, 2, 0x222222) });
  // corner screens climbing the shaft
  if (L5) {
    for (let k = 0; k < 3; k++) {
      const y = podH + 4 + k * 12;
      if (y + 8 > H1) break;
      const ad = SCREEN_ADS[(k * 3 + rng.int(0, 7)) % SCREEN_ADS.length];
      const sw = Math.min(10, (tx1 - tx0) * 0.6);
      mb.box(tx1 - sw, tx1 + 0.3, y, y + sw * 0.62, tz1, tz1 + 0.4, { f: S('scr:' + ad), side: M('plain', 2, 2, 0x111111), top: M('plain', 2, 2, 0x111111), b: null });
    }
  }
  for (let k = 0; k < (L5 ? 4 : 2); k++) neonBlade(g, tx0 + 0.6 + rng.float() * (tx1 - tx0 - 1.2), podH + 2 + rng.float() * (H1 - podH - 12), tz1, 8 + rng.float() * 6, rng.pick(['neonPink', 'neonCyan', 'neonLime', 'neonRed']));
  // crown sign
  const cw = Math.min(tx1 - tx0 - inset * 2, 16);
  mb.box(-cw / 2, cw / 2, H2 + 1, H2 + 1 + cw / 4, tz1 - inset - 0.4, tz1 - inset, { f: S(sign(b)), b: S(sign(b)), side: M('plain', 2, 2, 0x111111), top: M('plain', 2, 2, 0x111111) });
  roofJunk(g, tx0 + inset, tx1 - inset, tz0 + inset, tz1 - inset - 1, H2, 0.3, { masts: 2, billboards: L5 && W >= 16 ? 1 : 0 });
  wallSign(g, (x0 + x1) / 2, podH - 1.4, z1 + 0.3, Math.min(x1 - x0 - 2, 8), sign(rng.pick(['slop', 'waffleHut', 'bitcorn', 'cloudChasers', 'chickFilEh', 'slopEnergy'])), 1.3);
  for (let k = 0; k < 3; k++) g.em.push({ kind: 'cigarette', pos: [(rng.float() - 0.5) * W * 0.8, 1.6, D / 2 - 0.5] });
  if (b.merch) g.em.push({ kind: 'sparkle', pos: [0, H2 + 2, tz1 - inset] });
  g.label = b.name;
}

export function genComHigh(g: GenCtx) {
  const arch = chooseArch(g);
  const b = pickBrand(g, arch);
  g.brand = b.id;
  switch (arch) {
    case 'mall': return mall(g, b);
    case 'flagship': return flagship(g, b);
    case 'hotel': return hotel(g, b);
    case 'neonTower': return neonTower(g, b);
    default: return bigBox(g, b);
  }
}
