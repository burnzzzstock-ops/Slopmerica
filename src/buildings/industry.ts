// industry: sheds -> Amazin'-style warehouses -> factories with smokestacks ->
// My Own Propane depots -> Neural Fly AI data centers with cooling towers.
import { brandById, brandsFor, BRANDS, Brand, Archetype } from '../art/brands';
import { M, S, Mat, rgb, WHITE } from './mesh';
import { GenCtx, lotPad, car, wallSign, sideSign, poleSign, dumpster, hvac, fence, patch, mats, lampPost, monumentSign, inLot } from './props';
import { FAC, WALL, ROOF, block, roofJunk } from './blocks';
import { hexNum, signTile as sign } from './comLow';

function chooseArch(g: GenCtx): Archetype {
  const { rng, spec } = g;
  const b = brandById(spec.brand);
  const valid: Archetype[] = ['shed', 'warehouse', 'factory', 'propaneDepot', 'datacenter', 'brewery'];
  if (b?.arch?.length) {
    const ok = b.arch.filter((a) => valid.includes(a));
    if (ok.length) return rng.pick(ok);
  }
  const L = spec.level;
  const table: Partial<Record<Archetype, number>>[] = [
    {},
    { shed: 1 },
    { warehouse: 4, shed: 1 },
    { factory: 3, brewery: 1, warehouse: 1 },
    { propaneDepot: 3, factory: 1.5 },
    { datacenter: 4, propaneDepot: 0.5 },
  ];
  const t = table[L] ?? table[1];
  const opts = valid.filter((a) => (t[a] ?? 0) > 0);
  return rng.weighted(opts, (a) => t[a] ?? 0);
}

function pickBrand(g: GenCtx, arch: Archetype): Brand {
  const given = brandById(g.spec.brand);
  if (given && (given.arch ?? []).includes(arch)) return given;
  const want = arch === 'brewery' ? 'brewery' : arch;
  let pool = brandsFor('industry', want, g.spec.level);
  if (!pool.length) pool = BRANDS.filter((b) => b.zones.includes('industry') && (b.arch ?? []).includes(want));
  if (!pool.length) pool = [brandById('cousinDale')!];
  return g.rng.weighted(pool, (b) => b.weight ?? 1);
}

// ------------------------------------------------------------------ bits
function semi(g: GenCtx, x: number, z: number, yaw: number, cab = true, trailerTile?: string) {
  const { mb, rng } = g;
  mb.push().translate(x, 0, z).rotY(yaw);
  const box = M('metal', 2, 2, 0xf2f2f0, { ao: false });
  mb.box(-1.25, 1.25, 1.1, 4.0, -7, 7, { side: box, top: box });
  if (trailerTile) {
    mb.decal('+x', 0, 2.2, 1.25, 7, 1.75, S(trailerTile), 0.03);
    mb.decal('-x', 0, 2.2, -1.25, 7, 1.75, S(trailerTile), 0.03);
  }
  mb.box(-1.1, 1.1, 0, 1.1, -6.5, -4, { side: M('plain', 2, 2, 0x222222), top: null });
  if (cab) {
    const col = rng.pick([0xb3202a, 0x1d3a8a, 0xf2f2f0, 0x2a2a2a]);
    mb.box(-1.25, 1.25, 0.4, 3.4, 7.3, 10, { f: M('carWin', 2, 0.5), side: M('metal', 2, 2, col), top: M('metal', 2, 2, col) });
  } else mb.box(-0.3, 0.3, 0, 1.1, 5.5, 6, M('plain', 2, 2, 0x333333));
  mb.pop();
}

function stack(g: GenCtx, x: number, z: number, h: number, r: number, brick = true) {
  const { mb } = g;
  [x, z] = inLot(g, x, z, r * 1.35, r * 1.35);
  mb.lathe(x, z, [[r * 1.3, 0], [r, h * 0.15], [r * 0.78, h]], 10, brick ? M('brickDark', 2, 2) : M('concrete', 4, 4, 0xc8c4bc), { capTop: M('plain', 2, 2, 0x111111) });
  mb.lathe(x, z, [[r * 0.84, h - 1.8], [r * 0.84, h - 0.9]], 10, M('plain', 2, 2, 0xd8d4cc));
  mb.lathe(x, z, [[r * 0.82, h - 3.8], [r * 0.82, h - 3.2]], 10, M('plain', 2, 2, 0xb3202a));
  g.em.push({ kind: 'smoke', pos: [x, h + 1, z] });
}

function tankV(g: GenCtx, x: number, z: number, r: number, h: number, mat: Mat, cap?: Mat) {
  [x, z] = inLot(g, x, z, r + 0.1, r + 0.1);
  g.mb.lathe(x, z, [[r, 0], [r, h], [r * 0.7, h + r * 0.35], [0.01, h + r * 0.45]], 12, mat);
  if (cap) g.mb.lathe(x, z, [[r + 0.05, h * 0.55], [r + 0.05, h * 0.55 + 1.2]], 12, cap);
}

/** Horizontal propane "bullet" on two saddles, axis along X. */
function bullet(g: GenCtx, x: number, z: number, len: number, r: number, label?: string) {
  const { mb } = g;
  const white = M('metal', 2, 2, 0xf4f4f0);
  for (const sx of [-len * 0.3, len * 0.3]) mb.boxC(x + sx, z, 0.6, r * 1.6, 0, r * 0.9, WALL.concrete(0xa8a49c));
  mb.push().translate(x, r * 1.1, z).rotZ(Math.PI / 2);
  const half = len / 2;
  const prof: [number, number][] = [[0.01, -half - r * 0.6], [r * 0.7, -half - r * 0.4], [r, -half], [r, half], [r * 0.7, half + r * 0.4], [0.01, half + r * 0.6]];
  mb.lathe(0, 0, prof, 12, white);
  mb.pop();
  if (label) {
    mb.decal('+z', x, r * 0.75, z + r * 0.98, Math.min(len * 0.7, 9), Math.min(len * 0.7, 9) / 4, S(label), 0.08);
  }
}

function coolingTower(g: GenCtx, x: number, z: number, r: number, h: number) {
  [x, z] = inLot(g, x, z, r + 0.1, r + 0.1);
  g.mb.lathe(x, z, [[r, 0], [r * 0.82, h * 0.35], [r * 0.62, h * 0.72], [r * 0.66, h]], 14, M('concrete', 4, 4, 0xd8d4cc));
  g.mb.lathe(x, z, [[r * 0.64, h - 0.05], [0.01, h - 0.05]], 14, M('plain', 2, 2, 0x333333));
  g.em.push({ kind: 'steam', pos: [x, h + 2, z] });
}

function pile(g: GenCtx, x: number, z: number, r: number, h: number, col: number) {
  [x, z] = inLot(g, x, z, r, r);
  g.mb.lathe(x, z, [[r, 0.05], [r * 0.5, h * 0.7], [0.01, h]], 9, M('gravel', 4, 4, col));
}

function chainFence(g: GenCtx, x0: number, z0: number, x1: number, z1: number) {
  fence(g, x0, z0, x1, z0, 2.2, 'chainlink');
  fence(g, x1, z0, x1, z1, 2.2, 'chainlink');
  fence(g, x0, z1, x0, z0, 2.2, 'chainlink');
}

// ------------------------------------------------------------------ L1 shed / yard
function shed(g: GenCtx, b: Brand) {
  const { mb, rng, W, D } = g;
  lotPad(g, M('gravel', 4, 4, 0xd0c8b8));
  if (b.id === 'uStoreIt') return storage(g, b);
  const sw = Math.min(W - 3, 12 + rng.float() * 6), sd = Math.min(D - (D >= 16 ? 8 : 4), 10 + rng.float() * 4);
  const z0 = -D / 2 + 1, z1 = z0 + sd;
  const x = (rng.float() - 0.5) * (W - sw - 2);
  const wall = rng.chance(0.5) ? WALL.rusty() : WALL.corrugated(rgb(rng.pick([0xffffff, 0xd8e0e8, 0xe8e0d0])));
  mb.box(x - sw / 2, x + sw / 2, 0, 5, z0, z1, { side: wall, top: null });
  mb.gable(x - sw / 2, x + sw / 2, z0, z1, 5, 1.6, 'z', ROOF.metal(0xb0b0aa), wall, 0.4, 0.1);
  mb.decal('+z', x - sw / 4, 0, z1, 4, 4.2, M('rollup', 4, 4), 0.05);
  mb.decal('+z', x + sw / 4, 0, z1, 1, 2.1, S('doorMetal'), 0.05);
  wallSign(g, x + sw / 4, 3, z1, Math.min(sw * 0.45, 5), sign(b), 1.1);
  // yard: piles, equipment, a dump truck
  if (D >= 16) {
    const col = b.id === 'flatTop' ? 0x6a5a4a : b.id === 'cousinDale' ? 0x3a3a3a : 0xb8b0a0;
    pile(g, W / 2 - 4, D / 2 - 4, 3, 3.2, col);
    if (W >= 16) pile(g, -W / 2 + 4, D / 2 - 3.5, 2.4, 2.4, 0x9a8a70);
    car(g, x, Math.min(z1 + 4, D / 2 - 3), 0.3, 'pickup', 0xf2c230);
  }
  if (b.id === 'frackDaddy') {
    // pumpjack-ish rig + a flare
    mb.boxC(-W / 2 + 3, 0, 1, 1, 0, 6, M('metal', 2, 2, 0x444444));
    mb.push().translate(-W / 2 + 3, 6, 0).rotZ(0.2);
    mb.boxC(0, 0, 6, 0.5, 0, 0.6, M('metal', 2, 2, 0xf2c230));
    mb.pop();
    g.em.push({ kind: 'fire', pos: [W / 2 - 1.5, 7, -D / 2 + 1.5] });
    mb.cyl(W / 2 - 1.5, -D / 2 + 1.5, 0.2, 0, 6.5, 6, M('metal', 2, 2, 0x777777));
  }
  if (b.id === 'hogHeaven' && D >= 16) {
    patch(g, -W / 2 + 1, -W / 2 + 1 + Math.min(10, W * 0.4), -D / 2 + 1, -D / 2 + 7, M('pool', 4, 4, 0x8a6a3a), 0.12);
  }
  chainFence(g, -W / 2 + 0.3, D / 2 - 0.3, W / 2 - 0.3, -D / 2 + 0.3);
  monumentSign(g, -W / 2 + 3, D / 2 - 0.8, 3.2, sign(b), WALL.cinder());
  g.em.push({ kind: 'smoke', pos: [x - sw / 2 + 1, 5.8, z0 + 1] });
  g.label = b.name;
}

function storage(g: GenCtx, b: Brand) {
  const { mb, W, D } = g;
  const rows = Math.max(1, Math.floor((D - 6) / 9));
  for (let r = 0; r < rows; r++) {
    const z0 = -D / 2 + 2 + r * 9, z1 = z0 + 5;
    const wall = WALL.metalPanel(0xf0ece4);
    mb.box(-W / 2 + 1.5, W / 2 - 1.5, 0, 3, z0, z1, { f: M('rollup', 3, 3, 0xff8a3d), b: M('rollup', 3, 3, 0xff8a3d), l: wall, r: wall, top: null });
    mb.shed(-W / 2 + 1.5, W / 2 - 1.5, z0, z1, 3, 0.4, ROOF.metal(0xd8d8d2), wall, 0.2);
  }
  poleSign(g, W / 2 - 3, D / 2 - 1, 7, 5, sign(b));
  car(g, 0, D / 2 - 2.5, Math.PI / 2, 'van');
  g.label = `${b.name} (your stuff's stuff has stuff)`;
}

// ------------------------------------------------------------------ L2 warehouse
function warehouse(g: GenCtx, b: Brand) {
  const { mb, rng, W, D } = g;
  lotPad(g, mats.concrete());
  const bw = Math.min(W - 2, 30), bd = Math.min(D * 0.55, 18);
  const z0 = -D / 2 + 1, z1 = z0 + bd;
  const H = 10;
  const wall = WALL.metalPanel(rgb(rng.pick([0xe8ecf0, 0xf0ece4, 0xdadfe4])));
  mb.box(-bw / 2, bw / 2, 0, H, z0, z1, { f: FAC.docks(), side: wall, top: null });
  mb.parapet(-bw / 2, bw / 2, z0, z1, H, 0.6, wall, ROOF.flat(0xe0e0dc));
  // office bump-out + sign
  mb.box(-bw / 2 - 0.1, -bw / 2 + 7, 0, H + 0.8, z1, z1 + 1.2, { f: M('glassPlain', 3, 3), l: wall, r: wall, top: ROOF.flat(), b: null });
  wallSign(g, bw / 4, H - 2.4, z1, Math.min(12, bw * 0.45), sign(b), 2.2);
  const band = M('plain', 2, 2, hexNum(b.colors[1] ?? '#ff9900'), { ao: false });
  mb.box(-bw / 2, bw / 2, H - 0.5, H, z1, z1 + 0.1, { side: band, top: null, b: null });
  roofJunk(g, -bw / 2 + 1, bw / 2 - 1, z0 + 1, z1 - 1, H, 0.5);
  // truck court: trailers backed up to the docks
  const trailerTile = b.id === 'amazin' ? 'sign:amazin' : undefined;
  if (D / 2 - z1 >= 17.5 && bw >= 12) {
    const n = Math.max(1, Math.floor((bw - 8) / 4.2));
    for (let i = 0; i < n; i++) if (rng.chance(0.75)) semi(g, -bw / 2 + 8 + i * 4.2, z1 + 7.2, Math.PI, rng.chance(0.3), trailerTile);
  } else if (W >= 20) {
    semi(g, 0, D / 2 - 2, Math.PI / 2, true, trailerTile);
  } else if (W >= 12) {
    car(g, 0, D / 2 - 2.4, Math.PI / 2, 'van', 0xf2f2f0);
  }
  for (let i = 0; i < 3; i++) lampPost(g, -W / 2 + 2 + i * ((W - 4) / 2), D / 2 - 1, 9, 2);
  chainFence(g, -W / 2 + 0.3, D / 2 - 0.3, W / 2 - 0.3, -D / 2 + 0.3);
  g.label = b.id === 'amazin' ? "Amazin' Fulfillment Center (20 yrs tax-free)" : b.name;
}

// ------------------------------------------------------------------ L3 factory / brewery
function factory(g: GenCtx, b: Brand, brewery = false) {
  const { mb, rng, W, D } = g;
  lotPad(g, mats.concrete());
  const side = W >= 16;
  const bw = Math.min(W - (side ? 10 : 3), 26), bd = Math.min(D * 0.55, 16);
  const z0 = -D / 2 + 1, z1 = z0 + bd;
  const x0 = -W / 2 + 1.5, x1 = x0 + bw;
  const H = 8;
  const brick = rng.chance(0.6);
  const wall = brick ? WALL.brickDark() : WALL.corrugated(0xe0e4e8);
  mb.box(x0, x1, 0, H, z0, z1, { f: brick ? FAC.factoryWin(rng) : wall, side: wall, top: null });
  // sawtooth roof
  const teeth = Math.max(2, Math.round(bd / 4));
  const tw = bd / teeth;
  for (let i = 0; i < teeth; i++) {
    const a = z0 + i * tw;
    mb.poly([[x0, H, a + tw], [x1, H, a + tw], [x1, H + 2.2, a], [x0, H + 2.2, a]], ROOF.metal(0x9a9a94));
    mb.poly([[x1, H, a], [x0, H, a], [x0, H + 2.2, a], [x1, H + 2.2, a]], M('glassPlain', 3, 3, 0xb8c8c8));
    mb.poly([[x0, H, a], [x0, H, a + tw], [x0, H + 2.2, a]], wall);
    mb.poly([[x1, H, a + tw], [x1, H, a], [x1, H + 2.2, a]], wall);
  }
  wallSign(g, (x0 + x1) / 2, H - 2, z1, Math.min(bw * 0.5, 10), sign(b), 1.9);
  // stacks
  const nStacks = W >= 24 ? rng.int(2, 3) : 1;
  for (let i = 0; i < nStacks; i++) stack(g, x1 - 2 - i * 3.5, z0 + 2, 22 + rng.float() * 12, 1.1, brick);
  // tanks: copper fermenters for the brewery, lime for SLOP Energy, gray otherwise
  const tx = side ? x1 + 2.6 : x0 + 2;
  const tankMat = brewery ? M('metal', 2, 2, 0xc98b4a) : b.id === 'slopEnergy' ? M('metal', 2, 2, 0xc6f432) : M('metal', 2, 2, 0xd8dcdf);
  const tz = side ? Math.min(z0 + 6.5, D / 2 - 3.4) : Math.min(z1 + 3, D / 2 - 5.5);
  const nt = side && W >= 24 ? 3 : 2;
  for (let i = 0; i < nt; i++) tankV(g, tx + (i % 2) * 3, tz - Math.floor(i / 2) * 4 + (i % 2) * 1.5, 1.4, 6 + rng.float() * 3, tankMat, M('plain', 2, 2, 0x333333));
  if (brewery || b.id === 'slopEnergy' || b.id === 'slopBeer') {
    mb.decal('+z', tx + 1.5, 4.5, tz + 1.5, 3.2, 0.8, S(sign(b)), 0.3);
  }
  // pipe rack
  mb.box(x1, Math.min(W / 2 - 0.5, x1 + 6), 5.2, 5.6, z0 + 3, z0 + 3.5, M('metal', 2, 2, 0x8a8e92));
  if (D >= 24 && W >= 20) {
    semi(g, 0, D / 2 - 3, Math.PI / 2, true);
    for (let i = 0; i < 4; i++) car(g, -W / 2 + 2 + i * 2.7, D / 2 - 7, Math.PI, 'pickup');
  }
  dumpster(g, x0 + 1.4, z1 + 1.2, 0);
  chainFence(g, -W / 2 + 0.3, D / 2 - 0.3, W / 2 - 0.3, -D / 2 + 0.3);
  g.em.push({ kind: 'steam', pos: [(x0 + x1) / 2, H + 3, z0 + tw] });
  g.label = brewery ? 'SLOP Beer Brewery' : b.id === 'slopEnergy' ? 'SLOP Energy Bottling Plant' : b.name;
}

// ------------------------------------------------------------------ L4 propane depot
function propaneDepot(g: GenCtx, b: Brand) {
  const { mb, rng, W, D } = g;
  lotPad(g, M('gravel', 4, 4, 0xd8d0c0));
  const paradise = b.id === 'propaneParadise';
  const n = Math.max(1, Math.floor((D - 8) / 6));
  const len = Math.min(W - 6, 18);
  for (let i = 0; i < n; i++) bullet(g, -W / 2 + 2 + len / 2, -D / 2 + 3.5 + i * 6, len, 1.6 + (i === 0 ? 0.4 : 0), paradise ? 'lm:tankLabel' : sign(b));
  // office + truck bay
  const ox = W / 2 - 4;
  if (W >= 16 && D >= 16) {
    const wall = paradise ? M('lm:shirtPattern', 4, 4) : WALL.cinder(0xf0ece4);
    mb.box(ox - 3, ox + 3, 0, 3.4, D / 2 - 9, D / 2 - 4, { side: wall, top: null });
    mb.shed(ox - 3, ox + 3, D / 2 - 9, D / 2 - 4, 3.4, 0.6, ROOF.metal(paradise ? 0xff8a3d : 0x1d4fa3), wall, 0.3);
    wallSign(g, ox, 2.2, D / 2 - 4, 5.5, paradise ? 'lm:propaneParadise' : sign(b), 1.3);
  }
  // bobtail delivery trucks
  for (let i = 0; i < (D < 16 ? 0 : W >= 24 ? 2 : 1); i++) {
    mb.push().translate(W / 2 - 3 - i * 3.2, 0, D / 2 - 4.4).rotY(Math.PI);
    mb.push().translate(0, 1.5, -0.4).rotX(Math.PI / 2); // lathe axis -> truck length
    mb.lathe(0, 0, [[0.01, -2.6], [0.95, -2.3], [0.95, 2.0], [0.01, 2.3]], 10, M('metal', 2, 2, 0xf4f4f0));
    mb.pop();
    mb.box(-1.1, 1.1, 0.4, 3.0, 2.4, 4.6, { f: M('carWin', 2, 0.5), side: M('metal', 2, 2, paradise ? 0x12a39a : 0x1d4fa3), top: M('metal', 2, 2, paradise ? 0x12a39a : 0x1d4fa3) });
    mb.box(-1.1, 1.1, 0, 0.5, -3, 4.6, M('plain', 2, 2, 0x222222));
    mb.pop();
  }
  // flare stack
  mb.cyl(-W / 2 + 1.5, D / 2 - 1.5, 0.25, 0, 10, 6, M('metal', 2, 2, 0x8a8e92));
  g.em.push({ kind: 'fire', pos: [-W / 2 + 1.5, 10.6, D / 2 - 1.5] });
  chainFence(g, -W / 2 + 0.3, D / 2 - 0.3, W / 2 - 0.3, -D / 2 + 0.3);
  monumentSign(g, 0, D / 2 - 0.8, 4.4, paradise ? 'lm:propaneParadise' : sign(b), WALL.cinder());
  g.label = paradise ? 'Propane Paradise Tank Farm' : `${b.name} Depot`;
}

// ------------------------------------------------------------------ L5 data center
function datacenter(g: GenCtx, b: Brand) {
  const { mb, rng, W, D } = g;
  lotPad(g, mats.concrete());
  const neural = b.id === 'neuralFly';
  const bw = Math.min(W - 2, 30), bd = Math.min(D - (D >= 24 ? 10 : 2), 20);
  const z0 = -D / 2 + 1, z1 = z0 + bd;
  const H = 12;
  const wall = WALL.dc(0xffffff);
  mb.box(-bw / 2, bw / 2, 0, H, z0, z1, { side: wall, top: null });
  mb.parapet(-bw / 2, bw / 2, z0, z1, H, 1.2, wall, ROOF.flat(0xd0d0cc));
  // the logo: glowing neon fly on the facade
  const lw = Math.min(8, bw * 0.3);
  if (neural) mb.box(-lw / 2, lw / 2, H - lw - 1.2, H - 1.2, z1, z1 + 0.2, { f: S('lm:neuralLogo'), side: M('plain', 2, 2, 0x111111), top: null, b: null });
  wallSign(g, neural ? lw / 2 + Math.min(10, bw * 0.3) / 2 + 0.5 : 0, 3, z1, Math.min(10, bw * 0.34), neural ? 'lm:neuralSign' : sign(b), 2.2);
  mb.decal('+z', -bw / 2 + 3, 0, z1, 1.1, 2.2, S('doorMetal'), 0.05);
  // chillers carpet the roof
  for (let x = -bw / 2 + 2; x < bw / 2 - 1.5; x += 3.2) for (let z = z0 + 2; z < z1 - 1.5; z += 3.4) hvac(g, x, H, z, 1.1);
  // cooling towers (steam) + substation
  if (D >= 24 && W >= 16) {
    const nt = W >= 24 ? 2 : 1;
    for (let i = 0; i < nt; i++) coolingTower(g, -W / 2 + 5 + i * 9, D / 2 - 5, 3.6, 12);
    const sx = W / 2 - 5;
    for (let i = 0; i < 3; i++) mb.boxC(sx - 2 + i * 2, D / 2 - 5, 1.4, 1.2, 0, 2.2, { side: M('grille', 2, 2, 0x8a9098), top: M('plain', 2, 2, 0x6a7078) });
    for (const dx of [-3, 3]) mb.boxC(sx + dx, D / 2 - 5, 0.3, 0.3, 0, 7, M('metal', 2, 2, 0x8a8e92));
    mb.box(sx - 3, sx + 3, 6.7, 7, D / 2 - 5.15, D / 2 - 4.85, M('metal', 2, 2, 0x8a8e92));
  } else {
    for (let i = 0; i < 2; i++) g.em.push({ kind: 'steam', pos: [-bw / 4 + i * bw / 2, H + 2, (z0 + z1) / 2] });
  }
  chainFence(g, -W / 2 + 0.3, D / 2 - 0.3, W / 2 - 0.3, -D / 2 + 0.3);
  for (let i = 0; i < 2; i++) lampPost(g, -W / 2 + 2 + i * (W - 4), z1 + 1.5, 9, 1);
  g.label = neural ? 'Neural Fly AI Data Center (drinks the reservoir)' : b.name;
}

export function genIndustry(g: GenCtx) {
  const arch = chooseArch(g);
  const b = pickBrand(g, arch === 'brewery' ? 'brewery' : arch);
  g.brand = b.id;
  switch (arch) {
    case 'warehouse': return warehouse(g, b);
    case 'factory': return factory(g, b);
    case 'brewery': return factory(g, b, true);
    case 'propaneDepot': return propaneDepot(g, b);
    case 'datacenter': return datacenter(g, b);
    default: return shed(g, b);
  }
}
