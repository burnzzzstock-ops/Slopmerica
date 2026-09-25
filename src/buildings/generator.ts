// Procedural buildings, landmarks and billboards (City Look workstream).
// Contract: every returned geometry is NON-INDEXED with attributes
// position(3), normal(3), uv(2), color(3), in lot-local space (road on +Z),
// and renders with the one shared buildingMaterial().
import type { BuildingModel, LandmarkId, LotSpec, ZoneType } from '../contracts';
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
import { buildLandmark, LANDMARK_FOOTPRINT, setLandmarkMap } from './landmarks';
import { buildBillboard } from './billboard';
import { brandFits } from './archetypes';

export { buildingMaterial, setBuildingNight } from './material';

/** Paint the atlas (waits for the sign fonts). Call once before rendering buildings. */
export async function loadArt(): Promise<void> {
  await paintArt();
}

/** Optional: tell the art which map is loaded (water tower county name, palms vs. pines). */
export function setArtMap(map: MapId) {
  setLandmarkMap(map);
}

const GEN: Record<ZoneType, (g: GenCtx) => void> = {
  resLow: genResLow,
  resHigh: genResHigh,
  comLow: genComLow,
  comHigh: genComHigh,
  industry: genIndustry,
  office: genOffice,
};

/** Distinct looks per zone/level/size before seeds start repeating. */
export const VARIANTS = 16;
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
  return { geometry: m.geometry.clone(), height: m.height, label: m.label, brand: m.brand, emitters: m.emitters.map((e) => ({ kind: e.kind, pos: [...e.pos] as [number, number, number] })) };
}

function run(key: string, seed: number, spec: LotSpec, W: number, D: number, fn: (g: GenCtx) => void): BuildingModel {
  const mb = new MB();
  const g: GenCtx = { mb, rng: new Rng(seed), spec, W, D, em: [], label: '', brand: spec.brand };
  fn(g);
  const model: BuildingModel = { geometry: mb.build(), height: Math.max(0.5, mb.maxY()), label: g.label || key, brand: g.brand, emitters: g.em };
  cachePut(key, model);
  return model;
}

export function generateBuilding(spec: LotSpec): BuildingModel {
  const zone = GEN[spec.zone] ? spec.zone : 'resLow';
  const level = Math.max(1, Math.min(5, Math.round(spec.level || 1)));
  const w = Math.max(1, Math.min(4, Math.round(spec.widthCells || 1)));
  const d = Math.max(1, Math.min(4, Math.round(spec.depthCells || 1)));
  const variant = mix(spec.seed | 0) % VARIANTS;
  // The level picks the building; a requested brand is kept only if it has a
  // building that fits here (otherwise the generator picks one and reports it in model.brand).
  const brand = spec.brand && brandFits(zone, level, w, d, spec.brand) ? spec.brand : undefined;
  const key = `${zone}|${level}|${w}x${d}|${variant}|${brand ?? ''}`;
  const hit = cacheGet(key);
  if (hit) return copy(hit);
  const norm: LotSpec = { ...spec, zone, level, widthCells: w, depthCells: d, brand };
  return copy(run(key, mix(zone, level, w, d, variant, brand ?? ''), norm, w * CELL, d * CELL, GEN[zone]));
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
  return copy(run(key, mix(id, seed), spec, fp.widthCells * CELL, fp.depthCells * CELL, (g) => buildLandmark(g, id)));
}

/** Roadside billboard on a pole, facing +Z. merch=true shows an Imagine Supply Co. ad. */
export function generateBillboard(seed: number, merch = false): BuildingModel {
  const key = `bb|${seed | 0}|${merch ? 1 : 0}`;
  const hit = cacheGet(key);
  if (hit) return copy(hit);
  const spec: LotSpec = { zone: 'comLow', level: 1, widthCells: 2, depthCells: 1, seed };
  return copy(run(key, mix('bb', seed, merch ? 1 : 0), spec, 16, 8, (g) => buildBillboard(g, merch)));
}
