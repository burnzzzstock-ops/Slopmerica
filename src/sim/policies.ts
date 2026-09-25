import type { Bld } from './buildings';

export const POLICY_IDS = [
  'freeParking', 'hoaTyranny', 'cryptoHaven', 'openCarry', 'banBikes', 'legalizeIt',
  'fourDayWeek', 'rightToRepair', 'bookBans', 'heavyTrafficBan', 'sprawlZone',
  'smokeFree', 'solarMandate', 'waterRationing',
] as const;

export type PolicyId = (typeof POLICY_IDS)[number];

export interface PolicyDef {
  id: PolicyId;
  icon: string;
  label: string;
  summary: string;
  weeklyBase: number;
  weeklyPerPerson: number;
}

export const POLICY_DEFS: readonly PolicyDef[] = [
  { id: 'freeParking', icon: '🅿️', label: 'Free Parking Forever', summary: '+commercial demand, +car trips, lower value beside stroads', weeklyBase: 35, weeklyPerPerson: 0.04 },
  { id: 'hoaTyranny', icon: '🏡', label: 'HOA Tyranny', summary: '+low-res value; apartments receive a legally laminated no', weeklyBase: 50, weeklyPerPerson: 0.07 },
  { id: 'cryptoHaven', icon: '🪙', label: 'Crypto Tax Haven', summary: 'office tax ×0.5 and demand up; deterministic rug-pull weeks', weeklyBase: 90, weeklyPerPerson: 0.03 },
  { id: 'openCarry', icon: '🔫', label: 'Open Carry Drive-Thru', summary: '+commercial demand and crime multiplier', weeklyBase: 20, weeklyPerPerson: 0.02 },
  { id: 'banBikes', icon: '🚳', label: 'Ban Bikes', summary: 'fewer pedestrians, more car trips, weaker residential demand', weeklyBase: 12, weeklyPerPerson: 0.01 },
  { id: 'legalizeIt', icon: '🌿', label: 'Legalize It', summary: '+commercial demand, +residential value, licensing revenue', weeklyBase: -45, weeklyPerPerson: -0.025 },
  { id: 'fourDayWeek', icon: '🏝️', label: '4-Day Work Week', summary: 'fewer commute trips, happier offices, 6% business tax hit', weeklyBase: 15, weeklyPerPerson: 0.02 },
  { id: 'rightToRepair', icon: '🔧', label: 'Right to Repair', summary: 'industry levels faster and gains value; SLOP legal retainer', weeklyBase: 75, weeklyPerPerson: 0.04 },
  { id: 'bookBans', icon: '📚', label: 'Book Bans', summary: 'education effectiveness −30%; small enforcement cost', weeklyBase: 30, weeklyPerPerson: 0.03 },
  { id: 'heavyTrafficBan', icon: '🚚', label: 'Heavy Traffic Ban', summary: 'trucks avoid the district; cleaner homes, weaker industry', weeklyBase: 45, weeklyPerPerson: 0.02 },
  { id: 'sprawlZone', icon: '🏗️', label: 'Sprawl Incentive Zone', summary: 'construction ×1.5, demand up, land value −10', weeklyBase: 120, weeklyPerPerson: 0.08 },
  { id: 'smokeFree', icon: '🚭', label: 'Smoke-Free District', summary: 'lower fire risk and a small land-value bonus', weeklyBase: 22, weeklyPerPerson: 0.015 },
  { id: 'solarMandate', icon: '☀️', label: 'Solar Mandate', summary: 'building power demand ×0.78; rooftop subsidy', weeklyBase: 110, weeklyPerPerson: 0.06 },
  { id: 'waterRationing', icon: '🚱', label: 'Water Rationing', summary: 'water demand ×0.72; land value −7', weeklyBase: 18, weeklyPerPerson: 0.01 },
] as const;

export const POLICY_BY_ID = new Map(POLICY_DEFS.map((p) => [p.id, p]));

export type PolicyOverride = Partial<Record<PolicyId, boolean>>;

/** District entries override city policy; absent entries inherit it. */
export function policyEnabled(id: PolicyId, city: ReadonlySet<PolicyId>, district?: PolicyOverride): boolean {
  const own = district?.[id];
  return own === undefined ? city.has(id) : own;
}

export function policyTaxMultiplier(ids: ReadonlySet<PolicyId>, b: Bld): number {
  let n = 1;
  if (ids.has('cryptoHaven') && b.zone === 'office') n *= 0.5;
  if (ids.has('fourDayWeek') && b.zone !== 'resLow' && b.zone !== 'resHigh' && b.zone !== 'landmark' && b.zone !== 'service') n *= 0.94;
  if (ids.has('heavyTrafficBan') && b.zone === 'industry') n *= 0.9;
  return n;
}

export function policyLandValue(ids: ReadonlySet<PolicyId>, b: Bld, frontsStroad: boolean): number {
  let n = 0;
  if (ids.has('freeParking') && frontsStroad) n -= 6;
  if (ids.has('hoaTyranny') && b.zone === 'resLow') n += 8;
  if (ids.has('openCarry') && (b.zone === 'resLow' || b.zone === 'resHigh')) n -= 4;
  if (ids.has('banBikes') && (b.zone === 'resLow' || b.zone === 'resHigh')) n -= 2;
  if (ids.has('legalizeIt') && (b.zone === 'resLow' || b.zone === 'resHigh')) n += 3;
  if (ids.has('fourDayWeek') && b.zone === 'office') n += 4;
  if (ids.has('rightToRepair') && b.zone === 'industry') n += 8;
  if (ids.has('heavyTrafficBan') && (b.zone === 'resLow' || b.zone === 'resHigh')) n += 4;
  if (ids.has('sprawlZone')) n -= 10;
  if (ids.has('smokeFree')) n += 3;
  if (ids.has('waterRationing')) n -= 7;
  return n;
}

export const policyVacancyReason = (ids: ReadonlySet<PolicyId>, b: Bld): string | null =>
  ids.has('hoaTyranny') && b.zone === 'resHigh' ? 'HOA says no apartments' : null;

export interface DemandDelta { res: number; com: number; ind: number; off: number }

export function policyDemandDelta(id: PolicyId): DemandDelta {
  switch (id) {
    case 'freeParking': return { res: 0, com: 12, ind: 0, off: 0 };
    case 'hoaTyranny': return { res: -4, com: 0, ind: 0, off: 0 };
    case 'cryptoHaven': return { res: 0, com: 0, ind: 0, off: 16 };
    case 'openCarry': return { res: -2, com: 9, ind: 0, off: 0 };
    case 'banBikes': return { res: -6, com: -2, ind: 0, off: 0 };
    case 'legalizeIt': return { res: 2, com: 11, ind: 0, off: 0 };
    case 'fourDayWeek': return { res: 3, com: 0, ind: 0, off: 6 };
    case 'rightToRepair': return { res: 0, com: 0, ind: 10, off: 0 };
    case 'bookBans': return { res: -5, com: 0, ind: 0, off: -3 };
    case 'heavyTrafficBan': return { res: 3, com: 0, ind: -12, off: 0 };
    case 'sprawlZone': return { res: 8, com: 5, ind: 5, off: 2 };
    case 'smokeFree': return { res: 3, com: 0, ind: 0, off: 1 };
    case 'solarMandate': return { res: 1, com: 0, ind: -2, off: 2 };
    case 'waterRationing': return { res: -5, com: -2, ind: 0, off: 0 };
  }
}

export const policyLevelNote = (id: PolicyId) => id === 'rightToRepair' ? 'Industry levels 50% faster' : id === 'sprawlZone' ? 'Construction runs 50% faster' : '';
