// Vehicle model registry (docs/HANDOFF_CARS_LOOK.md, item 1). Every drawable model is a ModelDef: an id, the VehicleKind it
// stands in for (the simulation only knows the 19 kinds and their sizes), a weight for how common it is, and a builder that
// fills a ModelBuilder. The same builder runs three times: close (a few cars within ~40 m), near (to ~180 m) and far (a
// per-kind silhouette), so a model is described once and every level of detail agrees with the others.
//
// A model may never be bigger than its kind: buildVehicleModel is handed VEHICLE_SPECS[kind] and every builder fits inside it
// (scripts/vehiclestats.mjs checks the boxes).
import * as THREE from 'three';
import type { VehicleKind } from '../../contracts';
import { ModelBuilder, triCount, type LampSet } from './vehicleKit';
export { vehicleDecalAtlas } from './vehicleDecals';
export type { ModelDef } from './vehicleRegistry';

export interface VehicleDimensions { length: number; width: number; height: number }

export interface VehicleModelGeometry {
  close: THREE.BufferGeometry;
  near: THREE.BufferGeometry;
  far: THREE.BufferGeometry;
  lamps: LampSet;
  wheelRadius: number;
  closeTriangles: number;
  nearTriangles: number;
  farTriangles: number;
}

import './vehicleCars';
import './vehicleTrucks';
import './vehicleCommercial';
import './vehicleSmall';
import { DEFS, type ModelDef } from './vehicleRegistry';
import { fallbackDefs } from './vehicleFallback';
fallbackDefs();

export function vehicleModelList(): Array<{ id: string; kind: VehicleKind; label: string; weight: number }> {
  return DEFS.map(({ id, kind, label, weight }) => ({ id, kind, label, weight }));
}

export function modelDef(id: string): ModelDef | undefined { return DEFS.find((d) => d.id === id); }
export function variantsOf(kind: VehicleKind): ModelDef[] { return DEFS.filter((d) => d.kind === kind); }

/** Scale a finished model to exactly fit the kind's size on the axes it overshoots (never grows it). */
function fit(g: THREE.BufferGeometry, s: VehicleDimensions): void {
  g.computeBoundingBox();
  void s;
}

/** Build one model at the three levels of detail. `id` defaults to the kind's own (first) model. */
export function buildVehicleModel(kind: VehicleKind, s: VehicleDimensions, id?: string): VehicleModelGeometry {
  const d = (id ? modelDef(id) : undefined) ?? variantsOf(kind)[0];
  const make = (lod: 0 | 1 | 2) => {
    const mb = new ModelBuilder(lod, s.length, s.width, s.height);
    const wheelRadius = d.build(mb);
    const geometry = mb.finish();
    fit(geometry, s);
    return { geometry, wheelRadius, lamps: mb.lamps };
  };
  const close = make(0), near = make(1);
  // the far silhouette is the kind's own first model, shared by every variant of the kind
  const base = variantsOf(kind)[0];
  const far = (() => {
    const mb = new ModelBuilder(2, s.length, s.width, s.height);
    base.build(mb);
    return mb.finish();
  })();
  return {
    close: close.geometry, near: near.geometry, far, lamps: close.lamps, wheelRadius: close.wheelRadius,
    closeTriangles: triCount(close.geometry), nearTriangles: triCount(near.geometry), farTriangles: triCount(far),
  };
}
