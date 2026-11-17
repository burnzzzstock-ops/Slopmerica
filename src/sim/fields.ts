// game.fields: the simulation's state, read-only, for rendering and audio (WorldFields in src/contracts.ts).
// Nothing here changes the simulation, and nothing here reads the graphics preset.
import { HALF, WORLD } from '../config';
import type { FieldLegend, InfoViewId, ScalarField, ViewPose, ViewTarget, WorldFields } from '../contracts';
import type { Game } from '../game';
import { isZoned } from './buildings';
import { FIELD_CELL, FIELD_N } from './pollution';
import { airFields } from './services';
import { TUNING } from './tuning';

const YEAR = 365;
const LV_N = 192;

const LEGENDS: Partial<Record<InfoViewId, FieldLegend>> = {
  pollution: { title: 'Air pollution', unit: '', lowLabel: 'Clean', highLabel: 'Makes people sick', ramp: 'badHigh' },
  noise: { title: 'Noise', unit: '', lowLabel: 'Quiet', highLabel: 'Loud', ramp: 'badHigh' },
  landValue: { title: 'Land value', unit: '', lowLabel: 'Cheap', highLabel: 'Pricey', ramp: 'goodHigh' },
};

export function makeFields(g: Game): WorldFields {
  const made = new Map<InfoViewId, { f: ScalarField; day: number }>();
  let smogDay = -1, smogNow = 0;

  /** the field for a view, rebuilt when the game day has changed since the last call */
  const cached = (view: InfoViewId, w: number, h: number, cellM: number, min: number, max: number, fill: (data: Float32Array) => void): ScalarField => {
    const day = Math.floor(g.sim.day);
    let c = made.get(view);
    if (!c) { c = { f: { view, w, h, cellM, data: new Float32Array(w * h), min, max, legend: LEGENDS[view]!, version: 0 }, day: -1 }; made.set(view, c); }
    if (c.day !== day) { fill(c.f.data); c.f.version++; c.day = day; }
    return c.f;
  };

  const fieldFor = (view: InfoViewId): ScalarField | null => {
    if (view === 'pollution' || view === 'noise') {
      const F = airFields(), src = view === 'pollution' ? F.pol : F.noise;
      return cached(view, FIELD_N, FIELD_N, FIELD_CELL, 0, view === 'pollution' ? TUNING.smogCell : 1.6, (data) => {
        for (let i = 0; i < data.length; i++) data[i] = src[i] > 0.01 ? src[i] : NaN;
      });
    }
    if (view === 'landValue') {
      const cellM = WORLD / LV_N;
      return cached(view, LV_N, LV_N, cellM, 0, 100, (data) => {
        data.fill(NaN);
        for (const b of g.buildings.list.values()) {
          if (!isZoned(b)) continue;
          // every cell the footprint touches (a building is a few cells at this size)
          const r = Math.max(b.hw, b.hd);
          const i0 = Math.max(0, Math.floor((b.x - r + HALF) / cellM)), i1 = Math.min(LV_N - 1, Math.floor((b.x + r + HALF) / cellM));
          const j0 = Math.max(0, Math.floor((b.z - r + HALF) / cellM)), j1 = Math.min(LV_N - 1, Math.floor((b.z + r + HALF) / cellM));
          for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const k = j * LV_N + i; if (!(data[k] >= b.lv)) data[k] = b.lv; }
        }
      });
    }
    return null;   // the service views, traffic (drawn per road, not per cell), value per acre, commute, road condition, flood, heat: as each lands
  };

  const smog = (): number => {
    const day = Math.floor(g.sim.day);
    if (day !== smogDay) {
      const pol = airFields().pol;
      let bad = 0;
      for (let i = 0; i < pol.length; i++) if (pol[i] >= TUNING.smogCell) bad++;
      smogNow = Math.min(1, bad / pol.length / TUNING.smogFullShare);
      smogDay = day;
    }
    return smogNow;
  };

  const poseOf = (t: ViewTarget): ViewPose | null => {
    if (t.kind === 'car') {
      const c = g.traffic.cars.find((c) => c.id === t.id);
      return c ? { x: c.shown[0], y: c.shown[1], z: c.shown[2], yaw: c.shown[3], speed: c.v, radius: c.len / 2 } : null;
    }
    if (t.kind === 'person') {
      const p = g.peds.peds.find((p) => p.id === t.id && !p.gone);
      return p ? (p.shown ? { x: p.shown[0], y: p.shown[1], z: p.shown[2], yaw: p.shown[3], speed: p.kind === 'walk' ? p.speed : 0, radius: 0.5 } : { x: p.x, y: p.y, z: p.z, yaw: p.yaw, speed: p.kind === 'walk' ? p.speed : 0, radius: 0.5 }) : null;
    }
    const b = g.buildings.list.get(t.id);
    return b ? { x: b.x, y: b.y, z: b.z, yaw: b.yaw, speed: 0, radius: Math.max(b.hw, b.hd) } : null;
  };

  return {
    fieldFor,
    roadCondition: (segId) => {
      const s = g.net.segs.get(segId);
      return s ? Math.max(0, Math.min(1, 1 - (g.sim.day - (s.builtDay ?? 0)) / YEAR / TUNING.roadWearYears)) : 1;
    },
    buildingAge: (bldId) => { const b = g.buildings.list.get(bldId); return b && b.state === 'active' ? Math.max(0, g.sim.day - b.born) : 0; },
    buildingCondition: (bldId) => { const b = g.buildings.list.get(bldId); return !b || b.abandoned === undefined ? 1 : Math.max(0, 1 - b.abandoned / TUNING.derelictDays); },
    pollutionAt: (x, z) => { const F = airFields(); return F.sample(F.pol, x, z) / TUNING.smogCell; },
    smog,
    naturePct: () => g.sim.naturePct,
    poseOf,
  };
}
