// office: content farms -> glass offices -> prompt-engineering campus -> towers
// -> the L5 SLOP HQ glass megatower.
import { brandById, brandsFor, BRANDS, Brand, Archetype } from '../art/brands';
import { M, S, Mat, rgb, WHITE } from './mesh';
import { GenCtx, lotPad, parkingLot, car, tree, shrub, wallSign, poleSign, dish, patch, mats, lampPost, monumentSign, hvac } from './props';
import { FAC, FLOOR, WALL, ROOF, block, roofJunk, capFloors } from './blocks';
import { signTile as sign } from './comLow';
import { pickArch } from './archetypes';

function pickBrand(g: GenCtx, arch: Archetype): Brand {
  const given = brandById(g.spec.brand);
  if (given && (given.arch ?? []).includes(arch)) return given;
  let pool = brandsFor('office', arch, g.spec.level);
  // world headquarters don't go on skinny infill lots
  if (g.W < 16 || g.D < 16) pool = pool.filter((b) => b.id !== 'slopHQ');
  if (!pool.length) pool = BRANDS.filter((b) => b.zones.includes('office') && (b.arch ?? []).includes(arch) && b.id !== 'slopHQ');
  if (!pool.length) pool = [brandById('synergyPartners')!];
  return g.rng.weighted(pool, (b) => b.weight ?? 1);
}

// ------------------------------------------------------------------ L1 content farm
function contentFarm(g: GenCtx, b: Brand) {
  const { mb, rng, W, D } = g;
  lotPad(g, mats.asphalt());
  const floors = rng.chance(0.5) ? 2 : 1;
  const H = floors * FLOOR.office;
  const bw = Math.min(W - 2, 18), bd = Math.min(D - (D >= 16 ? 8 : 3), 12);
  const z0 = -D / 2 + 1, z1 = z0 + bd;
  const wall = WALL.stucco(rgb(rng.pick([0xe8e0d4, 0xd8dce0, 0xe4dccc])));
  mb.box(-bw / 2, bw / 2, 0, H, z0, z1, { f: FAC.officeLow(rng), side: wall, top: null });
  mb.parapet(-bw / 2, bw / 2, z0, z1, H, 0.7, wall, ROOF.flat());
  wallSign(g, 0, H - 1.25, z1 + 0.05, Math.min(bw - 2, 8), sign(b), 1.2);
  for (let i = 0; i < 3; i++) dish(g, -bw / 2 + 1.5 + i * 2.2, H + 0.3, z0 + 1.5, 0.9);
  hvac(g, bw / 4, H, (z0 + z1) / 2);
  if (D >= 16) parkingLot(g, -W / 2 + 0.4, W / 2 - 0.4, z1 + 2, D / 2 - 0.3, 0.6, { lamps: false });
  if (D >= 16) car(g, -bw / 2 + 2, z1 + 3, Math.PI, 'cyber', 0xd8dadc);
  for (let i = 0; i < 2; i++) g.em.push({ kind: 'cigarette', pos: [bw / 2 - 1 - i, 1.6, z1 + 0.8] });
  g.label = b.name;
}

// ------------------------------------------------------------------ L2 glass office
function glassOffice(g: GenCtx, b: Brand) {
  const { mb, rng, W, D } = g;
  lotPad(g, mats.asphalt());
  const floors = rng.int(4, 6);
  const fh = FLOOR.glass;
  const H = floors * fh;
  const bw = Math.min(W - 2, 24), bd = Math.min(D - (D >= 24 ? 10 : 2), 16);
  const z0 = -D / 2 + 1, z1 = z0 + bd;
  const fac = rng.pick([FAC.glassA(rng), FAC.glassC(rng), FAC.officeBand(rng)]);
  block(g, -bw / 2, bw / 2, z0, z1, 0, H, fac, { parapet: 0.9, cap: M('metal', 2, 2, 0xc8ccd0) });
  // entrance canopy + channel letters up top
  const cd = Math.min(3, D / 2 - z1 - 0.4);
  if (cd >= 1.2) mb.box(-3.5, 3.5, 3.6, 3.9, z1, z1 + cd, { side: M('metal', 2, 2, 0xd8dadc), top: ROOF.flat(), bottom: M('canopyLight', 3, 3) });
  const sw = Math.min(bw - 2, 10);
  mb.box(-sw / 2, sw / 2, H - 2.8, H - 2.8 + sw / 4, z1, z1 + 0.25, { f: S(sign(b)), side: M('plain', 2, 2, 0x1a1a1a), b: null });
  roofJunk(g, -bw / 2 + 1, bw / 2 - 1, z0 + 1, z1 - 1, H, 0.5);
  if (D >= 24) parkingLot(g, -W / 2 + 0.3, W / 2 - 0.3, z1 + 3.5, D / 2 - 0.3, 0.55, { trees: true, lamps: true });
  else for (let x = -W / 2 + 2; x < W / 2 - 2; x += 5) tree(g, x, D / 2 - 1, 0.6);
  monumentSign(g, W / 2 - 3, D / 2 - 0.9, 4, sign(b), M('stone', 3, 3));
  g.label = b.name;
}

// ------------------------------------------------------------------ L3 campus
function campus(g: GenCtx, b: Brand) {
  const { mb, rng, W, D } = g;
  lotPad(g, M('lawn', 8, 8));
  const fh = FLOOR.glass;
  const wood = M('wood', 4, 4, 0xd8b890);
  // two or three glass pavilions at different heights, joined by a sky bridge
  const n = W >= 24 ? 3 : 2;
  const pw = (W - 4) / n - 1.5;
  const tops: number[] = [];
  for (let i = 0; i < n; i++) {
    const cx = -W / 2 + 2 + pw / 2 + i * (pw + 1.5);
    const floors = rng.int(2, 4) + (i === 1 ? 2 : 0);
    const H = floors * fh;
    const d = Math.min(D * 0.55, 18) - (i % 2) * 2;
    const z0 = -D / 2 + 1.5, z1 = z0 + d;
    block(g, cx - pw / 2, cx + pw / 2, z0, z1, 0, H, FAC.glassC(rng), { side: wood, roof: null });
    // rooftop garden or solar (both ironic)
    if (rng.chance(0.5)) {
      mb.flat(cx - pw / 2, cx + pw / 2, z0, z1, H, M('lawn', 8, 8));
      mb.push().translate(0, H, 0);
      for (let k = 0; k < 3; k++) tree(g, cx - pw / 2 + 1.5 + rng.float() * (pw - 3), z0 + 1.5 + rng.float() * (d - 3), 0.4);
      mb.pop();
    } else {
      mb.flat(cx - pw / 2, cx + pw / 2, z0, z1, H, M('solar', 4, 4));
    }
    mb.box(cx - pw / 2 - 0.2, cx + pw / 2 + 0.2, H, H + 0.4, z0 - 0.2, z1 + 0.2, { side: M('plain', 2, 2, 0xe8e4dc), top: null });
    tops.push(H);
  }
  if (n >= 2) {
    const y = Math.min(...tops) - fh;
    mb.box(-W / 2 + 2 + pw, -W / 2 + 2 + pw + 1.5, y, y + 3, -D / 2 + 5, -D / 2 + 8, { side: M('glassPlain', 3, 3), top: ROOF.flat() });
  }
  // plaza with the giant "AI" sculpture and one bike
  const pz = -D / 2 + Math.min(D * 0.55, 18) + 3;
  patch(g, -W / 2 + 1, W / 2 - 1, pz - 2, Math.min(D / 2 - 1, pz + 5), M('concretePad', 4, 4, 0xe0dcd0), 0.12);
  mb.box(-1.8, -0.4, 0, 3.4, pz, pz + 0.6, M('plain', 2, 2, 0xc6f432));
  mb.box(0.2, 1.0, 0, 3.4, pz, pz + 0.6, M('plain', 2, 2, 0xc6f432));
  monumentSign(g, W / 2 - 3.5, D / 2 - 1, 5, sign(b), wood);
  if (D >= 24) parkingLot(g, -W / 2 + 0.3, W / 2 - 0.3, pz + 6, D / 2 - 0.3, 0.6, { lamps: true });
  for (let i = 0; i < 4; i++) shrub(g, -W / 2 + 2 + i * ((W - 4) / 3), pz - 2.6, 0.8);
  g.label = b.id === 'promptBros' ? 'Prompt Bros Prompt-Engineering Campus' : `${b.name} Campus`;
}

// ------------------------------------------------------------------ L4/L5 towers
function tower(g: GenCtx, b: Brand, mega: boolean) {
  const { mb, rng, W, D } = g;
  lotPad(g, mats.concrete());
  const hq = b.id === 'slopHQ';
  const fh = FLOOR.glass;
  const big = W >= 24 && D >= 24;
  const floors = capFloors(mega ? rng.int(38, 48) + (big ? 8 : 0) : rng.int(16, 26), fh, W, D, 6, mega ? 8 : 6.5);
  const x0 = -W / 2 + 0.8, x1 = W / 2 - 0.8, z0 = -D / 2 + 0.8, z1 = D / 2 - (D >= 16 ? 3 : 1);
  const fac = hq ? FAC.glassB(rng) : rng.pick([FAC.glassA(rng), FAC.glassB(rng), FAC.glassC(rng), FAC.officeBand(rng)]);
  // lobby
  const lobby = 6;
  mb.box(x0, x1, 0, lobby, z0, z1, { f: M('glassPlain', 3, 3), side: M('stone', 3, 3, 0xd8d4cc), top: null });
  // shaft in 2-3 tapering stages
  const stages = mega ? 3 : 2;
  let y = lobby, a0 = x0, a1 = x1, c0 = z0, c1 = z1;
  const perStage = Math.ceil(floors / stages);
  for (let s = 0; s < stages; s++) {
    const y1 = y + perStage * fh * (s === stages - 1 ? 0.8 : 1);
    block(g, a0, a1, c0, c1, y, y1, fac, { roof: ROOF.flat(0x6a6a6a) });
    // lime edge strips on SLOP HQ
    if (hq) for (const [ex, ez] of [[a0, c1], [a1, c1], [a0, c0], [a1, c0]]) mb.box(ex - 0.12, ex + 0.12, y, y1, ez - 0.12, ez + 0.12, S('neonLime'));
    y = y1;
    // setbacks only while the floor plate stays deep enough
    const plate = Math.min(a1 - a0, c1 - c0);
    const ins = plate > 8 ? Math.min(plate * 0.12, 2.5) : 0;
    a0 += ins;
    a1 -= ins;
    c0 += ins;
    c1 -= ins;
  }
  // crown: signs on all four sides
  const cw = a1 - a0, cd = c1 - c0;
  const crownTile = hq ? 'lm:slopHQ' : sign(b);
  const ch = hq ? Math.min(cw, cd) * 0.5 : Math.min(cw, 12) / 4;
  const crownMat = M('plain', 2, 2, 0x111111);
  mb.box(a0, a1, y, y + ch + 0.6, c0, c1, { side: crownMat, top: ROOF.flat(0x444444) });
  const sw = hq ? cw * 0.95 : Math.min(cw - 1, 12);
  const shh = hq ? ch : sw / 4;
  mb.decal('+z', (a0 + a1) / 2, y + 0.3, c1, sw, shh, S(crownTile), 0.05);
  mb.decal('-z', (a0 + a1) / 2, y + 0.3, c0, sw, shh, S(crownTile), 0.05);
  if (hq || mega) {
    const sd = hq ? cd * 0.95 : Math.min(cd - 1, 12);
    mb.decal('+x', (c0 + c1) / 2, y + 0.3, a1, sd, hq ? ch : sd / 4, S(crownTile), 0.05);
    mb.decal('-x', (c0 + c1) / 2, y + 0.3, a0, sd, hq ? ch : sd / 4, S(crownTile), 0.05);
  }
  y += ch + 0.6;
  // spire with an aircraft light
  if (mega) {
    mb.lathe((a0 + a1) / 2, (c0 + c1) / 2, [[0.8, y], [0.2, y + 18]], 6, M('metal', 2, 2, 0xc8ccd0));
    mb.boxC((a0 + a1) / 2, (c0 + c1) / 2, 0.6, 0.6, y + 18, 0.6, S('neonRed'));
    if (hq) g.em.push({ kind: 'sparkle', pos: [(a0 + a1) / 2, y + 2, c1] });
  } else roofJunk(g, a0, a1, c0, c1, y, 0.3, { masts: 1 });
  // entrance plaza
  if (D >= 16) {
    patch(g, -W / 2 + 0.5, W / 2 - 0.5, z1, D / 2 - 0.3, M('concretePad', 4, 4, 0xe0dcd0), 0.12);
    for (let x = -W / 2 + 3; x < W / 2 - 2; x += 6) tree(g, x, D / 2 - 1.2, 0.6);
    if (hq) {
      mb.boxC(0, z1 + 1.6, 7, 0.6, 0, 0.8, WALL.concrete(0x2a2a2a));
      mb.box(-3.5, 3.5, 0.8, 2.55, z1 + 1.5, z1 + 1.7, { f: S('sign:slop'), b: S('sign:slop'), side: M('plain', 2, 2, 0x111111) });
    }
  }
  wallSign(g, 0, lobby - 1.6, z1 + 0.05, Math.min(x1 - x0 - 2, 8), sign(b), 1.3);
  g.label = hq ? 'SLOP HQ (world headquarters)' : `${b.name} Tower`;
}

export function genOffice(g: GenCtx) {
  const L = g.spec.level;
  const given = brandById(g.spec.brand);
  const arch = pickArch(g.rng, 'office', L, g.spec.widthCells, g.spec.depthCells, g.spec.brand);
  let b = pickBrand(g, arch);
  // L5 megatowers are mostly SLOP HQ on big lots
  if (L >= 5 && !given && g.W >= 16 && g.rng.chance(0.55)) b = brandById('slopHQ')!;
  g.brand = b.id;
  switch (arch) {
    case 'contentFarm': return contentFarm(g, b);
    case 'glassOffice': return glassOffice(g, b);
    case 'campus': return campus(g, b);
    default: return tower(g, b, L >= 5);
  }
}
