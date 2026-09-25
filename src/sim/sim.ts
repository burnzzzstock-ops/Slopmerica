// The simulation: calendar, RCI(O) demand ratios, growth, move-ins, jobs,
// land value, level-ups, the Growth Ponzi budget, and the endless-sprawl ending.
import { MAX_LEVEL, ZONE_TYPES, type GameTime, type ZoneType } from '../contracts';
import { Emitter } from '../core/events';
import { clamp } from '../core/math';
import { Rng } from '../core/rng';
import type { Bld, Buildings } from './buildings';
import type { RoadNetwork } from '../roads/network';
import type { Zoning, ZCell } from '../zones/zoning';
import type { Terrain } from '../world/terrain';
import type { Trees } from '../world/trees';
import { WATER } from '../config';

export const DAY_SECONDS = 2.5;
export const SPEEDS = [0, 1, 2, 4];

export type Mode = 'sandbox' | 'ponzi' | 'hippie' | 'speedrun';

export interface Ledger {
  resTax: number;
  comTax: number;
  indTax: number;
  offTax: number;
  impact: number;
  grants: number;
  other: number;
  roads: number;
  construction: number;
  communes: number;
  loans: number;
}

const emptyLedger = (): Ledger => ({ resTax: 0, comTax: 0, indTax: 0, offTax: 0, impact: 0, grants: 0, other: 0, roads: 0, construction: 0, communes: 0, loans: 0 });

export const UNLOCKS: { pop: number; what: string; zone?: ZoneType; road?: string }[] = [
  { pop: 250, what: 'Luxury Slop apartments', zone: 'resHigh' },
  { pop: 400, what: 'Big Box commercial', zone: 'comHigh' },
  { pop: 600, what: 'MEGA Stroad (6 lanes)', road: 'stroad6' },
  { pop: 700, what: 'Content Farms (office)', zone: 'office' },
  { pop: 1500, what: 'Slopway highway', road: 'highway' },
  { pop: 2500, what: 'Katy Stroad (8 lanes)', road: 'stroad8' },
];

type Events = {
  milestone: { kind: 'population' | 'nature' | 'sprawl' | 'unlock' | 'maxLevel'; value: number; label: string };
  lowMoney: number;
  bankrupt: number;
  week: Ledger;
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
  weatherBuildMul = 1;
  weatherDemandMul = 1;
  /** gameplay hooks provided by the game */
  communePenalty: (x: number, z: number) => number = () => 0;

  constructor(public mode: Mode, private b: Buildings, private zones: Zoning, private net: RoadNetwork, private terrain: Terrain, private trees: Trees) {
    this.money = mode === 'sandbox' ? Infinity : mode === 'speedrun' ? 150000 : mode === 'hippie' ? 70000 : 90000;
    if (mode === 'speedrun') this.growthMul = 2;
    if (mode === 'sandbox') for (const u of UNLOCKS) this.unlocked.add(u.what);
    // sample buildable land once (for the sprawl meter)
    for (let z = -1000; z <= 1000; z += 16)
      for (let x = -1000; x <= 1000; x += 16) {
        const h = terrain.h(x, z);
        if (h > WATER + 0.4 && terrain.slope(x, z) < 0.3) this.buildable.push({ x, z });
      }
    b.onComplete = (bld) => this.onBuildingComplete(bld);
  }

  // ------------------------------------------------------------------ money
  spendable() {
    return this.money === Infinity ? Infinity : Math.max(0, this.money + 20000);
  }
  spend(amount: number, _label: string, kind: keyof Ledger = 'construction') {
    if (this.money === Infinity) return true;
    this.money -= amount;
    this.ledger[kind] -= amount;
    return true;
  }
  refund(amount: number) {
    if (this.money !== Infinity) this.money += amount;
    this.ledger.other += amount;
  }
  earn(amount: number, kind: keyof Ledger) {
    if (this.money !== Infinity) this.money += amount;
    this.ledger[kind] += amount;
  }
  takeLoan(amount: number) {
    const weeks = 52;
    const weekly = Math.round((amount * 1.18) / weeks);
    this.loans.push({ amount, weekly, weeksLeft: weeks });
    this.earn(amount, 'other');
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
    this.population = 0;
    let resHighPop = 0;
    const cap = { comLow: 0, comHigh: 0, industry: 0, office: 0 };
    for (const bld of this.b.list.values()) {
      if (bld.state !== 'active' && bld.occ === 0) continue;
      if (bld.zone === 'resLow' || bld.zone === 'resHigh') {
        // move-ins / move-outs
        if (bld.occ < bld.cap && this.demand.res > -30) bld.occ = Math.min(bld.cap, bld.occ + Math.max(1, Math.ceil(bld.cap * 0.18)));
        else if (this.demand.res < -60 && bld.occ > 0 && this.rng.chance(0.2)) bld.occ--;
        this.population += bld.occ;
        if (bld.zone === 'resHigh') resHighPop += bld.occ;
      } else if (bld.zone !== 'landmark' && bld.state === 'active') {
        cap[bld.zone] += bld.cap;
      }
    }
    this.jobsCap = cap;
    const jobs = cap.comLow + cap.comHigh + cap.industry + cap.office;
    this.workers = Math.round(this.population * 0.55);
    // commuters drive in from out of town when locals can't fill the jobs
    const commuters = Math.round(Math.max(0, jobs - this.workers) * 0.35);
    this.jobsFilled = Math.min(jobs, this.workers + commuters);
    const fill = jobs ? this.jobsFilled / jobs : 0;
    for (const bld of this.b.list.values()) if (bld.zone !== 'resLow' && bld.zone !== 'resHigh' && bld.zone !== 'landmark') bld.occ = bld.state === 'active' ? Math.round(bld.cap * fill) : 0;
    this.unemployment = this.workers ? Math.max(0, this.workers - jobs) / this.workers : 0;

    // ---- demand: the real-ish urban economics (jobs-housing balance, retail per capita, goods chain)
    const P = this.population, W = this.workers;
    const boom = P < 200 ? 45 : P < 800 ? 20 : 0;
    const taxHit = (this.taxRate - 0.09) * 450;
    let res = 30 + (70 * (jobs * 0.95 - W)) / Math.max(60, W) + boom - taxHit;
    const comCap = cap.comLow + cap.comHigh;
    const retailNeed = P * 0.2 + 8;
    let com = (100 * (retailNeed - comCap)) / Math.max(25, retailNeed) - taxHit;
    const goodsNeed = comCap * 0.8 + 18;
    let ind = (100 * (goodsNeed - cap.industry)) / Math.max(25, goodsNeed) + this.unemployment * 60 - taxHit;
    const officeNeed = resHighPop * 0.25 + P * 0.03 + 4;
    let off = (100 * (officeNeed - cap.office)) / Math.max(20, officeNeed) - taxHit;
    const wm = this.weatherDemandMul;
    this.demand = {
      res: clamp(res * (res > 0 ? wm : 1), -100, 100),
      com: clamp(com * (com > 0 ? wm : 1), -100, 100),
      ind: clamp(ind * (ind > 0 ? wm : 1), -100, 100),
      off: clamp(off * (off > 0 ? wm : 1), -100, 100),
    };

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
    for (const z of ZONE_TYPES) {
      if (!this.isUnlocked({ zone: z })) continue;
      const dem = catDemand(z);
      if (dem < 5) continue;
      const attempts = Math.min(6, Math.ceil((dem / 25) * this.growthMul));
      this.zones.candidates(z, this.cand);
      if (!this.cand.length) continue;
      for (let k = 0; k < attempts; k++) if (this.rng.chance(clamp(dem / 90, 0.1, 1))) this.b.tryGrow(z, this.cand);
    }

    // ---- land value + level ups every 3 days
    if (d % 3 === 0) this.landValueAndLevels(3);

    // ---- stats
    if (d % 5 === 0) this.updateSprawl();
    this.naturePct = this.trees.naturePct;
    this.checkMilestones();
    if (d % 7 === 0) this.weekly();
    if (d % 2 === 0) this.history.push({ day: d, pop: this.population, money: this.money === Infinity ? 0 : this.money, nature: this.naturePct, sprawl: this.sprawlPct });
    if (this.history.length > 800) this.history.splice(0, this.history.length - 800);
  }

  private landValueAndLevels(days: number) {
    for (const bld of this.b.list.values()) {
      if (bld.zone === 'landmark') continue;
      const near = this.b.near(bld.x, bld.z, 140);
      let lv = 18;
      let ind = 0, com = 0, slop = 0, dense = 0;
      for (const o of near) {
        if (o === bld) continue;
        dense++;
        if (o.zone === 'industry') ind++;
        if (o.zone === 'comLow' || o.zone === 'comHigh') com++;
        if (o.brand === 'slop' || o.landmark === 'slopCannon') slop++;
      }
      lv += Math.min(34, dense * 1.1);
      if (bld.zone !== 'industry') lv -= Math.min(30, ind * (bld.zone.startsWith('res') ? 4 : 1.5));
      if (bld.zone.startsWith('res')) lv += Math.min(10, com * 1.2);
      lv += Math.min(10, slop * 5);
      const h = this.terrain.h(bld.x, bld.z);
      lv += Math.min(12, Math.max(0, h) * 0.12);
      // waterfront premium
      for (const [dx, dz] of [[60, 0], [-60, 0], [0, 60], [0, -60]]) if (this.terrain.h(bld.x + dx, bld.z + dz) < WATER) { lv += 8; break; }
      lv += Math.min(12, this.trees.countIn(bld.x, bld.z, 70) * 0.3);
      lv -= this.communePenalty(bld.x, bld.z);
      bld.lv = clamp(lv, 0, 100);
      if (bld.state !== 'active') continue;
      const max = MAX_LEVEL[bld.zone];
      const target = clamp(1 + Math.floor(bld.lv / 18), 1, max);
      const fullEnough = bld.cap === 0 || bld.occ >= bld.cap * 0.7;
      if (target > bld.level && fullEnough) {
        bld.levelProgress += days * 0.06 * this.growthMul;
        if (bld.levelProgress >= 1) this.b.levelUp(bld);
      }
    }
  }

  private updateSprawl() {
    let covered = 0;
    for (const p of this.buildable) {
      if (this.b.at(p.x, p.z)) { covered++; continue; }
      const s = this.net.pickSeg(p.x, p.z, 0);
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
    if (bld.zone === 'landmark' || bld.level > 1) return;
    const perCell = { resLow: 220, resHigh: 260, comLow: 380, comHigh: 420, industry: 320, office: 480 }[bld.zone];
    this.earn(Math.round(perCell * bld.w * bld.d), 'impact');
  }

  private weekly() {
    const t = this.taxRate / 0.09;
    let res = 0, com = 0, ind = 0, off = 0;
    for (const bld of this.b.list.values()) {
      if (bld.state !== 'active' && bld.occ === 0) continue;
      const lm = 1 + (bld.level - 1) * 0.3;
      if (bld.zone === 'resLow' || bld.zone === 'resHigh') res += bld.occ * 2.2 * lm;
      else if (bld.zone === 'comLow' || bld.zone === 'comHigh') com += bld.occ * 3.0 * lm;
      else if (bld.zone === 'industry') ind += bld.occ * 2.6 * lm;
      else if (bld.zone === 'office') off += bld.occ * 3.6 * lm;
    }
    this.earn(Math.round(res * t), 'resTax');
    this.earn(Math.round(com * t), 'comTax');
    this.earn(Math.round(ind * t), 'indTax');
    this.earn(Math.round(off * t), 'offTax');
    this.spend(Math.round(this.net.upkeep()), 'Road upkeep', 'roads');
    for (const L of this.loans) {
      if (L.weeksLeft <= 0) continue;
      L.weeksLeft--;
      this.spend(L.weekly, 'Loan payment', 'loans');
    }
    this.loans = this.loans.filter((l) => l.weeksLeft > 0);
    this.lastWeek = this.ledger;
    this.ledger = emptyLedger();
    this.events.emit('week', this.lastWeek);
    if (this.money !== Infinity) {
      if (this.money < 5000 && this.money >= 0) this.events.emit('lowMoney', this.money);
      if (this.money < -15000) {
        this.bankruptWeeks++;
        if (this.bankruptWeeks >= 6) this.events.emit('bankrupt', this.money);
      } else this.bankruptWeeks = 0;
    }
  }

  restoreState(day: number, money: number | null, tax: number, loans: Sim['loans'], pop: number, nature: number, sprawl: number) {
    this.day = day;
    this.lastWhole = Math.floor(day);
    this.net.day = day;
    this.b.day = day;
    this.money = money === null ? Infinity : money;
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

  /** Net per week from the last completed ledger. */
  weeklyNet() {
    const L = this.lastWeek;
    return Object.values(L).reduce((a, b) => a + b, 0);
  }
}
