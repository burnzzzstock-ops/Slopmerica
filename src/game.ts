// Game: owns the scene and every subsystem, and runs the frame loop.
import { milestoneAt, nameUnlock, unlockPop } from './sim/milestones';
import * as THREE from 'three';
import { defaultQuality, GLOW, HALF, IS_TOUCH, MIN_RENDER_SCALE, nightLift, presetPixelRatio, QUALITY, Quality, saveQuality, storedQuality, WATER } from './config';
import type { FeedContext, FeedEventKind, LandmarkId } from './contracts';
import { generateMap, MapData, MapId } from './world/maps';
import { Terrain } from './world/terrain';
import { Trees } from './world/trees';
import { atmo, seasonOf } from './world/seasons';
import { GroundDetail } from './world/groundDetail';
import { createWater } from './world/water';
import { Environment } from './world/sky';
import { WeatherSystem } from './world/weather';
import { PointerHandlers, RTSCamera } from './render/camera';
import { PostFX } from './render/post';
import { applyLowGrade, lowExposure } from './render/lowGrade';
import { Particles } from './render/particles';
import { AudioEngine } from './audio/audio';
import { COUNTY_ROAD, RoadNetwork, RSeg, Plan } from './roads/network';
import { RoadRenderer } from './roads/roadMesh';
import { ROAD_TYPES, RoadTypeId } from './roads/roadTypes';
import { Zoning, type ZCell } from './zones/zoning';
import { Buildings, Bld, isZoned } from './sim/buildings';
import { footprintHitsBuilding, footprintHitsRoad, frontageCandidates, rectCorners, type Frontage } from './sim/frontage';
import { Sim, Mode, SPEEDS, DAY_SECONDS, usd } from './sim/sim';
import { Traffic, Car } from './agents/traffic';
import { Parking } from './agents/parking';
import { Pedestrians, Ped } from './agents/pedestrians';
import { Communes, Commune } from './agents/communes';
import { EXT } from './ext/registry';
import './ext/index';
import { AmbientLife } from './agents/ambient';
import { brandById } from './art/brands';
import { Tools } from './tools/tools';
import { setBuildingNight, loadArt, landmarkFootprint } from './buildings/generator';
import { lineCubic, V2 } from './core/math';
import { Overlays } from './render/overlays';
import { buildingMaterial } from './buildings/generator';
import { CivicLayer } from './civic/layer';
import { VaultScenery } from './vault/scenery';
import { legacyStart, pickStart, type StartSite } from './world/startSite';
import { loadKitArt, setKitNight } from './buildings/kitGenerator';
import { applySave, type SaveData } from './sim/save';
import { crumb } from './ui/bugreport';
import { FrameProfiler } from './core/prof';
import type { EmergencyView } from './sim/services';
import { NightLights, practicalPools } from './world/nightLights';

/** a building's brand as players read it (buildings store the brand id, e.g. 'tacoBull') */
const brandName = (id?: string) => brandById(id)?.name;

export type GameMode = Mode;

/**
 * Which good site a new county starts on: #start=<n> or #start=random in the
 * URL; otherwise random for players and the best one for automated runs, so
 * the regression tests stay repeatable.
 */
function startPick(): 'best' | 'random' | number {
  const m = /(?:^|[#&])start=([a-z0-9]+)/.exec(location.hash);
  if (m) return m[1] === 'random' ? 'random' : m[1] === 'best' ? 'best' : +m[1] || 0;
  return navigator.webdriver ? 'best' : 'random';
}

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
  | { kind: 'lot'; cell: ZCell }
  | null;

export interface FeedSink {
  push(kind: FeedEventKind, extra?: Partial<FeedContext>): void;
}

export interface UiSink {
  toast(msg: string, bad?: boolean): void;
  floatText(text: string, p: THREE.Vector3, color: string): void;
  select(sel: Selection): void;
  banner(title: string, sub: string): void;
  /** a milestone reached (its index in MILESTONES): what it unlocked and where, without covering the map */
  milestone?(i: number): void;
  /** a city-wide service emergency just began: get the player's attention (and time) */
  emergency?(e: EmergencyView): void;
  ending(kind: 'sprawl' | 'bankrupt'): void;
}

/**
 * One undoable purchase. The rule is the same for all of them: undo removes
 * what was built and refunds exactly what it cost (net of any grant).
 */
export type UndoAction =
  | { kind: 'build'; segIds: number[]; refund: number; label: string; trees?: number[]; w?: Record<number, number> }
  | { kind: 'upgrade'; prev: { id: number; type: RoadTypeId }[]; refund: number; label: string; w?: Record<number, number> }
  | { kind: 'place'; bldId: number; refund: number; label: string; trees?: number[] };

/** landmark names and icons (Landmarks panel, the "Placing …" badge) */
export const LANDMARKS: { id: LandmarkId; name: string; icon: string }[] = [
  { id: 'slopCannon', name: 'The Slop Cannon', icon: '💥' },
  { id: 'slop69Field', name: 'Slop 69 Field', icon: '⚾' },
  { id: 'pigCabanaResort', name: 'Pig Cabana Resort', icon: '🐷' },
  { id: 'neuralFlyDatacenter', name: 'Neural Fly Datacenter', icon: '🪰' },
  { id: 'propaneParadise', name: 'Propane Paradise', icon: '🔥' },
  { id: 'fillErUpMegaStation', name: 'Fill Er Up Mega Station', icon: '⛽' },
  { id: 'megachurch', name: 'Megachurch', icon: '⛪' },
  { id: 'waterTower', name: 'Water Tower', icon: '🗼' },
];

for (const l of LANDMARKS) nameUnlock(`lm:${l.id}`, `${l.icon} ${l.name}`);

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
  readonly groundDetail: GroundDetail;
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
  /** live parked cars (drawn only) */
  readonly parking: Parking;
  private parkView = new THREE.Frustum();
  private parkMat = new THREE.Matrix4();
  private parkPt = new THREE.Vector3();
  private parkSphere = new THREE.Sphere();
  readonly peds: Pedestrians;
  readonly civic: CivicLayer;
  /** the Asset Vault's road furniture (gantries, overpasses, cell towers, the bus stop to nowhere) */
  readonly vaultScenery: VaultScenery;
  readonly ambientLife: AmbientLife;
  /** the building problem icon under a screen point, and what it means (set by services) */
  problemAt?: (clientX: number, clientY: number) => { id: number; text: string | null } | null;
  /** a landmark, service or depot with no road link to the road network, and why (set by services) */
  linkProblem?: (b: Bld) => 'noRoad' | 'noLink' | null;
  /** what that costs it and what to do (set by services) */
  roadLinkText?: (b: Bld) => string;
  /** does this road join the road network that reaches the highway (set by services) */
  linkedRoad?: (s: RSeg) => boolean;
  /** what failing services are doing to the city today (set by services) */
  emergency?: () => EmergencyView | null;
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
  private waterT = 0;
  private waterNear = 0;
  private ray = new THREE.Raycaster();
  private nightWas = false;
  /** pools of light from street lamps, shopfronts, entrances and yards after dark */
  readonly nightLights: NightLights;
  private lampSig = '';
  private lampCheck = 0;
  readonly perf = { fps: 0, frameMs: 0, renderMs: 0, calls: 0, triangles: 0, resolution: 1, quality: 'high' as Quality['name'] };
  private perfSamples = 0;
  private perfWindowMs = 0;
  private perfWindowFrames = 0;
  private qualityBenchmarkMs = 0;
  private qualityBenchmarkN = 0;
  private qualityElapsed = 0;
  private qualityBenchmarkDone = false;
  private resolutionCooldown = 0;
  /** Settings → Resolution: 'auto' lowers it to hold the frame rate, 'full' never does */
  resolutionMode: 'auto' | 'full' = 'auto';
  /** a resolution drop on trial: kept only if frames got faster */
  private resTrial: { before: number; from: number } | null = null;
  /** seconds (perf clock) until the scaler may try lowering again */
  private resNoGain = 0;
  private perfClock = 0;
  /** the fastest one-second average frame time seen: the display's refresh cadence */
  private cadenceMs = Infinity;
  private dynamicScale = 1;
  pendingQuality: Quality['name'] | null = null;
  /** where each frame's time goes; its slowest frames go into bug reports */
  readonly prof = new FrameProfiler();
  /** when to look for an all-black picture (performance.now() ms) */
  private blackChecks: number[] = [];
  onFrame: ((dt: number) => void)[] = [];

  constructor(public container: HTMLElement, public opts: GameOptions) {
    const selected = opts.quality ?? defaultQuality();
    this.q = { ...selected, lod: [...selected.lod] };
    this.perf.quality = this.q.name;
    this.qualityBenchmarkDone = !!opts.quality || !!storedQuality();
    let tLap = performance.now();
    const lap = (n: string) => { const t = performance.now(); console.info(`[boot] ${n} ${(t - tLap).toFixed(0)}ms`); tLap = t; };
    this.map = generateMap(opts.map);
    lap('map');
    this.cityName = opts.cityName || defaultCityName(opts.map);

    // with post-processing the scene is multisampled offscreen, so the canvas itself needn't be
    // Without post-processing the default framebuffer does the MSAA (phones too:
    // tile GPUs resolve it on-chip); with post, the HDR target does.
    this.renderer = new THREE.WebGLRenderer({ antialias: !this.q.post, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, presetPixelRatio(this.q.name)));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = this.q.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.info.autoReset = false;
    this.renderer.domElement.className = 'game-canvas';
    container.appendChild(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 1, 50000);
    // Settings → Field of view (playtest: "hard to see what you're doing")
    try { const f = Number(localStorage.getItem('slopmerica.fov')); if (f >= 35 && f <= 75) this.camera.fov = f; } catch { /* default */ }
    this.camera.updateProjectionMatrix();

    // world
    this.terrain = new Terrain(this.map, this.renderer, this.q);
    this.scene.add(this.terrain.group);
    lap('terrain');
    this.water = createWater(this.terrain, this.map.def.water, this.q.name === 'high' || this.q.name === 'ultra', opts.map);
    this.scene.add(this.water.mesh);
    this.trees = new Trees(this.terrain, this.map, this.q, this.renderer);
    this.terrain.onReshape = (a, b, c, d) => this.trees.resettle(a, b, c, d);
    this.scene.add(this.trees.group);
    lap('trees');
    this.env = new Environment(this.scene, this.map.def, this.q, this.q.name === 'high' || this.q.name === 'ultra' ? this.renderer : undefined);
    this.env.hour = this.hour;
    this.weather = new WeatherSystem({ scene: this.scene, renderer: this.renderer, env: this.env, terrain: this.terrain, trees: this.trees, water: this.water, quality: this.q, mapId: opts.map });
    this.post = new PostFX(this.renderer, this.scene, this.camera, this.q);
    this.particles = new Particles(this.scene, this.q);
    this.particles.pxH = this.renderer.getDrawingBufferSize(new THREE.Vector2()).y;
    this.audio.mapId = opts.map;
    this.audio.quality = this.q.name; // sizes the street-sound voice pool (Low = phone = fewer voices)

    // city
    this.net = new RoadNetwork(this.terrain, this.trees);
    this.net.map = { id: opts.map };
    this.roads = new RoadRenderer(this.net, this.renderer);
    this.scene.add(this.roads.group);
    this.zones = new Zoning(this.net, this.terrain, this.scene);
    this.buildings = new Buildings(this.scene, this.terrain, this.trees, this.zones, this.net);
    this.sim = new Sim(opts.mode, this.buildings, this.zones, this.net, this.terrain, this.trees);
    this.nightLights = new NightLights(this.q.name === 'low' ? 512 : 1024, () => practicalPools(this.roads.lampSpots, this.buildings.list.values()));
    lap('city');

    const start = this.startView();
    lap('start');
    const communeCount = Math.round(this.map.def.communes * (opts.mode === 'hippie' ? 2.2 : 1));
    const avoid = [{ x: start.x, z: start.z, r: 320 }];
    // keep communes off the county road's way in (a straight one: exactly as
    // before sites were saved, so old saves get their communes back where they were)
    if (start.route) {
      const way = start.route;
      for (let k = 1; k < way.length; k++)
        for (let t = 0; t < 1; t += 0.2) avoid.push({ x: way[k - 1].x + (way[k].x - way[k - 1].x) * t, z: way[k - 1].z + (way[k].z - way[k - 1].z) * t, r: 140 });
    } else for (let t = 0; t <= 1; t += 0.05) avoid.push({ x: start.edge.x + (start.x - start.edge.x) * t, z: start.edge.z + (start.z - start.edge.z) * t, r: 140 });
    this.communes = new Communes(this.terrain, this.trees, opts.map, communeCount, this.map.def.seed + 5, opts.mode === 'hippie' ? 0.3 : 0.12, avoid);
    this.scene.add(this.communes.group);
    this.net.blockerReason = (id) => this.communeRoadRule(id);
    this.net.buildingsUnder = (pts, hw) => {
      const under = this.buildings.underPavement(pts, hw);
      const keep = under.find((b) => !isZoned(b));
      if (keep) return { reason: `${keep.label} is in the way: bulldoze it first, or go around.`, demolish: 0 };
      return { demolish: under.length, ids: under.map((b) => b.id) };
    };
    // zoned lots are dimmed while their zone is waiting for demand (overlay only)
    this.zones.growable = (z) => this.tools.zoneDemand(z).ok;
    this.syncBlockers();
    this.groundDetail = new GroundDetail(this.terrain, this.map, this.q, {
      roads: this.net, zones: this.zones, buildings: this.buildings, communes: this.communes,
    });
    this.scene.add(this.groundDetail.group);
    lap('communes');
    this.sim.communePenalty = (x, z) => this.communes.penalty(x, z);

    this.traffic = new Traffic(this.scene, this.net, this.buildings, this.q.maxCars);
    this.traffic.groundAt = (x, z) => this.terrain.h(x, z);
    // look pass: the vehicle renderer throws dust off gravel roads (it asks what the road under a car is, twice a second at most)
    this.traffic.renderer.surfaceAt = (x, z) => (this.net.pickSeg(x, z, 3)?.seg.type === 'gravel' ? 'gravel' : 'paved');
    // live parking: cars stay in lot stalls and driveways (drawn only; the traffic pass)
    this.parking = new Parking(this.buildings, this.traffic.renderer, this.q.maxCars);
    this.parking.groundAt = (x, z) => this.terrain.h(x, z);
    this.parking.paint = (kind, rnd) => Traffic.paint(kind, rnd);
    this.parking.inView = (x, z) => this.parkView.intersectsSphere(this.parkSphere.set(this.parkPt.set(x, this.terrain.h(x, z) + 1, z), 3));
    this.traffic.parking = this.parking;
    this.roads.setSignalStateProvider((nodeId, segId) => {
      const s = this.traffic.signalState(nodeId);
      if (!s) return 'green';
      const cycle = 13.5; // traffic's 11 second green plus 2.5 second clear
      const t = s.t % (cycle * s.phases);
      const phase = Math.floor(t / cycle);
      if (s.phaseOf.get(segId) !== phase) return 'red';
      return t - phase * cycle > 11 ? 'yellow' : 'green';
    });
    this.peds = new Pedestrians(this.scene, this.net, this.buildings, this.terrain, this.communes, this.q.maxPeople);
    // crosswalks: people wait for a gap (or the walk phase), cars stop for people on them
    this.traffic.crosswalkWalkers = (node, seg) => this.peds.crosswalkWalkers(node, seg);
    this.peds.canCross = (node, segs, secs, impatient) => this.traffic.canCross(node, segs, secs, impatient);
    // Civic Foundry street furniture, street trees and bus shelters (streamed in; low quality skips it)
    this.civic = new CivicLayer(this);
    if (this.q.name !== 'low') this.civic.load();
    this.vaultScenery = new VaultScenery(this);
    this.overlays = new Overlays(this);
    this.tools = new Tools(this);

    this.rts = new RTSCamera(this.camera, this.renderer.domElement, this.terrain, this.tools as PointerHandlers);
    try { this.rts.edgeScroll = localStorage.getItem('slopmerica.edgeScroll') !== '0'; } catch { /* private mode: default on */ }
    try { if (localStorage.getItem('slopmerica.resolution') === 'full') this.resolutionMode = 'full'; } catch { /* default auto */ }
    try {
      this.audio.musicOn = localStorage.getItem('slopmerica.music') !== '0';
      const mv = Number(localStorage.getItem('slopmerica.musicVol'));
      if (mv > 0 && mv <= 1) this.audio.musicVolume = mv;
    } catch { /* defaults: on, 55% */ }
    this.rts.setView(start.x, start.z, IS_TOUCH ? 900 : 800, start.yaw, 0.72, true);

    // --- ambient life (codex) ---
    const ambientLife = this.ambientLife = new AmbientLife(this.scene, this.terrain, opts.map, this.q);
    ambientLife.setRoadNetwork(this.net);
    this.onFrame.push(dt => {
      // a handful of boats for a small town, more as it grows
      ambientLife.boatCap = Math.round(THREE.MathUtils.clamp(1 + this.sim.population / 120, 1, 40));
      ambientLife.update(dt, this.camera, this.env.night, this.weather);
    });

    this.wireEvents();
    this.net.events.on('segSplit', ({ old, into }) => this.followSplit(old, into));
    // extension systems (transit, services, ...): init before a save restores their data
    for (const s of EXT.systems) s.init?.(this);
    this.sim.events.on('day', (d) => {
      for (const s of EXT.systems) s.daily?.(this, d);
      // demand moved: re-shade which zoned lots are waiting
      if (this.zones.overlayActive) this.zones.markOverlayDirty();
    });
    this.sim.events.on('week', () => { for (const s of EXT.systems) s.weekly?.(this); });
    if (opts.restore) applySave(this, opts.restore);
    else this.seedRoad(start);
    lap('rest');
    window.addEventListener('resize', () => this.resize());
  }

  /** Art (fonts/atlases) must be ready before buildings spawn. */
  static async create(container: HTMLElement, opts: GameOptions) {
    await Promise.all([loadArt(), loadKitArt()]);
    return new Game(container, opts);
  }

  private startCache: StartSite | null = null;
  /** Back over the town: the middle of what's been built, or where the county road arrives. */
  goHome() {
    let x = 0, z = 0, n = 0;
    for (const b of this.buildings.list.values()) { x += b.x; z += b.z; n++; }
    const S = this.startView();
    if (n) { x /= n; z /= n; } else { x = S.x; z = S.z; }
    this.rts.setView(x, z, Math.max(420, Math.min(900, this.rts.distance)), this.rts.yaw, 0.85);
  }

  /**
   * The town site and the county road's way in (src/world/startSite.ts): a
   * saved city keeps its own; saves from before sites were saved rebuild the
   * old pick; a new county gets one of the map's good sites at random.
   */
  startView(): StartSite {
    if (this.startCache) return this.startCache;
    const entry = this.map.def.entry, saved = this.opts.restore?.start;
    this.startCache = saved ? { ...saved } : this.opts.restore ? legacyStart(this.terrain, entry) : pickStart(this.terrain, entry, startPick());
    return this.startCache;
  }

  /** The county starts with one road in from the outside world. */
  private seedRoad(start: StartSite) {
    // the county highway predates you: it runs through land you don't own yet
    const allowed = this.net.allowed;
    this.net.allowed = null;
    try { this.buildSeedRoad(start); } finally { this.net.allowed = allowed; }
  }

  private buildSeedRoad(start: StartSite) {
    let pts: V2[] = [];
    if (start.route) pts = start.route.map((p) => ({ ...p }));
    else {
      const a = start.edge, b = { x: start.x, z: start.z };
      const n = Math.max(6, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 400));
      for (let k = 0; k <= n; k++) pts.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n });
      // nudge points onto dry land
      for (const p of pts) {
        let tries = 0;
        while (this.terrain.h(p.x, p.z) < WATER + 1 && tries++ < 20) p.z += 12;
      }
    }
    let prev = this.net.snap(pts[0].x, pts[0].z);
    let split = 0;
    for (let k = 1; k < pts.length; k++) {
      const end = { kind: 'free' as const, x: pts[k].x, z: pts[k].z };
      // a smooth curve through the route's corners (Catmull-Rom), or straight if that won't build
      const p0 = pts[Math.max(0, k - 2)], p3 = pts[Math.min(pts.length - 1, k + 1)];
      const a = { x: prev.x, z: prev.z }, b = pts[k];
      const curved = { p0: a, p1: { x: a.x + (b.x - p0.x) / 6, z: a.z + (b.z - p0.z) / 6 }, p2: { x: b.x - (p3.x - a.x) / 6, z: b.z - (p3.z - a.z) / 6 }, p3: b };
      let c = start.route ? curved : lineCubic(a, b);
      let plan = this.net.plan(prev, c, 'stroad4');
      if (!plan.ok && start.route) { c = lineCubic(a, b); plan = this.net.plan(prev, c, 'stroad4'); }
      // a leg that won't build: try it as two shorter ones before giving up
      if (!plan.ok && start.route && split < 12 && Math.hypot(b.x - a.x, b.z - a.z) > 60) {
        pts.splice(k, 0, { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 });
        split++;
        k--;
        continue;
      }
      if (!plan.ok) { console.warn(`[start] the county road stops ${Math.round(Math.hypot(b.x - start.x, b.z - start.z))} m short: ${plan.reason}`); break; }
      const segs = this.net.build(prev, end, c, 'stroad4', COUNTY_ROAD);
      if (!segs.length) break;
      const last = segs[segs.length - 1];
      const node = this.net.nodes.get(last.b)!;
      prev = { kind: 'node', id: node.id, x: node.x, z: node.z };
    }
  }

  /** Why a road can't cross a commune, and the two ways through (or none). */
  communeRoadRule(id: number): string {
    const c = this.communes.list.find((x) => x.id === id);
    if (!c) return 'Commune land: roads can’t cross it.';
    if (c.forever) return `Protected land: ${c.name} is here forever. Roads must go around.`;
    if (c.state === 'suing') return `Commune land: roads can’t cross ${c.name}. Your lawsuit is in court (${Math.max(0, Math.ceil(c.suitDays - this.sim.day))} days left).`;
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    return `Commune land: roads can’t cross ${c.name}. Pay them off ${usd(this.communes.bribeCost(c))} (${pct(this.communes.bribeOdds(c))} chance) or sue ${usd(this.communes.suitCost(c))} (${pct(this.communes.suitOdds(c))}, 20 days). Click here for options.`;
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
      if (b.zone !== 'resLow' && b.zone !== 'resHigh' && Math.random() < 0.35) this.feed.push('buildingOpened', { building: b.label, brand: brandName(b.brand) });
      this.traffic.grandOpening(b); // a new drive-thru: the town lines up (traffic pass)
      if (this.near(b.x, b.z, 500)) this.audio.play('build', 0.3);
    })(this.buildings.onComplete);
    this.buildings.onLevel = ((orig) => (b: Bld) => {
      orig?.(b); // (a system's own, e.g. the College's first graduates)
      if (Math.random() < 0.25) this.feed.push('buildingLeveled', { building: b.label, brand: brandName(b.brand), count: b.level });
      if (this.near(b.x, b.z, 400)) this.particles.emit('confetti', b.x, b.y + b.model.height, b.z, { count: 20, spread: 4 });
    })(this.buildings.onLevel);
    this.buildings.onDemolish = (b, reason) => {
      if (reason === 'road' && Math.random() < 0.6) this.feed.push('buildingDemolished', { building: b.label });
      if (this.selection?.kind === 'building' && this.selection.b === b) this.select(null);
      // the people who lived there are gone too (abandoned homes were already counted)
      if ((b.zone === 'resLow' || b.zone === 'resHigh') && b.abandoned === undefined && b.occ > 0)
        this.sim.lose(b.occ, reason === 'fire' ? 'fire' : reason === 'storm surge' || reason === 'wildfire' ? 'disaster' : 'bulldozed');
    };
    this.sim.events.on('milestone', (m) => {
      if (m.kind === 'population') this.feed.push('populationMilestone', { count: m.value });
      if (m.kind === 'nature') this.feed.push('natureMilestone', { count: Math.round(m.value * 100) });
      if (m.kind === 'sprawl') this.feed.push('sprawlMilestone', { count: Math.round(m.value * 100) });
      if (m.kind === 'tier' && this.ui.milestone) this.ui.milestone(m.value);
      else this.ui.banner(m.label, m.kind === 'nature' ? 'The trees had it coming.' : m.kind === 'unlock' ? 'New stuff in the toolbar.' : this.cityName);
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
    this.traffic.onDriveThruSpill = (b, seg) => this.feed.push('driveThruLine', { brand: brandName(b.brand) || b.label, road: seg?.name });
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

  /** after a road goes down; `quiet`: one street of several (a grid), so no sound, news or toast. Returns buildings razed. */
  onRoadBuilt(segs: RSeg[], plan: Plan, quiet = false) {
    // a road through homes and shops bulldozes them (the planner already
    // refused roads through services and landmarks)
    let razed = 0;
    for (const s of segs) {
      const pts = s.over ? s.samp.pts.filter((_, i) => s.hs[i] - s.ground[i] < 3) : s.samp.pts;
      for (const b of this.buildings.underPavement(pts, ROAD_TYPES[s.type].width / 2)) if (isZoned(b) && this.buildings.list.has(b.id)) { this.buildings.demolish(b, 'road'); razed++; }
    }
    if (razed) crumb(`road bulldozed ${razed} building${razed === 1 ? '' : 's'}`);
    if (quiet) return razed;
    if (razed) this.toast(`${razed} building${razed === 1 ? '' : 's'} bulldozed for the road`);
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
    return razed;
  }

  pushUndo(a: UndoAction) {
    // what each piece is worth of the refund (its share of the price), so Undo pays for what is still there
    if (a.kind !== 'place') {
      a.w = {};
      for (const id of a.kind === 'build' ? a.segIds : a.prev.map((p) => p.id)) {
        const sg = this.net.segs.get(id);
        if (sg) a.w[id] = Math.max(1, sg.length * ROAD_TYPES[sg.type].costPerM);
      }
    }
    this.undoStack.push(a);
    if (this.undoStack.length > 30) this.undoStack.shift();
  }

  /** A street joined mid-piece and split it in two new ids: every undo that remembered the old id follows the road. */
  private followSplit(old: number, into: [RSeg, RSeg]) {
    const total = into[0].length + into[1].length || 1;
    for (const a of this.undoStack) {
      if (a.kind === 'place' || !a.w || !(old in a.w)) continue;
      const w = a.w[old];
      delete a.w[old];
      into.forEach((sg, i) => { a.w![sg.id] = w * (i === 0 ? into[0].length : into[1].length) / total; });
      if (a.kind === 'build') a.segIds = a.segIds.flatMap((id) => id === old ? into.map((sg) => sg.id) : [id]);
      else { const t = a.prev.find((p) => p.id === old)!.type; a.prev = a.prev.flatMap((p) => p.id === old ? into.map((sg) => ({ id: sg.id, type: t })) : [p]); }
    }
  }

  /** What Undo pays back now: the price, less the share of any piece that has since been bulldozed. */
  private undoRefund(a: UndoAction): number {
    if (a.kind === 'place' || !a.w) return a.refund;
    let all = 0, alive = 0;
    for (const [id, w] of Object.entries(a.w)) { all += w; if (this.net.segs.has(Number(id))) alive += w; }
    return all > 0 ? Math.round(a.refund * alive / all) : a.refund;
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }

  /** what Undo would reverse, e.g. "Sheriff's Office (+$11,000 back)"; null when nothing */
  get undoLabel(): string | null {
    const a = this.undoStack[this.undoStack.length - 1];
    return a ? `${a.label} (+${usd(this.undoRefund(a))} back)` : null;
  }

  undo() {
    const a = this.undoStack.pop();
    if (!a) return false;
    // what it pays back is worked out before anything is taken down: only what is still standing
    const refund = this.undoRefund(a);
    if (a.kind !== 'place' && refund === 0 && a.refund > 0) { this.toast(`Can't undo ${a.label}: it's already gone.`, true); this.tools.cancel(); return true; }
    if (a.kind === 'build') {
      // splits are followed (segSplit), bulldozed pieces are just gone: remove what's still there
      for (const id of a.segIds) if (this.net.segs.has(id)) this.net.removeSeg(id);
      if (a.trees) this.trees.replant(a.trees);
    } else if (a.kind === 'upgrade') {
      for (const p of a.prev) if (this.net.segs.has(p.id)) this.net.upgrade(p.id, p.type);
    } else {
      const b = this.buildings.list.get(a.bldId);
      // already gone (burned, bulldozed): nothing to take back, nothing to refund
      if (!b) { this.toast(`Can't undo ${a.label}: it's already gone.`, true); this.tools.cancel(); return true; }
      this.buildings.demolish(b, 'undone');
      if (a.trees) this.trees.replant(a.trees);
    }
    this.sim.refund(refund, `Undo: ${a.label}`);
    crumb(`undo ${a.label}`);
    this.tools.cancel();
    this.audio.play('bulldoze', 0.6);
    this.toast(`Undone: ${a.label}, ${usd(refund)} back${refund < a.refund ? ' (part of it was already bulldozed)' : ''}${'trees' in a && a.trees?.length ? ', trees replanted' : ''}.`);
    return true;
  }

  // ------------------------------------------------------------------ commands
  // One validated path per player action, whichever UI asked for it (the map
  // tool, the inspector, a hotkey): same price, same checks, same undo.

  /** Price of ONE MORE LANE on these segments (all go to `next`). */
  quoteUpgrade(segs: RSeg[], next: RoadTypeId) {
    let cost = 0, grant = 0;
    for (const s of segs) {
      const c = s.length * (ROAD_TYPES[next].costPerM - ROAD_TYPES[s.type].costPerM * 0.3);
      cost += c;
      grant += c * ROAD_TYPES[next].fedGrant;
    }
    return { cost: Math.round(cost), grant: Math.round(grant), net: Math.round(cost - grant) };
  }

  /** ONE MORE LANE: widen `segs` one step. Rejects without changing anything. */
  upgradeRoads(segs: RSeg[], at?: THREE.Vector3): { ok: boolean; reason?: string } {
    const first = segs[0];
    const next = first && ROAD_TYPES[first.type].next;
    const fail = (reason: string) => { this.toast(reason, true); this.audio.play('error'); return { ok: false, reason }; };
    if (!first) return { ok: false, reason: 'No road there' };
    if (!next) return fail('MAX LANES. For now. (Try a highway.)');
    const q = this.quoteUpgrade(segs, next);
    if (q.net > this.sim.spendable()) return fail('Not enough money for one more lane');
    const prev = segs.map((s) => ({ id: s.id, type: s.type }));
    for (const s of segs) this.net.upgrade(s.id, next);
    this.pushUndo({ kind: 'upgrade', prev, refund: q.net, label: 'ONE MORE LANE' });
    this.sim.spend(q.cost, 'ONE MORE LANE', 'construction');
    this.sim.earn(q.grant, 'grants');
    if (q.grant > 0 && at) this.floatText(`+$${q.grant.toLocaleString()} Federal Slop Grant`, at, '#9dff3c');
    this.onLaneAdded(segs, next);
    return { ok: true };
  }

  /** Bulldoze one road segment (20% salvage, like the map tool). */
  bulldozeRoad(seg: RSeg) {
    if (!this.net.segs.has(seg.id)) return;
    this.net.removeSeg(seg.id);
    this.sim.refund(Math.round(seg.length * ROAD_TYPES[seg.type].costPerM * 0.2), `Bulldozed ${seg.name} (20% back)`);
    this.audio.play('bulldoze');
  }

  onLaneAdded(segs: RSeg[], to: RoadTypeId) {
    this.audio.play('build');
    this.feed.push('laneAdded', { road: segs[0]?.name, count: ROAD_TYPES[to].lanesPerDir * (ROAD_TYPES[to].oneWay ? 1 : 2) });
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

  canPlaceLandmark(id: LandmarkId, x: number, z: number, yawIn?: number): { ok: boolean; yaw: number; reason?: string; blocker?: Bld } {
    const fp = landmarkFootprint(id);
    const hw = (fp.widthCells * 8) / 2, hd = (fp.depthCells * 8) / 2;
    const r = Math.max(hw, hd) + 2;
    const pick = yawIn === undefined ? this.net.pickSeg(x, z, r + 40) : null;
    const yaw = yawIn ?? (pick ? (() => {
      const p = pick.seg.samp.pts[Math.min(pick.seg.samp.pts.length - 1, Math.round((pick.s / pick.seg.length) * (pick.seg.samp.pts.length - 1)))];
      return Math.atan2(p.x - x, p.z - z);
    })() : 0);
    const need = unlockPop.landmark(id);
    if (this.sim.mode !== 'sandbox' && this.sim.peakPop < need) return { ok: false, yaw, reason: `Unlocks at ${need.toLocaleString()} people (${milestoneAt(need)?.name ?? 'a later milestone'})` };
    if (!this.terrain.inBounds(x, z, r + 10)) return { ok: false, yaw, reason: 'Outside the county' };
    if (this.net.allowed && !this.net.allowed(x, z)) return { ok: false, yaw, reason: "You don't own this land yet. Buy it in 🏞️ Land." };
    const cs = rectCorners(x, z, hw, hd, yaw);
    let lo = Infinity, hi = -Infinity;
    for (const p of [...cs, { x, z }]) { const h = this.terrain.h(p.x, p.z); lo = Math.min(lo, h); hi = Math.max(hi, h); }
    if (lo < WATER + 0.8) return { ok: false, yaw, reason: 'Not in the water (yet)' };
    if (hi - lo > Math.max(8, Math.max(hw, hd) * 0.4)) return { ok: false, yaw, reason: 'Too steep here: find flatter ground' };
    if (footprintHitsRoad(this.net, x, z, hw, hd, yaw)) return { ok: false, yaw, reason: 'Overlaps a road' };
    const hit = footprintHitsBuilding(this.buildings, x, z, hw, hd, yaw);
    if (hit) return { ok: false, yaw, reason: `Overlaps ${hit.label}`, blocker: hit };
    if (this.communes.at(x, z)) return { ok: false, yaw, reason: 'Hippies live here' };
    const broke = this.sim.cantAfford(LANDMARK_COST[id]);
    if (broke) return { ok: false, yaw, reason: broke };
    return { ok: true, yaw };
  }

  /**
   * Where a landmark goes for a cursor at (x, z): square to the nearest road
   * and facing it (sliding along to the nearest spot that fits), or, with no
   * road near, right there: landmarks can come first and roads after.
   */
  landmarkSpot(id: LandmarkId, x: number, z: number): { x: number; z: number; yaw: number; ok: boolean; reason?: string; front?: Frontage; blocker?: Bld } {
    const hd = (landmarkFootprint(id).depthCells * 8) / 2;
    let first: string | undefined;
    let blocker: Bld | undefined;
    for (const f of frontageCandidates(this.net, x, z, hd, hd + 30)) {
      const c = this.canPlaceLandmark(id, f.x, f.z, f.yaw);
      if (c.ok) return { x: f.x, z: f.z, yaw: f.yaw, ok: true, front: f };
      // money, land and unlocks don't change by sliding along the road
      if (c.reason && /Needs \$|money|own this land|county|Unlocks at/i.test(c.reason)) return { x: f.x, z: f.z, yaw: f.yaw, ok: false, reason: c.reason, front: f };
      if (first === undefined) { first = c.reason; blocker = c.blocker; }
    }
    const here = this.canPlaceLandmark(id, x, z);
    if (first && !here.ok) return { x, z, yaw: here.yaw, ok: false, reason: first, blocker };
    return { x, z, yaw: here.yaw, ok: here.ok, reason: here.reason, blocker: here.blocker };
  }

  placeLandmark(id: LandmarkId, p: THREE.Vector3) {
    const spot = this.landmarkSpot(id, p.x, p.z);
    if (!spot.ok) { this.toast(spot.reason ?? 'Nope', true); this.audio.play('error'); return false; }
    const cost = LANDMARK_COST[id];
    const name = LANDMARKS.find((l) => l.id === id)?.name ?? 'Landmark';
    this.sim.spend(cost, name);
    this.trees.recordCuts();
    const b = this.buildings.placeLandmark(id, spot.x, spot.z, spot.yaw);
    this.pushUndo({ kind: 'place', bldId: b.id, refund: cost, label: name, trees: this.trees.takeCuts() });
    this.feed.push('buildingOpened', { building: b.label, brand: name });
    this.audio.play(id === 'slopCannon' ? 'cannon' : 'build');
    // it can go down before its road, but it does nothing until one links it to the network
    const off = this.linkProblem?.(b);
    if (off) this.toast(`🚧 ${name} is built, but ${off === 'noRoad' ? 'no road reaches it' : "its road doesn't join the rest of your roads"}. It does nothing until it's connected to the road network: draw a road to it (🛣️ Roads).`, true);
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
          // the commune lost the county's suit (the feed's lines for it say so; its buy-out
          // lines, posted here before, thanked them for $0)
          this.feed.push('communeLawsuitLost', { commune: c.name });
          this.ui.banner('Lawsuit won', `${c.name} has been evicted. The drum circle moves on.`);
          setTimeout(() => this.syncBlockers(), 4500);
        } else {
          c.state = 'active';
          c.stubborn = Math.min(1, c.stubborn + 0.15);
          // the commune won: the feed has no lines for that yet (communeLawsuitLost's all say the
          // commune lost), so only the banner says so
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
    // an empty zoned lot: say why nothing has grown there yet
    const lot = this.zones.cellsNear(p.x, p.z, 5).filter((c) => c.valid && c.zone && !c.bld).sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
    if (lot) return this.select({ kind: 'lot', cell: lot });
    this.select(null);
  }

  /**
   * Why an empty zoned lot hasn't grown, most important reason first, from
   * the same rules the builders use: its zone needs demand of +5, only
   * street-front lots start buildings, and builders start a limited number
   * of sites a day, spread over every empty lot of that zone.
   */
  lotStatus(c: ZCell): { primary: string; demand: { key: 'res' | 'com' | 'ind' | 'off'; v: number } | null } {
    const z = c.zone!;
    const d = this.tools.zoneDemand(z);
    const key = z === 'resLow' || z === 'resHigh' ? 'res' : z === 'comLow' || z === 'comHigh' ? 'com' : z === 'industry' ? 'ind' : 'off';
    const sign = (v: number) => (v > 0 ? `+${v}` : `${v}`);
    if (!d.ok) return { primary: `Waiting for demand. ${d.letter} demand is ${sign(d.v)}; builders start at +5.`, demand: { key, v: d.v } };
    if (c.row > 0) return { primary: 'Back lot. Only lots facing the street start new buildings; this one fills when a bigger building grows in front of it.', demand: null };
    const lots = this.zones.candidates(z, []).length;
    const perDay = Math.min(5, (0.8 + this.sim.population / 800) * this.sim.growthMul);
    return { primary: `In line. Builders want this zone (${d.letter} ${sign(d.v)}) and start about ${perDay.toFixed(1)} buildings a day across ${lots} empty street-front lot${lots === 1 ? '' : 's'} of every kind that's in demand.`, demand: { key, v: d.v } };
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

  /** Save a new preset and apply safe render changes immediately; reload completes asset budgets. */
  requestQuality(name: Quality['name']) {
    const next = QUALITY[name];
    saveQuality(name);
    this.pendingQuality = name === this.q.name ? null : name;
    this.renderer.shadowMap.enabled = next.shadows;
    this.env.sun.castShadow = next.shadows;
    if (this.env.sun.shadow.mapSize.x !== next.shadowMap) {
      this.env.sun.shadow.mapSize.set(next.shadowMap, next.shadowMap);
      this.env.sun.shadow.map?.dispose();
      this.env.sun.shadow.map = null;
    }
    this.setRenderScale(this.dynamicScale, presetPixelRatio(name));
    this.blackChecks.push(performance.now() + 2500);
    this.prof.note(`quality → ${name}`);
    return this.pendingQuality !== null;
  }

  /** Settings → Resolution */
  setResolutionMode(m: 'auto' | 'full') {
    this.resolutionMode = m;
    this.resTrial = null;
    this.resNoGain = 0;
    try { localStorage.setItem('slopmerica.resolution', m); } catch { /* not remembered */ }
    if (m === 'full') this.setRenderScale(1);
  }

  /** what the canvas actually renders at, against the screen's own pixels */
  renderInfo() {
    const c = this.renderer.domElement, dpr = window.devicePixelRatio || 1;
    const sw = Math.round(c.clientWidth * dpr), sh = Math.round(c.clientHeight * dpr);
    return { buffer: `${c.width}×${c.height}`, screen: `${sw}×${sh}`, share: Math.round((c.width / Math.max(1, sw)) * 100), dpr, dynamic: this.dynamicScale, mode: this.resolutionMode };
  }

  private setRenderScale(scale: number, presetRatio = presetPixelRatio(this.pendingQuality ?? this.q.name)) {
    this.dynamicScale = THREE.MathUtils.clamp(scale, MIN_RENDER_SCALE, 1);
    this.perf.resolution = this.dynamicScale;
    const pr = Math.min(window.devicePixelRatio || 1, presetRatio) * this.dynamicScale;
    if (Math.abs(this.renderer.getPixelRatio() - pr) < 0.035) return;
    // Resizing the canvas clears it. Done after a frame was drawn, the page
    // showed an empty world under the HUD until the next frame (the review's
    // one-frame blackout at 1:33), so apply it right before the next render.
    this.pendingRatio = pr;
  }
  private pendingRatio: number | null = null;
  private applyPendingRatio() {
    if (this.pendingRatio === null) return;
    this.renderer.setPixelRatio(this.pendingRatio);
    this.pendingRatio = null;
    this.resize();
  }

  private sampleFrame(intervalMs: number, workMs: number) {
    if (document.hidden || intervalMs <= 0) return;
    this.perfSamples++;
    this.perf.renderMs += (workMs - this.perf.renderMs) * 0.12;
    this.perfWindowMs += intervalMs;
    this.perfWindowFrames++;
    if (this.perfWindowMs >= 1000) {
      this.perf.fps = this.perfWindowFrames * 1000 / this.perfWindowMs;
      this.perf.frameMs = this.perfWindowMs / this.perfWindowFrames;
      this.perfWindowMs = this.perfWindowFrames = 0;
      if (this.perfSamples > 80) this.cadenceMs = Math.min(this.cadenceMs, this.perf.frameMs);
    }
    if (!this.qualityBenchmarkDone) {
      this.qualityElapsed += intervalMs;
      if (this.qualityElapsed > 500 && intervalMs < 2000) {
        this.qualityBenchmarkMs += intervalMs;
        this.qualityBenchmarkN++;
      }
      if (this.qualityElapsed >= 3000) {
        this.qualityBenchmarkDone = true;
        const avg = this.qualityBenchmarkMs / Math.max(1, this.qualityBenchmarkN);
        const caps = this.renderer.capabilities;
        const deviceCeiling: Quality['name'] = IS_TOUCH || !caps.isWebGL2 || caps.maxTextureSize < 8192 ? 'medium' : 'ultra';
        let chosen: Quality['name'] = avg > 34 ? 'low' : avg > 24 ? 'medium' : avg > 16 ? 'high' : 'ultra';
        if (deviceCeiling === 'medium' && (chosen === 'high' || chosen === 'ultra')) chosen = IS_TOUCH ? 'low' : 'medium';
        // Apply live (no reload mid-city); asset budgets pick it up next launch.
        if (chosen !== this.q.name) this.requestQuality(chosen);
        saveQuality(chosen, true);
      }
    }
    this.resolutionCooldown -= intervalMs / 1000;
    this.perfClock += intervalMs / 1000;
    if (this.resolutionMode === 'full') { if (this.dynamicScale < 0.99) this.setRenderScale(1); return; }
    if (this.resolutionCooldown <= 0 && this.perfSamples > 80 && this.perf.frameMs > 0) {
      const ms = this.perf.frameMs;
      // a drop that didn't make frames faster (the time goes to the simulation,
      // not to pixels) only made the picture soft: undo it and stop trying a while
      if (this.resTrial) {
        const t = this.resTrial;
        this.resTrial = null;
        if (ms > t.before * 0.92) {
          this.setRenderScale(t.from);
          this.resNoGain = this.perfClock + 60;
          this.prof.note(`resolution drop didn't help (${t.before.toFixed(1)} → ${ms.toFixed(1)} ms): back to ${Math.round(t.from * 100)}%`);
          this.resolutionCooldown = 3;
          return;
        }
      }
      // Aim for 60 fps, or the display's own rate if it's slower. A 60 Hz
      // screen never shows frames faster than 16.7 ms, so "under 15.2 ms"
      // never came true there and a lowered resolution never came back.
      const cad = Number.isFinite(this.cadenceMs) ? this.cadenceMs : 16.7;
      const slow = Math.max(18.5, cad * 1.25), fast = Math.max(15.2, cad * 1.1);
      if (ms > slow && this.dynamicScale > MIN_RENDER_SCALE + 0.01 && this.perfClock >= this.resNoGain) {
        this.resTrial = { before: ms, from: this.dynamicScale };
        this.setRenderScale(this.dynamicScale - (ms > 25 ? 0.12 : 0.07));
        this.resolutionCooldown = 3;
      } else if (ms < fast && this.perf.renderMs < fast && this.dynamicScale < 0.99) {
        // Recover promptly from startup shader-compilation spikes. A large
        // performance margin permits a larger step; near the target, climb
        // slowly so the scale does not bounce between two levels.
        const headroom = ms < Math.max(12.5, cad * 1.03) && this.perf.renderMs < 12.5;
        this.setRenderScale(this.dynamicScale + (headroom ? 0.1 : 0.04));
        this.resolutionCooldown = headroom ? 1.5 : 3;
      } else this.resolutionCooldown = 1.5;
    }
  }

  /**
   * Safety net for GPUs that draw nothing through the post effects: sample
   * the picture just drawn and, if a daylight frame is black everywhere, draw
   * straight to the screen instead. Returns what it found (for tests).
   */
  checkBlackFrame(): string {
    const gl = this.renderer.getContext();
    if (gl.isContextLost()) return 'context lost'; // reads come back as zeros; main.ts handles it
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, px = new Uint8Array(4);
    let lit = 0;
    for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) {
      gl.readPixels(Math.floor((w * (i + 0.5)) / 5), Math.floor((h * (j + 0.5)) / 5), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      if (px[0] + px[1] + px[2] > 12) lit++;
    }
    if (lit > 0) return 'ok';
    if (this.post.active) {
      this.post.turnOff('the picture came out black with them on');
      crumb('black frame: turned post effects off');
      console.warn('SLOPMERICA: the picture came out black with post effects on; drawing without them.');
      this.blackChecks.unshift(performance.now() + 1500);
      return 'black: post effects off';
    }
    // still black with nothing in between: that is a bug to report
    console.error(`Black frame even without post effects (${gpuName(gl)}, ${this.q.name})`);
    return 'black without post effects';
  }

  // ------------------------------------------------------------------ loop
  start() {
    let last = performance.now();
    this.blackChecks = [last + 2500, last + 6000, last + 12000];
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      const began = performance.now();
      const interval = began - last;
      last = began;
      const dt = Math.min(0.1, interval / 1000);
      this.frame(dt);
      this.sampleFrame(interval, performance.now() - began);
    };
    loop();
  }

  stop() {
    cancelAnimationFrame(this.raf);
  }

  private dayTick = 0;
  private emitT = 0;
  frame(dt: number, render = true) {
    const P = this.prof;
    P.begin();
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
    P.lap('camera+sky');
    const dayWas = Math.floor(this.sim.day);
    this.sim.update(dt);
    if (Math.floor(this.sim.day) !== dayWas) P.note(Math.floor(this.sim.day) % 7 === 0 ? 'new week' : 'new day');
    P.lap('sim');
    const t = this.sim.time(this.hour);
    this.weather.update(dt, t, this.camera, spd, this.rts.distance);
    this.groundDetail.update(this.time, this.rts.target, this.rts.distance, {
      season: this.weather.season, snowCover: this.weather.snowCover, wind: this.weather.wind,
    });
    const fxs = this.weather.effects();
    this.traffic.speedMul = fxs.speedMul;
    this.traffic.crashMul = fxs.crashMul;
    this.sim.weatherBuildMul = fxs.buildMul;
    this.sim.weatherDemandMul = fxs.demandMul;
    this.peds.outdoorMul = fxs.outdoorPeopleMul * (this.env.night > 0.5 ? 0.6 : 1);
    P.lap('weather');
    if (Math.floor(this.sim.day) !== this.dayTick) {
      this.dayTick = Math.floor(this.sim.day);
      this.communeTick();
    }
    P.lap('communes');
    this.terrain.updateLOD(this.camera.position);
    this.trees.setDayOfYear(t.dayOfYear);
    this.trees.update(this.time, this.rts.target, this.rts.distance);
    P.lap('terrain+trees');
    this.zones.update();
    this.roads.update();
    P.lap('zones+roads');
    const jobs = this.sim.jobsFilled;
    this.traffic.update(dt, spd, this.hour, this.sim.population, jobs, this.rts.target);
    this.parkView.setFromProjectionMatrix(this.parkMat.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse));
    this.parking.update(dt, this.hour, this.rts.target.x, this.rts.target.z, this.rts.distance, () => this.traffic.renderer.stats().active);
    P.lap('traffic');
    this.peds.population = this.sim.population;
    this.peds.update(dt, spd, this.rts.target, this.rts.distance, this.time);
    this.civic.update(dt);
    this.vaultScenery.update(dt);
    P.lap('people');
    this.communes.update(dt, this.env.night, this.time, this.camera.position);
    this.emitT -= dt;
    if (this.emitT <= 0 && spd > 0) {
      this.emitT = 0.6;
      const tgt = this.rts.target;
      // fireplaces and wood stoves only burn when it's cold: never in Florida,
      // mostly winter on the Golden Coast, autumn through spring in the hollers
      const season = seasonOf(Math.floor(this.sim.day) % 365), mapId = this.map.def.id;
      const chimneyP = mapId === 'florida' ? 0 : season === 'winter' ? 0.45 : mapId === 'appalachia' && season !== 'summer' ? 0.2 : 0;
      if (this.rts.distance < 900) {
        for (const b of this.buildings.near(tgt.x, tgt.z, 450)) {
          if (b.state !== 'active' || !b.model.emitters.length) continue;
          const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
          for (const em of b.model.emitters) {
            // (look pass, scripts/yellowflash.mjs) a prop's flame burns on every tick: skipping half of them
            // left gaps, so barrels and torches blinked on and off at night
            if (em.kind !== 'fire' && Math.random() > (em.kind === 'chimney' ? chimneyP : 0.5)) continue;
            const [lx, ly, lz] = em.pos;
            // prop flames at 0.6 size: a default fire puff is 3 m across, over a 0.7 m barrel
            this.particles.emit(em.kind === 'cigarette' ? 'cigarette' : em.kind === 'fire' ? 'fire' : em.kind === 'steam' ? 'steam' : em.kind === 'sparkle' ? 'confetti' : 'smoke', b.x + lx * c + lz * s, b.y + ly, b.z - lx * s + lz * c, { count: em.kind === 'cigarette' ? 1 : 2, spread: em.kind === 'fire' ? 0.3 : 0.6, size: em.kind === 'fire' ? 0.6 : 1 });
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
    P.lap('communes');
    this.tools.update();
    this.overlays.update(dt);
    this.particles.night = this.env.night;
    this.particles.wind.copy(this.weather.wind);
    this.particles.update(dt, this.camera);
    P.lap('tools+particles');
    {
      const simDays = (dt * spd) / DAY_SECONDS;
      for (const s of EXT.systems) {
        s.frame?.(this, dt, simDays);
        P.lap(s.id);
      }
    }
    for (const f of this.onFrame) f(dt);
    P.lap('hud+autosave');
    this.terrain.flush();

    // night lighting
    const n = this.env.night;
    GLOW.value = 1 / nightLift(n, this.env.moonLight);
    this.env.lightPollution = Math.min(1, this.buildings.list.size / 900);
    setBuildingNight(n);
    setKitNight(n);
    this.roads.setNight(n);
    this.zones.setNight(n);
    this.traffic.setNight(n);
    // look pass: the weather the cars show (exhaust in the cold, spray in rain)
    this.traffic.renderer.setEnvironment({ temperature: this.weather.temperature, wet: this.weather.wet, rain: atmo.uRain.value, snow: this.weather.snowCover });
    this.peds.setNight(n);
    if (n > 0.6 && !this.nightWas) { this.nightWas = true; if (Math.random() < 0.5) this.feed.push('nightfall'); }
    if (n < 0.3) this.nightWas = false;
    // repaint the pools when the lamps or the lit lots change (checked once a second)
    if ((this.lampCheck -= dt) <= 0) {
      this.lampCheck = 1;
      let lit = 0, sum = 0;
      for (const b of this.buildings.list.values()) if (b.state === 'active' && b.abandoned === undefined) { lit++; sum = (sum + b.id * 131) % 1000003; }
      let at = 0;
      for (const L of this.roads.lampSpots) at = (at + Math.round(L.x * 3 + L.z * 7)) % 1000003;
      const sig = `${this.roads.lampSpots.length}:${at}:${lit}:${sum}`;
      if (sig !== this.lampSig) { this.lampSig = sig; this.nightLights.invalidate(); }
    }
    this.nightLights.update(dt, n);

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

    // water around the view, for the creek (sampled twice a second)
    this.waterT -= dt;
    if (this.waterT <= 0) {
      this.waterT = 0.5;
      const T = this.rts.target, r = Math.max(60, this.rts.distance * 0.35);
      let wet = 0;
      for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) if (this.terrain.h(T.x + i * r / 2, T.z + j * r / 2) < WATER) wet++;
      this.waterNear = Math.min(1, wet / 6);
    }
    this.audio.update(dt, {
      zoom: Math.min(1, this.rts.distance / 1500), nature: this.sim.naturePct, water: this.waterNear, traffic: Math.min(1, this.traffic.count / 400),
      construction: Math.min(1, this.buildings.counts().building / 20), people: Math.min(1, this.peds.peds.length / 150), night: n,
      weather: this.weather.kind, weatherIntensity: this.weather.intensity, season: this.weather.season,
    });
    // street sound follows the real cars near the camera (src/audio/streetAudio.ts); re-picks its voices 4x a second
    this.audio.street(dt, this.traffic.cars, this.rts, this.weather.wet, spd);
    P.lap('lighting+audio');
    if (render) {
      this.applyPendingRatio();
      this.renderer.info.reset();
      wu.uReflOn.value = this.water.reflection?.shouldRender(this.camera) ? 1 : 0;
      // Low quality renders straight to the canvas: the grade's exposure (the weather's dimming or brightening, times the night lift)
      // rides on the tone map, since there is no grade pass to apply it. (Low used to take only the night lift, so a storm or a
      // heat wave exposed like a clear day.)
      this.renderer.toneMappingExposure = 0.95 * (this.post.active ? 1 : lowExposure(this.env, this.post.look));
      // ... and its tint rides on the two lights that carry the ambient and the key (render/lowGrade.ts)
      if (!this.post.active) applyLowGrade(this.env, this.post.look);
      this.post.render(n);
      P.lap('render');
      if (this.blackChecks.length && performance.now() >= this.blackChecks[0] && !document.hidden) {
        this.blackChecks.shift();
        if (this.hour > 7.5 && this.hour < 17.5) this.checkBlackFrame();
      }
      // A mirror pass before the main pass can bind a shadow sampler before
      // three.js has created its shadow texture. Reuse the previous reflection
      // for this frame and refresh it after the main scene has rendered.
      this.water.reflection?.render(this.renderer, this.scene, this.camera, [this.water.mesh]);
      P.lap('water reflection');
      this.perf.calls = this.renderer.info.render.calls;
      this.perf.triangles = this.renderer.info.render.triangles;
    }
    P.end(() => `day ${Math.floor(this.sim.day)} ${String(Math.floor(this.hour)).padStart(2, '0')}:${String(Math.floor((this.hour % 1) * 60)).padStart(2, '0')} · speed ${this.sim.speed} · ${this.tools.active} · zoom ${Math.round(this.rts.distance)} · ${this.buildings.list.size} bld, ${this.traffic.count} cars, pop ${this.sim.population}`);
  }
}

/** the GPU's name for a log line, when the browser shares it */
function gpuName(gl: WebGLRenderingContext | WebGL2RenderingContext) {
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  } catch { return 'unknown GPU'; }
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
