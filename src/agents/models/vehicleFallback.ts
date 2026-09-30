// Any kind that has no model of its own yet is drawn from a sedan plan, so the renderer never has holes (kinds are added to
// vehicleCars.ts / vehicleTrucks.ts one by one; this shrinks to nothing when every kind has its model).
import type { VehicleKind } from '../../contracts';
import { buildCar } from './vehicleBody';
import { DEFS, def } from './vehicleRegistry';
import { SEDAN_PLAN } from './vehicleCars';

const ALL_KINDS: VehicleKind[] = ['sedan', 'hatchback', 'suv', 'minivan', 'pickup', 'liftedTruck', 'cyberslop', 'semi', 'boxTruck', 'police', 'ambulance', 'firetruck', 'golfCart', 'vwBus', 'slopVan', 'motorcycle', 'towTruck', 'cityBus', 'garbageTruck'];
export function fallbackDefs(): void {
  for (const k of ALL_KINDS) if (!DEFS.some((d) => d.kind === k)) def(k, k, k, 1, (mb) => { buildCar(mb, SEDAN_PLAN); return SEDAN_PLAN.wheels.r; });
}
