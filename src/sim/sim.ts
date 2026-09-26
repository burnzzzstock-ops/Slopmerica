// The simulation: calendar, RCI(O) demand ratios, growth, move-ins, jobs,
// land value, level-ups, the Growth Ponzi budget, and the endless-sprawl ending.
import { MAX_LEVEL, ZONE_TYPES, type GameTime, type ZoneType } from '../contracts';
import { Emitter } from '../core/events';
import { clamp } from '../core/math';
import { Rng } from '../core/rng';
import { isZoned, type Bld, type Buildings } from './buildings';
import type { RoadNetwork } from '../roads/network';
import type { Zoning, ZCell } from '../zones/zoning';
import type { Terrain } from '../world/terrain';
import type { Trees } from '../world/trees';
import { HALF, WATER } from '../config';

export const DAY_SECONDS = 2.5;
export const SPEEDS = [0, 1, 2, 4];

export type Mode = 'sandbox' | 'ponzi' | 'hippie' | 'speedrun';

/**
 * Money by category, signed (income +, spending -). Recurring kinds are
 * billed once a week and make up the weekly rate the HUD shows; one-time
 * kinds are single purchases and payments that move cash but never the rate.
 */
export interface Ledger {
  // recurring
  resTax: number;
  comTax: number;
  indTax: number;
  offTax: number;
  /** road upkeep */
  roads: number;
  /** service upkeep, utility imports, the county waste contract */
  services: number;
  /** bus operations and fares */
  transit: number;
  /** district policy costs */
  policies: number;
  /** freight exports and emergency goods imports */
  freight: number;
  /** loan repayments */
  loans: number;
  // one-time
  construction: number;
  impact: number;
  grants: number;
  communes: number;
  disasters: number;
  refunds: number;
  /** loan money received */
  loanIn: number;
  other: number;
}
export type LedgerKind = keyof Ledger;
export const RECURRING: LedgerKind[] = ['resTax', 'comTax', 'indTax', 'offTax', 'roads', 'services', 'transit', 'policies', 'freight', 'loans'];
export const ONE_TIME: LedgerKind[] = ['construction', 'impact', 'grants', 'communes', 'disasters', 'refunds', 'loanIn', 'other'];
export const LEDGER_LABEL: Record<LedgerKind, string> = {
  resTax: 'Residential taxes', comTax: 'Commercial taxes', indTax: 'Industrial taxes', offTax: 'Office taxes',
  roads: 'Road upkeep', services: 'Services & utility imports', transit: 'Transit', policies: 'Policies', freight: 'Freight', loans: 'Loan payments',
  construction: 'Construction', impact: 'Impact fees', grants: 'Federal grants', communes: 'Communes & lawyers', disasters: 'Disaster recovery',
  refunds: 'Refunds', loanIn: 'Loans taken', other: 'Other',
};
/** how far below zero the treasury may go before purchases are refused */
export const CREDIT_LINE = 20000;
/** below this for BANKRUPT_WEEKS weekly closes in a row, the city goes bankrupt */
export const BANKRUPT_AT = -15000;
export const BANKRUPT_WEEKS = 6;

const emptyLedger = (): Ledger => ({
  resTax: 0, comTax: 0, indTax: 0, offTax: 0, roads: 0, services: 0, transit: 0, policies: 0, freight: 0, loans: 0,
  construction: 0, impact: 0, grants: 0, communes: 0, disasters: 0, refunds: 0, loanIn: 0, other: 0,
});

/** $12,345 / −$12,345 */
export const usd = (n: number) => (n === Infinity ? '∞' : `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString()}`);

/** one entry in the transaction log */
export interface Tx { day: number; label: string; amount: number; kind: LedgerKind }
/** one line of a weekly bill or forecast (amount signed like the ledger) */
export interface WeekLine { label: string; amount: number; kind: LedgerKind }

export const UNLOCKS: { pop: number; what: string; zone?: ZoneType; road?: string }[] = [
  { pop: 250, what: 'Luxury Slop apartments', zone: 'resHigh' },
  { pop: 400, what: 'Big Box commercial', zone: 'comHigh' },
  { pop: 600, what: 'MEGA Stroad (6 lanes)', road: 'stroad6' },
  { pop: 700, what: 'Content Farms (office)', zone: 'office' },
  { pop: 1500, what: 'Slopway highway', road: 'highway' },
  { pop: 2500, what: 'Katy Stroad (8 lanes)', road: 'stroad8' },
];

export type DemandKey = 'res' | 'com' | 'ind' | 'off';
export type DemandWhy = Record<DemandKey, string[]>;
/** one reason a demand bar is where it is; v is its signed share (null = not measured) */
export interface DemandDriver { text: string; v: number | null; base?: boolean }
export type DemandParts = Record<DemandKey, DemandDriver[]>;

/** a reason without its number, once the number is shown beside it */
const bare = (text: string) => text.replace(/\s*[+\-−]\s?\d+(?:\.\d+)?(?=\s*(?:\(|$))/, '').trim() || text;
/** the last signed number in a reason ("taxes −12", "parks +3.5 (40% coverage)") */
function signedIn(text: string): number | null {
  const m = [...text.matchAll(/([+\-−])\s?(\d+(?:\.\d+)?)/g)].pop();
  return m ? (m[1] === '+' ? 1 : -1) * Number(m[2]) : null;
}

/**
 * Extension points into the simulation. Systems outside sim.ts (services,
 * districts, policies) push functions here instead of editing the sim.
 */
export interface SimHooks {
  /** additive land value for a zoned building (services +, pollution -) */
  landValue: ((b: Bld) => number)[];
  /** highest level a building may reach right now and why (null = no cap) */
  levelCap: ((b: Bld) => { max: number; why: string } | null)[];
  /** why a building can't take new residents / workers right now (null = fine) */
  vacancy: ((b: Bld) => string | null)[];
  /** tax multiplier for one building (policies, districts); 1 = none */
  taxMul: ((b: Bld) => number)[];
  /** adjust demand in place and explain the change */
  demand: ((d: Record<DemandKey, number>, why: DemandWhy) => void)[];
  /**
   * Weekly budget lines: call add(label, amount, kind); amount > 0 is an
   * expense, < 0 income. With forecast=true the hook is asked for the bill it
   * would send at today's rates and must not change any state.
   */
  weekly: ((add: (label: string, amount: number, kind: LedgerKind) => void, forecast: boolean) => void)[];
}

type Events = {
  milestone: { kind: 'population' | 'nature' | 'sprawl' | 'unlock' | 'maxLevel'; value: number; label: string };
  lowMoney: number;
  bankrupt: number;
  week: Ledger;
  day: number;
  ending: void;
};

export class Sim {
  events = new Emitter<Events>();
  day = 0; // float days
  speed = 1;
  money: number;
  taxRate = 0.09;
  loans: { amount: number; weekly: number; weeksLeft: number }[] = [];
  population = 0;
  workers = 0;
  jobsCap = { comLow: 0, comHigh: 0, industry: 0, office: 0 };
  jobsFilled = 0;
  unemployment = 0;
  demand = { res: 60, com: 0, ind: 0, off: 0 };
  ledger = emptyLedger(); // current week (accumulating)
  lastWeek = emptyLedger();
  /** the latest transactions, oldest first (labelled; recurring bills included) */
  transactions: Tx[] = [];
  /** cash when the current week began (for the weekly reconciliation) */
  private weekStartCash = 0;
  /** cash at the start and end of the last closed week */
  lastWeekCash = { from: 0, to: 0 };
  /** how far the last closed week's cash change missed its ledger (should be 0) */
  ledgerDrift = 0;
  private fcCache: { key: string; v: ReturnType<Sim['computeForecast']> } | null = null;
  history: { day: number; pop: number; money: number; nature: number; sprawl: number }[] = [];
  coverage = 0;
  maxedPct = 0;
  sprawlPct = 0;
  naturePct = 1;
  ended = false;
  bankruptWeeks = 0;
  private rng = new Rng(777);
  private dayAcc = 0;
  private lastWhole = 0;
  private popMarks = [50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000];
  private natureMarks = [0.9, 0.75, 0.5, 0.25, 0.1, 0.01];
  private sprawlMarks = [0.1, 0.25, 0.5, 0.75, 0.9, 1];
  private unlocked = new Set<string>();
  private buildable: { x: number; z: number }[] = [];
  private cand: ZCell[] = [];
  growthMul = 1;
  /** fractional new construction sites carried over between days */
  private growthAcc = 0;
  weatherBuildMul = 1;
  weatherDemandMul = 1;
  /** gameplay hooks provided by the game */
  communePenalty: (x: number, z: number) => number = () => 0;
  hooks: SimHooks = { landValue: [], levelCap: [], vacancy: [], taxMul: [], demand: [], weekly: [] };
  /** why each demand bar is where it is (for the UI) */
  demandWhy: DemandWhy = { res: [], com: [], ind: [], off: [] };
  /** the same reasons with their signed contribution, for the demand explainer */
  demandParts: DemandParts = { res: [], com: [], ind: [], off: [] };
  /** demand before the ±100 clamp */
  demandRaw: Record<DemandKey, number> = { res: 60, com: 0, ind: 0, off: 0 };
  /** the last 8 days of demand, oldest first (not saved: a trend rebuilds in a week) */
  demandHistory: Record<DemandKey, number[]> = { res: [], com: [], ind: [], off: [] };
  /** flat per-capita services cost; the services system zeroes it and bills real facilities */
  serviceCostPerCapita = 0.55;

  constructor(public mode: Mode, private b: Buildings, private zones: Zoning, private net: RoadNetwork, private terrain: Terrain, private trees: Trees) {
    this.money = mode === 'sandbox' ? Infinity : mode === 'speedrun' ? 150000 : mode === 'hippie' ? 70000 : 90000;
    this.weekStartCash = this.money;
    if (mode === 'speedrun') this.growthMul = 2;
    if (mode === 'sandbox') for (const u of UNLOCKS) this.unlocked.add(u.what);
    // sample buildable land once (for the sprawl meter)
    for (let z = -HALF + 16; z < HALF; z += 32)
      for (let x = -HALF + 16; x < HALF; x += 32) {
        const h = terrain.h(x, z);
        if (h > WATER + 0.4 && terrain.slope(x, z) < 0.3) this.buildable.push({ x, z });
      }
    b.onComplete = (bld) => this.onBuildingComplete(bld);
  }

  // ------------------------------------------------------------------ money
  /** what can still be spent: cash plus the credit line */
  spendable() {
    return this.money === Infinity ? Infinity : Math.max(0, this.money + CREDIT_LINE);
  }
  private record(label: string, amount: number, kind: LedgerKind) {
    if (!amount) return;
    this.transactions.push({ day: Math.round(this.day * 10) / 10, label: label || LEDGER_LABEL[kind], amount, kind });
    if (this.transactions.length > 200) this.transactions.splice(0, this.transactions.length - 200);
    this.fcCache = null;
  }
  spend(amount: number, label: string, kind: LedgerKind = 'construction') {
    if (this.money === Infinity) return true;
    this.money -= amount;
    this.ledger[kind] -= amount;
    this.record(label, -amount, kind);
    return true;
  }
  refund(amount: number, label = 'Refund') {
    if (this.money !== Infinity) this.money += amount;
    this.ledger.refunds += amount;
    this.record(label, amount, 'refunds');
  }
  earn(amount: number, kind: LedgerKind, label = LEDGER_LABEL[kind]) {
    if (this.money !== Infinity) this.money += amount;
    this.ledger[kind] += amount;
    this.record(label, amount, kind);
  }
  takeLoan(amount: number) {
    const weeks = 52;
    const weekly = Math.round((amount * 1.18) / weeks);
    this.loans.push({ amount, weekly, weeksLeft: weeks });
    this.earn(amount, 'loanIn', `Loan (${weeks} weeks)`);
  }

  /** why a purchase can't go through, or null when it can */
  cantAfford(cost: number): string | null {
    if (cost <= this.spendable()) return null;
    return `Needs ${usd(cost)}. You can spend ${usd(this.spendable())} (cash ${usd(this.money)} + ${usd(CREDIT_LINE)} credit).`;
  }

  /**
   * Cash and the weekly rate after buying something for `cost` that adds
   * `weekly` of recurring cost (negative = recurring income).
   */
  afterSpend(cost: number, weekly = 0) {
    if (this.money === Infinity) return { cash: Infinity, before: 0, after: 0, credit: false, text: 'sandbox: money is no object' };
    const cash = this.money - cost, before = this.forecastWeek().net, after = before - weekly;
    const rate = (v: number) => `${v >= 0 ? '+' : '−'}${usd(Math.abs(v))}/wk`;
    return { cash, before, after, credit: cash < 0, text: `cash after ${usd(cash)}${cash < 0 ? ' (on credit)' : ''} · ${weekly ? `${rate(before)} → ${rate(after)}` : `${rate(before)} unchanged`}` };
  }

  /** tax owed per zone group this week at today's occupancy and rate */
  private taxLines(): WeekLine[] {
    const t = this.taxRate / 0.09;
    let res = 0, com = 0, ind = 0, off = 0;
    for (const bld of this.b.list.values()) {
      if (bld.state !== 'active' && bld.occ === 0) continue;
      if (!isZoned(bld) || bld.abandoned !== undefined) continue;
      let lm = 1 + (bld.level - 1) * 0.3;
      for (const h of this.hooks.taxMul) lm *= h(bld);
      if (bld.zone === 'resLow' || bld.zone === 'resHigh') res += bld.occ * 0.9 * lm;
      else if (bld.zone === 'comLow' || bld.zone === 'comHigh') com += bld.occ * 1.2 * lm;
      else if (bld.zone === 'industry') ind += bld.occ * 1.0 * lm;
      else if (bld.zone === 'office') off += bld.occ * 1.5 * lm;
    }
    return [
      { label: LEDGER_LABEL.resTax, amount: Math.round(res * t), kind: 'resTax' },
      { label: LEDGER_LABEL.comTax, amount: Math.round(com * t), kind: 'comTax' },
      { label: LEDGER_LABEL.indTax, amount: Math.round(ind * t), kind: 'indTax' },
      { label: LEDGER_LABEL.offTax, amount: Math.round(off * t), kind: 'offTax' },
    ];
  }

  /** every recurring line of a weekly bill; forecast=true asks hooks for today's rates */
  private weekLines(forecast: boolean): WeekLine[] {
    const lines = this.taxLines();
    lines.push({ label: 'Road upkeep', amount: -Math.round(this.net.upkeep()), kind: 'roads' });
    if (this.serviceCostPerCapita > 0) lines.push({ label: 'Services', amount: -Math.round(this.population * this.serviceCostPerCapita), kind: 'services' });
    for (const h of this.hooks.weekly) h((label, amount, kind) => { if (Math.round(amount)) lines.push({ label, amount: -Math.round(amount), kind }); }, forecast);
    for (const L of this.loans) if (L.weeksLeft > 0) lines.push({ label: 'Loan payment', amount: -L.weekly, kind: 'loans' });
    return lines.filter((l) => l.amount);
  }

  private computeForecast() {
    const lines = this.weekLines(true);
    let income = 0, expense = 0;
    for (const l of lines) if (l.amount > 0) income += l.amount; else expense -= l.amount;
    return { lines, income, expense, net: income - expense };
  }

  /**
   * The weekly bill at today's rates: taxes in, upkeep, imports and loan
   * payments out. One-time spending is never part of it. Cached briefly;
   * any transaction invalidates it.
   */
  forecastWeek() {
    const key = `${Math.floor(this.day * 8)}|${this.taxRate}|${this.population}`;
    if (!this.fcCache || this.fcCache.key !== key) this.fcCache = { key, v: this.computeForecast() };
    return this.fcCache.v;
  }

  /** a ledger's recurring and one-time totals */
  static split(L: Ledger) {
    let recurring = 0, oneTime = 0;
    for (const k of RECURRING) recurring += L[k];
    for (const k of ONE_TIME) oneTime += L[k];
    return { recurring, oneTime, total: recurring + oneTime };
  }
  isUnlocked(key: { zone?: ZoneType; road?: string }): boolean {
    if (this.mode === 'sandbox') return true;
    const u = UNLOCKS.find((u) => (key.zone && u.zone === key.zone) || (key.road && u.road === key.road));
    return !u || this.unlocked.has(u.what);
  }

  time(hour: number): GameTime {
    const d = Math.floor(this.day);
    return { day: d, dayOfYear: d % 365, year: Math.floor(d / 365), hour };
  }

  dateLabel() {
    const d = Math.floor(this.day);
    const start = new Date(2026, 2, 20);
    const dt = new Date(start.getTime() + d * 86400000);
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // ------------------------------------------------------------------ tick
  update(dtReal: number) {
    if (this.ended) return;
    const days = (dtReal * SPEEDS[this.speed]) / DAY_SECONDS;
    if (days <= 0) return;
    this.day += days;
    this.net.day = this.day;
    this.b.day = this.day;
    this.b.tickConstruction(days, this.weatherBuildMul * (this.mode === 'speedrun' ? 1.6 : 1));
    const whole = Math.floor(this.day);
    while (this.lastWhole < whole) {
      this.lastWhole++;
      this.dailyTick(this.lastWhole);
    }
  }

  private dailyTick(d: number) {
    const cap = { comLow: 0, comHigh: 0, industry: 0, office: 0 };
    // Households arrive at a steady, city-wide rate (a trickle that grows with
    // the town), not by instantly filling every new building.
    const open: Bld[] = [];
    for (const bld of this.b.list.values()) {
      if (bld.state !== 'active' || bld.abandoned !== undefined) continue;
      if (bld.zone === 'resLow' || bld.zone === 'resHigh') {
        if (this.demand.res < -60 && bld.occ > 0 && this.rng.chance(0.2)) bld.occ--;
        else if (bld.occ < bld.cap && !this.vacancyBlock(bld)) open.push(bld);
      } else if (isZoned(bld) && !this.vacancyBlock(bld)) {
        cap[bld.zone as keyof typeof cap] += bld.cap;
      }
    }
    if (this.demand.res > -30 && open.length) {
      let arrivals = Math.round((2.5 + this.population * 0.012) * clamp(this.demand.res / 50, 0.25, 1.3) * this.growthMul);
      for (let guard = 0; arrivals > 0 && open.length && guard < 400; guard++) {
        const k = this.rng.int(0, open.length - 1), bld = open[k];
        const hh = Math.min(bld.cap - bld.occ, this.rng.int(1, 3), arrivals); // a household
        bld.occ += hh;
        arrivals -= hh;
        if (bld.occ >= bld.cap) { open[k] = open[open.length - 1]; open.pop(); }
      }
    }
    this.population = 0;
    let resHighPop = 0;
    for (const bld of this.b.list.values()) {
      if (bld.abandoned !== undefined || (bld.zone !== 'resLow' && bld.zone !== 'resHigh')) continue;
      this.population += bld.occ;
      if (bld.zone === 'resHigh') resHighPop += bld.occ;
    }
    this.jobsCap = cap;
    const jobs = cap.comLow + cap.comHigh + cap.industry + cap.office;
    this.workers = Math.round(this.population * 0.55);
    // commuters drive in from out of town when locals can't fill the jobs
    const commuters = Math.round(Math.max(0, jobs - this.workers) * 0.35);
    this.jobsFilled = Math.min(jobs, this.workers + commuters);
    const fill = jobs ? this.jobsFilled / jobs : 0;
    for (const bld of this.b.list.values()) if (isZoned(bld) && bld.zone !== 'resLow' && bld.zone !== 'resHigh') bld.occ = bld.state === 'active' && bld.abandoned === undefined && !this.vacancyBlock(bld) ? Math.round(bld.cap * fill) : 0;
    this.unemployment = this.workers ? Math.max(0, this.workers - jobs) / this.workers : 0;

    // ---- demand: the real-ish urban economics (jobs-housing balance, retail per capita, goods chain)
    const P = this.population, W = this.workers;
    const boom = P < 200 ? 25 : P < 800 ? 10 : 0;
    const taxHit = (this.taxRate - 0.09) * 450;
    const gap = jobs * 0.95 - W;
    const jobsTerm = (70 * gap) / Math.max(60, W);
    const comCap = cap.comLow + cap.comHigh;
    const retailNeed = P * 0.2 + 8;
    const retailTerm = (100 * (retailNeed - comCap)) / Math.max(25, retailNeed);
    const goodsNeed = comCap * 0.8 + 18;
    const goodsTerm = (100 * (goodsNeed - cap.industry)) / Math.max(25, goodsNeed);
    const joblessTerm = this.unemployment * 60;
    const officeNeed = resHighPop * 0.25 + P * 0.03 + 4;
    const officeTerm = (100 * (officeNeed - cap.office)) / Math.max(20, officeNeed);
    const why: DemandWhy = { res: [], com: [], ind: [], off: [] };
    const parts: DemandParts = { res: [], com: [], ind: [], off: [] };
    const part = (k: DemandKey, text: string, v: number, base = false) => { why[k].push(text); parts[k].push(base ? { text, v, base } : { text, v }); };
    const dm: Record<DemandKey, number> = { res: 30 + jobsTerm + boom - taxHit, com: retailTerm - taxHit, ind: goodsTerm + joblessTerm - taxHit, off: officeTerm - taxHit };
    part('res', 'new-town appetite', 30, true);
    part('res', gap >= 0 ? `${Math.round(gap)} more jobs than workers` : `${Math.round(-gap)} more workers than jobs`, jobsTerm);
    if (boom) part('res', 'small-town boom', boom);
    part('com', comCap < retailNeed ? `shoppers want ${Math.round(retailNeed - comCap)} more shop jobs` : `${Math.round(comCap - retailNeed)} too many shop jobs for ${P} people`, retailTerm);
    part('ind', cap.industry < goodsNeed ? `shops need goods: ${Math.round(goodsNeed - cap.industry)} factory jobs short` : 'enough factories for the shops', goodsTerm);
    if (this.unemployment > 0.05) part('ind', `${Math.round(this.unemployment * 100)}% unemployed want work`, joblessTerm);
    part('off', cap.office < officeNeed ? `${Math.round(officeNeed - cap.office)} office jobs wanted` : 'offices saturated', officeTerm);
    if (Math.abs(taxHit) > 2) for (const k of ['res', 'com', 'ind', 'off'] as const) part(k, `taxes at ${Math.round(this.taxRate * 100)}%`, -taxHit);
    // weather only damps (or boosts) demand that is already positive
    const wm = this.weatherDemandMul;
    if (wm !== 1) for (const k of ['res', 'com', 'ind', 'off'] as const) {
      const v = dm[k] > 0 ? dm[k] * (wm - 1) : 0;
      dm[k] += v;
      if (Math.abs(v) >= 0.5) part(k, `weather ×${wm.toFixed(2)}`, v);
    }
    // extension hooks (services, districts, freight) explain themselves in
    // text; measure what each one actually changed so the numbers add up
    for (const h of this.hooks.demand) {
      const before = { ...dm }, had = { res: why.res.length, com: why.com.length, ind: why.ind.length, off: why.off.length };
      h(dm, why);
      for (const k of ['res', 'com', 'ind', 'off'] as const) {
        const delta = dm[k] - before[k], added = why[k].slice(had[k]);
        if (added.length === 1) parts[k].push({ text: bare(added[0]), v: delta });
        else if (added.length > 1) {
          const vs = added.map(signedIn);
          const known = vs.every((v) => v !== null) && Math.abs(vs.reduce<number>((a, v) => a + (v ?? 0), 0) - delta) <= added.length;
          added.forEach((text, i) => parts[k].push({ text: known ? bare(text) : text, v: known ? vs[i] : null }));
        } else if (Math.abs(delta) >= 0.5) { why[k].push('other effects'); parts[k].push({ text: 'other effects', v: delta }); }
      }
    }
    this.demandRaw = { ...dm };
    this.demand = { res: clamp(dm.res, -100, 100), com: clamp(dm.com, -100, 100), ind: clamp(dm.ind, -100, 100), off: clamp(dm.off, -100, 100) };
    this.demandWhy = why;
    this.demandParts = parts;
    for (const k of ['res', 'com', 'ind', 'off'] as const) { const hst = this.demandHistory[k]; hst.push(this.demand[k]); if (hst.length > 8) hst.shift(); }

    // ---- growth
    const catDemand = (z: ZoneType) => {
      const dm = this.demand;
      switch (z) {
        case 'resLow': return dm.res * (P > 1500 ? 0.6 : 1);
        case 'resHigh': return dm.res * (P > 1500 ? 1 : 0.5);
        case 'comLow': return dm.com * (P > 2000 ? 0.6 : 1);
        case 'comHigh': return dm.com * (P > 2000 ? 1 : 0.5);
        case 'industry': return dm.ind;
        case 'office': return dm.off;
      }
    };
    // Builders start a steady number of new sites per day (more as the town
    // grows), handed to the zones with the most demand.
    this.growthAcc = Math.min(3, this.growthAcc + Math.min(5, (0.8 + P / 800) * this.growthMul));
    const wants: [ZoneType, number][] = [];
    for (const z of ZONE_TYPES) {
      if (!this.isUnlocked({ zone: z })) continue;
      const dem = catDemand(z);
      if (dem >= 5) wants.push([z, dem]);
    }
    for (let guard = 0; this.growthAcc >= 1 && wants.length && guard < 12; guard++) {
      const i = this.pickWeighted(wants);
      const [z, dem] = wants[i];
      this.zones.candidates(z, this.cand);
      let built = false;
      for (let k = 0; k < 3 && this.cand.length && !built; k++) built = !!this.b.tryGrow(z, this.cand);
      if (built) this.growthAcc -= 1;
      else wants.splice(i, 1); // no room for this zone today
      void dem;
    }

    // ---- land value + level ups every 3 days
    if (d % 3 === 0) this.landValueAndLevels(3);

    // ---- stats
    if (d % 5 === 0) this.updateSprawl();
    this.naturePct = this.trees.naturePct;
    this.checkMilestones();
    this.events.emit('day', d);
    if (d % 7 === 0) this.weekly();
    if (d % 2 === 0) this.history.push({ day: d, pop: this.population, money: this.money === Infinity ? 0 : this.money, nature: this.naturePct, sprawl: this.sprawlPct });
    if (this.history.length > 800) this.history.splice(0, this.history.length - 800);
  }

  private landValueAndLevels(days: number) {
    for (const bld of this.b.list.values()) {
      if (!isZoned(bld)) continue;
      const near = this.b.near(bld.x, bld.z, 140);
      let lv = 18;
      let ind = 0, com = 0, slop = 0, dense = 0, lm = 0;
      for (const o of near) {
        if (o === bld) continue;
        if (o.zone === 'landmark') { lm++; continue; }
        if (o.zone === 'service') continue;
        dense++;
        if (o.zone === 'industry') ind++;
        if (o.zone === 'comLow' || o.zone === 'comHigh') com++;
        if (o.brand === 'slop' || o.landmark === 'slopCannon') slop++;
      }
      lv += Math.min(40, dense * 1.1);
      lv += Math.min(30, lm * 15);
      for (const o of this.b.near(bld.x, bld.z, 300)) if (o.zone === 'landmark') { lv += 6; break; }
      if (bld.zone !== 'industry') lv -= Math.min(30, ind * (bld.zone.startsWith('res') ? 4 : 1.5));
      if (bld.zone.startsWith('res')) lv += Math.min(10, com * 1.2);
      lv += Math.min(10, slop * 5);
      const h = this.terrain.h(bld.x, bld.z);
      lv += Math.min(12, Math.max(0, h) * 0.12);
      // waterfront premium
      for (const [dx, dz] of [[60, 0], [-60, 0], [0, 60], [0, -60]]) if (this.terrain.h(bld.x + dx, bld.z + dz) < WATER) { lv += 8; break; }
      lv += Math.min(12, this.trees.countIn(bld.x, bld.z, 70) * 0.3);
      lv -= this.communePenalty(bld.x, bld.z);
      for (const h of this.hooks.landValue) lv += h(bld);
      bld.lv = clamp(lv, 0, 100);
      if (bld.state !== 'active' || bld.abandoned !== undefined) continue;
      const max = this.levelCap(bld).max;
      const target = clamp(1 + Math.floor(bld.lv / 18), 1, max);
      const fullEnough = bld.cap === 0 || bld.occ >= bld.cap * 0.7;
      if (target > bld.level && fullEnough) {
        bld.levelProgress += days * 0.06 * this.growthMul;
        if (bld.levelProgress >= 1) this.b.levelUp(bld);
      }
    }
  }

  /** First vacancy block reason from the hooks (no power, no water, ...). */
  vacancyBlock(b: Bld): string | null {
    for (const h of this.hooks.vacancy) { const r = h(b); if (r) return r; }
    return null;
  }

  /** The level a building may reach right now, and what caps it. */
  levelCap(b: Bld): { max: number; why: string } {
    let best = { max: isZoned(b) ? MAX_LEVEL[b.zone] : 1, why: '' };
    for (const h of this.hooks.levelCap) { const r = h(b); if (r && r.max < best.max) best = r; }
    return best;
  }

  /**
   * The binding constraint: the one thing currently stopping this building's
   * next good outcome (filling up, or leveling up). For the inspector.
   */
  bindingConstraint(b: Bld): string | null {
    if (!isZoned(b)) return null;
    if (b.abandoned !== undefined) return `Abandoned: ${this.vacancyBlock(b) ?? 'nobody wants to live here'}`;
    if (b.state !== 'active') return null;
    const block = this.vacancyBlock(b);
    if (block) return block;
    const isRes = b.zone === 'resLow' || b.zone === 'resHigh';
    if (b.occ < b.cap * 0.7) return isRes ? (this.demand.res <= -30 ? 'Nobody is moving here (low residential demand)' : 'Filling up') : 'Not enough workers';
    const cap = this.levelCap(b);
    if (b.level >= cap.max) return b.level >= MAX_LEVEL[b.zone] ? null : cap.why;
    const need = (b.level) * 18;
    if (b.lv < need) return `Land value ${Math.round(b.lv)} of ${need} needed for level ${b.level + 1}`;
    return null;
  }

  private pickWeighted(list: [unknown, number][]): number {
    let sum = 0;
    for (const [, w] of list) sum += w;
    let r = this.rng.float() * sum;
    for (let i = 0; i < list.length; i++) { r -= list[i][1]; if (r <= 0) return i; }
    return list.length - 1;
  }

  private updateSprawl() {
    let covered = 0;
    for (const p of this.buildable) {
      if (this.b.at(p.x, p.z) || this.b.near(p.x, p.z, 10).some((b) => this.b.contains(b, p.x, p.z, 5))) { covered++; continue; }
      const s = this.net.pickSeg(p.x, p.z, 5);
      if (s) covered++;
    }
    this.coverage = this.buildable.length ? covered / this.buildable.length : 0;
    const c = this.b.counts();
    this.maxedPct = c.total ? c.maxed / c.total : 0;
    this.sprawlPct = clamp(this.coverage / 0.9, 0, 1) * 0.6 + this.maxedPct * 0.4 * clamp(this.coverage / 0.9, 0, 1);
    if (!this.ended && this.coverage >= 0.9 && this.maxedPct >= 0.98 && c.total > 50) {
      this.ended = true;
      this.events.emit('ending', undefined);
    }
  }

  private checkMilestones() {
    while (this.popMarks.length && this.population >= this.popMarks[0]) {
      const v = this.popMarks.shift()!;
      this.events.emit('milestone', { kind: 'population', value: v, label: `Population ${v.toLocaleString()}` });
    }
    while (this.natureMarks.length && this.naturePct <= this.natureMarks[0]) {
      const v = this.natureMarks.shift()!;
      this.events.emit('milestone', { kind: 'nature', value: v, label: `${Math.round(v * 100)}% of nature remaining` });
    }
    while (this.sprawlMarks.length && this.sprawlPct >= this.sprawlMarks[0]) {
      const v = this.sprawlMarks.shift()!;
      this.events.emit('milestone', { kind: 'sprawl', value: v, label: `${Math.round(v * 100)}% Endless Sprawl` });
    }
    for (const u of UNLOCKS) {
      if (!this.unlocked.has(u.what) && this.population >= u.pop) {
        this.unlocked.add(u.what);
        this.events.emit('milestone', { kind: 'unlock', value: u.pop, label: `Unlocked: ${u.what}` });
      }
    }
  }

  private onBuildingComplete(bld: Bld) {
    if (!isZoned(bld) || bld.level > 1) return;
    const perCell = { resLow: 110, resHigh: 130, comLow: 190, comHigh: 210, industry: 160, office: 240 }[bld.zone];
    this.earn(Math.round(perCell * bld.w * bld.d), 'impact');
  }

  private weekly() {
    // bill exactly the lines a forecast would show (the hooks close their
    // weekly accumulators when forecast=false)
    for (const l of this.weekLines(false)) {
      if (l.amount > 0) this.earn(l.amount, l.kind, l.label);
      else this.spend(-l.amount, l.label, l.kind);
    }
    for (const L of this.loans) if (L.weeksLeft > 0) L.weeksLeft--;
    this.loans = this.loans.filter((l) => l.weeksLeft > 0);
    // reconcile: the week's cash change must equal the sum of its ledger
    if (this.money !== Infinity) {
      const { total } = Sim.split(this.ledger);
      this.ledgerDrift = Math.round(this.money - this.weekStartCash - total);
      if (Math.abs(this.ledgerDrift) > 1) console.error(`Ledger out of balance by $${this.ledgerDrift} (week ending day ${Math.floor(this.day)})`);
      this.lastWeekCash = { from: Math.round(this.weekStartCash), to: Math.round(this.money) };
      this.weekStartCash = this.money;
    }
    this.lastWeek = this.ledger;
    this.ledger = emptyLedger();
    this.fcCache = null;
    this.events.emit('week', this.lastWeek);
    if (this.money !== Infinity) {
      if (this.money < 5000 && this.money >= 0) this.events.emit('lowMoney', this.money);
      if (this.money < BANKRUPT_AT) {
        this.bankruptWeeks++;
        if (this.bankruptWeeks >= BANKRUPT_WEEKS) this.events.emit('bankrupt', this.money);
      } else this.bankruptWeeks = 0;
    }
  }

  restoreState(day: number, money: number | null, tax: number, loans: Sim['loans'], pop: number, nature: number, sprawl: number) {
    this.day = day;
    this.lastWhole = Math.floor(day);
    this.net.day = day;
    this.b.day = day;
    this.money = money === null ? Infinity : money;
    this.weekStartCash = this.money;
    this.taxRate = tax;
    this.loans = loans;
    this.population = pop;
    this.naturePct = nature;
    this.sprawlPct = sprawl;
    this.popMarks = this.popMarks.filter((m) => m > pop);
    this.natureMarks = this.natureMarks.filter((m) => m < nature);
    this.sprawlMarks = this.sprawlMarks.filter((m) => m > sprawl);
    for (const u of UNLOCKS) if (pop >= u.pop) this.unlocked.add(u.what);
  }

  /** State that shapes what happens next but isn't in the core save fields. */
  serializeExtra() {
    return {
      bankruptWeeks: this.bankruptWeeks, growthAcc: this.growthAcc, rng: this.rng.state,
      ledger: { ...this.ledger }, lastWeek: { ...this.lastWeek }, history: this.history.slice(-400),
      unlocked: [...this.unlocked],
      weekStartCash: this.money === Infinity ? 0 : Math.round(this.weekStartCash), lastWeekCash: { ...this.lastWeekCash },
      transactions: this.transactions.slice(-60),
    };
  }

  restoreExtra(x: ReturnType<Sim['serializeExtra']> | undefined) {
    if (!x || typeof x !== 'object') return;
    if (Number.isFinite(x.bankruptWeeks)) this.bankruptWeeks = x.bankruptWeeks;
    if (Number.isFinite(x.growthAcc)) this.growthAcc = x.growthAcc;
    if (Number.isFinite(x.rng)) this.rng.state = x.rng >>> 0;
    if (x.ledger) this.ledger = { ...emptyLedger(), ...x.ledger };
    if (x.lastWeek) this.lastWeek = { ...emptyLedger(), ...x.lastWeek };
    // older saves: start reconciling from what this week has booked so far
    this.weekStartCash = Number.isFinite(x.weekStartCash) ? x.weekStartCash : this.money - Sim.split(this.ledger).total;
    if (x.lastWeekCash) this.lastWeekCash = x.lastWeekCash;
    if (Array.isArray(x.transactions)) this.transactions = x.transactions;
    if (Array.isArray(x.history)) this.history = x.history;
    if (Array.isArray(x.unlocked)) for (const u of x.unlocked) this.unlocked.add(u);
  }

  /** The weekly rate at today's rates (recurring lines only; see forecastWeek). */
  weeklyNet() {
    return this.forecastWeek().net;
  }
}
