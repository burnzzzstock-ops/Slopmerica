// In-game HUD: top bar (money, pop, date, speed, RCIO demand, nature/sprawl),
// bottom toolbar with sub-panels, the X feed, inspector, budget, toasts.
import { currentLayout, LAYOUT_ORDER, LAYOUTS, rotateLayout, selectLayout, type LayoutId } from '../roads/interchanges';
import * as THREE from 'three';
import { EXT } from '../ext/registry';
import type { LandmarkId, ZoneType } from '../contracts';
import { ZONE_TYPES } from '../contracts';
import type { Game, Selection, UiSink } from '../game';
import { LANDMARK_COST, LANDMARKS } from '../game';
import { ROAD_ORDER, ROAD_TYPES, RoadTypeId } from '../roads/roadTypes';
import { ZONE_COLORS, ZONE_LABEL, type ZCell } from '../zones/zoning';
import { MAX_LEVEL } from '../contracts';
import type { ToolId } from '../tools/tools';
import { GRID_BLOCKS, type GridBlock } from '../tools/gridRoads';
import { FeedPanel } from './feedPanel';
import { courtText, emergencyToast } from './copy';
import { MERCH_URL, brandById } from '../art/brands';
import { BUILD, cityFile, crumb, onCapturedError, openBugReport, saveFile, saveMessage } from './bugreport';
import { FOV_MAX, FOV_MIN, IS_TOUCH } from '../config';
import { QUALITY, type Quality } from '../config';
import { BANKRUPT_AT, BANKRUPT_WEEKS, CREDIT_LINE, LEDGER_LABEL, LOSS_LABEL, ONE_TIME, RECURRING, SPEEDS, Sim, UNLOCKS, usd, type DemandKey } from '../sim/sim';
import { SERVICE_DEFS, overloadedServices, type EmergencyView } from '../sim/services';
import { MILESTONES, lockText, milestoneAt, nameUnlock, unlockNames, unlockPop } from '../sim/milestones';
import { isZoned } from '../sim/buildings';
import type { ViewMode } from '../render/overlays';
import { ARCHETYPES } from '../agents/people';
import { saveGame } from '../sim/save';
import { VEHICLE_SPECS } from '../agents/vehicles';
import { LANDMARK_EVENTS } from '../agents/parking';
import { VISIT_PULL } from '../agents/traffic';


/** 5 pm, 8:30 am */
const clock12 = (h: number) => `${((Math.floor(h) + 11) % 12) + 1}${h % 1 ? `:${String(Math.round((h % 1) * 60)).padStart(2, '0')}` : ''} ${h % 24 < 12 ? 'am' : 'pm'}`;
/** what a landmark does, for its inspector (the numbers are the sim's and the traffic's) */
function landmarkEffects(id: LandmarkId | undefined): string {
  const e = id && LANDMARK_EVENTS[id];
  const when = e ? ` ${e.label}: ${e.when}, ${clock12(e.from)} to ${clock12(e.to)}; the town drives in and the lot fills.` : '';
  const lifts = 'lifts land value around it (more within 140 m, a little out to 300 m)';
  return `${id && VISIT_PULL[id] ? `Draws visitors by day and ${lifts}` : `${lifts[0].toUpperCase()}${lifts.slice(1)}`}.${when}`;
}

const esc = (s: string) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const money = (n: number) => (n === Infinity ? '∞' : (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString());


const ZONE_ICON: Record<ZoneType, string> = { resLow: '🏡', resHigh: '🏢', comLow: '🛒', comHigh: '🏬', industry: '🏭', office: '💻' };
for (const z of ZONE_TYPES) nameUnlock(`zone:${z}`, `${ZONE_ICON[z]} ${ZONE_LABEL[z]}`);
const DEMAND_KEYS: DemandKey[] = ['res', 'com', 'ind', 'off'];
const DEM: Record<DemandKey, { name: string; letter: string; noun: string; one: string; zones: [ZoneType, ZoneType?] }> = {
  res: { name: 'Residential', letter: 'R', noun: 'homes', one: 'home', zones: ['resLow', 'resHigh'] },
  com: { name: 'Commercial', letter: 'C', noun: 'shops', one: 'shop', zones: ['comLow', 'comHigh'] },
  ind: { name: 'Industrial', letter: 'I', noun: 'factories', one: 'factory', zones: ['industry'] },
  off: { name: 'Office', letter: 'O', noun: 'offices', one: 'office', zones: ['office'] },
};
/** +12 / −7 / 0, with a real minus sign */
const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');
/** how close a landfill forecast is to biting: 0 none, 1 within two months, 2 a month, 3 a week, 4 already full */
const soonness = (d: number | null) => (d === null ? 0 : d <= 0 ? 4 : d < 7 ? 3 : d < 30 ? 2 : 1);

type PanelId = 'roads' | 'zones' | 'landmarks' | 'views' | 'budget' | 'communes' | 'help' | 'more' | `ext:${string}` | null;

/** Phones get these in the toolbar; everything else lives in the More drawer. */
const PHONE_PRIMARY = ['inspect', 'roads', 'zones', 'ext:services', 'views', 'bulldoze'];
const DESK_PRIMARY = ['inspect', 'roads', 'zones', 'ext:services', 'landmarks', 'upgrade', 'bulldoze', 'views', 'budget', 'help', 'bug'];
const BUILD_TOOLS = ['roads', 'zones', 'ext:services', 'landmarks'];
const COMPACT = IS_TOUCH || (typeof window !== 'undefined' && window.innerWidth < 700);

/**
 * What the clock does when a city-wide emergency begins (Settings →
 * Emergencies): drop to normal speed (the default), pause, or keep going.
 */
type EmergencySpeed = 'slow' | 'pause' | 'off';
const EMERGENCY_SPEED_LABEL: Record<EmergencySpeed, string> = { slow: 'slow to ▶', pause: 'pause', off: 'keep speed' };
function emergencySpeed(): EmergencySpeed {
  try { const v = localStorage.getItem('slopmerica.emergencySpeed'); return v === 'pause' || v === 'off' ? v : 'slow'; } catch { return 'slow'; }
}
/** "~6 days", "6–20 days", "any day now" */
const etaText = ([lo, hi]: [number, number]) => (hi <= 1 ? 'any day now' : lo === hi ? `~${lo} days` : `${Math.max(1, lo)}–${hi} days`);

export class Hud implements UiSink {
  root: HTMLElement;
  feed: FeedPanel;
  private top!: HTMLElement;
  private bar!: HTMLElement;
  private sub!: HTMLElement;
  private inspector!: HTMLElement;
  /** when the inspector sheet last opened (performance.now()): see the click guard in the constructor */
  private inspectorOpenedAt = 0;
  /** when a finger last lifted off the screen (performance.now()) */
  private lastTouchUpAt = 0;
  private toasts!: HTMLElement;
  private remeasureToasts = true;
  private tip!: HTMLElement;
  private actions!: HTMLElement;
  private perfEl!: HTMLElement;
  private perfVisible = false;
  private floats: { el: HTMLElement; p: THREE.Vector3; t: number }[] = [];
  private panel: PanelId = null;
  private demandPop!: HTMLElement;
  private meterPop: HTMLElement | null = null;
  /** tools unlocked this session and not used yet (their cards say NEW) */
  private fresh = new Set<string>();
  /** zoned empty street-front lots and the day each was first seen waiting (Next hint) */
  private lotSeen = new Map<number, number>();
  private budgetHtml = '';
  private crisis: HTMLElement | null = null;
  private crisisHtml = '';
  private crisisDismissed = false;
  /** the right-hand column the in-the-red and emergency cards stack in */
  private sideCards!: HTMLElement;
  private emergencyEl: HTMLElement | null = null;
  private emergencyHtml = '';
  /**
   * the warning the player closed and how bad it was then (it comes back when
   * the situation changes or gets materially worse), and the one showing
   */
  private emergencyDismissed: { key: string; atRisk: number; soon: number } | null = null;
  private emergencyKey = '';
  private emergencyMin = false;
  /** what the clock did when this emergency began */
  private emergencyNote = '';
  /** the neighbourhood "Worst area" goes to next */
  private hotIdx = 0;
  private popPop: HTMLElement | null = null;
  private demandKey: DemandKey | null = null;
  private demandHtml = '';
  private demandCells: ZCell[] = [];
  private nextBar?: HTMLElement;
  private nextBarObs?: ResizeObserver;
  private nextHidden = '';
  private nextKey = '';
  private budgetSeen = false;
  private firstStepsDone = (() => { try { return localStorage.getItem('slopmerica.firstSteps') === '1'; } catch { return false; } })();
  private nextStepT = -99;
  private domT = 0;
  private v = new THREE.Vector3();

  constructor(private game: Game, parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'hud';
    parent.appendChild(this.root);
    this.buildTop();
    this.feed = new FeedPanel(game, this.root, IS_TOUCH || window.innerWidth < 760);
    this.feed.onUnread = (n) => {
      const b = this.root.querySelector('#feed-badge') as HTMLElement;
      if (b) { b.textContent = n ? String(n) : ''; b.hidden = !n; }
    };
    this.buildToolbar();
    this.wirePanelMinimize();
    this.inspector = this.mk('aside', 'inspector');
    // A tap on the map opens the sheet under the finger, and the browser's emulated click is then delivered to whatever is under the finger NOW: a building
    // tapped where the sheet's x appears was selected and then closed 21 ms later (seen at 110 degrees on the phone, scripts/ghosttap.mjs). No click that
    // soon after a finger lifted and the sheet opened is a deliberate press, so none reaches it (a click with no finger just before it, a script's, does).
    window.addEventListener('pointerup', (e) => { if (e.pointerType === 'touch') this.lastTouchUpAt = performance.now(); }, true);
    this.inspector.addEventListener('click', (e) => { const now = performance.now(); if (now - this.inspectorOpenedAt < 350 && now - this.lastTouchUpAt < 350) { e.stopPropagation(); e.preventDefault(); } }, true);
    this.inspector.hidden = true;
    this.sideCards = this.mk('div', 'side-cards');
    this.toasts = this.mk('div', 'toasts');
    this.tip = this.mk('div', 'cursor-tip');
    this.tip.hidden = true;
    this.actions = this.mk('div', 'tool-actions');
    this.perfEl = this.mk('div', 'perf-overlay');
    this.perfEl.hidden = true;
    this.demandPop = this.mk('div', 'demand-pop');
    this.demandPop.hidden = true;
    this.demandPop.setAttribute('role', 'dialog');
    this.demandPop.setAttribute('aria-label', 'Why demand is where it is');
    this.demandPop.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-k],[data-act]');
      if (!t) return;
      game.audio.play('click', 0.4);
      if (t.dataset.k) this.openDemand(t.dataset.k as DemandKey);
      else this.demandAction(t.dataset.act!);
    });
    // a tap anywhere else (the map, a panel) puts the card away
    document.addEventListener('pointerdown', (e) => {
      const t = e.target as HTMLElement;
      if (this.meterPop && !this.meterPop.hidden && !this.meterPop.contains(t) && !t.closest?.('#tb-meters')) this.closeMeters();
      if (this.popPop && !this.popPop.hidden && !this.popPop.contains(t) && !t.closest?.('#tb-popstat')) this.closePop();
      if (!this.demandKey) return;
      if (this.demandPop.contains(t) || t.closest?.('[data-dem]')) return;
      this.closeDemand();
    }, true);
    window.addEventListener('resize', () => { if (this.demandKey) this.placeDemand(); const f = this.sub?.querySelector('#fov-v'); if (f) f.textContent = this.fovText(); });
    this.actions.innerHTML = `<span class="ta-tip" id="ta-tip"></span><button id="ta-build" class="ta-build">🔨 Build</button><button id="ta-done" class="ta-done">${IS_TOUCH ? '✓ Done' : '✕ Stop'}</button><button id="ta-undo">↶ Undo</button>`;
    this.actions.hidden = true;
    // phones: Done leaves the tool entirely (double-tap ends just the current
    // road); desktop: Stop ends the road being drawn and keeps the tool
    this.actions.querySelector('#ta-done')!.addEventListener('click', () => {
      // desktop roads: stop this road, keep the tool; everything else: put the tool away
      if (IS_TOUCH || game.tools.active !== 'road') { this.exitTool(); return; }
      game.tools.cancel();
      game.audio.play('click', 0.4);
    });
    this.actions.querySelector('#ta-build')!.addEventListener('click', () => {
      if (game.tools.active === 'ext') game.tools.confirmExt();
      else game.tools.buildPending();
    });
    this.actions.querySelector('#ta-undo')!.addEventListener('click', () => game.undo());
    game.feed = this.feed;
    game.ui = this;
    // playtest: when something throws, offer the report right there
    let lastCrash = -1e9;
    onCapturedError((e) => {
      const now = performance.now();
      if (now - lastCrash < 45000 || document.querySelector('.bug')) return;
      lastCrash = now;
      this.root.querySelector('.crash-toast')?.remove();
      const el = this.mk('div', 'crash-toast');
      el.innerHTML = `<span>Something broke behind the scenes.</span><button class="bug-primary">🐞 Report it</button><button class="ct-x" aria-label="Dismiss">✕</button>`;
      el.querySelector('.bug-primary')!.addEventListener('click', () => { el.remove(); this.reportBug(`Something broke (the game said: "${e.msg.slice(0, 120)}"). I was `); });
      el.querySelector('.ct-x')!.addEventListener('click', () => el.remove());
      setTimeout(() => el.remove(), 12000);
    });
    // one active tool: the toolbar, the open panel's highlighted card, the
    // badge and the cursor tip all follow it
    game.tools.onChange = () => {
      this.syncToolbar();
      if (this.panel && this.panel !== 'budget' && this.panel !== 'help' && this.panel !== 'more' && this.panel !== 'communes') this.renderPanel();
    };
    window.addEventListener('keydown', (e) => this.hotkey(e));
    game.renderer.domElement.addEventListener('pointermove', (e) => {
      this.tipAt = { x: e.clientX, y: e.clientY };
      this.overMap = true;
      this.placeTip();
    });
    game.renderer.domElement.addEventListener('pointerleave', () => { this.overMap = false; });
    setTimeout(() => game.feed.push('gameStart'), 1500);
    if (!game.opts.restore) setTimeout(() => this.onboarding(), 900);
  }

  private tipAt = { x: 0, y: 0 };
  private overMap = false;
  /**
   * The cursor tip stays inside the game: below-right of the cursor, flipping
   * to the other side at the right and bottom edges, and wrapping long text
   * (a placement reason ran off the right edge in the playtest recording).
   */
  private placeTip() {
    const t = this.tip;
    if (t.hidden) return;
    const W = window.innerWidth, H = window.innerHeight, M = 6, { x, y } = this.tipAt;
    t.style.maxWidth = `${Math.max(180, Math.min(520, W - 2 * M))}px`;
    const r = t.getBoundingClientRect();
    let tx = x + 16, ty = y + 18;
    if (tx + r.width > W - M) tx = x - 12 - r.width; // flip to the cursor's left
    if (tx < M) tx = Math.max(M, Math.min(W - M - r.width, x - r.width / 2));
    if (ty + r.height > H - M) ty = y - 12 - r.height; // above the cursor
    if (ty < M) ty = M;
    t.style.transform = `translate(${Math.round(tx)}px, ${Math.round(ty)}px)`;
  }

  private onboarding() {
    let seen = false;
    try { seen = localStorage.getItem('slopmerica.onboarded') === '1'; } catch { /* private mode */ }
    if (seen) return;
    const el = this.mk('div', 'onboard');
    el.innerHTML = `
      <div class="ob-kicker">A MESSAGE FROM CHAD, ECONOMIC DEVELOPMENT</div>
      <h3>Welcome, Commissioner.</h3>
      <ol>
        <li><b>Roads</b>: draw one off <em>Old County Road</em>. ${IS_TOUCH ? 'Drag your finger to draw. Two fingers move the map.' : 'Click to start, click to end.'} Stroads are the American way (and the dearest to maintain: short gravel and two-lane streets pay for themselves sooner).</li>
        <li><b>Zoning</b>: paint green (homes), blue (shops) and yellow (industry) along it. Watch the R C I O bars.</li>
        <li><b>▶▶▶</b>: let the slop grow. Widen jammed roads with <b>One More Lane</b>. Hippies can be paid off or sued.</li>
      </ol>
      <p>Goal: pave every inch and max every building. Tokyo × Delhi or bust.</p>
      <p class="ob-playtest">🐞 <b>This is a playtest.</b> When something breaks, looks wrong or confuses you, tap <b>Report bug</b>${IS_TOUCH ? ' (under More)' : ''}.</p>
      <button id="ob-go">Let's pave</button>`;
    el.querySelector('#ob-go')!.addEventListener('click', () => {
      try { localStorage.setItem('slopmerica.onboarded', '1'); } catch { /* ignore */ }
      el.remove();
      this.onTool('roads');
    });
  }

  private mk(tag: string, cls: string, parent: HTMLElement = this.root) {
    const el = document.createElement(tag);
    el.className = cls;
    parent.appendChild(el);
    return el;
  }

  // ------------------------------------------------------------------ top bar
  private buildTop() {
    this.top = this.mk('header', 'topbar');
    this.top.innerHTML = `
      <div class="tb-city">
        <div class="tb-name" role="button" tabindex="0" id="tb-home" title="Back to town (H)">${esc(this.game.cityName)}</div>
        <div class="tb-date" id="tb-date"></div>
      </div>
      <div class="tb-speed" role="group" aria-label="Game speed">
        <button data-speed="0" title="Pause (Space)">❚❚</button>
        <button data-speed="1" title="Speed 1 (1)">▶</button>
        <button data-speed="2" title="Speed 2 (2)">▶▶</button>
        <button data-speed="3" title="Speed 3 (3)">▶▶▶</button>
      </div>
      <div class="tb-stat tb-popstat" role="button" tabindex="0" id="tb-popstat" aria-haspopup="dialog"><span class="tb-lbl">Pop</span><b id="tb-pop">0</b></div>
      <div class="tb-stat tb-money" role="button" tabindex="0" id="tb-treasury"><span class="tb-lbl">Treasury</span><b id="tb-money">$0</b><i id="tb-net"></i><i id="tb-growth" class="tb-growth" hidden></i></div>
      <div class="tb-demand" role="group" aria-label="Demand">
        ${DEMAND_KEYS.map((k) => `<button class="dbar" data-dem="${k}" aria-haspopup="dialog" aria-expanded="false"><span class="dtrack"><span class="dfill" id="d-${k}" style="--c:var(--${k})"></span><em>${DEM[k].letter}</em></span></button>`).join('')}
      </div>
      <div class="tb-meters" role="button" tabindex="0" id="tb-meters" aria-haspopup="dialog" aria-label="Nature and sprawl: show what they mean">
        <div class="meter" title="Nature remaining"><span>🌲</span><div class="mtrack"><div class="mfill nature" id="m-nature"></div></div><b id="m-nature-t"></b></div>
        <div class="meter" title="Progress toward Endless Sprawl"><span>🏙️</span><div class="mtrack"><div class="mfill sprawl" id="m-sprawl"></div></div><b id="m-sprawl-t"></b></div>
      </div>
      <div class="tb-weather" id="tb-weather"></div>`;
    this.top.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((b) =>
      b.addEventListener('click', () => { if (this.endingUp()) return; this.game.sim.speed = Number(b.dataset.speed); this.game.audio.play('click', 0.4); this.refreshTop(); }),
    );
    const meters = this.top.querySelector('#tb-meters') as HTMLElement;
    const toggleMeters = () => { this.game.audio.play('click', 0.4); if (this.meterPop && !this.meterPop.hidden) this.closeMeters(); else this.openMeters(); };
    meters.addEventListener('click', toggleMeters);
    meters.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleMeters(); } });
    // who moved in, who left and why
    const popStat = this.top.querySelector('#tb-popstat') as HTMLElement;
    const togglePop = () => { this.game.audio.play('click', 0.4); if (this.popPop && !this.popPop.hidden) this.closePop(); else this.openPop(); };
    popStat.addEventListener('click', togglePop);
    popStat.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); togglePop(); } });
    const home = this.top.querySelector('#tb-home') as HTMLElement;
    home.addEventListener('click', () => this.game.goHome());
    home.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.game.goHome(); } });
    const treasury = this.top.querySelector('#tb-treasury') as HTMLElement;
    const openBudget = () => { if (this.panel !== 'budget') this.onTool('budget'); };
    treasury.addEventListener('click', openBudget);
    treasury.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openBudget(); } });
    this.top.querySelectorAll<HTMLButtonElement>('[data-dem]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.dem as DemandKey;
      this.game.audio.play('click', 0.4);
      if (this.demandKey === k) this.closeDemand(); else this.openDemand(k);
    }));
  }

  // ------------------------------------------------------------------ budget
  /**
   * Where the budget is heading: road upkeep as today's roads age (a third
   * of full price the first year, full by year four), and how far the town is
   * from paying its own way at today's tax per resident.
   */
  private budgetOutlook(fc: { net: number; lines: { amount: number; kind: string }[] }): string {
    const g = this.game, s = g.sim;
    const now = g.net.upkeep(), y1 = g.net.upkeep(365), y4 = g.net.upkeep(365 * 4);
    const rows: string[] = [];
    if (now > 1) rows.push(`🛣️ Roads cost more as they age: <b>${usd(now)}/wk</b> now → <b>${usd(y1)}/wk</b> in a year → <b>${usd(y4)}/wk</b> in four (today's roads; the state maintains Old County Road unless you widen it).`);
    const tax = fc.lines.filter((l) => /Tax$/.test(l.kind)).reduce((a, l) => a + l.amount, 0);
    const perHead = s.population > 0 && tax > 0 ? tax / s.population : 1.2;
    if (fc.net < 0) {
      const more = Math.ceil(-fc.net / perHead / 10) * 10;
      rows.push(`⚖️ To break even at today's costs: about <b>${more.toLocaleString()} more residents</b> with jobs to match (you make ${usd(perHead)}/wk a head in taxes), or less upkeep. Short, busy streets pay; long empty ones don't.`);
    } else rows.push(`⚖️ The town pays its own way: <b class="pos">+${usd(fc.net)}/wk</b> at today's rates. Aging roads will eat into it${y1 > now + 1 ? ` (${usd(y1 - now)}/wk more in a year)` : ''}.`);
    return `<div class="bg-outlook">${rows.map((r) => `<p>${r}</p>`).join('')}</div>`;
  }

  /** the budget's numbers: next week's bill, this week's one-time money, last week, the log */
  private budgetLive(): string {
    const g = this.game, s = g.sim;
    if (s.money === Infinity) return '<p>Sandbox: money is no object. Nothing to balance.</p>';
    const fc = s.forecastWeek();
    const sign = (v: number) => `<b class="${v < 0 ? 'neg' : v > 0 ? 'pos' : ''}">${v > 0 ? '+' : ''}${usd(v)}</b>`;
    const row = (label: string, v: number, cls = '') => `<tr class="${cls}"><td>${esc(label)}</td><td>${sign(v)}</td></tr>`;
    const lines = [...fc.lines].sort((a, b) => (b.amount > 0 ? 1 : 0) - (a.amount > 0 ? 1 : 0) || Math.abs(b.amount) - Math.abs(a.amount));
    const shown = lines.slice(0, 9), rest = lines.slice(9);
    const restSum = rest.reduce((a, l) => a + l.amount, 0);
    const spendable = s.money + CREDIT_LINE;
    const runway = fc.net < 0 ? Math.floor(Math.max(0, spendable) / -fc.net) : Infinity;
    const dayOfWeek = (Math.floor(s.day) % 7) + 1;
    const oneTime = ONE_TIME.filter((k) => Math.round(s.ledger[k]));
    const last = Sim.split(s.lastWeek), lc = s.lastWeekCash;
    // growth money vs forever costs: the Ponzi in two numbers
    const growth = s.growthWeek();
    const recent = s.transactions.slice(-12).reverse();
    return `
      <div class="bg-top">
        <div><span>Treasury</span>${sign(s.money)}</div>
        <div><span>Every week</span><b class="${fc.net < 0 ? 'neg' : 'pos'}">${fc.net >= 0 ? '+' : ''}${usd(fc.net)}/wk</b></div>
        <div><span>${fc.net < 0 ? 'Money lasts' : 'Trend'}</span><b class="${runway < 8 ? 'neg' : ''}">${fc.net >= 0 ? 'growing' : runway >= 520 ? '10+ years' : `${runway} week${runway === 1 ? '' : 's'}`}</b></div>
      </div>
      <table>
        <tr class="head"><td colspan="2">Every week, at today's rates</td></tr>
        ${shown.map((l) => row(l.label, l.amount)).join('')}
        ${rest.length ? row(`${rest.length} smaller lines`, restSum) : ''}
        ${row('Weekly balance', fc.net, 'total')}
      </table>
      <table>
        <tr class="head"><td colspan="2">This week so far · day ${dayOfWeek} of 7</td></tr>
        ${oneTime.length ? oneTime.map((k) => row(LEDGER_LABEL[k], s.ledger[k])).join('') : '<tr><td colspan="2" class="muted">No one-time spending or income yet.</td></tr>'}
        <tr><td colspan="2" class="muted">Taxes and upkeep are billed when the week ends.</td></tr>
      </table>
      ${growth >= 1 ? `<p class="bg-growth">Growth money: new buildings' impact fees and grants brought <b class="pos">+${usd(growth)}/wk</b> on average lately. It stops when growth stops; upkeep doesn't.</p>` : ''}
      ${this.budgetOutlook(fc)}
      <details class="bg-more"><summary>Last week: ${usd(lc.from)} → ${usd(lc.to)} (${last.total >= 0 ? '+' : ''}${usd(last.total)})</summary>
        <table>
          ${RECURRING.filter((k) => Math.round(s.lastWeek[k])).map((k) => row(LEDGER_LABEL[k], s.lastWeek[k])).join('')}
          ${row('Recurring', last.recurring, 'sub')}
          ${ONE_TIME.filter((k) => Math.round(s.lastWeek[k])).map((k) => row(LEDGER_LABEL[k], s.lastWeek[k])).join('')}
          ${row('One-time', last.oneTime, 'sub')}
        </table>
        ${Math.abs(s.ledgerDrift) > 1 ? `<p class="neg">Ledger mismatch: ${usd(s.ledgerDrift)} unaccounted for. Please report this (🐞).</p>` : ''}
      </details>
      <details class="bg-more"><summary>Recent transactions</summary>
        <table>${recent.map((t) => `<tr><td><span class="muted">d${Math.floor(t.day)}</span> ${esc(t.label)}</td><td>${sign(t.amount)}</td></tr>`).join('') || '<tr><td class="muted">Nothing yet.</td></tr>'}</table>
      </details>`;
  }

  private budgetRules(): string {
    const s = this.game.sim;
    if (s.money === Infinity) return '';
    return `<b>Debt:</b> you can spend down to ${usd(-CREDIT_LINE)}. Below ${usd(BANKRUPT_AT)} at ${BANKRUPT_WEEKS} weekly closes in a row, the city goes bankrupt${s.bankruptWeeks ? ` (<b class="neg">${s.bankruptWeeks}/${BANKRUPT_WEEKS}</b> so far)` : ''}.`;
  }

  /** update the open panel's live numbers without re-rendering it (keeps focus and scroll) */
  private refreshPanelLive() {
    if (this.panel === 'budget') {
      const live = this.sub.querySelector('.budget-live') as HTMLElement | null, rules = this.sub.querySelector('.bg-rules') as HTMLElement | null;
      if (live) {
        const open = [...live.querySelectorAll('details')].map((d) => d.open);
        const html = this.budgetLive();
        if (html !== this.budgetHtml) {
          this.budgetHtml = html;
          live.innerHTML = html;
          live.querySelectorAll('details').forEach((d, i) => { d.open = open[i] ?? false; });
        }
      }
      if (rules) { const r = this.budgetRules(); if (rules.innerHTML !== r) rules.innerHTML = r; }
    } else if (this.panel?.startsWith('ext:')) {
      EXT.panels.find((x) => `ext:${x.id}` === this.panel)?.refresh?.(this.sub, this.game);
    }
  }

  /** In the red: a card that says why and what to do, without blocking the map. */
  private syncCrisis() {
    const s = this.game.sim;
    const red = s.money !== Infinity && s.money < 0;
    if (!red) { this.crisisDismissed = false; if (this.crisis) this.crisis.hidden = true; return; }
    if (this.crisisDismissed) return;
    if (!this.crisis) {
      this.crisis = this.mk('aside', 'crisis', this.sideCards);
      this.crisis.setAttribute('role', 'status');
      this.crisis.addEventListener('click', (e) => {
        const a = (e.target as HTMLElement).closest<HTMLElement>('[data-crisis]')?.dataset.crisis;
        if (!a) return;
        this.game.audio.play('click', 0.4);
        if (a === 'budget') { if (this.panel !== 'budget') this.onTool('budget'); }
        else if (a === 'pause') this.game.sim.speed = 0;
        else if (a === 'close') { this.crisisDismissed = true; this.crisis!.hidden = true; }
      });
    }
    // what drained it: the biggest outflows of the last two weeks, and the weekly rate
    const since = s.day - 14, by = new Map<string, number>();
    for (const t of s.transactions) if (t.day >= since && t.amount < 0 && !RECURRING.includes(t.kind)) by.set(t.label, (by.get(t.label) ?? 0) + t.amount);
    const top = [...by].sort((a, b) => a[1] - b[1]).slice(0, 3);
    const fc = s.forecastWeek();
    const worst = [...fc.lines].filter((l) => l.amount < 0).sort((a, b) => a.amount - b.amount)[0];
    const html = `<div class="crisis-head"><b>In the red: ${usd(s.money)}</b><button data-crisis="close" aria-label="Dismiss">✕</button></div>
      <p>${top.length ? `Recent spending: ${top.map(([l, v]) => `${esc(l)} ${usd(v)}`).join(' · ')}.` : ''} Every week: <b class="${fc.net < 0 ? 'neg' : 'pos'}">${fc.net >= 0 ? '+' : ''}${usd(fc.net)}</b>${worst ? ` (biggest: ${esc(worst.label)} ${usd(worst.amount)})` : ''}.</p>
      <p class="muted">Credit left ${usd(s.money + CREDIT_LINE)}. Bankrupt after ${BANKRUPT_WEEKS} weekly closes below ${usd(BANKRUPT_AT)}${s.bankruptWeeks ? ` (${s.bankruptWeeks}/${BANKRUPT_WEEKS})` : ''}. Raise taxes, take a loan, or let growth fees catch up.</p>
      <div class="crisis-acts"><button class="chip on" data-crisis="budget">💰 Budget</button>${s.speed ? '<button class="chip" data-crisis="pause">❚❚ Pause</button>' : ''}</div>`;
    if (html !== this.crisisHtml) { this.crisisHtml = html; this.crisis.innerHTML = html; }
    this.crisis.hidden = false;
  }

  // ------------------------------------------------------------------ service emergencies
  /**
   * A city-wide service failure just began (services' daily assessment).
   * Playtest 4: at top speed a full landfill emptied a 5,141-person city in
   * eleven game days (about seven real seconds) while the warnings were
   * toasts among crash and Florida Man posts. So: slow the clock (or pause,
   * per Settings) and keep a card up that says what, why, how long, and where.
   */
  emergency(e: EmergencyView) {
    const s = this.game.sim, top = e.needs[0];
    const mode = emergencySpeed(), was = s.speed;
    if (mode === 'pause' && s.speed) s.speed = 0;
    else if (mode === 'slow' && s.speed > 1) s.speed = 1;
    this.emergencyNote = s.speed === was ? '' : `${s.speed ? 'Slowed to ▶ normal speed' : 'Paused'} for this emergency (Settings → Emergencies)`;
    this.emergencyMin = false;
    this.hotIdx = 0;
    crumb(`emergency: ${top?.need ?? '?'} · ${e.atRisk} buildings, ${e.residents} residents · speed ${was}→${s.speed}`);
    this.game.audio.play('siren', 0.5);
    this.toast(emergencyToast(top?.label, e.atRisk, top?.failing, s.speed === was ? 'same' : s.speed ? 'slowed' : 'paused'), true);
    this.refreshTop();
  }

  /** open Services on one category, with its info view on (the affected buildings show red) */
  private openServices(cat: string) {
    const ep = EXT.panels.find((p) => p.id === 'services');
    if (!ep) return;
    if (this.panel !== 'ext:services') this.openPanel('ext:services');
    ep.focus?.(this.game, cat);
    this.renderPanel();
  }

  /** fly to the next worst neighbourhood and select the building there that empties soonest */
  private showWorst(e: EmergencyView) {
    const h = e.hot[this.hotIdx % e.hot.length];
    if (!h) return;
    this.hotIdx++;
    const g = this.game, top = e.needs[0];
    if (top) EXT.panels.find((p) => p.id === 'services')?.focus?.(g, top.cat);
    g.rts.setView(h.x, h.z, Math.min(g.rts.distance, 460));
    const b = g.buildings.list.get(h.id);
    if (b) g.select({ kind: 'building', b });
    crumb(`emergency: show area ${this.hotIdx} (${h.n} buildings)`);
  }

  private syncEmergency() {
    const e = this.game.emergency?.() ?? null;
    const lvl = e?.level ?? 'none';
    const key = e ? `${lvl}|${e.needs.map((n) => n.need).join(',')}|${e.crisis.since}|${e.forecast ? 'f' : ''}` : '';
    const d = this.emergencyDismissed;
    // a closed warning stays closed until it's a different one, twice as many buildings, or a landfill a stage closer to full
    const hidden = !!e && !!d && lvl !== 'crit' && d.key === key && e.atRisk <= Math.max(3, d.atRisk * 2) && soonness(e.forecastDays) <= d.soon;
    if (!e || lvl === 'none' || hidden) {
      if (this.emergencyEl) this.emergencyEl.hidden = true;
      return;
    }
    if (!this.emergencyEl) {
      // first in the column: an emergency outranks being in the red
      this.emergencyEl = document.createElement('aside');
      this.emergencyEl.setAttribute('role', 'alert');
      this.sideCards.prepend(this.emergencyEl);
      this.emergencyEl.addEventListener('click', (ev) => {
        const a = (ev.target as HTMLElement).closest<HTMLElement>('[data-em]')?.dataset.em;
        const now = this.game.emergency?.();
        if (!a || !now) return;
        this.game.audio.play('click', 0.4);
        crumb(`emergency card: ${a}`);
        if (a.startsWith('fix:')) this.openServices(a.slice(4));
        else if (a === 'show') this.showWorst(now);
        else if (a === 'pause') this.game.sim.speed = 0;
        else if (a === 'play') this.game.sim.speed = 1;
        else if (a === 'min') this.emergencyMin = !this.emergencyMin;
        else if (a === 'close') this.emergencyDismissed = { key: this.emergencyKey, atRisk: now.atRisk, soon: soonness(now.forecastDays) };
        this.emergencyHtml = '';
        this.refreshTop();
      });
    }
    this.emergencyKey = key;
    const html = this.emergencyCard(e);
    this.emergencyEl.className = `emergency em-${lvl}${this.emergencyMin && lvl === 'crit' ? ' min' : ''}`;
    if (html !== this.emergencyHtml) {
      const open = this.emergencyEl.querySelector('details')?.open ?? false;
      this.emergencyHtml = html;
      this.emergencyEl.innerHTML = html;
      const d = this.emergencyEl.querySelector('details');
      if (d) d.open = open;
    }
    this.emergencyEl.hidden = false;
  }

  private emergencyCard(e: EmergencyView): string {
    const g = this.game, s = g.sim, top = e.needs[0];
    const n = (v: number) => Math.round(v).toLocaleString();
    const plural = (v: number, one: string, many = `${one}s`) => `${n(v)} ${v === 1 ? one : many}`;
    const fix = (x: EmergencyView['needs'][number]) => `<button class="chip on" data-em="fix:${x.cat}">${x.icon} Fix ${esc(x.label.toLowerCase())}</button>`;
    const show = e.hot.length ? `<button class="chip" data-em="show">📍 Worst area${e.hot.length > 1 ? ` (${(this.hotIdx % e.hot.length) + 1}/${e.hot.length})` : ''}</button>` : '';
    const clock = s.speed ? '<button class="chip" data-em="pause">❚❚ Pause</button>' : '<button class="chip" data-em="play">▶ Resume</button>';
    if (e.level === 'crit' && top) {
      const head = `<div class="em-head"><b>🚨 ${esc(top.label)} emergency</b><span class="em-since">since ${esc(s.dateOf(e.crisis.since, false))}</span><button data-em="min" aria-label="${this.emergencyMin ? 'Expand' : 'Minimize'}">${this.emergencyMin ? '+' : '–'}</button></div>`;
      if (this.emergencyMin) return `${head}<p class="em-lead">${e.atRisk ? `${plural(e.atRisk, 'building')} ${esc(top.failing)} · first empty ${etaText(top.eta)}` : `${plural(e.abandoned, 'building')} abandoned`}</p>`;
      const flow = s.popFlow(14);
      const lost = flow.causes.slice(0, 4).map((c) => `${esc(LOSS_LABEL[c.cause])} ${n(c.n)}`).join(' · ');
      const log = s.alerts.slice(-8).reverse();
      const onClock = e.needs.filter((x) => x.buildings > 0);
      // nothing left on the clock but still broken: the city emptied out
      const lead = e.atRisk && onClock.length
        ? `<b>${plural(e.atRisk, 'building')}</b> on the clock${e.residents ? `, <b>${plural(e.residents, 'resident')}</b>` : ''}: abandoned in ${etaText([Math.min(...onClock.map((x) => x.eta[0])), Math.max(...onClock.map((x) => x.eta[1]))])} unless it's fixed.`
        : `The city has emptied out: <b>${plural(e.abandoned, 'building')}</b> stand abandoned. Nothing comes back until it's fixed.`;
      return `${head}
        <p class="em-lead">${lead}</p>
        <ul class="em-needs">${e.needs.slice(0, 3).map((x) => `<li><div><span>${x.icon} ${x.buildings ? `${plural(x.buildings, 'building')} ${esc(x.failing)}${x.residents ? ` (${n(x.residents)} people)` : ''}` : `${esc(x.label)} still failing`}</span>${x.buildings ? `<b>${etaText(x.eta)}</b>` : ''}</div><small>Why: ${esc(x.why)}.</small></li>`).join('')}</ul>
        ${lost ? `<p class="em-lost">Left in the last 14 days: ${lost}${flow.in ? ` · moved in ${n(flow.in)}` : ''}</p>` : ''}
        <div class="em-acts">${fix(top)}${show}${clock}</div>
        ${this.emergencyNote ? `<p class="em-note">${esc(this.emergencyNote)}</p>` : ''}
        ${log.length ? `<details class="em-log"><summary>What happened</summary><ol>${log.map((a) => `<li class="em-${a.level}"><span>${esc(s.dateOf(a.day, false))}</span> ${esc(a.text)}</li>`).join('')}</ol></details>` : ''}`;
    }
    if (e.level === 'recovering') {
      const c = e.crisis;
      const still = e.needs.filter((x) => x.buildings >= 3);
      return `<div class="em-head"><b>✅ Recovering${c.cause ? ` from the ${esc(c.cause)} emergency` : ''}</b><button data-em="close" aria-label="Dismiss">✕</button></div>
        <p class="em-lead">Buildings at risk <b>${n(c.peakAtRisk)} → ${n(e.atRisk)}</b>${c.peakTrash ? ` · trash piling up ${n(c.peakTrash)} → ${n(e.trash)}` : ''} · population ${n(c.lowPop)} at the low → <b>${n(s.population)}</b></p>
        ${still.length ? `<p>Still failing: ${still.map((x) => `${x.icon} ${plural(x.buildings, 'building')} ${esc(x.failing)}`).join(' · ')}.</p>` : ''}
        ${e.forecast ? `<p>${esc(e.forecast)}</p>` : ''}
        <div class="em-acts">${still[0] ? fix(still[0]) : ''}${still.length ? show : ''}</div>`;
    }
    // a warning: something to fix before it becomes an emergency
    return `<div class="em-head"><b>⚠️ ${top ? `${plural(top.buildings, 'building')} ${esc(top.failing)}` : 'Coming up'}</b><button data-em="close" aria-label="Dismiss">✕</button></div>
      ${top ? `<p class="em-lead">Abandoned in ${etaText(top.eta)} unless fixed. Why: ${esc(top.why)}.</p>` : ''}
      ${e.forecast ? `<p>${esc(e.forecast)}</p>` : ''}
      <div class="em-acts">${top ? fix(top) : e.forecast ? '<button class="chip on" data-em="fix:garbage">🗑️ Garbage</button>' : ''}${top ? show : ''}</div>`;
  }

  // ------------------------------------------------------------------ population explainer
  private openPop() {
    this.closeDemand();
    this.closeMeters();
    if (!this.popPop) {
      this.popPop = this.mk('div', 'demand-pop pop-pop');
      this.popPop.setAttribute('role', 'dialog');
      this.popPop.setAttribute('aria-label', 'Population: who moved in, who left and why');
      this.popPop.addEventListener('click', (ev) => {
        const a = (ev.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
        if (a === 'close') this.closePop();
        else if (a === 'show') { const e = this.game.emergency?.(); if (e?.hot.length) { this.closePop(); this.showWorst(e); } }
      });
    }
    crumb('opened population');
    this.popPop.hidden = false;
    this.renderPop();
    const r = this.top.querySelector('#tb-popstat')!.getBoundingClientRect();
    const W = window.innerWidth, w = Math.min(320, W - 32);
    const left = Math.max(16, Math.min(W - 16 - w, r.left + r.width / 2 - w / 2));
    Object.assign(this.popPop.style, { width: `${w}px`, left: `${left}px`, top: `${r.bottom + 10}px` });
    this.popPop.style.setProperty('--caret', `${Math.max(14, Math.min(w - 14, r.left + r.width / 2 - left))}px`);
  }

  private closePop() {
    if (this.popPop) this.popPop.hidden = true;
  }

  /** How many people, the most ever, and who moved in and out (and why) lately. */
  private renderPop() {
    if (!this.popPop || this.popPop.hidden) return;
    const g = this.game, s = g.sim, n = (v: number) => Math.round(v).toLocaleString();
    const flow = s.popFlow(30);
    const back = s.history.find((h) => h.day >= Math.floor(s.day) - 14);
    const trend = back ? s.population - back.pop : 0;
    const e = g.emergency?.();
    const risk = e && e.atRisk && e.needs[0] ? `<p class="dp-next">⚠️ <b>${n(e.atRisk)} building${e.atRisk === 1 ? '' : 's'}</b>${e.residents ? ` (${n(e.residents)} people)` : ''} on the clock: ${esc(e.needs[0].failing)}, abandoned in ${etaText(e.needs[0].eta)}.</p><div class="dp-acts">${e.hot.length ? '<button class="dp-go" data-act="show">📍 Show me</button>' : ''}</div>` : '';
    const html = `
      <div class="dp-head"><b>Population</b><button class="dp-x" data-act="close" aria-label="Close">✕</button></div>
      <div class="dp-title" style="--c:var(--res)"><span class="dp-name">👥 Residents</span><span class="dp-val">${n(s.population)}</span><span class="dp-trend ${trend > 3 ? 'up' : trend < -3 ? 'down' : ''}">${back ? `${trend > 0 ? '▲' : trend < 0 ? '▼' : ''} ${signed(Math.round(trend))} in 14d` : 'new'}</span></div>
      <p class="dp-status">Most ever: <b>${n(Math.max(s.peakPop, s.population))}</b>. Tools unlocked by population stay unlocked if the city shrinks.</p>
      <div class="dp-h">Last 30 days</div>
      <ul><li class="dp-up"><span>Moved in</span><b>+${n(flow.in)}</b></li>${flow.causes.slice(0, 6).map((c) => `<li class="dp-down"><span>${esc(LOSS_LABEL[c.cause])}</span><b>−${n(c.n)}</b></li>`).join('')}${flow.causes.length ? '' : '<li class="dp-na"><span>Nobody left</span></li>'}</ul>
      ${risk}
      <div class="dp-base">People who left are booked to the root cause: trash that made them sick counts as garbage.</div>`;
    if (this.popPop.innerHTML !== html) this.popPop.innerHTML = html;
  }

  // ------------------------------------------------------------------ nature & sprawl explainer
  private openMeters() {
    this.closeDemand();
    if (!this.meterPop) {
      this.meterPop = this.mk('div', 'demand-pop meter-pop');
      this.meterPop.setAttribute('role', 'dialog');
      this.meterPop.setAttribute('aria-label', 'Nature and sprawl');
      this.meterPop.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('[data-act="close"]')) this.closeMeters(); });
    }
    crumb('opened meters');
    this.meterPop.hidden = false;
    this.renderMeters();
    const r = this.top.querySelector('#tb-meters')!.getBoundingClientRect();
    const W = window.innerWidth, w = Math.min(320, W - 32);
    const left = Math.max(16, Math.min(W - 16 - w, r.left + r.width / 2 - w / 2));
    Object.assign(this.meterPop.style, { width: `${w}px`, left: `${left}px`, top: `${r.bottom + 10}px` });
    this.meterPop.style.setProperty('--caret', `${Math.max(14, Math.min(w - 14, r.left + r.width / 2 - left))}px`);
  }

  private closeMeters() {
    if (this.meterPop) this.meterPop.hidden = true;
  }

  private renderMeters() {
    if (!this.meterPop || this.meterPop.hidden) return;
    const s = this.game.sim, pct = (v: number) => `${Math.round(v * 100)}%`;
    const fine = (v: number) => (v > 0 && v < 0.1 ? `${(v * 100).toFixed(1)}%` : pct(v));
    const G = s.nextGoals(), goals: string[] = [];
    if (G.pop) goals.push(`👥 Reach <b>${G.pop.toLocaleString()} people</b> (${s.population.toLocaleString()} now)`);
    if (G.unlock && G.unlock.pop !== G.pop) goals.push(`🔓 At ${G.unlock.pop.toLocaleString()} people: <b>${esc(G.unlock.what)}</b>`);
    else if (G.unlock) goals[goals.length - 1] += `: unlocks <b>${esc(G.unlock.what)}</b>`;
    if (s.money !== Infinity) {
      const net = s.forecastWeek().net;
      goals.push(net >= 0 ? `⚖️ <b>Paying its own way</b> (+${usd(net)}/wk). Keep it there as roads age.` : `⚖️ <b>Break even</b>: ${usd(-net)}/wk short. Budget shows how far.`);
    }
    if (G.sprawl) goals.push(`🏙️ <b>${fine(G.sprawl)} Endless Sprawl</b> (${fine(s.sprawlPct)} now)`);
    const html = `
      <div class="dp-head"><b>Nature &amp; sprawl</b><button class="dp-x" data-act="close" aria-label="Close">✕</button></div>
      <div class="dp-title" style="--c:var(--good)"><span class="dp-name">🌲 Nature left</span><span class="dp-val">${pct(s.naturePct)}</span></div>
      <p class="dp-status">The county's original trees still standing. Roads, buildings and terraforming cut them down, and they don't grow back.</p>
      <div class="dp-title" style="--c:var(--slop)"><span class="dp-name">🏙️ Endless Sprawl</span><span class="dp-val">${pct(s.sprawlPct)}</span></div>
      <p class="dp-status">Your win meter. ${fine(s.coverage)} of buildable land is paved or built on; ${pct(s.maxedPct)} of buildings are maxed out. Pave 90% of it with 98% maxed to win: a long game, so aim for the steps below.</p>
      <div class="dp-title" style="--c:var(--accent, #ffd23f)"><span class="dp-name">🎯 Next goals</span></div>
      <ul class="dp-goals">${goals.map((x) => `<li>${x}</li>`).join('')}</ul>`;
    if (this.meterPop.innerHTML !== html) this.meterPop.innerHTML = html;
  }

  // ------------------------------------------------------------------ demand explainer
  /** Open the "why is this bar where it is" card for one demand type. */
  openDemand(k: DemandKey) {
    crumb(`demand ${k}`);
    this.demandKey = k;
    this.demandHtml = '';
    this.demandPop.hidden = false;
    this.renderDemand();
    this.placeDemand();
    for (const b of this.top.querySelectorAll<HTMLElement>('[data-dem]')) {
      b.classList.toggle('on', b.dataset.dem === k);
      b.setAttribute('aria-expanded', String(b.dataset.dem === k));
    }
  }

  closeDemand() {
    if (!this.demandKey) return;
    this.demandKey = null;
    this.demandPop.hidden = true;
    for (const b of this.top.querySelectorAll<HTMLElement>('[data-dem]')) { b.classList.remove('on'); b.setAttribute('aria-expanded', 'false'); }
  }

  private placeDemand() {
    const bars = this.top.querySelector('.tb-demand')!.getBoundingClientRect();
    const W = window.innerWidth, w = Math.min(340, W - 32);
    const left = Math.max(16, Math.min(W - 16 - w, bars.left + bars.width / 2 - w / 2));
    const st = this.demandPop.style;
    st.width = `${w}px`;
    st.left = `${left}px`;
    st.top = `${bars.bottom + 10}px`;
    const bar = this.demandKey && this.top.querySelector(`[data-dem="${this.demandKey}"]`)?.getBoundingClientRect();
    st.setProperty('--caret', `${bar ? Math.max(14, Math.min(w - 14, bar.left + bar.width / 2 - left)) : w / 2}px`);
  }

  /** the zone a player should paint for this demand right now (null = locked) */
  /**
   * The one thing to do next, from all four demands at once: zone what
   * builders want where there's no lot left, open new street frontage when
   * every lot along the roads is spoken for, or wait while builders work.
   */
  /** The one thing to do next, as text (demand card, bar tooltip). */
  nextStep(): string {
    return this.nextAction().text;
  }

  /**
   * The one thing to do next, from all four demands at once, with a button
   * that does it: zone what builders want where there's no lot left, open new
   * street frontage when every lot along the roads is spoken for, or wait
   * while builders work. Lot words are exact: zoned lots with no building yet,
   * zoned lots that all have buildings, and unzoned lots along your roads.
   */
  nextAction(): { text: string; act?: string; label?: string } {
    const g = this.game, s = g.sim, cells: ZCell[] = [];
    // what's failing comes before what to zone next (playtest: an overloaded
    // fire station with five fires while the hint still said to grow)
    const em = g.emergency?.();
    const top = em && em.level !== 'none' && em.level !== 'recovering' ? em.needs.find((x) => x.buildings > 0) : undefined;
    if (top) return { text: `${top.icon} ${top.buildings} building${top.buildings === 1 ? '' : 's'} ${top.failing}: ${top.why}.`, act: `fix:${top.cat}`, label: `${top.icon} Fix ${top.label.toLowerCase()}` };
    const over = overloadedServices(g)[0];
    if (over) return { text: `${over.icon} ${over.name} is overloaded (${over.load.toLocaleString()} of ${over.capacity.toLocaleString()}): everything it covers gets slower, worse service. Build another one nearby.`, act: `fix:${over.cat}`, label: `${over.icon} Services` };
    let free = 0;
    const zonedAny = new Map<string, number>();
    for (const c of g.zones.cells.values()) {
      if (!c.valid) continue;
      if (c.zone) zonedAny.set(c.zone, (zonedAny.get(c.zone) ?? 0) + 1);
      else if (c.row === 0 && !c.bld && (!g.net.allowed || g.net.allowed(c.x, c.z))) free++;
    }
    // a lot that has sat zoned and empty for a month isn't one builders are about to use
    // (the playtest's "wait for shops on one zoned lot" never went away)
    const day = Math.floor(s.day), seen = this.lotSeen;
    const waiting = (z: ZoneType) => {
      let fresh = 0, stale = 0;
      for (const c of g.zones.candidates(z, cells)) {
        const since = seen.get(c.id) ?? (seen.set(c.id, day), day);
        if (day - since > 30) stale++;
        else fresh++;
      }
      return { fresh, stale };
    };
    if (seen.size > 20000) seen.clear();
    const ranked = DEMAND_KEYS.map((k) => {
      const zone = this.demandZone(k);
      let open = 0, stale = 0;
      if (zone) for (const z of DEM[k].zones) if (z && s.isUnlocked({ zone: z })) { const w = waiting(z); open += w.fresh; stale += w.stale; }
      const zoned = DEM[k].zones.reduce((n, z) => n + (z ? zonedAny.get(z) ?? 0 : 0), 0);
      return { k, v: Math.round(s.demand[k]), zone, open, stale, zoned };
    }).sort((a, b) => b.v - a.v);
    for (const r of ranked) {
      if (r.v < 5) break;
      const D = DEM[r.k];
      if (!r.zone) continue;
      const why = `${D.letter} ${signed(r.v)}`;
      if (r.open > 0) return { text: `Wait: builders are putting up ${D.noun} on ${r.open} zoned lot${r.open === 1 ? '' : 's'} (${why}). Speed up to watch it happen.`, act: 'speed', label: '▶▶▶ Speed up' };
      if (free > 0) {
        const state = r.stale ? `the ${r.stale} lot${r.stale === 1 ? '' : 's'} zoned for ${D.noun} ${r.stale === 1 ? 'has' : 'have'} sat empty for a month (too cramped or awkward for builders)` : r.zoned ? `every lot zoned for ${D.noun} has a building` : `no lots are zoned for ${D.noun} yet`;
        return { text: `Zone ${D.noun} beside a road: builders want them (${why}) and ${state}. ${free} unzoned lots line your roads.`, act: `zone:${r.zone}`, label: `${ZONE_ICON[r.zone]} Zone ${D.noun}` };
      }
      return { text: `Build a street: builders want ${D.noun} (${why}) but every lot along your roads is zoned. Short streets off existing ones are cheapest.`, act: 'road', label: '🛣️ Roads' };
    }
    const locked = ranked.find((r) => r.v >= 5 && !r.zone);
    if (locked) {
      // nothing that's unlocked wants building, so "zone what's in demand" led nowhere
      // (playtest 6: a town sat at 1,181 people for 2,600 days waiting for offices
      // at 1,800 then, with taxes at 15% holding homes back): say what's holding homes back
      const u = UNLOCKS.find((x) => x.zone === DEM[locked.k].zones[0]);
      const drag = s.demandParts.res.filter((p) => !p.base && p.v !== null && p.v < -3).sort((a, b) => a.v! - b.v!)[0];
      return {
        text: `Grow: ${DEM[locked.k].noun} unlock at ${u?.pop.toLocaleString() ?? 'a bigger'} people, and nothing else wants building (homes ${signed(Math.round(s.demand.res))}${drag ? `, held back by ${drag.text}` : ''}). Lower taxes or add jobs to bring people in.`,
        act: 'budget', label: '💰 Budget',
      };
    }
    const worst = DEMAND_KEYS.flatMap((k) => s.demandParts[k].filter((p) => !p.base && p.v !== null && p.v < -3)).sort((a, b) => a.v! - b.v!)[0];
    return { text: `Wait: nothing wants building right now${worst ? ` (biggest drag: ${worst.text})` : ''}. Taxes, services and jobs move demand.`, act: 'budget', label: '💰 Budget' };
  }

  /**
   * A first town, one step at a time: a street, homes on it, the first house
   * finished, jobs, then a look at the money. Each ticks off as it happens.
   */
  firstSteps(): { n: number; of: number; text: string; act?: string; label?: string } | null {
    const g = this.game, s = g.sim;
    if (this.firstStepsDone) return null;
    const own = [...g.net.segs.values()].some((q) => q.name !== 'Old County Road');
    let res = false, jobs = false;
    for (const c of g.zones.cells.values()) {
      if (!c.zone) continue;
      if (c.zone === 'resLow' || c.zone === 'resHigh') res = true;
      else jobs = true;
    }
    const home = [...g.buildings.list.values()].some((b) => (b.zone === 'resLow' || b.zone === 'resHigh') && b.state === 'active');
    const steps: { done: boolean; text: string; act?: string; label?: string }[] = [
      // zoning homes straight onto the county road counts too: the demand card suggests it
      { done: own || res, text: 'Draw a street off Old County Road (or zone homes right along it). Short and cheap beats long and grand.', act: 'road', label: '🛣️ Roads' },
      { done: res, text: 'Zone homes along your street: paint the lots beside it.', act: 'zone:resLow', label: '🏡 Zone homes' },
      { done: home, text: 'Let builders finish the first home. Speed up while they work.', act: 'speed', label: '▶▶▶ Speed up' },
      { done: jobs, text: 'Give people jobs: zone shops or industry nearby.', act: 'zone:comLow', label: '🛒 Zone shops' },
      { done: this.budgetSeen, text: 'Check the money: taxes in, upkeep out, and how long it lasts.', act: 'budget', label: '💰 Budget' },
    ];
    const i = steps.findIndex((x) => !x.done);
    if (i < 0) { this.firstStepsDone = true; try { localStorage.setItem('slopmerica.firstSteps', '1'); } catch { /* not remembered */ } return null; }
    return { n: i + 1, of: steps.length, ...steps[i] };
  }

  private doAction(act: string) {
    const g = this.game;
    crumb(`next step ${act}`);
    if (act.startsWith('zone:')) {
      g.tools.zoneType = act.slice(5) as ZoneType;
      if (this.panel !== 'zones') this.onTool('zones');
      g.tools.set('zone');
      this.renderPanel();
    } else if (act === 'road') { if (this.panel !== 'roads') this.onTool('roads'); }
    else if (act === 'speed') g.sim.speed = 3;
    else if (act.startsWith('fix:')) this.openServices(act.slice(4));
    else if (act === 'budget') this.openPanel('budget');
    this.refreshTop();
  }

  /** The persistent "Next" line under the top bar: first steps, then demand; and the next unlock. */
  private renderNextBar() {
    if (!this.nextBar) {
      this.nextBar = this.mk('div', 'next-bar');
      this.nextBar.setAttribute('role', 'status');
      this.nextBar.addEventListener('click', (e) => {
        const el = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
        if (!el) return;
        const act = el.dataset.act!;
        if (act === 'hide') { this.nextHidden = this.nextKey; this.nextBar!.hidden = true; return; }
        this.doAction(act);
      });
    }
    const fs = this.firstSteps();
    const a = fs ?? this.nextAction();
    const G = this.game.sim.nextGoals();
    const unlock = G.unlock ? `<span class="nb-unlock" title="Next milestone: ${esc(G.unlock.what)}">🔓 ${G.unlock.pop.toLocaleString()}: ${esc(G.unlock.name)} <small>(${this.game.sim.population.toLocaleString()} now)</small></span>` : '';
    const key = a.text;
    this.nextKey = key;
    const busy = this.game.tools.active !== 'inspect' || !!this.game.tools.placingLabel;
    this.nextBar.hidden = this.nextHidden === key || (busy && !fs);
    const html = `<span class="nb-step">${fs ? `<b>Step ${fs.n}/${fs.of}</b>` : '<b>Next</b>'} ${esc(a.text)}</span>${a.act ? `<button class="chip on" data-act="${a.act}">${esc(a.label ?? 'Go')}</button>` : ''}${unlock}<button class="nb-x" data-act="hide" aria-label="Hide until the next step" title="Hide until the next step">✕</button>`;
    if (this.nextBar.innerHTML !== html) this.nextBar.innerHTML = html;
    this.placeNextBar();
  }

  /** wide windows: beside the toolbar, in space the map doesn't use; narrow
   *  ones: just above the toolbar or an open drawer (never over the drawing
   *  badge). Runs whenever the drawer or toolbar changes size, not just on the
   *  bar's own refresh, so a drawer opening never ends up under it. */
  private placeNextBar() {
    if (!this.nextBar) return;
    if (!this.nextBarObs && typeof ResizeObserver !== 'undefined') {
      this.nextBarObs = new ResizeObserver(() => this.placeNextBar());
      this.nextBarObs.observe(this.sub);
      this.nextBarObs.observe(this.bar);
    }
    const tb = this.bar.getBoundingClientRect(), W = window.innerWidth, H = window.innerHeight;
    const side = W - tb.right - 24;
    const st = this.nextBar.style;
    if (!IS_TOUCH && side >= 250) {
      this.nextBar.classList.add('side');
      const w = Math.round(Math.min(340, side));
      st.left = 'auto'; st.right = '12px'; st.transform = 'none';
      st.maxWidth = `${w}px`;
      // an open drawer that reaches under it: sit on top of the drawer instead
      const sr = !this.sub.hidden ? this.sub.getBoundingClientRect() : null;
      const over = sr && sr.right > W - 12 - w;
      st.bottom = `${Math.round(over ? H - sr!.top + 8 : H - tb.bottom)}px`;
    } else {
      this.nextBar.classList.remove('side');
      st.left = ''; st.right = ''; st.transform = ''; st.maxWidth = '';
      const anchor = !this.sub.hidden ? this.sub.getBoundingClientRect().top : tb.top;
      st.bottom = `${Math.max(8, Math.round(H - anchor + 8))}px`;
    }
  }

  /** occupied, vacant and open lots for one demand type, and jobs against workers */
  private townGlance(k: DemandKey): string {
    const g = this.game, s = g.sim, D = DEM[k];
    let n = 0, cap = 0, occ = 0;
    for (const b of g.buildings.list.values()) if (isZoned(b) && (b.zone === D.zones[0] || b.zone === D.zones[1]) && b.abandoned === undefined && b.state === 'active') { n++; cap += b.cap; occ += b.occ; }
    const cells: ZCell[] = [];
    const open = D.zones.reduce((m, z) => m + (z && s.isUnlocked({ zone: z }) ? g.zones.candidates(z, cells).length : 0), 0);
    const jobs = s.jobsCap.comLow + s.jobsCap.comHigh + s.jobsCap.industry + s.jobsCap.office;
    const unit = k === 'res' ? 'homes' : 'jobs';
    return `<div class="dp-glance">
      <div><span>${D.noun[0].toUpperCase() + D.noun.slice(1)}</span><b>${n}</b></div>
      <div><span>${unit} filled</span><b>${occ.toLocaleString()} / ${cap.toLocaleString()}</b></div>
      <div><span>Empty zoned lots</span><b>${open}</b></div>
      <div><span>Jobs · workers</span><b>${jobs.toLocaleString()} · ${s.workers.toLocaleString()}</b></div>
    </div>`;
  }

  private demandZone(k: DemandKey): ZoneType | null {
    const s = this.game.sim, P = s.population;
    const [low, high] = DEM[k].zones;
    if (high && s.isUnlocked({ zone: high }) && (P > (k === 'res' ? 1500 : 2000) || !s.isUnlocked({ zone: low }))) return high;
    return s.isUnlocked({ zone: low }) ? low : null;
  }

  private renderDemand() {
    const k = this.demandKey;
    if (!k) return;
    const g = this.game, s = g.sim, D = DEM[k];
    const v = Math.round(s.demand[k]), raw = Math.round(s.demandRaw[k]);
    const hist = s.demandHistory[k];
    const trend = hist.length >= 2 ? Math.round(hist[hist.length - 1] - hist[0]) : 0;
    const days = Math.max(1, hist.length - 1);
    const zone = this.demandZone(k);
    const lock = zone ? null : UNLOCKS.find((u) => u.zone === D.zones[0]);
    const open = zone ? D.zones.reduce((n, z) => n + (z && s.isUnlocked({ zone: z }) ? g.zones.candidates(z, this.demandCells).length : 0), 0) : 0;
    let status: string;
    if (!zone) status = `🔒 ${D.noun[0].toUpperCase() + D.noun.slice(1)} unlock at ${lock?.pop.toLocaleString() ?? 'a bigger'} people${lock && milestoneAt(lock.pop) ? ` (the ${milestoneAt(lock.pop)!.name} milestone)` : ''}.`;
    else if (v >= 5) {
      const zoned = [...g.zones.cells.values()].some((c) => c.zone === D.zones[0] || (!!D.zones[1] && c.zone === D.zones[1]));
      status = open ? `Builders are putting up ${D.noun} on the ${open} zoned lot${open === 1 ? '' : 's'} with no building yet.`
        : zoned ? `Builders want to put up ${D.noun}, but every lot zoned for them has a building. Zone more along a road.`
        : `Builders want to put up ${D.noun}, but no lots are zoned for them yet. Zone some along a road.`;
    }
    else if (k === 'res' && v <= -30) status = v <= -60 ? 'Nobody is moving in, and some residents are packing up.' : 'Nobody is moving in.';
    else status = `Too little demand: no new ${D.noun} are being built.`;
    const parts = s.demandParts[k].filter((p) => !p.base && (p.v === null || Math.abs(p.v) >= 0.5));
    const up = parts.filter((p) => p.v !== null && p.v > 0).sort((a, b) => b.v! - a.v!).slice(0, 3);
    const down = parts.filter((p) => p.v !== null && p.v < 0).sort((a, b) => a.v! - b.v!).slice(0, 3);
    const other = parts.filter((p) => p.v === null);
    const base = s.demandParts[k].find((p) => p.base);
    const row = (p: { text: string; v: number | null }, dir: 'up' | 'down' | 'na') => `<li class="dp-${dir}"><span>${esc(p.text)}</span>${p.v === null ? '' : `<b>${signed(Math.round(p.v))}</b>`}</li>`;
    // one fix for the biggest thing holding this bar back, one way to use the demand
    const acts: [string, string][] = [];
    if (zone && v >= 5) acts.push([`zone:${zone}`, `${ZONE_ICON[zone]} Zone ${D.noun}`]);
    else {
      const best = DEMAND_KEYS.filter((o) => o !== k && s.demand[o] >= 5 && this.demandZone(o)).sort((a, b) => s.demand[b] - s.demand[a])[0];
      if (best) { const z = this.demandZone(best)!; acts.push([`zone:${z}`, `${ZONE_ICON[z]} Zone ${DEM[best].noun} instead`]); }
    }
    const hasServices = EXT.panels.some((p) => p.id === 'services');
    for (const p of down) {
      if (hasServices && /utilit|crime|sick/.test(p.text)) { acts.push(['svc', /utilit/.test(p.text) ? '🔌 Fix utilities' : '🚓 Services']); break; }
      if (/^taxes/.test(p.text)) { acts.push(['budget', '💰 Taxes']); break; }
    }
    const html = `
      <div class="dp-head"><b>Demand</b><button class="dp-x" data-act="close" aria-label="Close">✕</button></div>
      <div class="dp-tabs" role="tablist">${DEMAND_KEYS.map((o) => `<button role="tab" class="dp-tab ${o === k ? 'on' : ''}" aria-selected="${o === k}" data-k="${o}" style="--c:var(--${o})">${DEM[o].letter}<b>${signed(Math.round(s.demand[o]))}</b></button>`).join('')}</div>
      <div class="dp-title" style="--c:var(--${k})"><span class="dp-name">${D.name}</span><span class="dp-val ${v < 0 ? 'neg' : 'pos'}">${signed(v)}</span>
        <span class="dp-trend ${trend > 3 ? 'up' : trend < -3 ? 'down' : ''}">${hist.length < 2 ? 'new' : trend > 3 ? `▲ ${signed(trend)} in ${days}d` : trend < -3 ? `▼ ${signed(trend)} in ${days}d` : 'steady'}</span></div>
      ${raw !== v ? `<div class="dp-cap">Maxed out at ${signed(v)} (would be ${signed(raw)})</div>` : ''}
      <p class="dp-status">${status}</p>
      ${this.townGlance(k)}
      <p class="dp-next">👉 <b>Next:</b> ${esc(this.nextStep())}</p>
      ${up.length ? `<div class="dp-h">Pushing up</div><ul>${up.map((p) => row(p, 'up')).join('')}</ul>` : ''}
      ${down.length ? `<div class="dp-h">Holding back</div><ul>${down.map((p) => row(p, 'down')).join('')}</ul>` : ''}
      ${other.length ? `<div class="dp-h">Also</div><ul>${other.map((p) => row(p, 'na')).join('')}</ul>` : ''}
      ${base ? `<div class="dp-base">Starts from ${esc(base.text)} ${signed(Math.round(base.v ?? 0))}</div>` : ''}
      ${acts.length ? `<div class="dp-acts">${acts.map(([id, label], i) => `<button class="${i ? 'chip' : 'dp-go'}" data-act="${id}">${label}</button>`).join('')}</div>` : ''}`;
    if (html === this.demandHtml) return;
    // keep keyboard focus on the same control across live refreshes
    const f = document.activeElement as HTMLElement | null;
    const keep = f && this.demandPop.contains(f) ? (f.dataset.k ? `[data-k="${f.dataset.k}"]` : f.dataset.act ? `[data-act="${f.dataset.act}"]` : null) : null;
    this.demandHtml = html;
    this.demandPop.innerHTML = html;
    if (keep) (this.demandPop.querySelector(keep) as HTMLElement | null)?.focus();
  }

  private demandAction(id: string) {
    const g = this.game;
    crumb(`demand action ${id}`);
    this.closeDemand();
    if (id === 'close') return;
    if (id.startsWith('zone:')) {
      g.tools.zoneType = id.slice(5) as ZoneType;
      this.openPanel('zones');
      g.tools.set('zone');
      this.renderPanel();
      this.toast(IS_TOUCH ? `Paint ${ZONE_LABEL[g.tools.zoneType]} along a road.` : `Paint ${ZONE_LABEL[g.tools.zoneType]} along a road: drag beside it.`);
    } else if (id === 'svc') this.openPanel('ext:services');
    else if (id === 'budget') this.openPanel('budget');
  }

  private refreshTop() {
    const g = this.game, s = g.sim;
    const $ = (id: string) => this.top.querySelector('#' + id) as HTMLElement;
    $('tb-date').textContent = `${s.mode !== 'sandbox' && window.innerWidth > 900 ? `🏅 ${MILESTONES[s.tier].name} · ` : ''}${s.dateLabel()} · ${fmtHour(g.hour)}`;
    $('tb-pop').textContent = s.population.toLocaleString();
    $('tb-money').textContent = money(s.money);
    $('tb-money').classList.toggle('neg', s.money < 0);
    // running (taxes in, upkeep out: forever) apart from growth money (new
    // buildings' fees and grants: stops when growth stops). Playtest 5 had to
    // work out which was which from the budget panel.
    const net = s.weeklyNet(), wide = window.innerWidth > 1000;
    const netEl = $('tb-net'), growthEl = $('tb-growth');
    netEl.textContent = s.money === Infinity ? 'sandbox' : `${net >= 0 ? '+' : ''}${money(net)}/wk${wide ? ' running' : ''}`;
    netEl.className = net >= 0 ? 'pos' : 'neg';
    const growth = s.money === Infinity ? 0 : s.growthWeek();
    growthEl.hidden = !wide || growth < 1;
    if (!growthEl.hidden) growthEl.textContent = `+${money(growth)}/wk growth`;
    if (s.money !== Infinity) {
      const fc = s.forecastWeek(), one = Sim.split(s.ledger).oneTime;
      const tip = `Running, every week at today's rates: ${usd(fc.income)} taxes and fees in, ${usd(fc.expense)} upkeep, imports and loans out (${net >= 0 ? '+' : ''}${usd(net)}/wk).${growth >= 1 ? ` Growth money: +${usd(growth)}/wk lately from new buildings' impact fees and grants; it stops when growth stops.` : ''}${one ? ` One-time this week: ${one > 0 ? '+' : ''}${usd(one)} (construction, fees, grants).` : ''} Click for the budget.`;
      const tr = $('tb-treasury');
      if (tr.title !== tip) { tr.title = tip; tr.setAttribute('aria-label', `Treasury ${usd(s.money)}, ${usd(net)} per week. ${tip}`); }
    }
    this.syncCrisis();
    this.syncEmergency();
    for (const k of DEMAND_KEYS) {
      const v = s.demand[k], el = $('d-' + k);
      el.style.height = `${Math.max(2, Math.min(100, Math.abs(v)))}%`;
      const bar = el.closest('.dbar') as HTMLElement;
      bar.classList.toggle('neg', v < 0);
      const label = `${DEM[k].name} demand ${signed(Math.round(v))}. Show why.`;
      if (bar.getAttribute('aria-label') !== label) bar.setAttribute('aria-label', label);
    }
    // hovering the bars says what to do about them (refreshed every couple of seconds)
    if (this.game.time - this.nextStepT > 1) {
      this.nextStepT = this.game.time;
      const t = `Next: ${this.nextStep()} Click a bar for why.`;
      for (const b of this.top.querySelectorAll<HTMLElement>('.dbar')) if (b.title !== t) b.title = t;
      // hovering the population says who left lately and why
      const f = s.popFlow(14), pe = $('tb-popstat');
      const pt = `Population ${s.population.toLocaleString()} (most ever ${Math.max(s.peakPop, s.population).toLocaleString()}). Last 14 days: +${f.in.toLocaleString()} moved in, −${Math.round(f.out).toLocaleString()} left${f.causes.length ? ` (${f.causes.slice(0, 3).map((c) => `${LOSS_LABEL[c.cause]} ${Math.round(c.n).toLocaleString()}`).join(', ')})` : ''}. Click for the breakdown.`;
      if (pe.title !== pt) { pe.title = pt; pe.setAttribute('aria-label', pt); }
      this.renderNextBar();
    }
    if (this.demandKey) this.renderDemand();
    this.renderMeters();
    this.renderPop();
    $('m-nature').style.width = `${Math.round(s.naturePct * 100)}%`;
    $('m-nature-t').textContent = `${Math.round(s.naturePct * 100)}%`;
    $('m-sprawl').style.width = `${Math.round(s.sprawlPct * 100)}%`;
    // a first town is a sliver of the county: show tenths below 10% so progress is visible
    $('m-sprawl-t').textContent = s.sprawlPct < 0.1 && s.sprawlPct > 0 ? `${(s.sprawlPct * 100).toFixed(1)}%` : `${Math.round(s.sprawlPct * 100)}%`;
    const w = g.weather;
    const icon = { clear: '☀️', cloudy: '☁️', rain: '🌧️', storm: '⛈️', snow: '🌨️', blizzard: '❄️', fog: '🌫️', heatwave: '🥵', hurricane: '🌀', wildfireSmoke: '🔥' }[w.kind];
    $('tb-weather').innerHTML = `<span>${icon}</span><small>${w.season}</small>`;
    this.top.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((b) => b.classList.toggle('on', Number(b.dataset.speed) === s.speed));
  }

  // ------------------------------------------------------------------ toolbar
  private buildToolbar() {
    this.sub = this.mk('div', 'subpanel');
    this.sub.hidden = true;
    this.bar = this.mk('nav', 'toolbar');
    const items: [string, string, string][] = [
      ['inspect', '👆', 'Select'],
      ['roads', '🛣️', 'Roads'],
      ['zones', '🟩', 'Zoning'],
      ['upgrade', '➕', 'One More Lane'],
      ['bulldoze', '💣', 'Bulldoze'],
      ['landmarks', '💥', 'Landmarks'],
      ['views', '🗺️', 'Info Views'],
      ['budget', '💰', 'Budget'],
      ['communes', '☮️', 'Communes'],
      ['feed', '𝕏', 'Feed'],
      ['help', '⚙️', 'Settings'],
      ['bug', '🐞', 'Report bug'],
    ];
    // extension panels slot in by `order` (core buttons sit at 10, 20, 30, ...)
    const withOrder = items.map((it, i) => ({ it, o: (i + 1) * 10 }));
    for (const ep of EXT.panels) withOrder.push({ it: [`ext:${ep.id}`, ep.icon, ep.label], o: ep.order ?? 65 });
    withOrder.sort((a, b) => a.o - b.o);
    const all = withOrder.map((x) => x.it);
    const btn = ([id, icon, label]: [string, string, string]) => `<button class="tbtn" data-t="${id}" title="${label}"><span class="ti">${icon}</span><span class="tl">${label}</span>${id === 'feed' || id === 'more' ? '<i id="feed-badge" class="badge" hidden></i>' : ''}</button>`;
    if (COMPACT) {
      // phones: a short toolbar; the rest opens from More
      const short: Record<string, string> = { views: 'Views' };
      const primary = (PHONE_PRIMARY.map((id) => all.find((x) => x[0] === id)).filter(Boolean) as [string, string, string][]).map(([id, icon, label]) => [id, icon, short[id] ?? label] as [string, string, string]);
      // playtest: the bug button leads the More grid so testers find it
      this.moreItems = all.filter((x) => !PHONE_PRIMARY.includes(x[0])).sort((a, b) => Number(b[0] === 'bug') - Number(a[0] === 'bug'));
      this.bar.innerHTML = primary.map(btn).join('') + btn(['more', '<i class="more-dots"><b></b><b></b><b></b></i>', 'More']);
      this.bar.classList.add('compact');
    } else {
      // desktop: the building tools up front and a little larger, the rest
      // (land, transit, districts, terraforming, communes, the feed,
      // disasters) behind More: twenty small buttons were hard to scan
      const hint: Record<string, string> = { inspect: 'Esc', zones: 'Z', upgrade: 'U', bulldoze: 'B' };
      const primary = DESK_PRIMARY.map((id) => all.find((x) => x[0] === id)).filter(Boolean) as [string, string, string][];
      this.moreItems = all.filter((x) => !DESK_PRIMARY.includes(x[0]));
      this.bar.innerHTML = primary.map(btn).join('') + btn(['more', '<i class="more-dots"><b></b><b></b><b></b></i>', 'More']);
      this.bar.querySelectorAll<HTMLButtonElement>('button.tbtn').forEach((b) => {
        const id = b.dataset.t!;
        if (BUILD_TOOLS.includes(id)) b.classList.add('build');
        if (hint[id]) b.title = `${b.title} (${hint[id]})`;
      });
    }
    this.bar.querySelectorAll<HTMLButtonElement>('button.tbtn').forEach((b) => b.addEventListener('click', () => this.onTool(b.dataset.t!)));
    // narrow desktop windows: the bar scrolls sideways; let the mouse wheel do
    // it and fade the edge that has more tools past it
    const edges = () => {
      const bar = this.bar, more = bar.scrollWidth - bar.clientWidth;
      bar.classList.toggle('more-right', more > 2 && bar.scrollLeft < more - 2);
      bar.classList.toggle('more-left', more > 2 && bar.scrollLeft > 2);
    };
    this.bar.addEventListener('wheel', (e) => {
      if (this.bar.scrollWidth <= this.bar.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      this.bar.scrollLeft += e.deltaY;
    }, { passive: false });
    this.bar.addEventListener('scroll', edges, { passive: true });
    window.addEventListener('resize', edges);
    requestAnimationFrame(edges);
  }
  private moreItems: [string, string, string][] = [];

  /** Phones: an open panel shrinks to its title pill while you work on the map. */
  private wirePanelMinimize() {
    this.game.renderer.domElement.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' || this.sub.hidden || this.panel === 'more') return;
      if (this.sub.querySelector(':scope > .sp-title')) this.sub.classList.add('min');
    });
    this.sub.addEventListener('click', (e) => {
      if (!this.sub.classList.contains('min')) return;
      e.stopPropagation();
      e.preventDefault();
      this.sub.classList.remove('min');
    }, true);
  }

  private onTool(id: string) {
    const g = this.game;
    g.audio.unlock();
    g.audio.play('click', 0.4);
    if (id === 'feed') { this.feed.setCollapsed(!this.feed.collapsed); return; }
    if (id === 'bug') { if (this.panel === 'more') this.openPanel(null); this.reportBug(); return; }
    crumb(`${this.panel === id ? 'closed' : 'opened'} ${id}`);
    if (id === 'inspect' || id === 'upgrade' || id === 'bulldoze') {
      this.openPanel(null);
      g.tools.set(g.tools.active === id && id !== 'inspect' ? 'inspect' : (id as ToolId));
      if (id === 'upgrade') this.toast(IS_TOUCH ? 'ONE MORE LANE: tap a road to widen that block.' : 'ONE MORE LANE: click a road to widen it. Shift-click widens the whole street.');
      return;
    }
    const pid = id as PanelId;
    const closing = this.panel === pid;
    this.openPanel(closing ? null : pid);
    // closing a panel (tapping its button again) must also put its tool away,
    // or taps on the map keep drawing roads / painting zones with no menu open
    if (closing) { g.tools.set('inspect'); return; }
    if (pid === 'roads') g.tools.set('road');
    else if (pid === 'zones') g.tools.set('zone');
    else if (pid !== 'landmarks' || g.tools.active !== 'landmark') g.tools.set('inspect');
  }

  /** refresh the top bar and the open panel now (tests; normally 4× a second) */
  refreshNow() {
    this.refreshTop();
    this.refreshPanelLive();
  }

  /** Open the playtest bug report sheet. */
  reportBug(prefill?: string) {
    openBugReport(this.root, this.game, { prefill });
  }

  /** Put the current map tool away: back to Select with no panel open. */
  private exitTool() {
    crumb('tapped Done');
    this.game.tools.finishExt();
    this.openPanel(null);
    this.game.tools.set('inspect');
    this.game.audio.play('click', 0.4);
  }

  private openPanel(p: PanelId) {
    if (p === 'budget') this.budgetSeen = true;
    if (this.panel && this.panel !== p && this.panel.startsWith('ext:')) {
      const old = EXT.panels.find((x) => `ext:${x.id}` === this.panel);
      old?.close?.(this.game);
      if (this.game.tools.active === 'ext') this.game.tools.set('inspect');
    }
    this.panel = p;
    this.sub.hidden = !p;
    this.sub.classList.remove('min');
    if (!p) { if (this.game.tools.active === 'road' || this.game.tools.active === 'zone' || this.game.tools.active === 'dezone') this.game.tools.set('inspect'); this.syncToolbar(); this.placeNextBar(); return; }
    this.renderPanel();
    this.syncToolbar();
    this.placeNextBar();
  }

  private renderPanel() {
    const g = this.game, t = g.tools;
    const p = this.panel;
    if (p && p.startsWith('ext:')) {
      const ep = EXT.panels.find((x) => `ext:${x.id}` === p);
      this.sub.innerHTML = '';
      ep?.render(this.sub, g, () => this.renderPanel());
      return;
    }
    if (p === 'more') {
      this.sub.innerHTML = `
        <div class="sp-title">More</div>
        <div class="more-grid">${this.moreItems.map(([id, icon, label]) => `<button class="more-btn" data-more="${id}"><span>${icon}</span>${esc(label)}</button>`).join('')}
          <a class="more-btn merch" href="${MERCH_URL}" target="_blank" rel="noopener"><span class="slop-mini">Slop</span>Merch</a></div>`;
      this.sub.querySelectorAll<HTMLButtonElement>('[data-more]').forEach((b) => b.addEventListener('click', () => {
        const id = b.dataset.more!;
        if (id === 'feed') this.openPanel(null);
        this.onTool(id);
      }));
      return;
    }
    if (p === 'roads') {
      this.sub.innerHTML = `
        <div class="sp-title">Roads <small>${IS_TOUCH ? 'Drag to plan a road, then tap Build. Drag from its end to keep going. Two fingers move the map. Double-tap or Stop to finish.' : 'Click start, click end, keep going. Right-click, double-click or Esc stops.'}</small></div>
        <div class="sp-row modes">${(['straight', 'curve', 'freeform', 'grid'] as const).map((m) => `<button class="chip ${t.roadMode === m ? 'on' : ''}" data-mode="${m}" ${m === 'grid' ? 'title="Lay out a whole street grid: corner, first side, width"' : ''}>${m === 'straight' ? '📏 Straight' : m === 'curve' ? '↪️ Curved' : m === 'freeform' ? '〰️ Freeform' : '▦ Grid'}</button>`).join('')}</div>
        ${t.roadMode === 'grid' ? `<div class="sp-row modes grid-blocks"><small>${IS_TOUCH ? 'Touch a corner, drag the first side, drag out the width, then Build.' : 'Click a corner, the first side, then the width.'} Blocks:</small>${(Object.keys(GRID_BLOCKS) as GridBlock[]).map((b) => `<button class="chip ${t.gridBlock === b ? 'on' : ''}" data-block="${b}" title="${GRID_BLOCKS[b].cells * 2} lot rows between streets">${GRID_BLOCKS[b].label}</button>`).join('')}</div>` : ''}
        <div class="sp-grid roads-grid">${ROAD_ORDER.map((id) => {
          const r = ROAD_TYPES[id];
          const locked = !g.sim.isUnlocked({ road: id });
          return `<button class="card ${t.roadType === id && t.active === 'road' ? 'on' : ''} ${this.fresh.has(`road:${id}`) ? 'new' : ''}" data-road="${id}" ${locked ? 'disabled' : ''} title="${esc(r.blurb)}">
            <span class="ci">${r.icon}</span><b>${esc(r.name)}</b><small>${locked ? lockText(r.unlockPop) : `$${r.costPerM}/m · ${r.oneWay ? `${r.lanesPerDir} lane${r.lanesPerDir > 1 ? 's' : ''}, one way` : `${r.lanesPerDir * 2} lanes${r.centerTurn ? ' + turn' : ''}`}`}</small></button>`;
        }).join('')}<span class="sp-sep" aria-hidden="true"></span>${LAYOUT_ORDER.map((id) => {
          const l = LAYOUTS[id];
          const locked = g.sim.mode !== 'sandbox' && g.sim.peakPop < l.unlockPop;
          return `<button class="card layout ${currentLayout(g) === id ? 'on' : ''}" data-layout="${id}" ${locked ? 'disabled' : ''} title="${esc(l.blurb)}"><span class="ci">${l.icon}</span><b>${esc(l.name)}</b><small>${locked ? lockText(l.unlockPop) : id === 'diamond' ? 'Interchange · overpass' : 'Roundabout'}</small></button>`;
        }).join('')}${currentLayout(g) ? `<button class="chip" id="layout-rotate" title="Rotate (, and .)">↻ Rotate</button>` : ''}</div>`;
      this.sub.querySelectorAll<HTMLButtonElement>('[data-layout]').forEach((b) => b.addEventListener('click', () => { selectLayout(g, b.dataset.layout as LayoutId); this.renderPanel(); }));
      this.sub.querySelector('#layout-rotate')?.addEventListener('click', () => rotateLayout(g));
      this.sub.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => b.addEventListener('click', () => { t.roadMode = b.dataset.mode as never; t.cancel(); t.set('road'); this.renderPanel(); }));
      this.sub.querySelectorAll<HTMLButtonElement>('[data-block]').forEach((b) => b.addEventListener('click', () => { t.gridBlock = b.dataset.block as GridBlock; if (t.active !== 'road') t.set('road'); this.renderPanel(); }));
      this.sub.querySelectorAll<HTMLButtonElement>('[data-road]').forEach((b) => b.addEventListener('click', () => { t.roadType = b.dataset.road as RoadTypeId; this.fresh.delete(`road:${t.roadType}`); t.set('road'); this.renderPanel(); }));
    } else if (p === 'zones') {
      this.sub.innerHTML = `
        <div class="sp-title">Zoning <small>Paint cells along roads. Buildings grow when there's demand.</small></div>
        <div class="sp-row">Brush ${['S', 'M', 'L'].map((s, i) => `<button class="chip ${t.brush === i ? 'on' : ''}" data-brush="${i}">${s}</button>`).join('')}</div>
        <div class="sp-grid zones">${ZONE_TYPES.map((z) => {
          const locked = !g.sim.isUnlocked({ zone: z });
          const need = UNLOCKS.find((u) => u.zone === z)?.pop;
          return `<button class="card zone ${t.active === 'zone' && t.zoneType === z ? 'on' : ''} ${this.fresh.has(`zone:${z}`) ? 'new' : ''}" data-zone="${z}" style="--zc:#${ZONE_COLORS[z].toString(16).padStart(6, '0')}" ${locked ? 'disabled' : ''}>
            <span class="ci">${ZONE_ICON[z]}</span><b>${esc(ZONE_LABEL[z])}</b><small>${locked ? lockText(need ?? 0) : `Levels 1–${MAX_LEVEL[z]}`}</small></button>`;
        }).join('')}
          <button class="card zone ${t.active === 'dezone' ? 'on' : ''}" data-zone="none" style="--zc:#888"><span class="ci">🧽</span><b>Dezone</b><small>Unzone empty cells</small></button>
        </div>`;
      this.sub.querySelectorAll<HTMLButtonElement>('[data-zone]').forEach((b) => b.addEventListener('click', () => {
        const z = b.dataset.zone!;
        if (z === 'none') t.set('dezone');
        else { t.zoneType = z as ZoneType; this.fresh.delete(`zone:${z}`); t.set('zone'); }
        this.renderPanel();
      }));
      this.sub.querySelectorAll<HTMLButtonElement>('[data-brush]').forEach((b) => b.addEventListener('click', () => { t.brush = Number(b.dataset.brush); this.renderPanel(); }));
    } else if (p === 'landmarks') {
      this.sub.innerHTML = `
        <div class="sp-title">Landmarks <small>Monuments to Slopmerica. Place one, then build around it.</small></div>
        <div class="sp-grid">${LANDMARKS.map((l) => {
          const need = unlockPop.landmark(l.id), locked = g.sim.mode !== 'sandbox' && g.sim.peakPop < need;
          return `<button class="card ${t.active === 'landmark' && t.landmark === l.id ? 'on' : ''}" data-lm="${l.id}" ${locked ? 'disabled' : ''}><span class="ci">${l.icon}</span><b>${esc(l.name)}</b><small>${locked ? lockText(need) : money(LANDMARK_COST[l.id])}</small></button>`;
        }).join('')}</div>`;
      this.sub.querySelectorAll<HTMLButtonElement>('[data-lm]').forEach((b) => b.addEventListener('click', () => { t.landmark = b.dataset.lm as LandmarkId; t.set('landmark'); this.renderPanel(); }));
    } else if (p === 'views') {
      const mode = g.overlays.mode;
      const views: [ViewMode, string, string][] = [['none', '🌎', 'Normal'], ['traffic', '🚦', 'Traffic'], ['landValue', '💲', 'Land Value']];
      const ev = g.overlays.ext;
      this.sub.innerHTML = `
        <div class="sp-title">Info Views</div>
        <div class="sp-row">${views.map(([v, i, l]) => `<button class="chip ${mode === v && !ev ? 'on' : ''}" data-view="${v}">${i} ${l}</button>`).join('')}${EXT.views.map((v) => `<button class="chip ${ev === v ? 'on' : ''}" data-extview="${v.id}">${v.icon} ${esc(v.label)}</button>`).join('')}</div>
        ${ev?.legend ? `<div class="sp-legend">${ev.legend(g)}</div>` : ''}
        <div class="sp-row">${['clear', 'rain', 'storm', 'snow', 'fog', 'heatwave'].map((w) => `<button class="chip" data-wx="${w}">${w}</button>`).join('')}</div>`;
      this.sub.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) => b.addEventListener('click', () => { g.overlays.set(b.dataset.view as ViewMode); this.renderPanel(); }));
      this.sub.querySelectorAll<HTMLButtonElement>('[data-extview]').forEach((b) => b.addEventListener('click', () => {
        const v = EXT.views.find((x) => x.id === b.dataset.extview);
        g.overlays.setExt(g.overlays.ext === v ? null : v ?? null);
        this.renderPanel();
      }));
      this.sub.querySelectorAll<HTMLButtonElement>('[data-wx]').forEach((b) => b.addEventListener('click', () => g.weather.force(b.dataset.wx as never, 4)));
    } else if (p === 'budget') {
      const s = g.sim;
      this.sub.innerHTML = `
        <div class="sp-title">Budget <small>The Growth Ponzi: new roads are cheap now, expensive forever.</small></div>
        <div class="budget">
          <div class="budget-live">${this.budgetLive()}</div>
          <div class="tax">
            <div class="bg-rules">${this.budgetRules()}</div>
            <label for="tax">Tax rate <b id="tax-v">${Math.round(s.taxRate * 100)}%</b></label>
            <input id="tax" type="range" min="1" max="29" value="${Math.round(s.taxRate * 100)}" />
            <small>Taxation is theft (demand drops) / eat the rich (money rises)</small>
            <div class="sp-row">${[10000, 50000, 150000].map((a) => `<button class="chip" data-loan="${a}" title="${usd(a)} now, then ${usd(Math.round((a * 1.18) / 52))}/wk for 52 weeks">Loan ${money(a)} <small>−${usd(Math.round((a * 1.18) / 52))}/wk</small></button>`).join('')}</div>
            <small>${s.loans.length ? `${s.loans.length} loan(s): ${money(s.loans.reduce((a, l) => a + l.weekly, 0))}/wk, ${Math.max(...s.loans.map((l) => l.weeksLeft))} weeks left` : 'No loans. Yet.'}</small>
          </div>
        </div>`;
      const tax = this.sub.querySelector('#tax') as HTMLInputElement;
      tax.addEventListener('input', () => {
        const old = s.taxRate;
        s.taxRate = Number(tax.value) / 100;
        (this.sub.querySelector('#tax-v') as HTMLElement).textContent = `${tax.value}%`;
        if (Math.abs(s.taxRate - old) > 0.001) this.taxFeed(s.taxRate > old);
        this.refreshPanelLive();
      });
      this.sub.querySelectorAll<HTMLButtonElement>('[data-loan]').forEach((b) => b.addEventListener('click', () => { s.takeLoan(Number(b.dataset.loan)); g.audio.play('cash'); this.renderPanel(); }));
    } else if (p === 'communes') {
      const list = g.communes.list.filter((c) => c.state !== 'gone');
      this.sub.innerHTML = `
        <div class="sp-title">Hippie Communes <small>${list.length} remaining. Click one to fly there.</small></div>
        <div class="sp-list">${list.map((c) => `<button class="li" data-cm="${c.id}"><b>${esc(c.name)}</b><small>${c.members} members · ${c.forever ? '♾️ FOREVER' : c.state === 'suing' ? '⚖️ in court' : esc(c.vibe)}</small></button>`).join('') || '<p>All communes gone. The drum circle is silent.</p>'}</div>`;
      this.sub.querySelectorAll<HTMLButtonElement>('[data-cm]').forEach((b) => b.addEventListener('click', () => {
        const c = g.communes.list.find((x) => x.id === Number(b.dataset.cm));
        if (c) { g.rts.setView(c.x, c.z, 260); g.select({ kind: 'commune', c }); }
      }));
    } else if (p === 'help') {
      this.sub.innerHTML = `
        <div class="sp-title">Settings &amp; Controls</div>
        <div class="sp-row quality-controls"><span class="ql" id="quality-label">Graphics</span>
          <span class="seg" role="radiogroup" aria-labelledby="quality-label">${(Object.keys(QUALITY) as Quality['name'][]).map((n) => { const on = n === (g.pendingQuality ?? g.q.name); return `<button class="chip ${on ? 'on' : ''}" role="radio" aria-checked="${on}" data-quality="${n}">${n[0].toUpperCase() + n.slice(1)}</button>`; }).join('')}</span>
          <button class="chip" id="perf-toggle">${this.perfVisible ? 'Hide' : 'Show'} performance</button>
          ${IS_TOUCH ? '' : `<button class="chip ${g.rts.edgeScroll ? 'on' : ''}" id="edge-toggle" aria-pressed="${g.rts.edgeScroll}">Edge scrolling: ${g.rts.edgeScroll ? 'on' : 'off'}</button>`}
          ${g.pendingQuality ? '<button class="chip on" id="quality-reload">Reload to finish applying</button>' : ''}
          ${IS_TOUCH ? '' : `<button class="chip ${g.resolutionMode === 'full' ? 'on' : ''}" id="res-toggle" title="Auto lowers the resolution when frames are slow; Always full keeps it sharp">Resolution: ${g.resolutionMode === 'full' ? 'always full' : 'auto'}</button>`}
          <button class="chip ${emergencySpeed() !== 'off' ? 'on' : ''}" id="emergency-toggle" title="When a city-wide service emergency begins: slow the clock to normal speed, pause it, or keep going">🚨 Emergencies: ${EMERGENCY_SPEED_LABEL[emergencySpeed()]}</button>
          <button class="chip ${g.audio.musicOn ? 'on' : ''}" id="music-toggle" aria-pressed="${g.audio.musicOn}">🎹 Music: ${g.audio.musicOn ? 'on' : 'off'}</button>
          <label class="fov-ctl" for="music-range">Music volume <input type="range" id="music-range" min="5" max="100" step="5" value="${Math.round(g.audio.musicVolume * 100)}"></label>
          <button class="chip ${g.audio.soundOn ? 'on' : ''}" id="sound-toggle" aria-pressed="${g.audio.soundOn}" title="Effects, ambience and the sound of the cars in the street">🔊 Sound: ${g.audio.soundOn ? 'on' : 'off'}</button>
          <label class="fov-ctl" for="sound-range">Sound volume <input type="range" id="sound-range" min="5" max="100" step="5" value="${Math.round(g.audio.soundVolume * 100)}"></label>
          <label class="fov-ctl" for="fov-range">Field of view <input type="range" id="fov-range" min="${FOV_MIN}" max="${FOV_MAX}" step="1" value="${Math.round(g.camera.fov)}"><b id="fov-v">${this.fovText()}</b></label>
        </div>
        <small>Resolution and shadows change immediately. Reload applies scenery, traffic, and post-processing budgets.</small>
        <div class="help">${IS_TOUCH ? `
          <div><b>Move</b> drag with one finger (two fingers while a tool is on)</div>
          <div><b>Zoom</b> pinch</div>
          <div><b>Rotate</b> twist two fingers</div>
          <div><b>Tilt</b> drag two fingers up or down</div>
          <div><b>Roads</b> drag to plan, tap Build. Double-tap ends a road. Done puts the tool away.</div>
          <div><b>Placing</b> services and landmarks: tap to preview, then Build</div>
          <div><b>Demand</b> tap the R C I O bars to see why they're up or down and what to zone</div>` : `
          <div><b>Demand</b> click the R C I O bars to see why they're up or down and what to zone</div>
          <div><b>Move</b> WASD / arrows · drag · push the mouse against a screen edge</div>
          <div><b>Back to town</b> H, or click the town's name</div>
          <div><b>Rotate</b> right-drag · Q/E</div>
          <div><b>Tilt</b> right-drag up/down · R/F</div>
          <div><b>Zoom</b> wheel</div>
          <div><b>Roads</b> click start, click end. Keeps chaining. Esc / right-click stops.</div>
          <div><b>Speed</b> Space pause · 1 2 3</div>
          <div><b>Tools</b> B bulldoze · U one more lane · Z zoning · Esc cancel</div>
          <div><b>Interchanges</b> Roads → Interchanges · , and . rotate</div>
          <div><b>Performance</b> F3 shows FPS, frame time, draw calls and triangles</div>`}
        </div>
        <div class="sp-row"><button class="chip" id="save-now">💾 Save now</button><button class="chip" id="save-file">📁 Save city file</button><button class="chip" id="new-city">🆕 New city</button><small>Autosaves every 30 seconds in this browser. A city file is a backup you keep: where downloads are blocked it is copied to the clipboard instead.</small></div>
        <div class="sp-row"><button class="chip on" id="report-bug">🐞 Report a bug</button><small>Playtest build ${BUILD}</small></div>`;
      this.sub.querySelector('#save-now')?.addEventListener('click', () => { const ok = saveGame(g); this.toast(ok ? 'Saved.' : 'Could not save in this browser', !ok); });
      this.sub.querySelector('#save-file')?.addEventListener('click', async () => {
        const f = cityFile(g);
        const r = await saveFile(f.name, f.data);
        crumb(`city file: ${r}`);
        this.toast(saveMessage(r, 'City file', 'to load it later: title screen, Load a city file, Paste a copied city'), r === 'failed');
      });
      this.sub.querySelector('#new-city')?.addEventListener('click', () => { saveGame(g); location.hash = ''; location.reload(); });
      this.sub.querySelector('#report-bug')?.addEventListener('click', () => this.reportBug());
      // buttons, not a native <select>: the playtest recording caught the
      // dropdown's list painting blank on a second opening
      this.sub.querySelectorAll<HTMLButtonElement>('[data-quality]').forEach((b) => b.addEventListener('click', () => {
        const reload = g.requestQuality(b.dataset.quality as Quality['name']);
        this.renderPanel();
        this.toast(reload ? 'Graphics preset saved. Reload to apply all details.' : 'Graphics preset applied.');
      }));
      this.sub.querySelector('#quality-reload')?.addEventListener('click', () => location.reload());
      this.sub.querySelector('#perf-toggle')?.addEventListener('click', () => { this.togglePerf(); this.renderPanel(); });
      this.sub.querySelector('#emergency-toggle')?.addEventListener('click', () => {
        const next: EmergencySpeed = ({ slow: 'pause', pause: 'off', off: 'slow' } as const)[emergencySpeed()];
        try { localStorage.setItem('slopmerica.emergencySpeed', next); } catch { /* not remembered */ }
        crumb(`emergencies: ${next}`);
        this.renderPanel();
      });
      this.sub.querySelector('#music-toggle')?.addEventListener('click', () => {
        g.audio.unlock();
        g.audio.musicOn = !g.audio.musicOn;
        try { localStorage.setItem('slopmerica.music', g.audio.musicOn ? '1' : '0'); } catch { /* not remembered */ }
        crumb(`music ${g.audio.musicOn ? 'on' : 'off'}`);
        this.renderPanel();
      });
      this.sub.querySelector('#sound-toggle')?.addEventListener('click', () => {
        g.audio.unlock();
        g.audio.soundOn = !g.audio.soundOn;
        try { localStorage.setItem('slopmerica.sound', g.audio.soundOn ? '1' : '0'); } catch { /* not remembered */ }
        crumb(`sound ${g.audio.soundOn ? 'on' : 'off'}`);
        this.renderPanel();
      });
      this.sub.querySelector('#sound-range')?.addEventListener('input', (e) => {
        g.audio.unlock();
        g.audio.soundVolume = Number((e.target as HTMLInputElement).value) / 100;
        try { localStorage.setItem('slopmerica.soundVol', String(g.audio.soundVolume)); } catch { /* not remembered */ }
      });
      this.sub.querySelector('#music-range')?.addEventListener('input', (e) => {
        g.audio.musicVolume = Number((e.target as HTMLInputElement).value) / 100;
        try { localStorage.setItem('slopmerica.musicVol', String(g.audio.musicVolume)); } catch { /* not remembered */ }
      });
      this.sub.querySelector('#res-toggle')?.addEventListener('click', () => {
        g.setResolutionMode(g.resolutionMode === 'full' ? 'auto' : 'full');
        crumb(`resolution ${g.resolutionMode}`);
        this.renderPanel();
      });
      this.sub.querySelector('#fov-range')?.addEventListener('input', (e) => {
        const v = Number((e.target as HTMLInputElement).value);
        g.camera.fov = v;
        g.camera.updateProjectionMatrix();
        this.sub.querySelector('#fov-v')!.textContent = this.fovText();
        try { localStorage.setItem('slopmerica.fov', String(v)); } catch { /* not remembered */ }
      });
      this.sub.querySelector('#edge-toggle')?.addEventListener('click', () => {
        g.rts.edgeScroll = !g.rts.edgeScroll;
        try { localStorage.setItem('slopmerica.edgeScroll', g.rts.edgeScroll ? '1' : '0'); } catch { /* not remembered */ }
        crumb(`edge scrolling ${g.rts.edgeScroll ? 'on' : 'off'}`);
        this.renderPanel();
      });
    }
  }

  /** The slider is the camera's vertical angle; say so, and how wide that is across this window ("110° tall · 137° across"). */
  private fovText(): string {
    const c = this.game.camera, across = 2 * Math.atan(Math.tan((c.fov * Math.PI) / 360) * c.aspect) * (180 / Math.PI);
    return `${Math.round(c.fov)}° tall · ${Math.round(across)}° across`;
  }

  private taxFeed(raised: boolean) {
    clearTimeout((this as any)._taxT);
    (this as any)._taxT = setTimeout(() => this.game.feed.push(raised ? 'taxRaised' : 'taxCut'), 900);
  }

  private syncToolbar() {
    const act = this.game.tools.active;
    this.bar.querySelectorAll<HTMLButtonElement>('button.tbtn').forEach((b) => {
      const id = b.dataset.t!;
      const inMore = id === 'more' && (this.panel === 'more' || (!!this.panel && this.moreItems.some((x) => x[0] === this.panel)) || (act === 'upgrade' && this.moreItems.some((x) => x[0] === 'upgrade')));
      const on = inMore || id === this.panel || (id === 'upgrade' && act === 'upgrade') || (id === 'bulldoze' && act === 'bulldoze') || (id === 'inspect' && act === 'inspect' && !this.panel);
      b.classList.toggle('on', on);
    });
  }

  /** an ending card (bankrupt, sprawl) is up: the game waits for its button */
  private endingUp() { return !!this.root.querySelector('.ending'); }

  private hotkey(e: KeyboardEvent) {
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;
    const s = this.game.sim;
    if (e.key === 'F3') { e.preventDefault(); this.togglePerf(); }
    else if (e.key === ' ') { e.preventDefault(); if (!this.endingUp()) s.speed = s.speed === 0 ? 1 : 0; }
    else if (e.key === '1' || e.key === '2' || e.key === '3') { if (!this.endingUp()) s.speed = Number(e.key); }
    // Ctrl/Cmd+Z before plain Z (Zoning), or undo never happens
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); this.game.undo(); }
    else if (e.ctrlKey || e.metaKey || e.altKey) return;
    else if (e.key.toLowerCase() === 'b') this.onTool('bulldoze');
    else if (e.key.toLowerCase() === 'u') this.onTool('upgrade');
    else if (e.key.toLowerCase() === 'z') this.onTool('zones');
    else if (e.key.toLowerCase() === 'h') this.game.goHome();
    else if (e.key === 'Escape' && this.demandKey) {
      const k = this.demandKey;
      this.closeDemand();
      (this.top.querySelector(`[data-dem="${k}"]`) as HTMLElement | null)?.focus();
    } else if (e.key === 'Escape' && this.meterPop && !this.meterPop.hidden) {
      this.closeMeters();
      (this.top.querySelector('#tb-meters') as HTMLElement | null)?.focus();
    } else if (e.key === 'Escape' && this.popPop && !this.popPop.hidden) {
      this.closePop();
      (this.top.querySelector('#tb-popstat') as HTMLElement | null)?.focus();
    } else if (e.key === 'Escape') { this.openPanel(null); this.game.tools.set('inspect'); this.select(null); }
    this.refreshTop();
  }

  private togglePerf() {
    this.perfVisible = !this.perfVisible;
    this.perfEl.hidden = !this.perfVisible;
  }

  // ------------------------------------------------------------------ inspector
  select(sel: Selection) {
    if (!sel) { this.inspector.hidden = true; this.layoutCards(); return; }
    if (this.inspector.hidden) this.inspectorOpenedAt = performance.now();
    this.inspector.hidden = false;
    queueMicrotask(() => this.layoutCards());
    this.renderInspector();
    if (COMPACT) requestAnimationFrame(() => this.keepSelectionVisible());
  }

  /** Phones: the inspector is a bottom sheet, so slide the map until the
   * thing you tapped sits above it instead of hiding underneath. */
  private keepSelectionVisible() {
    const sel = this.game.selection;
    if (!sel || this.inspector.hidden) return;
    // roads are left alone: a segment can be hundreds of meters long, and
    // centering its middle would throw the view away from where you tapped
    const at = sel.kind === 'building' ? sel.b : sel.kind === 'commune' || sel.kind === 'car' ? sel.c : sel.kind === 'lot' ? sel.cell : null;
    if (!at) return;
    const top = this.inspector.getBoundingClientRect().top;
    this.v.set(at.x, this.game.terrain.h(at.x, at.z), at.z).project(this.game.camera);
    const sy = (-this.v.y * 0.5 + 0.5) * window.innerHeight;
    if (sy > 100 && sy < top - 30) return;
    const want = this.game.rts.groundAt(window.innerWidth / 2, Math.max(120, top * 0.55));
    if (want) this.game.rts.nudge(at.x - want.x, at.z - want.z);
  }

  private renderInspector() {
    const sel = this.game.selection;
    if (!sel) { this.inspector.hidden = true; return; }
    const g = this.game;
    let html = '';
    if (sel.kind === 'building' && !isZoned(sel.b)) {
      const b = sel.b;
      const svc = b.zone === 'service';
      // it does nothing until a road links it to the network: say so, and offer the road tool
      const off = g.linkProblem?.(b) ?? null;
      html = `<div class="in-kicker" style="--zc:${svc ? 'var(--off)' : '#ff3ea5'}">${svc ? 'CITY SERVICE' : 'LANDMARK'}</div>
        <h3>${esc(b.label)}</h3>
        <div class="in-stats">
          <div><span>Status</span><b class="${off ? 'in-warn' : ''}">${b.state === 'building' ? `🚧 ${Math.round(b.progress * 100)}%` : off ? '🚧 Not connected' : 'Open'}</b></div>
          <div><span>Road</span><b class="${off ? 'in-warn' : ''}">${off === 'noRoad' ? 'None' : off === 'noLink' ? 'No route to the highway' : 'Connected'}</b></div>
          ${!svc && !off && b.state === 'active' ? `<div><span>Visitors today</span><b>${g.traffic.visitorsToday(b).toLocaleString()}</b></div>` : ''}
        </div>
        ${off ? `<p class="in-note in-warn" id="in-link">🚧 ${esc(g.roadLinkText?.(b) ?? '')}</p>` : ''}
        ${!svc && !off ? `<p class="in-note">${landmarkEffects(b.landmark)}</p>` : ''}
        <div class="in-actions">${off ? '<button id="in-road">🛣️ Draw a road</button>' : ''}<button class="danger" id="in-bulldoze">💣 Bulldoze</button></div>`;
    } else if (sel.kind === 'building' && isZoned(sel.b)) {
      const b = sel.b;
      const brand = brandById(b.brand);
      const isRes = b.zone === 'resLow' || b.zone === 'resHigh';
      const max = MAX_LEVEL[b.zone];
      const bind = g.sim.bindingConstraint(b);
      html = `<div class="in-kicker" style="--zc:#${ZONE_COLORS[b.zone].toString(16).padStart(6, '0')}">${esc(ZONE_LABEL[b.zone])}${b.abandoned !== undefined ? ' · ABANDONED' : ''}</div>
        <h3>${esc(b.label)}</h3>
        ${brand?.blurb ? `<p class="in-blurb">${esc(brand.blurb)}</p>` : ''}
        <div class="in-stats">
          <div><span>Level</span><b>${'★'.repeat(b.level)}${'☆'.repeat(Math.max(0, max - b.level))}</b></div>
          <div><span>${isRes ? 'Residents' : 'Workers'}</span><b>${b.occ}/${b.cap}</b></div>
          <div><span>Land value</span><b>${Math.round(b.lv)}</b></div>
          <div><span>Status</span><b>${b.state === 'building' ? `🚧 ${Math.round(b.progress * 100)}%` : b.abandoned !== undefined ? '🏚️ Abandoned' : 'Open'}</b></div>
        </div>
        ${bind ? `<div class="in-bind"><span>Holding it back</span><b>${esc(bind)}</b></div>` : ''}
        ${b.level < max && b.state === 'active' ? `<div class="in-prog"><span style="width:${Math.round(b.levelProgress * 100)}%"></span></div><small>Leveling up with land value. Denser neighbors = more value.</small>` : ''}
        ${brand?.merch ? `<a class="in-merch" href="${MERCH_URL}" target="_blank" rel="noopener">Shop the real ${esc(brand.name)} at imaginesupply.co →</a>` : ''}
        <div class="in-actions"><button class="danger" id="in-bulldoze">💣 Bulldoze</button></div>`;
    } else if (sel.kind === 'car') {
      const c = sel.c;
      const a = ARCHETYPES[c.driver % ARCHETYPES.length];
      html = `<div class="in-kicker">${esc(VEHICLE_SPECS[c.kind].label)}</div>
        <h3>${esc(a?.name ?? 'Driver')}</h3>
        <p class="in-blurb">${esc(a?.bio ?? '')}</p>
        <div class="in-stats">
          <div><span>Doing</span><b>${esc(c.purpose)}</b></div>
          <div><span>Headed to</span><b>${esc(c.dest)}</b></div>
          <div><span>Speed</span><b>${Math.round(c.v * 3.6)} km/h</b></div>
          <div><span>Vibe</span><b>${c.crashed > 0 ? '💥 WRECKED' : c.drunk ? `🍺 BAC ${c.bac.toFixed(2)}` : c.reckless ? '😤 reckless' : '😐 fine'}${c.smoker ? ' 🚬' : ''}</b></div>
        </div>`;
    } else if (sel.kind === 'ped') {
      const p = sel.p;
      const a = ARCHETYPES[p.arch];
      html = `<div class="in-kicker">${a?.hippie ? 'COMMUNE MEMBER' : 'CITIZEN'}</div>
        <h3>${esc(a?.name ?? 'Citizen')}</h3>
        <p class="in-blurb">${esc(a?.bio ?? '')}</p>
        <div class="in-stats"><div><span>@</span><b>${esc(a?.handle ?? 'anon')}</b></div><div><span>Doing</span><b>${esc(p.action)}</b></div><div><span>Near</span><b>${esc(p.label)}</b></div><div><span>Leans</span><b>${esc(a?.lean ?? '?')}</b></div></div>`;
    } else if (sel.kind === 'commune') {
      const c = sel.c;
      html = `<div class="in-kicker hippie">HIPPIE COMMUNE · EST. ${c.founded}</div>
        <h3>${esc(c.name)}</h3>
        <div class="in-stats">
          <div><span>Members</span><b>${c.members}</b></div>
          <div><span>Vibe</span><b>${esc(c.vibe)}</b></div>
          <div><span>Stubbornness</span><b>${Math.round(c.stubborn * 100)}%</b></div>
          <div><span>Status</span><b>${c.forever ? '♾️ Forever' : c.state === 'suing' ? courtText(Math.ceil(c.suitDays - g.sim.day)) : c.state}</b></div>
        </div>
        <p class="in-blurb">Demands: “${esc(c.demand)}”</p>
        ${c.forever ? `<p class="in-warn">They've been here since 1969. They're never leaving. Build around them.</p>` : `<p class="in-note">Roads and zoning can't cross their land. <b>Pay off</b>: if they refuse, the money is gone and they dig in harder. <b>Sue</b>: 20 days in court; lose and they dig in.</p>`}
        <div class="in-actions">
          <button id="in-bribe" ${c.forever || c.state !== 'active' ? 'disabled' : ''}>💸 Pay off ${money(g.communes.bribeCost(c))} <small>${Math.round(g.communes.bribeOdds(c) * 100)}%</small></button>
          <button id="in-sue" ${c.forever || c.state !== 'active' ? 'disabled' : ''}>⚖️ Sue ${money(g.communes.suitCost(c))} <small>${Math.round(g.communes.suitOdds(c) * 100)}%</small></button>
        </div>`;
    } else if (sel.kind === 'lot') {
      const c = sel.cell, z = c.zone;
      // built on while you were looking: show the building instead
      if (c.bld) { const b = g.buildings.list.get(c.bld); g.select(b ? { kind: 'building', b } : null); return; }
      if (!z) { g.select(null); return; }
      const st = g.lotStatus(c);
      html = `<div class="in-kicker">ZONED LOT · EMPTY</div><h3>${ZONE_ICON[z]} ${esc(ZONE_LABEL[z])}</h3>
        <p class="in-blurb"><b>${esc(st.primary)}</b></p>
        <div class="in-actions">${st.demand ? `<button id="in-why">📊 ${DEM[st.demand.key].name} demand ${signed(st.demand.v)}: why?</button>` : ''}<button id="in-dezone">🧽 Dezone</button></div>`;
    } else if (sel.kind === 'road') {
      const s = sel.s;
      const t = ROAD_TYPES[s.type];
      html = `<div class="in-kicker">${esc(t.name)}</div><h3>${esc(s.name)}</h3>
        <div class="in-stats">
          <div><span>Length</span><b>${Math.round(s.length)} m</b></div>
          <div><span>Traffic</span><b>${Math.round(Math.min(1.5, s.vc) * 100)}% of capacity</b></div>
          <div><span>Age</span><b>${Math.floor((g.sim.day - s.builtDay) / 365)} yrs</b></div>
          <div><span>Upkeep</span><b>${money(s.length * t.upkeepPerM)}/wk+</b></div>
        </div>
        <div class="in-actions">${t.next ? (() => {
          const q = g.quoteUpgrade([s], t.next);
          const short = q.net > g.sim.spendable();
          return `<button id="in-lane" ${short ? 'disabled title="Not enough money"' : ''}>➕ ONE MORE LANE · ${money(q.net)}</button>`;
        })() : '<button disabled>MAX LANES</button>'}${t.oneWay ? '<button id="in-flip" title="The arrows point the other way">⇅ Flip direction</button>' : ''}<button class="danger" id="in-bulldoze">💣 Bulldoze</button></div>`;
    }
    let extra = '';
    for (const f of EXT.inspector) extra += f(sel, g) ?? '';
    if (extra) {
      const at = html.indexOf('<div class="in-actions">');
      html = at >= 0 ? html.slice(0, at) + extra + html.slice(at) : html + extra;
    }
    this.inspector.innerHTML = `<button class="in-close" id="in-close" aria-label="Close">×</button>${html}`;
    this.inspector.querySelector('#in-close')?.addEventListener('click', () => g.select(null));
    this.inspector.querySelector('#in-road')?.addEventListener('click', () => { crumb('draw a road (inspector: not connected)'); g.tools.roadMode = 'straight'; if (this.panel !== 'roads') this.onTool('roads'); g.tools.set('road'); });
    this.inspector.querySelector('#in-bulldoze')?.addEventListener('click', () => {
      if (sel.kind === 'building') { crumb(`bulldozed ${sel.b.label} (inspector)`); g.buildings.demolish(sel.b, 'bulldozed'); g.audio.play('bulldoze'); }
      if (sel.kind === 'road') { crumb(`bulldozed road ${sel.s.name} (inspector)`); g.bulldozeRoad(sel.s); }
      g.select(null);
    });
    this.inspector.querySelector('#in-lane')?.addEventListener('click', () => {
      if (sel.kind !== 'road') return;
      // the same command as the map tool: price, affordability check and undo
      if (g.upgradeRoads([sel.s]).ok) crumb(`one more lane: ${sel.s.name} (inspector)`);
      this.renderInspector();
    });
    this.inspector.querySelector('#in-flip')?.addEventListener('click', () => {
      if (sel.kind !== 'road') return;
      if (g.net.flip(sel.s.id)) { crumb(`flipped one-way ${sel.s.name} (inspector)`); g.audio.play('click'); }
      this.renderInspector();
    });
    this.inspector.querySelector('#in-why')?.addEventListener('click', () => { if (sel.kind === 'lot') { const st = g.lotStatus(sel.cell); if (st.demand) this.openDemand(st.demand.key); } });
    this.inspector.querySelector('#in-dezone')?.addEventListener('click', () => { if (sel.kind === 'lot') { g.zones.paint(sel.cell.x, sel.cell.z, 4, null); crumb('dezoned a lot (inspector)'); g.select(null); } });
    this.inspector.querySelector('#in-bribe')?.addEventListener('click', () => { if (sel.kind === 'commune') { g.bribe(sel.c); this.renderInspector(); } });
    this.inspector.querySelector('#in-sue')?.addEventListener('click', () => { if (sel.kind === 'commune') { g.sue(sel.c); this.renderInspector(); } });
  }

  // ------------------------------------------------------------------ transient UI
  toast(msg: string, bad = false) {
    // the same message again while it's still showing: keep one, refreshed
    for (const el of this.toasts.children) {
      if (el.textContent !== msg || el.classList.contains('out')) continue;
      const t0 = el as HTMLElement & { _t?: number[] };
      t0._t?.forEach((h) => clearTimeout(h));
      t0._t = [window.setTimeout(() => t0.classList.add('out'), 2600), window.setTimeout(() => t0.remove(), 3200)];
      t0.classList.remove('again'); void t0.offsetWidth; t0.classList.add('again');
      return;
    }
    crumb(`${bad ? 'warning' : 'toast'}: ${msg}`);
    const t = document.createElement('div') as HTMLDivElement & { _t?: number[] };
    t.className = 'toast' + (bad ? ' bad' : '');
    t.textContent = msg;
    this.toasts.appendChild(t);
    t._t = [window.setTimeout(() => t.classList.add('out'), 2600), window.setTimeout(() => t.remove(), 3200)];
    while (this.toasts.children.length > 3) this.toasts.firstChild?.remove();
  }

  floatText(text: string, p: THREE.Vector3, color: string) {
    const el = document.createElement('div');
    el.className = 'float';
    el.style.color = color;
    el.textContent = text;
    this.root.appendChild(el);
    this.floats.push({ el, p: p.clone(), t: 0 });
  }

  /**
   * A milestone reached: its name, the grant, and everything it unlocked,
   * with a way to the first of them (the new zone or road is marked NEW).
   */
  milestone(i: number) {
    const m = MILESTONES[i];
    if (!m) return;
    const names = unlockNames(m);
    for (const z of m.zones ?? []) this.fresh.add(`zone:${z}`);
    for (const r of m.roads ?? []) this.fresh.add(`road:${r}`);
    crumb(`milestone ${m.name}`);
    const t = document.createElement('div');
    t.className = 'toast unlock milestone';
    const next = MILESTONES[i + 1];
    t.innerHTML = `<span><b>🏅 ${esc(m.name)}</b> · ${m.pop.toLocaleString()} people${m.reward ? ` · <b class="pos">+${usd(m.reward)}</b> state grant` : ''}<small>${names.length ? `Unlocked: ${esc(names.join(', '))}` : esc(m.blurb)}</small>${next ? `<small>Next: ${esc(next.name)} at ${next.pop.toLocaleString()} people</small>` : ''}</span>${names.length ? '<button class="chip on">Open</button>' : ''}`;
    t.querySelector('button')?.addEventListener('click', () => {
      const g = this.game;
      g.audio.play('click', 0.4);
      const z = m.zones?.[0], r = m.roads?.[0], svc = m.services?.[0], lm = m.landmarks?.[0];
      if (z) { g.tools.zoneType = z; if (this.panel !== 'zones') this.onTool('zones'); g.tools.set('zone'); }
      else if (svc && SERVICE_DEFS.get(svc)) this.openServices(SERVICE_DEFS.get(svc)!.cat);
      else if (r) { g.tools.roadType = r; if (this.panel !== 'roads') this.onTool('roads'); g.tools.set('road'); }
      else if (lm) { g.tools.landmark = lm; if (this.panel !== 'landmarks') this.onTool('landmarks'); g.tools.set('landmark'); }
      this.renderPanel();
      t.remove();
    });
    this.toasts.appendChild(t);
    setTimeout(() => t.classList.add('out'), 15000);
    setTimeout(() => t.remove(), 15600);
    while (this.toasts.children.length > 3) this.toasts.firstChild?.remove();
  }

  banner(title: string, sub: string) {
    // while something is being placed, a celebration mustn't cover the spot
    if (this.game.tools.active !== 'inspect') { this.toast(`${title} · ${sub}`); return; }
    const b = document.createElement('div');
    b.className = 'banner';
    b.innerHTML = `<b>${esc(title)}</b><span>${esc(sub)}</span>`;
    this.root.appendChild(b);
    setTimeout(() => b.classList.add('out'), 3200);
    setTimeout(() => b.remove(), 4000);
  }

  ending(kind: 'sprawl' | 'bankrupt') {
    const g = this.game;
    g.sim.speed = 0;
    // one card per ending: every weekly close below the line re-announces bankruptcy, and a second card would need a second click
    if (this.root.querySelector(`.ending.${kind}`)) return;
    const el = this.mk('div', 'ending ' + kind);
    el.innerHTML = kind === 'sprawl'
      ? `<div class="end-card"><div class="end-kicker">ENDLESS SPRAWL ACHIEVED</div><h1>Tokyo × Delhi × ${esc(g.cityName)}</h1>
         <p>Every buildable inch is paved and every building is maxed out. Nature: ${Math.round(g.sim.naturePct * 100)}%. Population: ${g.sim.population.toLocaleString()}.</p>
         <p class="end-quote">“They paved paradise and put up a parking lot.”</p><button id="end-go">Keep sprawling</button></div>`
      : `<div class="end-card"><div class="end-kicker">THE PONZI ENDS</div><h1>${esc(g.cityName)} is bankrupt</h1>
         <p>The roads came due. The chains closed. Somewhere, a sapling pushes up through a parking lot.</p>
         <button id="end-go">Take a federal bailout (sandbox)</button></div>`;
    el.querySelector('#end-go')!.addEventListener('click', () => {
      if (kind === 'bankrupt') { g.sim.earn(50000 - g.sim.money, 'other', 'Federal bailout'); g.sim.bankruptWeeks = 0; }
      el.remove();
      g.sim.speed = 1;
    });
  }

  // ------------------------------------------------------------------ per frame
  /**
   * Keep the right-hand cards from covering each other (playtest 5: "Inspector,
   * Next guidance, zoning controls, and emergency panels overlap"). Desktop:
   * the emergency and in-the-red cards, then the inspector under them, sized
   * to the room above the bottom panel; while inspecting, the emergency card
   * shrinks to its headline and its Fix button. Phones: the inspector sheet
   * puts an open drawer away while it's up. (Next already hides while a tool
   * is in hand.)
   */
  private layoutCards() {
    const insp = this.inspector, open = !insp.hidden, phone = window.innerWidth <= 760;
    this.sideCards.classList.toggle('with-inspector', open);
    // the tool's Done/Build badge (top centre on phones) stays above the cards
    const ta = this.root.querySelector<HTMLElement>('.tool-actions');
    let cardsTop = '';
    if (ta && !ta.hidden && ta.offsetParent) {
      const a = ta.getBoundingClientRect();
      this.sideCards.style.top = '';
      const c = this.sideCards.getBoundingClientRect();
      if (a.height > 0 && a.right > c.left && a.left < c.right && a.bottom + 6 > c.top) cardsTop = `${Math.round(a.bottom + 6)}px`;
    }
    if (this.sideCards.style.top !== cardsTop) this.sideCards.style.top = cardsTop;
    const panel = this.root.querySelector<HTMLElement>('.subpanel');
    panel?.classList.toggle('under-inspector', open && phone);
    let top = '', max = '';
    if (open && !phone) {
      const cards = [...this.sideCards.children].some((e) => !(e as HTMLElement).hidden && e.getBoundingClientRect().height > 0);
      const from = cards ? this.sideCards.getBoundingClientRect().bottom + 8 : insp.getBoundingClientRect().top;
      if (cards) top = `${Math.round(from)}px`;
      // the highest of the toolbar, the drawer and the Next card that sit under the inspector's column
      const ir = insp.getBoundingClientRect();
      const floorOf = (els: (HTMLElement | null | undefined)[]) => {
        let f = innerHeight;
        for (const e of els) {
          if (!e || e.hidden || !e.offsetParent || e.classList.contains('yield')) continue;
          const r = e.getBoundingClientRect();
          if (r.height > 0 && r.right > ir.left && r.left < ir.right && r.top > from) f = Math.min(f, r.top);
        }
        return f - 8;
      };
      const base = [this.root.querySelector<HTMLElement>('.toolbar'), panel];
      // secondary guidance steps aside when there isn't room for both (a short window, a drawer and an emergency)
      this.nextBar?.classList.remove('yield');
      let floor = floorOf([...base, this.nextBar]);
      if (floor - from < 200 && this.nextBar) { this.nextBar.classList.add('yield'); floor = floorOf(base); }
      max = `${Math.max(180, Math.round(floor - from))}px`;
    }
    // a phone's inspector is a sheet as wide as the screen that sits where the Next card does: the card lay across its last rows and its Bulldoze
    // button (round 8 audit), so it steps aside while the sheet is up
    if (phone) this.nextBar?.classList.toggle('yield', open);
    else if (!open) this.nextBar?.classList.remove('yield');
    if (insp.style.top !== top) insp.style.top = top;
    if (insp.style.maxHeight !== max) insp.style.maxHeight = max;
  }

  update(dt: number) {
    this.feed.update(dt);
    this.domT -= dt;
    if (this.domT <= 0) {
      this.domT = 0.25;
      this.remeasureToasts = true;
      this.refreshTop();
      this.refreshPanelLive();
      this.layoutCards();
      if (this.perfVisible) {
        const p = this.game.perf;
        const pf = this.game.prof, w = pf.worst[0];
        const ri = this.game.renderInfo();
        this.perfEl.textContent = `${p.fps.toFixed(1)} fps · ${p.frameMs.toFixed(1)} ms frame · ${p.renderMs.toFixed(1)} ms work\n${p.calls.toLocaleString()} calls · ${p.triangles.toLocaleString()} tris · ${p.quality.toUpperCase()}${this.game.post.active ? '' : ' · no FX'}\nrender ${ri.buffer} of the screen's ${ri.screen} (${ri.share}%) · ${ri.mode === 'full' ? 'full res locked' : `auto ${Math.round(ri.dynamic * 100)}%`}\n${pf.top(5).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(' · ')}${w ? `\nworst ${w.ms.toFixed(0)} ms: ${w.parts.slice(0, 3).map(([k, v]) => `${k} ${v}`).join(', ')}` : ''}`;
      }
      if (this.game.selection && (this.game.selection.kind === 'car' || this.game.selection.kind === 'building' || this.game.selection.kind === 'lot')) this.renderInspector();
    }
    let tip = this.game.tools.tip;
    const t = this.game.tools;
    // phones: every map tool gets the bar (hint + Done), since there's no hover tip
    const placingLabel = t.placingLabel;
    // desktop: placing a building shows a "Placing …" badge with Cancel
    const showActions = t.active === 'road' || t.active === 'upgrade' || (IS_TOUCH && t.active !== 'inspect') || !!placingLabel;
    const barChanged = this.actions.hidden === showActions;
    this.actions.hidden = !showActions;
    if (barChanged || this.remeasureToasts) {
      // toasts drop below the action bar instead of printing over it
      // (measured when the bar appears and 4x a second, not every frame)
      this.remeasureToasts = false;
      // on desktop they sit at the right, so they also clear the card column there (an emergency, in the red)
      const crisisB = !IS_TOUCH && [...this.sideCards.children].some((c) => !(c as HTMLElement).hidden) ? this.sideCards.getBoundingClientRect().bottom + 8 : 0;
      const barB = showActions ? this.actions.getBoundingClientRect().bottom + 6 : 0;
      const toastTop = Math.max(crisisB, barB) ? `${Math.round(Math.max(crisisB, barB))}px` : '';
      if (this.toasts.style.top !== toastTop) this.toasts.style.top = toastTop;
    }
    if (showActions) {
      const tipEl = this.actions.querySelector('#ta-tip') as HTMLElement;
      const badge = !IS_TOUCH && placingLabel ? `Placing ${placingLabel} · Esc or right-click to cancel` : '';
      tipEl.textContent = IS_TOUCH ? tip?.text ?? '' : badge;
      tipEl.classList.toggle('bad', IS_TOUCH && !!tip?.bad);
      tipEl.classList.toggle('good', IS_TOUCH && !tip?.bad && !!tip?.good);
      tipEl.hidden = IS_TOUCH ? !tip : !badge;
      const done = this.actions.querySelector('#ta-done') as HTMLElement;
      done.hidden = IS_TOUCH ? false : !t.drawing && !placingLabel;
      const doneLabel = IS_TOUCH ? '✓ Done' : placingLabel ? '✕ Cancel' : '✕ Stop';
      if (done.textContent !== doneLabel) done.textContent = doneLabel;
      const build = this.actions.querySelector('#ta-build') as HTMLButtonElement;
      const plan = t.active === 'ext' ? t.extPending : t.pending ? { cost: t.pendingCost } : null;
      build.hidden = !plan;
      build.disabled = !plan || plan.cost === null;
      const label = plan && plan.cost !== null ? `🔨 Build $${plan.cost.toLocaleString()}` : '🔨 Build';
      if (build.textContent !== label) build.textContent = label;
      const undo = this.actions.querySelector('#ta-undo') as HTMLButtonElement;
      undo.hidden = t.active !== 'road' && t.active !== 'upgrade' && !placingLabel;
      undo.disabled = !this.game.canUndo;
      // name what Undo will reverse and what comes back
      const ul = this.game.undoLabel, utitle = ul ? `Undo ${ul} (Ctrl+Z)` : 'Nothing to undo';
      if (undo.title !== utitle) { undo.title = utitle; undo.setAttribute('aria-label', utitle); }
    }
    // hovering a problem icon over a building says what it needs (any tool
    // that isn't already talking through the tip)
    if (!IS_TOUCH && !tip && this.tipAt.x && this.overMap) {
      const hit = this.game.problemAt?.(this.tipAt.x, this.tipAt.y);
      if (hit?.text) tip = { text: hit.text, bad: true };
    }
    if (tip && !IS_TOUCH) {
      const was = this.tip.hidden, text = this.tip.textContent;
      this.tip.hidden = false;
      if (text !== tip.text) this.tip.textContent = tip.text;
      this.tip.classList.toggle('bad', !!tip.bad);
      this.tip.classList.toggle('good', !tip.bad && 'good' in tip && !!tip.good);
      if (was || text !== tip.text) this.placeTip();
    } else this.tip.hidden = true;
    // floating texts
    const cam = this.game.camera;
    const w = window.innerWidth, h = window.innerHeight;
    for (let i = this.floats.length - 1; i >= 0; i--) {
      const f = this.floats[i];
      f.t += dt;
      this.v.copy(f.p).setY(f.p.y + 4 + f.t * 6).project(cam);
      f.el.style.transform = `translate(${(this.v.x * 0.5 + 0.5) * w}px, ${(-this.v.y * 0.5 + 0.5) * h}px) translate(-50%, -50%)`;
      f.el.style.opacity = String(Math.max(0, 1 - f.t / 2.2));
      if (f.t > 2.2) { f.el.remove(); this.floats.splice(i, 1); }
    }
    // follow selected car
    const sel = this.game.selection;
    if (sel?.kind === 'car' && sel.c.crashed !== -1 && this.game.rts.distance < 200) this.game.rts.setView(sel.c.x, sel.c.z, this.game.rts.distance);
  }
}

function fmtHour(h: number) {
  const hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
  const ap = hh >= 12 ? 'PM' : 'AM';
  return `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${ap}`;
}
