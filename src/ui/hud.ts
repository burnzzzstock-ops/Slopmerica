// In-game HUD: top bar (money, pop, date, speed, RCIO demand, nature/sprawl),
// bottom toolbar with sub-panels, the X feed, inspector, budget, toasts.
import * as THREE from 'three';
import { EXT } from '../ext/registry';
import type { LandmarkId, ZoneType } from '../contracts';
import { ZONE_TYPES } from '../contracts';
import type { Game, Selection, UiSink } from '../game';
import { LANDMARK_COST } from '../game';
import { ROAD_ORDER, ROAD_TYPES, RoadTypeId } from '../roads/roadTypes';
import { ZONE_COLORS, ZONE_LABEL } from '../zones/zoning';
import { MAX_LEVEL } from '../contracts';
import type { ToolId } from '../tools/tools';
import { FeedPanel } from './feedPanel';
import { MERCH_URL, brandById } from '../art/brands';
import { IS_TOUCH } from '../config';
import { QUALITY, type Quality } from '../config';
import { SPEEDS } from '../sim/sim';
import { isZoned } from '../sim/buildings';
import type { ViewMode } from '../render/overlays';
import { ARCHETYPES } from '../agents/people';
import { saveGame } from '../sim/save';
import { VEHICLE_SPECS } from '../agents/vehicles';

const esc = (s: string) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const money = (n: number) => (n === Infinity ? '∞' : (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString());

const LANDMARKS: { id: LandmarkId; name: string; icon: string }[] = [
  { id: 'slopCannon', name: 'The Slop Cannon', icon: '💥' },
  { id: 'slop69Field', name: 'Slop 69 Field', icon: '⚾' },
  { id: 'pigCabanaResort', name: 'Pig Cabana Resort', icon: '🐷' },
  { id: 'neuralFlyDatacenter', name: 'Neural Fly Datacenter', icon: '🪰' },
  { id: 'propaneParadise', name: 'Propane Paradise', icon: '🔥' },
  { id: 'fillErUpMegaStation', name: 'Fill Er Up Mega Station', icon: '⛽' },
  { id: 'megachurch', name: 'Megachurch', icon: '⛪' },
  { id: 'waterTower', name: 'Water Tower', icon: '🗼' },
];

const ZONE_ICON: Record<ZoneType, string> = { resLow: '🏡', resHigh: '🏢', comLow: '🛒', comHigh: '🏬', industry: '🏭', office: '💻' };

type PanelId = 'roads' | 'zones' | 'landmarks' | 'views' | 'budget' | 'communes' | 'help' | 'more' | `ext:${string}` | null;

/** Phones get these in the toolbar; everything else lives in the More drawer. */
const PHONE_PRIMARY = ['inspect', 'roads', 'zones', 'ext:services', 'views', 'bulldoze'];
const COMPACT = IS_TOUCH || (typeof window !== 'undefined' && window.innerWidth < 700);

export class Hud implements UiSink {
  root: HTMLElement;
  feed: FeedPanel;
  private top!: HTMLElement;
  private bar!: HTMLElement;
  private sub!: HTMLElement;
  private inspector!: HTMLElement;
  private toasts!: HTMLElement;
  private remeasureToasts = true;
  private tip!: HTMLElement;
  private actions!: HTMLElement;
  private perfEl!: HTMLElement;
  private perfVisible = false;
  private floats: { el: HTMLElement; p: THREE.Vector3; t: number }[] = [];
  private panel: PanelId = null;
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
    this.inspector.hidden = true;
    this.toasts = this.mk('div', 'toasts');
    this.tip = this.mk('div', 'cursor-tip');
    this.tip.hidden = true;
    this.actions = this.mk('div', 'tool-actions');
    this.perfEl = this.mk('div', 'perf-overlay');
    this.perfEl.hidden = true;
    this.actions.innerHTML = `<span class="ta-tip" id="ta-tip"></span><button id="ta-build" class="ta-build">🔨 Build</button><button id="ta-done" class="ta-done">${IS_TOUCH ? '✓ Done' : '✕ Stop'}</button><button id="ta-undo">↶ Undo</button>`;
    this.actions.hidden = true;
    // phones: Done leaves the tool entirely (double-tap ends just the current
    // road); desktop: Stop ends the road being drawn and keeps the tool
    this.actions.querySelector('#ta-done')!.addEventListener('click', () => {
      if (IS_TOUCH) { this.exitTool(); return; }
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
    game.tools.onChange = () => this.syncToolbar();
    window.addEventListener('keydown', (e) => this.hotkey(e));
    game.renderer.domElement.addEventListener('pointermove', (e) => {
      this.tip.style.transform = `translate(${e.clientX + 16}px, ${e.clientY + 18}px)`;
    });
    setTimeout(() => game.feed.push('gameStart'), 1500);
    if (!game.opts.restore) setTimeout(() => this.onboarding(), 900);
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
        <li><b>Roads</b>: draw one off <em>Old County Road</em>. ${IS_TOUCH ? 'Drag your finger to draw. Two fingers move the map.' : 'Click to start, click to end.'} Stroads are the American way.</li>
        <li><b>Zoning</b>: paint green (homes), blue (shops) and yellow (industry) along it. Watch the R C I O bars.</li>
        <li><b>▶▶▶</b>: let the slop grow. Widen jammed roads with <b>One More Lane</b>. Hippies can be paid off or sued.</li>
      </ol>
      <p>Goal: pave every inch and max every building. Tokyo × Delhi or bust.</p>
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
        <div class="tb-name">${esc(this.game.cityName)}</div>
        <div class="tb-date" id="tb-date"></div>
      </div>
      <div class="tb-speed" role="group" aria-label="Game speed">
        <button data-speed="0" title="Pause (Space)">❚❚</button>
        <button data-speed="1" title="Speed 1 (1)">▶</button>
        <button data-speed="2" title="Speed 2 (2)">▶▶</button>
        <button data-speed="3" title="Speed 3 (3)">▶▶▶</button>
      </div>
      <div class="tb-stat"><span class="tb-lbl">Pop</span><b id="tb-pop">0</b></div>
      <div class="tb-stat tb-money"><span class="tb-lbl">Treasury</span><b id="tb-money">$0</b><i id="tb-net"></i></div>
      <div class="tb-demand" title="Demand: Residential, Commercial, Industrial, Office">
        <div class="dbar"><span class="dfill" id="d-res" style="--c:var(--res)"></span><em>R</em></div>
        <div class="dbar"><span class="dfill" id="d-com" style="--c:var(--com)"></span><em>C</em></div>
        <div class="dbar"><span class="dfill" id="d-ind" style="--c:var(--ind)"></span><em>I</em></div>
        <div class="dbar"><span class="dfill" id="d-off" style="--c:var(--off)"></span><em>O</em></div>
      </div>
      <div class="tb-meters">
        <div class="meter" title="Nature remaining"><span>🌲</span><div class="mtrack"><div class="mfill nature" id="m-nature"></div></div><b id="m-nature-t"></b></div>
        <div class="meter" title="Progress toward Endless Sprawl"><span>🏙️</span><div class="mtrack"><div class="mfill sprawl" id="m-sprawl"></div></div><b id="m-sprawl-t"></b></div>
      </div>
      <div class="tb-weather" id="tb-weather"></div>`;
    this.top.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((b) =>
      b.addEventListener('click', () => { this.game.sim.speed = Number(b.dataset.speed); this.game.audio.play('click', 0.4); this.refreshTop(); }),
    );
  }

  private refreshTop() {
    const g = this.game, s = g.sim;
    const $ = (id: string) => this.top.querySelector('#' + id) as HTMLElement;
    $('tb-date').textContent = `${s.dateLabel()} · ${fmtHour(g.hour)}`;
    $('tb-pop').textContent = s.population.toLocaleString();
    $('tb-money').textContent = money(s.money);
    $('tb-money').classList.toggle('neg', s.money < 0);
    const net = s.weeklyNet();
    const netEl = $('tb-net');
    netEl.textContent = s.money === Infinity ? 'sandbox' : `${net >= 0 ? '+' : ''}${money(net)}/wk`;
    netEl.className = net >= 0 ? 'pos' : 'neg';
    const d = s.demand;
    const names = { res: 'Residential', com: 'Commercial', ind: 'Industrial', off: 'Office' } as const;
    for (const [k, v] of Object.entries(d) as [keyof typeof names, number][]) {
      const el = $('d-' + k);
      el.style.height = `${Math.max(2, Math.min(100, Math.max(0, v)))}%`;
      el.classList.toggle('neg', v < 0);
      const bar = el.parentElement as HTMLElement;
      const tip = `${names[k]} demand ${Math.round(v)}\n• ${s.demandWhy[k].join('\n• ')}`;
      if (bar.title !== tip) bar.title = tip;
    }
    $('m-nature').style.width = `${Math.round(s.naturePct * 100)}%`;
    $('m-nature-t').textContent = `${Math.round(s.naturePct * 100)}%`;
    $('m-sprawl').style.width = `${Math.round(s.sprawlPct * 100)}%`;
    $('m-sprawl-t').textContent = `${Math.round(s.sprawlPct * 100)}%`;
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
      this.moreItems = all.filter((x) => !PHONE_PRIMARY.includes(x[0]));
      this.bar.innerHTML = primary.map(btn).join('') + btn(['more', '<i class="more-dots"><b></b><b></b><b></b></i>', 'More']);
      this.bar.classList.add('compact');
    } else {
      this.bar.innerHTML = all.map(btn).join('') +
        `<a class="tbtn merch" href="${MERCH_URL}" target="_blank" rel="noopener" title="Real Slop merch"><span class="ti slop-mini">Slop</span><span class="tl">Merch</span></a>`;
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

  /** Put the current map tool away: back to Select with no panel open. */
  private exitTool() {
    this.game.tools.finishExt();
    this.openPanel(null);
    this.game.tools.set('inspect');
    this.game.audio.play('click', 0.4);
  }

  private openPanel(p: PanelId) {
    if (this.panel && this.panel !== p && this.panel.startsWith('ext:')) {
      const old = EXT.panels.find((x) => `ext:${x.id}` === this.panel);
      old?.close?.(this.game);
      if (this.game.tools.active === 'ext') this.game.tools.set('inspect');
    }
    this.panel = p;
    this.sub.hidden = !p;
    this.sub.classList.remove('min');
    if (!p) { if (this.game.tools.active === 'road' || this.game.tools.active === 'zone' || this.game.tools.active === 'dezone') this.game.tools.set('inspect'); this.syncToolbar(); return; }
    this.renderPanel();
    this.syncToolbar();
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
        <div class="sp-row modes">${(['straight', 'curve', 'freeform'] as const).map((m) => `<button class="chip ${t.roadMode === m ? 'on' : ''}" data-mode="${m}">${m === 'straight' ? '📏 Straight' : m === 'curve' ? '↪️ Curved' : '〰️ Freeform'}</button>`).join('')}</div>
        <div class="sp-grid">${ROAD_ORDER.map((id) => {
          const r = ROAD_TYPES[id];
          const locked = !g.sim.isUnlocked({ road: id });
          return `<button class="card ${t.roadType === id ? 'on' : ''}" data-road="${id}" ${locked ? 'disabled' : ''} title="${esc(r.blurb)}">
            <span class="ci">${r.icon}</span><b>${esc(r.name)}</b><small>${locked ? `🔒 Pop ${r.unlockPop.toLocaleString()}` : `$${r.costPerM}/m · ${r.lanesPerDir * 2} lanes${r.centerTurn ? ' + turn' : ''}`}</small></button>`;
        }).join('')}</div>`;
      this.sub.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => b.addEventListener('click', () => { t.roadMode = b.dataset.mode as never; t.cancel(); t.set('road'); this.renderPanel(); }));
      this.sub.querySelectorAll<HTMLButtonElement>('[data-road]').forEach((b) => b.addEventListener('click', () => { t.roadType = b.dataset.road as RoadTypeId; t.set('road'); this.renderPanel(); }));
    } else if (p === 'zones') {
      this.sub.innerHTML = `
        <div class="sp-title">Zoning <small>Paint cells along roads. Buildings grow when there's demand.</small></div>
        <div class="sp-grid zones">${ZONE_TYPES.map((z) => {
          const locked = !g.sim.isUnlocked({ zone: z });
          return `<button class="card zone ${t.active === 'zone' && t.zoneType === z ? 'on' : ''}" data-zone="${z}" style="--zc:#${ZONE_COLORS[z].toString(16).padStart(6, '0')}" ${locked ? 'disabled' : ''}>
            <span class="ci">${ZONE_ICON[z]}</span><b>${esc(ZONE_LABEL[z])}</b><small>${locked ? '🔒 grow the city' : `Levels 1–${MAX_LEVEL[z]}`}</small></button>`;
        }).join('')}
          <button class="card zone ${t.active === 'dezone' ? 'on' : ''}" data-zone="none" style="--zc:#888"><span class="ci">🧽</span><b>Dezone</b><small>Unzone empty cells</small></button>
        </div>
        <div class="sp-row">Brush ${['S', 'M', 'L'].map((s, i) => `<button class="chip ${t.brush === i ? 'on' : ''}" data-brush="${i}">${s}</button>`).join('')}</div>`;
      this.sub.querySelectorAll<HTMLButtonElement>('[data-zone]').forEach((b) => b.addEventListener('click', () => {
        const z = b.dataset.zone!;
        if (z === 'none') t.set('dezone');
        else { t.zoneType = z as ZoneType; t.set('zone'); }
        this.renderPanel();
      }));
      this.sub.querySelectorAll<HTMLButtonElement>('[data-brush]').forEach((b) => b.addEventListener('click', () => { t.brush = Number(b.dataset.brush); this.renderPanel(); }));
    } else if (p === 'landmarks') {
      this.sub.innerHTML = `
        <div class="sp-title">Landmarks <small>Monuments to Slopmerica. Place one, then build around it.</small></div>
        <div class="sp-grid">${LANDMARKS.map((l) => `<button class="card ${t.active === 'landmark' && t.landmark === l.id ? 'on' : ''}" data-lm="${l.id}"><span class="ci">${l.icon}</span><b>${esc(l.name)}</b><small>${money(LANDMARK_COST[l.id])}</small></button>`).join('')}</div>`;
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
      const s = g.sim, L = s.lastWeek;
      const row = (label: string, v: number) => `<tr><td>${label}</td><td class="${v < 0 ? 'neg' : v > 0 ? 'pos' : ''}">${money(v)}</td></tr>`;
      this.sub.innerHTML = `
        <div class="sp-title">Budget <small>The Growth Ponzi: new roads are cheap now, expensive forever.</small></div>
        <div class="budget">
          <table>
            ${row('Residential tax', L.resTax)}${row('Commercial tax', L.comTax)}${row('Industrial tax', L.indTax)}${row('Office tax', L.offTax)}
            ${row('Impact fees (new construction)', L.impact)}${row('Federal Slop Grants', L.grants)}${row('Other', L.other)}
            ${row('Road upkeep (ages badly)', L.roads)}${row('Services: cops, fire, schools', L.services)}${row('Construction', L.construction)}${row('Communes & lawyers', L.communes)}${row('Loan payments', L.loans)}
            <tr class="total"><td>Last week</td><td class="${s.weeklyNet() < 0 ? 'neg' : 'pos'}">${money(s.weeklyNet())}</td></tr>
          </table>
          <div class="tax">
            <label for="tax">Tax rate <b id="tax-v">${Math.round(s.taxRate * 100)}%</b></label>
            <input id="tax" type="range" min="1" max="29" value="${Math.round(s.taxRate * 100)}" />
            <small>Taxation is theft (demand drops) / eat the rich (money rises)</small>
            <div class="sp-row">${[10000, 50000, 150000].map((a) => `<button class="chip" data-loan="${a}">Loan ${money(a)}</button>`).join('')}</div>
            <small>${s.loans.length ? `${s.loans.length} loan(s): ${money(s.loans.reduce((a, l) => a + l.weekly, 0))}/wk` : 'No loans. Yet.'}</small>
          </div>
        </div>`;
      const tax = this.sub.querySelector('#tax') as HTMLInputElement;
      tax.addEventListener('input', () => {
        const old = s.taxRate;
        s.taxRate = Number(tax.value) / 100;
        (this.sub.querySelector('#tax-v') as HTMLElement).textContent = `${tax.value}%`;
        if (Math.abs(s.taxRate - old) > 0.001) this.taxFeed(s.taxRate > old);
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
        <div class="sp-row quality-controls"><label for="quality-preset">Graphics</label>
          <select id="quality-preset">${(Object.keys(QUALITY) as Quality['name'][]).map((n) => `<option value="${n}" ${n === (g.pendingQuality ?? g.q.name) ? 'selected' : ''}>${n[0].toUpperCase() + n.slice(1)}</option>`).join('')}</select>
          <button class="chip" id="perf-toggle">${this.perfVisible ? 'Hide' : 'Show'} performance</button>
          ${g.pendingQuality ? '<button class="chip on" id="quality-reload">Reload to finish applying</button>' : ''}
        </div>
        <small>Resolution and shadows change immediately. Reload applies scenery, traffic, and post-processing budgets.</small>
        <div class="help">${IS_TOUCH ? `
          <div><b>Move</b> drag with one finger (two fingers while a tool is on)</div>
          <div><b>Zoom</b> pinch</div>
          <div><b>Rotate</b> twist two fingers</div>
          <div><b>Tilt</b> drag two fingers up or down</div>
          <div><b>Roads</b> drag to plan, tap Build. Double-tap ends a road. Done puts the tool away.</div>
          <div><b>Placing</b> services and landmarks: tap to preview, then Build</div>` : `
          <div><b>Move</b> WASD / arrows · drag</div>
          <div><b>Rotate</b> right-drag · Q/E</div>
          <div><b>Tilt</b> right-drag up/down · R/F</div>
          <div><b>Zoom</b> wheel</div>
          <div><b>Roads</b> click start, click end. Keeps chaining. Esc / right-click stops.</div>
          <div><b>Speed</b> Space pause · 1 2 3</div>
          <div><b>Tools</b> B bulldoze · U one more lane · Z zoning · Esc cancel</div>
          <div><b>Performance</b> F3 shows FPS, frame time, draw calls and triangles</div>`}
        </div>
        <div class="sp-row"><button class="chip" id="save-now">💾 Save now</button><button class="chip" id="new-city">🆕 New city</button><small>Autosaves every 30 seconds in this browser.</small></div>`;
      this.sub.querySelector('#save-now')?.addEventListener('click', () => { const ok = saveGame(g); this.toast(ok ? 'Saved.' : 'Could not save in this browser', !ok); });
      this.sub.querySelector('#new-city')?.addEventListener('click', () => { saveGame(g); location.hash = ''; location.reload(); });
      this.sub.querySelector('#quality-preset')?.addEventListener('change', (e) => {
        const reload = g.requestQuality((e.target as HTMLSelectElement).value as Quality['name']);
        this.renderPanel();
        this.toast(reload ? 'Graphics preset saved. Reload to apply all details.' : 'Graphics preset applied.');
      });
      this.sub.querySelector('#quality-reload')?.addEventListener('click', () => location.reload());
      this.sub.querySelector('#perf-toggle')?.addEventListener('click', () => { this.togglePerf(); this.renderPanel(); });
    }
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

  private hotkey(e: KeyboardEvent) {
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;
    const s = this.game.sim;
    if (e.key === 'F3') { e.preventDefault(); this.togglePerf(); }
    else if (e.key === ' ') { e.preventDefault(); s.speed = s.speed === 0 ? 1 : 0; }
    else if (e.key === '1' || e.key === '2' || e.key === '3') s.speed = Number(e.key);
    else if (e.key.toLowerCase() === 'b') this.onTool('bulldoze');
    else if (e.key.toLowerCase() === 'u') this.onTool('upgrade');
    else if (e.key.toLowerCase() === 'z') this.onTool('zones');
    else if (e.key === 'Escape') { this.openPanel(null); this.game.tools.set('inspect'); this.select(null); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); this.game.undo(); }
    this.refreshTop();
  }

  private togglePerf() {
    this.perfVisible = !this.perfVisible;
    this.perfEl.hidden = !this.perfVisible;
  }

  // ------------------------------------------------------------------ inspector
  select(sel: Selection) {
    if (!sel) { this.inspector.hidden = true; return; }
    this.inspector.hidden = false;
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
    const at = sel.kind === 'building' ? sel.b : sel.kind === 'commune' || sel.kind === 'car' ? sel.c : null;
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
      html = `<div class="in-kicker" style="--zc:${svc ? 'var(--off)' : '#ff3ea5'}">${svc ? 'CITY SERVICE' : 'LANDMARK'}</div>
        <h3>${esc(b.label)}</h3>
        <div class="in-stats">
          <div><span>Status</span><b>${b.state === 'building' ? `🚧 ${Math.round(b.progress * 100)}%` : 'Open'}</b></div>
        </div>
        <div class="in-actions"><button class="danger" id="in-bulldoze">💣 Bulldoze</button></div>`;
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
          <div><span>Status</span><b>${c.forever ? '♾️ Forever' : c.state === 'suing' ? `⚖️ Court in ${Math.max(0, Math.ceil(c.suitDays - g.sim.day))} days` : c.state}</b></div>
        </div>
        <p class="in-blurb">Demands: “${esc(c.demand)}”</p>
        ${c.forever ? `<p class="in-warn">They've been here since 1969. They're never leaving. Build around them.</p>` : ''}
        <div class="in-actions">
          <button id="in-bribe" ${c.forever || c.state !== 'active' ? 'disabled' : ''}>💸 Pay off ${money(g.communes.bribeCost(c))} <small>${Math.round(g.communes.bribeOdds(c) * 100)}%</small></button>
          <button id="in-sue" ${c.forever || c.state !== 'active' ? 'disabled' : ''}>⚖️ Sue ${money(g.communes.suitCost(c))} <small>${Math.round(g.communes.suitOdds(c) * 100)}%</small></button>
        </div>`;
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
        <div class="in-actions">${t.next ? `<button id="in-lane">➕ ONE MORE LANE</button>` : '<button disabled>MAX LANES</button>'}<button class="danger" id="in-bulldoze">💣 Bulldoze</button></div>`;
    }
    let extra = '';
    for (const f of EXT.inspector) extra += f(sel, g) ?? '';
    if (extra) {
      const at = html.indexOf('<div class="in-actions">');
      html = at >= 0 ? html.slice(0, at) + extra + html.slice(at) : html + extra;
    }
    this.inspector.innerHTML = `<button class="in-close" id="in-close" aria-label="Close">×</button>${html}`;
    this.inspector.querySelector('#in-close')?.addEventListener('click', () => g.select(null));
    this.inspector.querySelector('#in-bulldoze')?.addEventListener('click', () => {
      if (sel.kind === 'building') { g.buildings.demolish(sel.b, 'bulldozed'); g.audio.play('bulldoze'); }
      if (sel.kind === 'road') { g.net.removeSeg(sel.s.id); g.audio.play('bulldoze'); }
      g.select(null);
    });
    this.inspector.querySelector('#in-lane')?.addEventListener('click', () => {
      if (sel.kind !== 'road') return;
      const next = ROAD_TYPES[sel.s.type].next!;
      const cost = sel.s.length * ROAD_TYPES[next].costPerM;
      g.sim.spend(Math.round(cost), 'ONE MORE LANE');
      g.sim.earn(Math.round(cost * ROAD_TYPES[next].fedGrant), 'grants');
      g.net.upgrade(sel.s.id);
      g.onLaneAdded([sel.s], next);
      this.renderInspector();
    });
    this.inspector.querySelector('#in-bribe')?.addEventListener('click', () => { if (sel.kind === 'commune') { g.bribe(sel.c); this.renderInspector(); } });
    this.inspector.querySelector('#in-sue')?.addEventListener('click', () => { if (sel.kind === 'commune') { g.sue(sel.c); this.renderInspector(); } });
  }

  // ------------------------------------------------------------------ transient UI
  toast(msg: string, bad = false) {
    const t = document.createElement('div');
    t.className = 'toast' + (bad ? ' bad' : '');
    t.textContent = msg;
    this.toasts.appendChild(t);
    setTimeout(() => t.classList.add('out'), 2600);
    setTimeout(() => t.remove(), 3200);
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

  banner(title: string, sub: string) {
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
    const el = this.mk('div', 'ending ' + kind);
    el.innerHTML = kind === 'sprawl'
      ? `<div class="end-card"><div class="end-kicker">ENDLESS SPRAWL ACHIEVED</div><h1>Tokyo × Delhi × ${esc(g.cityName)}</h1>
         <p>Every buildable inch is paved and every building is maxed out. Nature: ${Math.round(g.sim.naturePct * 100)}%. Population: ${g.sim.population.toLocaleString()}.</p>
         <p class="end-quote">“They paved paradise and put up a parking lot.”</p><button id="end-go">Keep sprawling</button></div>`
      : `<div class="end-card"><div class="end-kicker">THE PONZI ENDS</div><h1>${esc(g.cityName)} is bankrupt</h1>
         <p>The roads came due. The chains closed. Somewhere, a sapling pushes up through a parking lot.</p>
         <button id="end-go">Take a federal bailout (sandbox)</button></div>`;
    el.querySelector('#end-go')!.addEventListener('click', () => {
      if (kind === 'bankrupt') { g.sim.money = 50000; g.sim.bankruptWeeks = 0; }
      el.remove();
      g.sim.speed = 1;
    });
  }

  // ------------------------------------------------------------------ per frame
  update(dt: number) {
    this.feed.update(dt);
    this.domT -= dt;
    if (this.domT <= 0) {
      this.domT = 0.25;
      this.remeasureToasts = true;
      this.refreshTop();
      if (this.perfVisible) {
        const p = this.game.perf;
        this.perfEl.textContent = `${p.fps.toFixed(1)} fps · ${p.frameMs.toFixed(1)} ms frame · ${p.renderMs.toFixed(1)} ms work\n${p.calls.toLocaleString()} calls · ${p.triangles.toLocaleString()} tris · ${p.quality.toUpperCase()} · ${Math.round(p.resolution * 100)}% res`;
      }
      if (this.game.selection && (this.game.selection.kind === 'car' || this.game.selection.kind === 'building')) this.renderInspector();
    }
    const tip = this.game.tools.tip;
    const t = this.game.tools;
    // phones: every map tool gets the bar (hint + Done), since there's no hover tip
    const showActions = t.active === 'road' || t.active === 'upgrade' || (IS_TOUCH && t.active !== 'inspect');
    const barChanged = this.actions.hidden === showActions;
    this.actions.hidden = !showActions;
    if (barChanged || this.remeasureToasts) {
      // toasts drop below the action bar instead of printing over it
      // (measured when the bar appears and 4x a second, not every frame)
      this.remeasureToasts = false;
      const toastTop = showActions ? `${Math.round(this.actions.getBoundingClientRect().bottom + 6)}px` : '';
      if (this.toasts.style.top !== toastTop) this.toasts.style.top = toastTop;
    }
    if (showActions) {
      const tipEl = this.actions.querySelector('#ta-tip') as HTMLElement;
      tipEl.textContent = IS_TOUCH ? tip?.text ?? '' : '';
      tipEl.classList.toggle('bad', !!tip?.bad);
      tipEl.hidden = !IS_TOUCH || !tip;
      (this.actions.querySelector('#ta-done') as HTMLElement).hidden = IS_TOUCH ? false : !t.drawing;
      const build = this.actions.querySelector('#ta-build') as HTMLButtonElement;
      const plan = t.active === 'ext' ? t.extPending : t.pending ? { cost: t.pendingCost } : null;
      build.hidden = !plan;
      build.disabled = !plan || plan.cost === null;
      const label = plan && plan.cost !== null ? `🔨 Build $${plan.cost.toLocaleString()}` : '🔨 Build';
      if (build.textContent !== label) build.textContent = label;
      const undo = this.actions.querySelector('#ta-undo') as HTMLButtonElement;
      undo.hidden = t.active !== 'road' && t.active !== 'upgrade'; // only roads and lanes are on the undo stack
      undo.disabled = !this.game.canUndo;
    }
    if (tip && !IS_TOUCH) {
      this.tip.hidden = false;
      this.tip.textContent = tip.text;
      this.tip.classList.toggle('bad', !!tip.bad);
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
