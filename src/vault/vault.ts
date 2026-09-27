// The Asset Vault in the game (PR #7): all 4,000 of its models, packed by
// scripts/vault-pack.mjs into a shared shape library plus one record per part
// (public/vault), built as ordinary buildings: each part's triangles go
// through the MeshBuilder with the game's own atlas tiles standing in for the
// vault's PBR materials (brick for brick, corrugated for galvanised metal,
// tinted plain for paint), and the family sign on the satire sheet. So they
// batch, shade, light at night, go up under scaffolding, get picked, and
// crumble like every other building.
//
// The pack loads with the art, before any building exists. If it can't
// (offline file, old build), every vault slot falls back to a procedural
// building and the game looks as it did.
import * as THREE from 'three';
import type { GenCtx } from '../buildings/props';
import type { Emitter } from '../contracts';
import { M, S, type Mat, type V3 } from '../buildings/mesh';
import { fetchPack } from '../core/pack';
import { VAULT_FAMILIES, type VaultFamily, type VaultRole } from './families';
import { vaultSignTile } from './art';

interface Pack {
  version: number; source: string; lod: number; bytes: number; count: number;
  parts: number; assets: number; mats: string[]; paint: Record<string, [number, number, number]>;
  prims: [number, number, number, number][];
  bin64?: string;
}

export interface VaultAsset {
  index: number;
  family: VaultFamily;
  /** 0..39: state * 20 + layout * 5 + size */
  variant: number;
  /** the vault's plan code, e.g. B3-2 */
  plan: string;
  minX: number; minZ: number; maxX: number; maxZ: number; maxY: number;
  parts: number;
  partOff: number;
}

let pack: Pack | null = null;
let dv: DataView | null = null;
let bin: ArrayBuffer | null = null;
let status: 'off' | 'loading' | 'ready' | 'failed' = 'off';
let loading: Promise<boolean> | null = null;

/** Start loading the pack (once). Resolves false if it isn't there or takes longer than `timeoutMs`. */
export function loadVault(base = new URL('vault/', document.baseURI), timeoutMs = 15000): Promise<boolean> {
  if (!loading) {
    status = 'loading';
    loading = fetchPack<Pack>(base).then(
      ({ json, bin: b }) => {
        // too late: this session already built its town without it
        if (status !== 'loading') return false;
        pack = json; bin = b; dv = new DataView(b);
        status = 'ready';
        return true;
      },
      (e) => { status = 'failed'; console.info('[vault] asset pack not available:', e?.message ?? e); return false; },
    );
  }
  return Promise.race([loading, new Promise<boolean>((res) => setTimeout(() => { if (status === 'loading') { status = 'failed'; console.info('[vault] asset pack timed out'); } res(status === 'ready'); }, timeoutMs))]);
}

export const vaultReady = () => status === 'ready';
export const vaultStatus = () => status;
export const vaultCount = () => pack?.count ?? 0;

const plan = (v: number) => `${'ABCD'[Math.floor((v % 20) / 5)]}${(v % 5) + 1}-${Math.floor(v / 20) + 1}`;

export function vaultAsset(i: number): VaultAsset {
  const o = pack!.assets + i * 18, d = dv!;
  const variant = d.getUint8(o + 7);
  return {
    index: i, family: VAULT_FAMILIES[d.getUint8(o + 6)], variant, plan: plan(variant),
    minX: d.getInt16(o + 8, true) / 100, minZ: d.getInt16(o + 10, true) / 100, maxX: d.getInt16(o + 12, true) / 100, maxZ: d.getInt16(o + 14, true) / 100,
    maxY: d.getUint16(o + 16, true) / 100, parts: d.getUint16(o + 4, true), partOff: d.getUint32(o, true),
  };
}

/** every asset of a family, by variant */
export function vaultFamilyAssets(id: string): number[] {
  if (!pack) return [];
  const fi = VAULT_FAMILIES.findIndex((f) => f.id === id);
  const out: number[] = [];
  for (let i = 0; i < pack.count; i++) if (dv!.getUint8(pack.assets + i * 18 + 6) === fi) out.push(i);
  return out;
}

// ------------------------------------------------------------------ fitting lots
/** room left at the lot edge (m) */
const MARGIN = 0.5;
/** How an asset sits on a W x D lot: uniform scale (up to `grow`) and its footprint share. */
export function vaultFit(i: number, W: number, D: number, grow = 1) {
  const a = vaultAsset(i);
  const bx = Math.max(0.5, a.maxX - a.minX), bz = Math.max(0.5, a.maxZ - a.minZ);
  const s = Math.min(grow, (W - 2 * MARGIN) / bx, (D - 2 * MARGIN) / bz);
  return { s, fill: (bx * bz * s * s) / (W * D), cx: (a.minX + a.maxX) / 2, cz: (a.minZ + a.maxZ) / 2 };
}
/** a lot takes an asset shrunk to no less than this, and filling at least this much of it */
const MIN_SCALE = 0.8, MIN_FILL = 0.2;

const byRole = new Map<VaultRole, number[]>();
const candCache = new Map<string, Map<string, number[]>>();
function roleAssets(role: VaultRole) {
  let l = byRole.get(role);
  if (!l) {
    l = [];
    for (let i = 0; i < pack!.count; i++) if (VAULT_FAMILIES[dv!.getUint8(pack!.assets + i * 18 + 6)].zones.includes(role)) l.push(i);
    byRole.set(role, l);
  }
  return l;
}
/** the assets that fit a lot, grouped by family */
export function vaultCandidates(role: VaultRole, level: number, W: number, D: number): Map<string, number[]> {
  const key = `${role}|${level}|${W}|${D}`;
  let c = candCache.get(key);
  if (c) return c;
  c = new Map();
  if (pack) for (const i of roleAssets(role)) {
    const a = vaultAsset(i);
    if (level < a.family.lv[0] || level > a.family.lv[1]) continue;
    const f = vaultFit(i, W, D);
    if (f.s < MIN_SCALE || f.fill < MIN_FILL) continue;
    const l = c.get(a.family.id);
    if (l) l.push(i); else c.set(a.family.id, [i]);
  }
  candCache.set(key, c);
  return c;
}

function mix(...xs: (number | string)[]) {
  let h = 2166136261;
  for (const x of xs) {
    const s = String(x);
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    h = Math.imul(h ^ 0x9e37, 16777619);
  }
  return h >>> 0;
}

/** A vault asset for a lot (family first, so big families don't crowd out small ones), or -1. */
export function vaultPick(role: VaultRole, level: number, W: number, D: number, slot: number): number {
  if (!pack) return -1;
  const c = vaultCandidates(role, level, W, D);
  if (!c.size) return -1;
  const fams = [...c.keys()];
  const h = mix(role, level, W, D, slot);
  const l = c.get(fams[h % fams.length])!;
  return l[(h >>> 11) % l.length];
}

// ------------------------------------------------------------------ building one
/** the vault's materials in the game's atlas (tile, metres per repeat, tint) */
const TEX: Record<string, () => Mat> = {
  asphalt: () => M('asphalt', 6, 6),
  concrete: () => M('concrete', 4, 4),
  limestone: () => M('stone', 3, 3, 0xe8e0d0),
  'brick-red': () => M('brick', 2, 2),
  'brick-cream': () => M('brickTan', 2, 2),
  'stucco-ivory': () => M('stucco', 4, 4, 0xf0e8d6),
  'metal-dark': () => M('metalPanel', 3, 3, 0x6a6e74),
  'metal-galvanized': () => M('corrugated', 3, 3, 0xd4d8dc),
  'metal-copper': () => M('metal', 2, 2, 0xc07a48),
  'roof-metal': () => M('metalRoof', 4, 4),
  'roof-shingle': () => M('shingles', 4, 4, 0xb0aaa4),
  'glass-blue': () => M('vaultGlass', 3, 3),
  'wood-painted': () => M('siding', 3, 3, 0xece6da),
  'wood-oak': () => M('wood', 2, 2),
  bark: () => M('wood', 1.5, 1.5, 0x6b4a32),
  foliage: () => M('leaf', 2, 2),
  soil: () => M('dirt', 4, 4),
  rubber: () => M('plain', 2, 2, 0x26262a),
};
let waterMat: Mat | null = null;
const water = () => (waterMat ??= M('plain', 2, 2, 0x3f7fa6));
let mats: Mat[] | null = null;
const signMats = new Map<string, Mat>();
function matTable(): Mat[] {
  if (mats) return mats;
  mats = pack!.mats.map((name) => {
    const t = TEX[name];
    if (t) return t();
    const p = pack!.paint[name];
    if (p) return M('plain', 2, 2, p);
    return M('plain', 2, 2, 0xbbbbbb);
  });
  return mats;
}
const edgeMats = new Map<string, Mat>();
function signEdge(f: VaultFamily) {
  let m = edgeMats.get(f.id);
  if (!m) edgeMats.set(f.id, (m = M('plain', 2, 2, parseInt(f.bg.slice(1), 16))));
  return m;
}
function signMat(f: VaultFamily) {
  let m = signMats.get(f.id);
  if (!m) signMats.set(f.id, (m = S(vaultSignTile(f.id))));
  return m;
}

const _m = new THREE.Matrix4(), _fit = new THREE.Matrix4(), _q = new THREE.Quaternion(), _t = new THREE.Vector3(), _s = new THREE.Vector3(), _v = new THREE.Vector3();

/**
 * Build asset i into g.mb, centred on the lot and scaled to fit it (enlarged
 * up to `grow`). Sets the building's label. With `stacks`, its tall slender
 * parts (chimneys, stacks) get that emitter on top. Returns false if the pack
 * isn't loaded.
 */
export function buildVault(g: GenCtx, i: number, W = g.W, D = g.D, grow = 1, stacks?: Emitter['kind']): boolean {
  if (!pack || !dv || !bin) return false;
  const a = vaultAsset(i), f = vaultFit(i, W, D, grow);
  const s = f.s;
  _fit.makeScale(s, s, s).premultiply(new THREE.Matrix4().makeTranslation(-f.cx * s, 0, -f.cz * s));
  const table = matTable(), signIdx = pack.mats.indexOf('sign'), glassIdx = pack.mats.indexOf('glass-blue');
  const d = dv;
  let o = pack.parts + a.partOff;
  for (let p = 0; p < a.parts; p++) {
    const prim = d.getUint16(o, true), mi = d.getUint8(o + 2), flags = d.getUint8(o + 3);
    o += 4;
    const big = flags & 4;
    if (big) { _t.set(d.getFloat32(o, true), d.getFloat32(o + 4, true), d.getFloat32(o + 8, true)); o += 12; }
    else { _t.set(d.getInt16(o, true) / 100, d.getInt16(o + 2, true) / 100, d.getInt16(o + 4, true) / 100); o += 6; }
    if (flags & 1) {
      if (big) { _q.set(d.getFloat32(o, true), d.getFloat32(o + 4, true), d.getFloat32(o + 8, true), d.getFloat32(o + 12, true)); o += 16; }
      else { _q.set(d.getInt16(o, true) / 32767, d.getInt16(o + 2, true) / 32767, d.getInt16(o + 4, true) / 32767, d.getInt16(o + 6, true) / 32767).normalize(); o += 8; }
    } else _q.identity();
    if (flags & 2) {
      if (big) { _s.set(d.getFloat32(o, true), d.getFloat32(o + 4, true), d.getFloat32(o + 8, true)); o += 12; }
      else { _s.set(d.getUint16(o, true) / 1000, d.getUint16(o + 2, true) / 1000, d.getUint16(o + 4, true) / 1000); o += 6; }
    } else _s.set(1, 1, 1);
    _m.compose(_t, _q, _s).premultiply(_fit);
    const [posOff, nv, idxOff, ni] = pack.prims[prim];
    const P = new Float32Array(bin, posOff, nv * 3), I = new Uint16Array(bin, idxOff, ni);
    const V: V3[] = new Array(nv);
    for (let k = 0; k < nv; k++) {
      _v.set(P[k * 3], P[k * 3 + 1], P[k * 3 + 2]).applyMatrix4(_m);
      V[k] = [_v.x, _v.y, _v.z];
    }
    const flip = _s.x * _s.y * _s.z < 0;
    if (stacks && g.em.length < 4) {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const v of V) { x0 = Math.min(x0, v[0]); x1 = Math.max(x1, v[0]); y0 = Math.min(y0, v[1]); y1 = Math.max(y1, v[1]); z0 = Math.min(z0, v[2]); z1 = Math.max(z1, v[2]); }
      const wide = Math.max(x1 - x0, z1 - z0);
      if (y1 - y0 > 3 * wide && wide < 4 && y1 > 0.55 * a.maxY * f.s) g.em.push({ kind: stacks, pos: [(x0 + x1) / 2, y1 + 0.3, (z0 + z1) / 2] });
    }
    if (mi === signIdx) { signFaces(g, V, I, flip, signMat(a.family), signEdge(a.family)); continue; }
    const mat = table[mi], glass = mi === glassIdx;
    for (let k = 0; k + 2 < ni; k += 3) {
      const A = V[I[k]], B = V[I[k + 1]], C = V[I[k + 2]];
      // the vault's glass lying flat is water (ponds, splash pads), not windows
      let m = mat;
      if (glass) {
        const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        if (Math.abs(ny) > 0.9 * Math.hypot(nx, ny, nz)) m = water();
      }
      g.mb.poly(flip ? [A, C, B] : [A, B, C], m);
    }
  }
  g.label = a.family.label;
  g.brand = '';
  return true;
}

/**
 * A sign part: its big flat faces carry the family sign, stretched over the
 * whole face (one polygon per plane, so the sign isn't cut per triangle);
 * slivers get the sign's colour.
 */
function signFaces(g: GenCtx, V: V3[], I: Uint16Array, flip: boolean, sign: Mat, edge: Mat) {
  const planes = new Map<string, { n: THREE.Vector3; pts: V3[]; area: number }>();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  for (let k = 0; k + 2 < I.length; k += 3) {
    let i0 = I[k], i1 = I[k + 1], i2 = I[k + 2];
    if (flip) [i1, i2] = [i2, i1];
    a.fromArray(V[i0]); b.fromArray(V[i1]); c.fromArray(V[i2]);
    n.subVectors(b, a).cross(c.clone().sub(a));
    const area = n.length() / 2;
    if (area < 1e-6) continue;
    n.normalize();
    const key = `${n.x.toFixed(2)},${n.y.toFixed(2)},${n.z.toFixed(2)},${n.dot(a).toFixed(2)}`;
    let pl = planes.get(key);
    if (!pl) planes.set(key, (pl = { n: n.clone(), pts: [], area: 0 }));
    pl.area += area;
    for (const v of [V[i0], V[i1], V[i2]]) if (!pl.pts.some((q) => Math.abs(q[0] - v[0]) + Math.abs(q[1] - v[1]) + Math.abs(q[2] - v[2]) < 1e-4)) pl.pts.push(v);
  }
  for (const pl of planes.values()) {
    if (pl.pts.length < 3) continue;
    // order the face's corners counter-clockwise around its normal
    const cx = pl.pts.reduce((s, p) => s + p[0], 0) / pl.pts.length, cy = pl.pts.reduce((s, p) => s + p[1], 0) / pl.pts.length, cz = pl.pts.reduce((s, p) => s + p[2], 0) / pl.pts.length;
    const u = new THREE.Vector3(pl.pts[0][0] - cx, pl.pts[0][1] - cy, pl.pts[0][2] - cz).normalize();
    const w = pl.n.clone().cross(u);
    const pts = pl.pts.slice().sort((p, q) => {
      const ap = Math.atan2((p[0] - cx) * w.x + (p[1] - cy) * w.y + (p[2] - cz) * w.z, (p[0] - cx) * u.x + (p[1] - cy) * u.y + (p[2] - cz) * u.z);
      const aq = Math.atan2((q[0] - cx) * w.x + (q[1] - cy) * w.y + (q[2] - cz) * w.z, (q[0] - cx) * u.x + (q[1] - cy) * u.y + (q[2] - cz) * u.z);
      return ap - aq;
    });
    g.mb.poly(pts, pl.area > 0.3 && Math.abs(pl.n.y) < 0.9 ? sign : edge);
  }
}

// tests and the audit
(globalThis as unknown as { __vault?: unknown }).__vault = { status: vaultStatus, count: vaultCount, asset: vaultAsset, candidates: vaultCandidates, families: VAULT_FAMILIES };
