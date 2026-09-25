// Game: owns the scene and every subsystem, and runs the frame loop.
import * as THREE from 'three';
import { defaultQuality, HALF, IS_TOUCH, Quality, WATER } from './config';
import type { FeedContext, FeedEventKind, LandmarkId } from './contracts';
import { generateMap, MapData, MapId } from './world/maps';
import { Terrain } from './world/terrain';
import { Trees } from './world/trees';
import { createWater } from './world/water';
import { Environment } from './world/sky';
import { WeatherSystem } from './world/weather';
import { PointerHandlers, RTSCamera } from './render/camera';
import { PostFX } from './render/post';
import { Particles } from './render/particles';
import { AudioEngine } from './audio/audio';
import { RoadNetwork, RSeg, Plan } from './roads/network';
import { RoadRenderer } from './roads/roadMesh';
import { ROAD_TYPES, RoadTypeId } from './roads/roadTypes';
import { Zoning } from './zones/zoning';
import { Buildings, Bld } from './sim/buildings';
import { Sim, Mode, SPEEDS } from './sim/sim';
import { Traffic, Car } from './agents/traffic';
import { Pedestrians, Ped } from './agents/pedestrians';
import { Communes, Commune } from './agents/communes';
import { AmbientLife } from './agents/ambient';
import { Tools } from './tools/tools';
import { setBuildingNight, loadArt, landmarkFootprint } from './buildings/generator';
import { lineCubic, V2 } from './core/math';
import { Overlays } from './render/overlays';
import { buildingMaterial } from './buildings/generator';
import { applySave, type SaveData } from './sim/save';

export type GameMode = Mode;

export interface GameOptions {
  map: MapId;
  mode: GameMode;
  cityName?: string;
  quality?: Quality;
  restore?: SaveData;
}

export type Selection =
  | { kind: 'building'; b: Bld }
  | { kind: 'car'; c: Car }
  | { kind: 'ped'; p: Ped }
  | { kind: 'commune'; c: Commune }
  | { kind: 'road'; s: RSeg }
  | null;

export interface FeedSink {
  push(kind: FeedEventKind, extra?: Partial<FeedContext>): void;
}

export interface UiSink {
  toast(msg: string, bad?: boolean): void;
  floatText(text: string, p: THREE.Vector3, color: string): void;
  select(sel: Selection): void;
  banner(title: string, sub: string): void;
  ending(kind: 'sprawl' | 'bankrupt'): void;
}

export type UndoAction =
  | { kind: 'build'; segIds: number[]; refund: number }
  | { kind: 'upgrade'; prev: { id: number; type: RoadTypeId }[]; refund: number };

export const LANDMARK_COST: Record<LandmarkId, number> = {
  slopCannon: 25000, slop69Field: 60000, pigCabanaResort: 45000, neuralFlyDatacenter: 80000, propaneParadise: 18000,
  fillErUpMegaStation: 30000, megachurch: 35000, waterTower: 8000,
};

export class Game {
  readonly q: Quality;
  readonly map: MapData;
  readonly scene = new THREE.Scene();
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
  readonly rts: RTSCamera;
  readonly terrain: Terrain;
  readonly trees: Trees;
  readonly env: Environment;
  readonly water: ReturnType<typeof createWater>;
  readonly weather: WeatherSystem;
  readonly post: PostFX;
  readonly particles: Particles;
  readonly audio = new AudioEngine();
  readonly net: RoadNetwork;
  readonly roads: RoadRenderer;
  readonly zones: Zoning;
  readonly buildings: Buildings;
  readonly sim: Sim;
  readonly traffic: Traffic;
  readonly peds: Pedestrians;
  readonly communes: Communes;
  readonly tools: Tools;
  readonly overlays: Overlays;
  readonly timer = new THREE.Timer();
  readonly cityName: string;
  time = 0;
  hour = 9.5;
  selection: Selection = null;
  feed: FeedSink = { push: () => {} };
  ui: UiSink = { toast: () => {}, floatText: () => {}, select: () => {}, banner: () => {}, ending: () => {} };
  landmarkPending: LandmarkId | null = null;
  readonly isTouch = IS_TOUCH;
  private undoStack: UndoAction[] = [];
  private raf = 0;
  private ray = new THREE.Raycaster();
  private nightWas = false;
  onFrame: ((dt: number) => void)[] = [];

  constructor(public container: HTMLElement, public opts: GameOptions) {
    this.q = opts.quality ?? defaultQuality();
    let tLap = performance.now();
    const lap = (n: string) => { const t = performance.now(); console.info(`[boot] ${n} ${(t - tLap).toFixed(0)}ms`); tLap = t; };
    this.map = generateMap(opts.map);
    lap('map');
    this.cityName = opts.cityName || defaultCityName(opts.map);

    // with post-processing the scene is multisampled offscreen, so the canvas itself needn't be
    this.renderer = new THREE.WebGLRenderer({ antialias: this.q.post ? false : !IS_TOUCH, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.q.pixelRatio));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = this.q.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.className = 'game-canvas';
    container.appendChild(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 1, 50000);

    // world
    this.terrain = new Terrain(this.map, this.renderer, this.q);
    this.scene.add(this.terrain.group);
    lap('terrain');
    this.water = createWater(this.terrain, this.map.def.water, this.q.name === 'high', opts.map);
    this.scene.add(this.water.mesh);
    this.trees = new Trees(this.terrain, this.map, this.q, this.renderer);
    this.scene.add(this.trees.group);
    lap('trees');
    this.env = new Environment(this.scene, this.map.def, this.q, this.q.name === 'high' ? this.renderer : undefined);
    this.env.hour = this.hour;
    this.weather = new WeatherSystem({ scene: this.scene, renderer: this.renderer, env: this.env, terrain: this.terrain, trees: this.trees, water: this.water, quality: this.q, mapId: opts.map });
    this.post = new PostFX(this.renderer, this.scene, this.camera, this.q);
    this.particles = new Particles(this.scene, this.q);
    this.particles.pxH = this.renderer.getDrawingBufferSize(new THREE.Vector2()).y;
    this.audio.mapId = opts.map;

    // city
    this.net = new RoadNetwork(this.terrain, this.trees);
    this.net.map = { id: opts.map };
    this.roads = new RoadRenderer(this.net, this.renderer);
    this.scene.add(this.roads.group);
    this.zones = new Zoning(this.net, this.terrain, this.scene);
    this.buildings = new Buildings(this.scene, this.terrain, this.trees, this.zones, this.net);
    this.sim = new Sim(opts.mode, this.buildings, this.zones, this.net, this.terrain, this.trees);
    lap('city');

    const start = this.startView();
    lap('start');
    const communeCount = Math.round(this.map.def.communes * (opts.mode === 'hippie' ? 2.2 : 1));
    const avoid = [{ x: start.x, z: start.z, r: 320 }];
    for (let t = 0; t <= 1; t += 0.05) avoid.push({ x: start.edge.x + (start.x - start.edge.x) * t, z: start.edge.z + (start.z - start.edge.z) * t, r: 140 });
    this.communes = new Communes(this.terrain, this.trees, opts.map, communeCount, this.map.def.seed + 5, opts.mode === 'hippie' ? 0.3 : 0.12, avoid);
    this.scene.add(this.communes.group);
    this.syncBlockers();
    lap('communes');
    this.sim.communePenalty = (x, z) => this.communes.penalty(x, z);

    this.traffic = new Traffic(this.scene, this.net, this.buildings, this.q.maxCars);
    this.peds = new Pedestrians(this.scene, this.net, this.buildings, this.terrain, this.communes, this.q.maxPeople);
    this.overlays = new Overlays(this);
    this.tools = new Tools(this);

    this.rts = new RTSCamera(this.camera, this.renderer.domElement, this.terrain, this.tools as PointerHandlers);
    this.rts.setView(start.x, start.z, IS_TOUCH ? 900 : 800, start.yaw, 0.72, true);

    // --- ambient life (codex) ---
    const ambientLife = new AmbientLife(this.scene, this.terrain, opts.map, this.q);
    ambientLife.setRoadNetwork(this.net);
    this.onFrame.push(dt => ambientLife.update(dt, this.camera, this.env.night, this.weather));
    const stopWithoutAmbient = this.stop.bind(this);
    let ambientDisposed = false;
    this.stop = () => {
      if (!ambientDisposed) { ambientLife.dispose(); ambientDisposed = true; }
      stopWithoutAmbient();
    };

    this.wireEvents();
    if (opts.restore) applySave(this, opts.restore);
    else this.seedRoad(start);
    lap('rest');
    window.addEventListener('resize', () => this.resize());
  }

  /** Art (fonts/atlases) must be ready before buildings spawn. */
  static async create(container: HTMLElement, opts: GameOptions) {
    await loadArt();
    return new Game(container, opts);
  }

  private startCache: { x: number; z: number; yaw: number; edge: { x: number; z: number } } | null = null;
  /** Find flat, dry, roomy land near the middle of the map for the first town. */
  private startView() {
    if (this.startCache) return this.startCache;
    const T = this.terrain;
    let best = { x: 0, z: 0 }, bestScore = -Infinity;
    for (let z = -HALF * 0.55; z <= HALF * 0.55; z += 150)
      for (let x = -HALF * 0.55; x <= HALF * 0.55; x += 150) {
        if (T.h(x, z) < 2) continue;
        let flat = 0;
        for (let k = 0; k < 36; k++) {
          const a = k * 2.399, r = 50 + (k / 36) * 330;
          const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
          const hh = T.h(px, pz);
          if (hh > 1.4 && T.slope(px, pz) < 0.12) flat++;
        }
        const score = flat - (Math.hypot(x, z) / HALF) * 8;
        if (score > bestScore) { bestScore = score; best = { x, z }; }
      }
    const e = this.map.def.entry;
    const edge = e === 'west' ? { x: -HALF + 14, z: best.z } : e === 'east' ? { x: HALF - 14, z: best.z } : e === 'north' ? { x: best.x, z: -HALF + 14 } : { x: best.x, z: HALF - 14 };
    const yaw = Math.atan2(edge.x - best.x, edge.z - best.z) + 0.5;
    this.startCache = { x: best.x, z: best.z, yaw, edge };
    return this.startCache;
  }

  /** The county starts with one road in from the outside world. */
  private seedRoad(start: { x: number; z: number; edge: { x: number; z: number } }) {
    const pts: V2[] = [];
    const a = start.edge, b = { x: start.x, z: start.z };
    const n = Math.max(6, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 400));
    for (let k = 0; k <= n; k++) pts.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n });
    // nudge points onto dry land
    for (const p of pts) {
      let tries = 0;
      while (this.terrain.h(p.x, p.z) < WATER + 1 && tries++ < 20) p.z += 12;
    }
    let prev = this.net.snap(pts[0].x, pts[0].z);
    for (let k = 1; k < pts.length; k++) {
      const end = { kind: 'free' as const, x: pts[k].x, z: pts[k].z };
      const c = lineCubic({ x: prev.x, z: prev.z }, pts[k]);
      const plan = this.net.plan(prev, c, 'stroad4');
      if (!plan.ok) break;
      const segs = this.net.build(prev, end, c, 'stroad4', 'Old County Road');
      if (!segs.length) break;
      const last = segs[segs.length - 1];
      const node = this.net.nodes.get(last.b)!;
      prev = { kind: 'node', id: node.id, x: node.x, z: node.z };
    }
  }

  syncBlockers() {
    const bl = this.communes.blockers();
    this.net.blockers = bl;
    this.zones.blockers = bl;
    this.zones.refreshBlockers();
  }

  // ------------------------------------------------------------------ events -> feed/ui
  ctx(extra: Partial<FeedContext> = {}): FeedContext {
    return {
      city: this.cityName, map: this.map.def.id, population: this.sim.population, money: this.sim.money === Infinity ? 1e9 : this.sim.money,
      naturePct: this.sim.naturePct, sprawlPct: this.sim.sprawlPct, season: this.weather.season, weather: this.weather.kind, ...extra,
    };
  }

  private wireEvents() {
    this.buildings.onComplete = ((orig) => (b: Bld) => {
      orig?.(b);
      if (b.zone !== 'resLow' && b.zone !== 'resHigh' && Math.random() < 0.35) this.feed.push('buildingOpened', { building: b.label, brand: b.brand });
      if (this.near(b.x, b.z, 500)) this.audio.play('build', 0.3);
    })(this.buildings.onComplete);
    this.buildings.onLevel = (b) => {
      if (Math.random() < 0.25) this.feed.push('buildingLeveled', { building: b.label, brand: b.brand, count: b.level });
      if (this.near(b.x, b.z, 400)) this.particles.emit('confetti', b.x, b.y + b.model.height, b.z, { count: 20, spread: 4 });
    };
    this.buildings.onDemolish = (b, reason) => {
      if (reason === 'road' && Math.random() < 0.6) this.feed.push('buildingDemolished', { building: b.label });
      if (this.selection?.kind === 'building' && this.selection.b === b) this.select(null);
    };
    this.sim.events.on('milestone', (m) => {
      if (m.kind === 'population') this.feed.push('populationMilestone', { count: m.value });
      if (m.kind === 'nature') this.feed.push('natureMilestone', { count: Math.round(m.value * 100) });
      if (m.kind === 'sprawl') this.feed.push('sprawlMilestone', { count: Math.round(m.value * 100) });
      this.ui.banner(m.label, m.kind === 'nature' ? 'The trees had it coming.' : m.kind === 'unlock' ? 'New stuff in the toolbar.' : this.cityName);
      this.audio.play('levelUp');
    });
    this.sim.events.on('lowMoney', () => this.feed.push('lowMoney'));
    this.sim.events.on('bankrupt', () => { this.feed.push('bankrupt'); this.ui.ending('bankrupt'); });
    this.sim.events.on('ending', () => this.ui.ending('sprawl'));
    this.traffic.onCrash = (cars, seg, drunk) => {
      this.feed.push(drunk ? 'drunkCrash' : 'crash', { road: seg?.name });
      const c = cars[0];
      if (c && this.near(c.x, c.z, 450)) {
        this.audio.play('crash', 0.8);
        this.floatText(drunk ? '💥🍺 DUI' : '💥 WRECK', new THREE.Vector3(c.x, c.y + 2, c.z), '#ff8a3a');
      }
    };
    this.traffic.onJam = (seg) => this.feed.push('trafficJam', { road: seg.name });
    this.traffic.onEmit = (kind, x, y, z, n) => this.particles.emit(kind, x, y, z, { count: n, spread: kind === 'cigarette' ? 0.2 : 1.5 });
    this.post.look && (this.weather.look = this.post.look);
    this.weather.onThunder = (delay, dist) => {
      setTimeout(() => this.audio.play('thunder', Math.max(0.15, 1 - dist / 2500)), delay * 1000);
    };
    this.weather.onLightning = (x, z, dist, bolt) => {
      if (bolt && dist < 1800) this.particles.emit('spark', x, this.terrain.h(x, z) + 1, z, { count: 24, spread: 2 });
    };
    this.weather.onChange = (kind, season) => {
      if (season !== this.lastSeason) { this.lastSeason = season; this.feed.push('seasonChange'); }
      else this.feed.push('weatherChange');
      void kind;
    };
  }
  private lastSeason = 'spring';

  near(x: number, z: number, r: number) {
    return Math.abs(x - this.rts.target.x) < r && Math.abs(z - this.rts.target.z) < r && this.rts.distance < r * 2;
  }

  onRoadBuilt(segs: RSeg[], plan: Plan) {
    const t = ROAD_TYPES[segs[0].type];
    this.audio.play('build', 0.6);
    const kind: FeedEventKind = t.id === 'highway' ? 'highwayBuilt' : t.centerTurn ? 'stroadBuilt' : plan.bridgeLen > 10 ? 'bridgeBuilt' : 'roadBuilt';
    if (Math.random() < (kind === 'roadBuilt' ? 0.25 : 0.7)) this.feed.push(kind, { road: segs[0].name, amount: plan.cost });
    // communes hate roads near them
    for (const c of this.communes.list) {
      if (c.state !== 'active') continue;
      const s = segs[0].samp.pts[0];
      if (Math.hypot(c.x - s.x, c.z - s.z) < 260 && Math.random() < 0.5) this.feed.push('communeProtest', { commune: c.name, road: segs[0].name });
    }
  }

  pushUndo(a: UndoAction) {
    this.undoStack.push(a);
    if (this.undoStack.length > 30) this.undoStack.shift();
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }

  undo() {
    const a = this.undoStack.pop();
    if (!a) return false;
    if (a.kind === 'build') {
      // splits may have renumbered segments; remove what's still there
      for (const id of a.segIds) if (this.net.segs.has(id)) this.net.removeSeg(id);
    } else {
      for (const p of a.prev) if (this.net.segs.has(p.id)) this.net.upgrade(p.id, p.type);
    }
    this.sim.refund(a.refund);
    this.tools.cancel();
    this.audio.play('bulldoze', 0.6);
    this.toast('Undone. The trees are still gone though.');
    return true;
  }

  onLaneAdded(segs: RSeg[], to: RoadTypeId) {
    this.audio.play('build');
    this.feed.push('laneAdded', { road: segs[0]?.name, count: ROAD_TYPES[to].lanesPerDir * 2 });
  }

  // ------------------------------------------------------------------ tool helpers
  toast(msg: string, bad = false) {
    this.ui.toast(msg, bad);
  }
  floatText(text: string, p: THREE.Vector3, color = '#c6f432') {
    this.ui.floatText(text, p, color);
  }

  buildingAt(p: THREE.Vector3): string | null {
    const b = this.buildings.at(p.x, p.z);
    return b ? b.label : null;
  }

  bulldozeAt(p: THREE.Vector3): boolean {
    const b = this.buildings.at(p.x, p.z);
    if (!b) return false;
    this.buildings.demolish(b, 'bulldozed');
    this.audio.play('bulldoze');
    this.particles.emit('dust', b.x, b.y + 2, b.z, { count: 50, spread: b.hw });
    return true;
  }

  canPlaceLandmark(id: LandmarkId, x: number, z: number): { ok: boolean; yaw: number; reason?: string } {
    const fp = landmarkFootprint(id);
    const r = (Math.max(fp.widthCells, fp.depthCells) * 8) / 2 + 2;
    const pick = this.net.pickSeg(x, z, r + 40);
    const yaw = pick ? (() => {
      const p = pick.seg.samp.pts[Math.min(pick.seg.samp.pts.length - 1, Math.round((pick.s / pick.seg.length) * (pick.seg.samp.pts.length - 1)))];
      return Math.atan2(p.x - x, p.z - z);
    })() : 0;
    if (!this.terrain.inBounds(x, z, r + 10)) return { ok: false, yaw, reason: 'Outside the county' };
    if (this.terrain.h(x, z) < WATER + 0.8) return { ok: false, yaw, reason: 'Not in the water (yet)' };
    if (this.net.pickSeg(x, z, r - 2)) return { ok: false, yaw, reason: 'Overlaps a road' };
    for (const b of this.buildings.near(x, z, r + 30)) if (Math.hypot(b.x - x, b.z - z) < r + Math.max(b.hw, b.hd)) return { ok: false, yaw, reason: `Overlaps ${b.label}` };
    if (this.communes.at(x, z)) return { ok: false, yaw, reason: 'Hippies live here' };
    return { ok: true, yaw };
  }

  placeLandmark(id: LandmarkId, p: THREE.Vector3) {
    const chk = this.canPlaceLandmark(id, p.x, p.z);
    if (!chk.ok) { this.toast(chk.reason ?? 'Nope', true); this.audio.play('error'); return false; }
    const cost = LANDMARK_COST[id];
    if (cost > this.sim.spendable()) { this.toast('Not enough money', true); this.audio.play('error'); return false; }
    this.sim.spend(cost, 'Landmark');
    const b = this.buildings.placeLandmark(id, p.x, p.z, chk.yaw);
    this.feed.push('buildingOpened', { building: b.label, brand: id });
    this.audio.play(id === 'slopCannon' ? 'cannon' : 'build');
    return true;
  }

  // ------------------------------------------------------------------ communes
  bribe(c: Commune) {
    const cost = this.communes.bribeCost(c);
    if (c.forever) { this.toast(`${c.name} laughs at your money. They've been here since 1969.`, true); return; }
    if (cost > this.sim.spendable()) { this.toast('Not enough money to bribe hippies', true); return; }
    this.sim.spend(cost, 'Commune payoff', 'communes');
    if (Math.random() < this.communes.bribeOdds(c)) {
      c.state = 'leaving';
      this.feed.push('communeBribed', { commune: c.name, amount: cost });
      this.toast(`${c.name} took the money and left in a cloud of patchouli.`);
      setTimeout(() => this.syncBlockers(), 4500);
    } else {
      c.stubborn = Math.min(1, c.stubborn + 0.12);
      this.feed.push('communeProtest', { commune: c.name });
      this.toast(`${c.name} spent your $${cost.toLocaleString()} on kombucha and stayed.`, true);
    }
  }

  sue(c: Commune) {
    if (c.forever) { this.toast('No court in America will touch them. They are forever.', true); return; }
    if (c.state === 'suing') return;
    const cost = this.communes.suitCost(c);
    if (cost > this.sim.spendable()) { this.toast('Not enough money for lawyers', true); return; }
    this.sim.spend(cost, 'Lawsuit', 'communes');
    c.state = 'suing';
    c.suitDays = this.sim.day + 20;
    c.suitOdds = this.communes.suitOdds(c);
    this.feed.push('communeSued', { commune: c.name, amount: cost });
  }

  private communeTick() {
    const day = this.sim.day;
    for (const c of this.communes.list) {
      if (c.state === 'suing' && day >= c.suitDays) {
        if (Math.random() < c.suitOdds) {
          c.state = 'leaving';
          this.feed.push('communeBribed', { commune: c.name, amount: 0 });
          this.ui.banner('Lawsuit won', `${c.name} has been evicted. The drum circle moves on.`);
          setTimeout(() => this.syncBlockers(), 4500);
        } else {
          c.state = 'active';
          c.stubborn = Math.min(1, c.stubborn + 0.15);
          this.feed.push('communeLawsuitLost', { commune: c.name });
          this.ui.banner('Lawsuit lost', `${c.name} won. The judge was wearing hemp.`);
        }
      }
      if (c.state === 'active' && day >= c.nextProtest) {
        c.nextProtest = day + (c.forever ? 18 : 35) + Math.random() * 40;
        const segs = this.net.segsNear(c.x - 300, c.z - 300, c.x + 300, c.z + 300).filter((s) => s.type !== 'highway');
        if (segs.length) {
          segs.sort((a, b) => Math.hypot(a.samp.pts[0].x - c.x, a.samp.pts[0].z - c.z) - Math.hypot(b.samp.pts[0].x - c.x, b.samp.pts[0].z - c.z));
          const s = segs[0];
          s.blocked = 30;
          this.feed.push('communeProtest', { commune: c.name, road: s.name });
        }
        if (c.forever && Math.random() < 0.3) this.feed.push('communeForever', { commune: c.name });
      }
    }
  }

  // ------------------------------------------------------------------ selection
  inspect(p: THREE.Vector3, e: PointerEvent) {
    this.ray.setFromCamera(this.ndc(e.clientX, e.clientY), this.camera);
    const car = this.traffic.pick(this.ray);
    if (car) return this.select({ kind: 'car', c: car });
    const ped = this.peds.pick(this.ray);
    if (ped) return this.select({ kind: 'ped', p: ped });
    const b = this.buildings.pickRay(this.ray.ray) ?? this.buildings.at(p.x, p.z);
    if (b) return this.select({ kind: 'building', b });
    const c = this.communes.at(p.x, p.z);
    if (c) return this.select({ kind: 'commune', c });
    const s = this.net.pickSeg(p.x, p.z, 1);
    if (s) return this.select({ kind: 'road', s: s.seg });
    this.select(null);
  }

  select(sel: Selection) {
    this.selection = sel;
    this.ui.select(sel);
    if (sel) this.audio.play('click', 0.5);
  }

  private ndc(x: number, y: number) {
    const r = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.post.setSize(w, h);
    this.particles.pxH = this.renderer.getDrawingBufferSize(new THREE.Vector2()).y;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------ loop
  start() {
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      this.timer.update();
      const dt = Math.min(0.1, this.timer.getDelta());
      this.frame(dt);
    };
    loop();
  }

  stop() {
    cancelAnimationFrame(this.raf);
  }

  private dayTick = 0;
  private emitT = 0;
  frame(dt: number, render = true) {
    this.time += dt;
    const spd = SPEEDS[this.sim.speed];
    this.rts.update(dt);
    this.hour = (this.hour + (dt * spd * 24) / 360) % 24;
    this.env.hour = this.hour;
    // tighter near plane when zoomed in, deeper when zoomed out (depth precision)
    const nearWant = THREE.MathUtils.clamp(this.rts.distance * 0.008, 1, 10);
    if (Math.abs(this.camera.near - nearWant) > 0.05) {
      this.camera.near = nearWant;
      this.camera.updateProjectionMatrix();
    }
    this.env.update(0, this.rts.target, this.rts.distance, this.camera.position);
    this.sim.update(dt);
    const t = this.sim.time(this.hour);
    this.weather.update(dt, t, this.camera, spd, this.rts.distance);
    const fxs = this.weather.effects();
    this.traffic.speedMul = fxs.speedMul;
    this.traffic.crashMul = fxs.crashMul;
    this.sim.weatherBuildMul = fxs.buildMul;
    this.sim.weatherDemandMul = fxs.demandMul;
    this.peds.outdoorMul = fxs.outdoorPeopleMul * (this.env.night > 0.5 ? 0.6 : 1);
    if (Math.floor(this.sim.day) !== this.dayTick) {
      this.dayTick = Math.floor(this.sim.day);
      this.communeTick();
    }
    this.terrain.updateLOD(this.camera.position);
    this.trees.setDayOfYear(t.dayOfYear);
    this.trees.update(this.time, this.rts.target, this.rts.distance);
    this.zones.update();
    this.roads.update();
    const jobs = this.sim.jobsFilled;
    this.traffic.update(dt, spd, this.hour, this.sim.population, jobs, this.rts.target);
    this.peds.population = this.sim.population;
    this.peds.update(dt, spd, this.rts.target, this.rts.distance, this.time);
    this.communes.update(dt, this.env.night, this.time);
    this.emitT -= dt;
    if (this.emitT <= 0 && spd > 0) {
      this.emitT = 0.6;
      const tgt = this.rts.target;
      if (this.rts.distance < 900) {
        for (const b of this.buildings.near(tgt.x, tgt.z, 450)) {
          if (b.state !== 'active' || !b.model.emitters.length) continue;
          const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
          for (const em of b.model.emitters) {
            if (Math.random() > 0.5) continue;
            const [lx, ly, lz] = em.pos;
            this.particles.emit(em.kind === 'cigarette' ? 'cigarette' : em.kind === 'fire' ? 'fire' : em.kind === 'steam' ? 'steam' : em.kind === 'sparkle' ? 'confetti' : 'smoke', b.x + lx * c + lz * s, b.y + ly, b.z - lx * s + lz * c, { count: em.kind === 'cigarette' ? 1 : 3, spread: 0.6 });
          }
        }
      }
    }
    if (this.emitT === 0.6 && spd > 0 && this.rts.distance < 900) {
      const tgt = this.rts.target;
      for (const c of this.communes.list) {
        if (c.state === 'gone' || Math.abs(c.x - tgt.x) > 500 || Math.abs(c.z - tgt.z) > 500) continue;
        for (const em of c.emitters) {
          if (Math.random() > 0.6) continue;
          const [lx, ly, lz] = em.pos;
          this.particles.emit(em.kind === 'fire' ? 'fire' : 'smoke', c.x + lx, c.group.position.y + ly, c.z + lz, { count: em.kind === 'fire' ? 4 : 2, spread: em.kind === 'fire' ? 0.8 : 0.3, size: em.kind === 'fire' ? 0.8 : 0.5 });
        }
      }
    }
    this.tools.update();
    this.overlays.update(dt);
    this.particles.night = this.env.night;
    this.particles.wind.copy(this.weather.wind);
    this.particles.update(dt, this.camera);
    for (const f of this.onFrame) f(dt);
    this.terrain.flush();

    // night lighting
    const n = this.env.night;
    this.env.lightPollution = Math.min(1, this.buildings.list.size / 900);
    setBuildingNight(n);
    this.roads.setNight(n);
    this.zones.setNight(n);
    this.traffic.setNight(n);
    this.peds.setNight(n);
    if (n > 0.6 && !this.nightWas) { this.nightWas = true; if (Math.random() < 0.5) this.feed.push('nightfall'); }
    if (n < 0.3) this.nightWas = false;

    const wu = this.water.mat.uniforms;
    wu.uTime.value = this.time;
    wu.uSunDir.value.copy(this.env.sunDirection);
    wu.uNight.value = n;
    wu.uSky.value.copy(this.env.fog.color);
    wu.uSunColor.value.copy(this.env.sunColor);
    wu.uSkyTop.value.copy(this.env.hemi.color).multiplyScalar(0.55 * (1 - n * 0.9)).lerp(this.env.fog.color, this.env.overcast * 0.8);
    this.roads.setWet(this.weather.wet);
    this.post.aoRadius = THREE.MathUtils.clamp(this.rts.distance * 0.011, 2.2, 16);
    wu.uPollution.value = Math.min(0.7, (1 - this.sim.naturePct) * 0.6 + this.buildings.counts().active / 4000);

    this.audio.update(dt, {
      zoom: Math.min(1, this.rts.distance / 1500), nature: this.sim.naturePct, traffic: Math.min(1, this.traffic.count / 400),
      construction: Math.min(1, this.buildings.counts().building / 20), people: Math.min(1, this.peds.peds.length / 150), night: n,
      weather: this.weather.kind, weatherIntensity: this.weather.intensity, season: this.weather.season,
    });
    if (render) {
      this.post.render(n);
      // mirror for the next frame's water (1 frame of lag is invisible). Rendering
      // it after the main pass guarantees the shadow maps exist and are current.
      this.water.reflection?.render(this.renderer, this.scene, this.camera, [this.water.mesh]);
    }
  }
}

function defaultCityName(map: MapId) {
  const opts: Record<MapId, string[]> = {
    appalachia: ['Holler County', 'Slopington', 'Possum Trot', 'New Wheeling', 'Coalburg'],
    norcal: ['Golden Slop', 'San Slopcisco', 'Malibu Heights', 'Redwood Commons'],
    florida: ['Gator Gulch', 'Port Slop Lucie', 'Florida Mantown', 'Sawgrass Springs'],
  };
  const a = opts[map];
  return a[Math.floor(Math.random() * a.length)];
}

export { buildingMaterial };
