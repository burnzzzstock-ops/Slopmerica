// Procedural buildings, landmarks and billboards (City Look workstream).
// Contract: every returned geometry is NON-INDEXED with attributes
// position(3), normal(3), uv(2), color(3), in lot-local space (road on +Z),
// and renders with the one shared buildingMaterial().
import type { BuildingModel, Emitter, LandmarkId, LotSpec, ZoneType } from '../contracts';
import { CELL } from '../config';
import { Rng } from '../core/rng';
import type { MapId } from '../world/maps';
import { paintArt } from '../art';
import { MB } from './mesh';
import type { GenCtx } from './props';
import { genResLow } from './resLow';
import { genResHigh } from './resHigh';
import { genComLow } from './comLow';
import { genComHigh } from './comHigh';
import { genIndustry } from './industry';
import { genOffice } from './office';
import { decorate, satirePass } from './satire';
import { BRANDS } from '../art/brands';
import { buildVault, loadVault, vaultAsset, vaultFamilyAssets, vaultFit, vaultPick, vaultReady } from '../vault/vault';
import { civicOverlay } from './civicOverlay';
import { buildLandmark, LANDMARK_FOOTPRINT, setLandmarkMap } from './landmarks';
import { buildBillboard } from './billboard';
import { brandFits } from './archetypes';

export { buildingMaterial, setBuildingNight } from './material';

/** Paint the atlas (waits for the sign fonts) and load the Asset Vault. Call once before rendering buildings. */
export async function loadArt(): Promise<void> {
  await Promise.all([paintArt(), loadVault()]);
}

/** Optional: tell the art which map is loaded (water tower county name, palms vs. pines). */
export function setArtMap(map: MapId) {
  setLandmarkMap(map);
}

const dressed = (fn: (g: GenCtx) => void) => (g: GenCtx) => {
  fn(g);
  satirePass(g);
};
const GEN: Record<ZoneType, (g: GenCtx) => void> = {
  resLow: genResLow,
  resHigh: dressed(genResHigh),
  comLow: dressed(genComLow),
  comHigh: dressed(genComHigh),
  industry: dressed(genIndustry),
  office: dressed(genOffice),
};

/** Distinct looks per zone/level/size before seeds start repeating. */
export const VARIANTS = 16;
/**
 * On top of those, slots that grow an Asset Vault building that fits the lot
 * (see src/vault): a Mattress Mitosis, a double-wide, a Permit Palace.
 */
const VAULT_SLOTS: Record<ZoneType, number> = { resLow: 20, comLow: 24, comHigh: 10, industry: 16, office: 10, resHigh: 6 };
const procedural = (zone: ZoneType) => (zone === 'resLow' ? 40 : VARIANTS);
/** Homes have fifty-odd styles: more variants so a street doesn't repeat. */
export function variantsFor(zone: ZoneType) {
  return procedural(zone) + VAULT_SLOTS[zone];
}
/** the SLOP merch brands keep their own buildings */
const MERCH = new Set(BRANDS.filter((b) => b.merch).map((b) => b.id));

/** a vault building's lot: homes get yard stuff, everything else the zone's satire */
function vaultDress(g: GenCtx) {
  const { W, D, rng } = g;
  if (g.spec.zone !== 'resLow') return satirePass(g);
  decorate(g, 'frontYard', { x0: -W / 2 + 0.4, x1: W / 2 - 0.4, z0: 0, z1: D / 2 - 0.6 }, rng.int(1, 2));
  decorate(g, 'backYard', { x0: -W / 2 + 0.4, x1: W / 2 - 0.4, z0: -D / 2 + 0.4, z1: 0 }, rng.int(0, 1));
}
const CACHE_MAX = 900;
const cache = new Map<string, BuildingModel>();

function mix(...xs: (number | string)[]) {
  let h = 2166136261;
  for (const x of xs) {
    const s = String(x);
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    h = Math.imul(h ^ 0x9e37, 16777619);
  }
  return h >>> 0;
}

function cacheGet(key: string) {
  const m = cache.get(key);
  if (m) {
    cache.delete(key);
    cache.set(key, m);
  }
  return m;
}

function cachePut(key: string, m: BuildingModel) {
  cache.set(key, m);
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value as string;
    cache.get(oldest)?.geometry.dispose();
    cache.delete(oldest);
  }
}

/** Callers may transform/merge the returned geometry freely: it's a copy. */
function copy(m: BuildingModel): BuildingModel {
  return { geometry: m.geometry.clone(), height: m.height, label: m.label, brand: m.brand, emitters: m.emitters.map((e) => ({ kind: e.kind, pos: [...e.pos] as [number, number, number] })), ...(m.spots ? { spots: m.spots.map((p) => ({ ...p })) } : {}) };
}

function run(key: string, seed: number, spec: LotSpec, W: number, D: number, fn: (g: GenCtx) => void, live = false): BuildingModel {
  const mb = new MB();
  // (traffic pass: `live` zoned buildings collect parking spots; see props.liveSpot)
  const g: GenCtx = { mb, rng: new Rng(seed), spec, W, D, em: [], label: '', brand: spec.brand, ...(live ? { spots: [] } : {}) };
  fn(g);
  const model: BuildingModel = { geometry: mb.build(), height: Math.max(0.5, mb.maxY()), label: g.label || key, brand: g.brand, emitters: g.em, ...(g.spots?.length ? { spots: g.spots } : {}) };
  cachePut(key, model);
  return model;
}

export function generateBuilding(spec: LotSpec): BuildingModel {
  const zone = GEN[spec.zone] ? spec.zone : 'resLow';
  const level = Math.max(1, Math.min(5, Math.round(spec.level || 1)));
  const w = Math.max(1, Math.min(4, Math.round(spec.widthCells || 1)));
  const d = Math.max(1, Math.min(4, Math.round(spec.depthCells || 1)));
  let variant = mix(spec.seed | 0) % variantsFor(zone);
  const style = (spec as { style?: string }).style;
  if (variant >= procedural(zone)) {
    // a vault slot: a vault building that fits, unless a merch brand wants this lot
    const slot = variant - procedural(zone);
    const pick = !style && !(spec.brand && MERCH.has(spec.brand)) && vaultReady() ? vaultPick(zone, level, w * CELL, d * CELL, slot) : -1;
    if (pick >= 0) {
      const key = `vault|${pick}|${zone}|${level}|${w}x${d}`;
      const hit = cacheGet(key);
      if (hit) return copy(hit);
      const norm: LotSpec = { ...spec, zone, level, widthCells: w, depthCells: d, brand: undefined };
      return copy(run(key, mix('vault', pick, zone, level, w, d), norm, w * CELL, d * CELL, (g) => { buildVault(g, pick); vaultDress(g); }));
    }
    variant = slot % procedural(zone);
  }
  // The level picks the building; a requested brand is kept only if it has a
  // building that fits here (otherwise the generator picks one and reports it in model.brand).
  const brand = spec.brand && brandFits(zone, level, w, d, spec.brand) ? spec.brand : undefined;
  const key = `${zone}|${level}|${w}x${d}|${variant}|${brand ?? ''}${style ? '|' + style : ''}`;
  const hit = cacheGet(key);
  if (hit) return copy(hit);
  const norm: LotSpec = { ...spec, zone, level, widthCells: w, depthCells: d, brand };
  return copy(run(key, mix(zone, level, w, d, variant, brand ?? ''), norm, w * CELL, d * CELL, GEN[zone], true));
}

/**
 * One Asset Vault building on a w x d lot, dressed for `zone` if given (dev
 * views, roadside attractions). Null if the vault isn't loaded.
 */
export function generateVaultModel(index: number, widthCells: number, depthCells: number, zone: ZoneType | null = null): BuildingModel | null {
  if (!vaultReady()) return null;
  const key = `vaultm|${index}|${widthCells}x${depthCells}|${zone ?? ''}`;
  const hit = cacheGet(key);
  if (hit) return copy(hit);
  const spec: LotSpec = { zone: zone ?? 'comLow', level: 1, widthCells, depthCells, seed: index };
  return copy(run(key, mix('vaultm', index), spec, widthCells * CELL, depthCells * CELL, (g) => { buildVault(g, index); if (zone) vaultDress(g); }));
}

/** a vault look for a city service may be enlarged this much to fill its lot */
const SERVICE_GROW = 1.8;
/**
 * A city service in an Asset Vault family's clothes (the Very Clean Coal Plant
 * for the Clean Coal™ Plant): the family's plan that fills the w x d lot best.
 * `stacks` puts smoke on its chimneys. Null if the vault isn't loaded.
 */
export function generateVaultService(family: string, widthCells: number, depthCells: number, stacks?: Emitter['kind']): BuildingModel | null {
  if (!vaultReady()) return null;
  const W = widthCells * CELL, D = depthCells * CELL;
  let best = -1, fill = 0;
  for (const i of vaultFamilyAssets(family)) {
    const f = vaultFit(i, W, D, SERVICE_GROW);
    if (f.s >= 0.8 && f.fill > fill) { fill = f.fill; best = i; }
  }
  if (best < 0) return null;
  const key = `vaults|${family}|${widthCells}x${depthCells}|${stacks ?? ''}`;
  const hit = cacheGet(key);
  if (hit) return copy(hit);
  const spec: LotSpec = { zone: 'industry', level: 1, widthCells, depthCells, seed: best };
  return copy(run(key, mix('vaults', best), spec, W, D, (g) => { if (buildVault(g, best, W, D, SERVICE_GROW, stacks)) civicOverlay(g, family, vaultAsset(best).plan); }));
}

/** An Asset Vault model at scale `s`, centred on its own footprint (road furniture). Null if the vault isn't loaded. */
export function generateVaultScaled(index: number, s: number): BuildingModel | null {
  if (!vaultReady()) return null;
  const key = `vaultx|${index}|${s.toFixed(2)}`;
  const hit = cacheGet(key);
  if (hit) return copy(hit);
  const spec: LotSpec = { zone: 'industry', level: 1, widthCells: 1, depthCells: 1, seed: index };
  return copy(run(key, mix('vaultx', index), spec, 8, 8, (g) => { buildVault(g, index, 8, 8, 1, undefined, s); }));
}

export function landmarkFootprint(id: LandmarkId): { widthCells: number; depthCells: number } {
  return { ...(LANDMARK_FOOTPRINT[id] ?? { widthCells: 4, depthCells: 4 }) };
}

export function generateLandmark(id: LandmarkId, seed: number): BuildingModel {
  const fp = landmarkFootprint(id);
  const key = `lm|${id}|${mix(seed | 0) % 4}`;
  const hit = cacheGet(key);
  if (hit) return copy(hit);
  const spec: LotSpec = { zone: 'comHigh', level: 5, widthCells: fp.widthCells, depthCells: fp.depthCells, seed };
  // (live: its lot's stalls are exported and left empty for the live parking: game-night crowds park there)
  return copy(run(key, mix(id, seed), spec, fp.widthCells * CELL, fp.depthCells * CELL, (g) => buildLandmark(g, id), true));
}

/** Roadside billboard on a pole, facing +Z. merch=true shows an Imagine Supply Co. ad. */
export function generateBillboard(seed: number, merch = false): BuildingModel {
  const key = `bb|${seed | 0}|${merch ? 1 : 0}`;
  const hit = cacheGet(key);
  if (hit) return copy(hit);
  const spec: LotSpec = { zone: 'comLow', level: 1, widthCells: 2, depthCells: 1, seed };
  return copy(run(key, mix('bb', seed, merch ? 1 : 0), spec, 16, 8, (g) => buildBillboard(g, merch)));
}
