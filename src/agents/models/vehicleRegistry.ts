// The list of drawable vehicle models. Model files (vehicleCars.ts, vehicleTrucks.ts ...) register themselves here;
// vehicleModels.ts builds them.
import type { VehicleKind } from '../../contracts';
import type { ModelBuilder } from './vehicleKit';

export interface ModelDef {
  id: string;
  kind: VehicleKind;
  label: string;
  /** How common this model is among its kind's cars (relative weight). The first model registered for a kind is its base. */
  weight: number;
  /** Fills the builder; returns the wheel radius (for spin). */
  build: (mb: ModelBuilder) => number;
}

export const DEFS: ModelDef[] = [];
export function def(id: string, kind: VehicleKind, label: string, weight: number, build: (mb: ModelBuilder) => number): void {
  if (DEFS.some((d) => d.id === id)) throw new Error(`duplicate vehicle model ${id}`);
  DEFS.push({ id, kind, label, weight, build });
}
