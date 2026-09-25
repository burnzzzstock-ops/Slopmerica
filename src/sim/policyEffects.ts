import type { Bld } from './buildings';
import { activePolicyIdsFor } from './districts';

const has = (b: Bld, id: string) => activePolicyIdsFor(b).has(id as never);

/** Shared policy multipliers consumed by services and other simulation modules. */
export const POLICY = {
  crimeMul(b: Bld): number {
    let n = 1;
    if (has(b, 'openCarry')) n *= 1.35;
    if (has(b, 'legalizeIt')) n *= 1.05;
    return n;
  },
  educationMul(b: Bld): number {
    return has(b, 'bookBans') ? 0.7 : 1;
  },
  powerDemandMul(b: Bld): number {
    return has(b, 'solarMandate') ? 0.78 : 1;
  },
  waterDemandMul(b: Bld): number {
    return has(b, 'waterRationing') ? 0.72 : 1;
  },
  fireRiskMul(b: Bld): number {
    let n = 1;
    if (has(b, 'smokeFree')) n *= 0.82;
    if (has(b, 'solarMandate')) n *= 1.05;
    return n;
  },
  garbageMul(b: Bld): number {
    let n = 1;
    if (has(b, 'freeParking')) n *= 1.04;
    if (has(b, 'legalizeIt')) n *= 1.08;
    return n;
  },
} as const;

/** Optional hooks for traffic/freight integrations; safe defaults before district init. */
export const POLICY_MOBILITY = {
  carTripMul: (b: Bld) => (has(b, 'freeParking') ? 1.12 : 1) * (has(b, 'banBikes') ? 1.14 : 1) * (has(b, 'fourDayWeek') ? 0.88 : 1),
  pedestrianMul: (b: Bld) => has(b, 'banBikes') ? 0.7 : 1,
  truckAllowed: (b: Bld) => !has(b, 'heavyTrafficBan'),
  smokingAllowed: (b: Bld) => !has(b, 'smokeFree'),
} as const;
