// Atmosphere Lab: builds the world the way src/game.ts does (LOD terrain,
// streamed trees, water, env with image-based lighting) and wires in
// WeatherSystem, PostFX, Particles and AudioEngine the same way too.
// Hash params (all optional): map, day, hour, weather, q=low|high, cam=start|hero|close|far|top
// or cam=x,z,dist,yaw,pitch, ui=0, moon (0..1), lp (0..1), tilt=1, play=1, speed (days/s),
// hspeed (hours/s), city (0..1), fx=<particle kind>.
// Scripting: window.__atmo.go({ day, hour, weather, cam, ... }) sets, settles and steps frames.
import '../style.css';
import * as THREE from 'three';
import { defaultQuality, HALF, QUALITY } from '../config';
import { generateMap, MAPS, type MapData, type MapId } from '../world/maps';
import { Terrain } from '../world/terrain';
import { Trees } from '../world/trees';
import { createWater } from '../world/water';
import { Environment } from '../world/sky';
import { RTSCamera } from '../render/camera';
import { WeatherSystem } from '../world/weather';
import { dateLabel, seasonOf } from '../world/seasons';
import { PostFX } from '../render/post';
import { Particles } from '../render/particles';
import { AudioEngine } from '../audio/audio';
import type { GameTime, ParticleKind, SfxKind, SoundMix, WeatherKind } from '../contracts';

const WEATHER: WeatherKind[] = ['clear', 'cloudy', 'rain', 'storm', 'snow', 'blizzard', 'fog', 'heatwave', 'hurricane', 'wildfireSmoke'];
const PARTICLES: ParticleKind[] = ['smoke', 'cigarette', 'fire', 'dust', 'spark', 'steam', 'confetti', 'money', 'splash'];
const SFX: SfxKind[] = ['click', 'build', 'bulldoze', 'zone', 'cash', 'error', 'notify', 'crash', 'honk', 'siren', 'thunder', 'cannon', 'levelUp'];

function readHash() {
  const out: Record<string, string> = {};
  for (const part of location.hash.replace('#', '').split('&')) {
    const [k, v] = part.split('=');
    if (k) out[k] = decodeURIComponent(v ?? '1');
  }
  return out;
}
const P = readHash();
const num = (k: string, d: number) => (P[k] !== undefined && P[k] !== '' && !Number.isNaN(+P[k]) ? +P[k] : d);

/** Flat, dry, roomy land near the middle of the map (same search the game uses for the first town). */
function startView(t: Terrain, map: MapData) {
  let best = { x: 0, z: 0 }, bestScore = -Infinity;
  for (let z = -HALF * 0.55; z <= HALF * 0.55; z += 150)
    for (let x = -HALF * 0.55; x <= HALF * 0.55; x += 150) {
      if (t.h(x, z) < 2) continue;
      let flat = 0;
      for (let k = 0; k < 36; k++) {
        const a = k * 2.399, r = 50 + (k / 36) * 330;
        const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        if (t.h(px, pz) > 1.4 && t.slope(px, pz) < 0.12) flat++;
      }
      const score = flat - (Math.hypot(x, z) / HALF) * 8;
      if (score > bestScore) { bestScore = score; best = { x, z }; }
    }
  const e = map.def.entry;
  const edge = e === 'west' ? { x: -HALF + 14, z: best.z } : e === 'east' ? { x: HALF - 14, z: best.z } : e === 'north' ? { x: best.x, z: -HALF + 14 } : { x: best.x, z: HALF - 14 };
  return { x: best.x, z: best.z, yaw: Math.atan2(edge.x - best.x, edge.z - best.z) + 0.5 };
}

class Lab {
  readonly q = P.q === 'low' ? QUALITY.low : P.q === 'high' ? QUALITY.high : defaultQuality();
  readonly mapId: MapId = (MAPS.find((m) => m.id === P.map)?.id ?? 'appalachia') as MapId;
  readonly map: MapData;
  readonly scene = new THREE.Scene();
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
  readonly rts: RTSCamera;
  readonly terrain: Terrain;
  readonly trees: Trees;
  readonly water: ReturnType<typeof createWater>;
  readonly env: Environment;
  readonly weather: WeatherSystem;
  readonly post: PostFX;
  readonly particles: Particles;
  readonly audio = new AudioEngine();
  readonly time: GameTime = { day: 0, dayOfYear: 0, year: 0, hour: 15.5 };
  readonly start: { x: number; z: number; yaw: number };
  playing = P.play === '1';
  daysPerSec = num('speed', 0.4);
  hoursPerSec = num('hspeed', 0);
  city = num('city', 0);
  nature = 1;
  /** Freeze the render loop (scripts use it to hold a lightning frame for a screenshot). */
  paused = false;
  fx: ParticleKind | null = (PARTICLES as string[]).includes(P.fx) ? (P.fx as ParticleKind) : null;
  private fxTimer = 0;
  private clock = new THREE.Timer();
  private t = 0;
  private fps = 60;
  private mix: SoundMix = { zoom: 0.5, nature: 1, traffic: 0, construction: 0, people: 0, night: 0, weather: 'clear', weatherIntensity: 0, season: 'spring' };
  onTick?: () => void;

  constructor(container: HTMLElement) {
    this.map = generateMap(this.mapId);
    this.renderer = new THREE.WebGLRenderer({ antialias: this.q.post ? false : true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
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

    this.terrain = new Terrain(this.map, this.renderer, this.q);
    this.scene.add(this.terrain.group);
    this.water = createWater(this.terrain, this.map.def.water, this.q.name === 'high', this.mapId);
    this.scene.add(this.water.mesh);
    this.trees = new Trees(this.terrain, this.map, this.q, this.renderer);
    this.scene.add(this.trees.group);
    this.env = new Environment(this.scene, this.map.def, this.q, this.q.name === 'high' ? this.renderer : undefined);
    this.weather = new WeatherSystem({ scene: this.scene, renderer: this.renderer, env: this.env, terrain: this.terrain, trees: this.trees, water: this.water, quality: this.q, mapId: this.mapId });
    this.post = new PostFX(this.renderer, this.scene, this.camera, this.q);
    this.particles = new Particles(this.scene, this.q);
    this.particles.pxH = this.renderer.getDrawingBufferSize(new THREE.Vector2()).y;
    this.weather.look = this.post.look;
    this.weather.onThunder = (delay, dist) => setTimeout(() => this.audio.play('thunder', Math.max(0.15, 1 - dist / 2500)), delay * 1000);
    if (P.ui !== '0') this.weather.onChange = (k, s) => toast(`${s.toUpperCase()} · ${k}`);
    this.audio.mapId = this.mapId;

    const noop = () => {};
    this.rts = new RTSCamera(this.camera, this.renderer.domElement, this.terrain, { toolCapturesDrag: () => false, down: noop, move: noop, up: noop, cancel: noop });
    this.start = startView(this.terrain, this.map);
    this.setCam(P.cam ?? 'start');

    this.time.dayOfYear = num('day', 30);
    this.time.hour = num('hour', 15.5);
    this.env.lightPollution = num('lp', 0);
    if (P.moon !== undefined) this.env.moonPhaseOverride = num('moon', 0.5);
    this.post.tiltShift = P.tilt === '1';
    if (P.weather && (WEATHER as string[]).includes(P.weather)) this.weather.force(P.weather as WeatherKind, 9999);

    window.addEventListener('resize', () => {
      this.renderer.setSize(container.clientWidth, container.clientHeight);
      this.camera.aspect = container.clientWidth / container.clientHeight;
      this.camera.updateProjectionMatrix();
      this.post.setSize(container.clientWidth, container.clientHeight);
      this.particles.pxH = this.renderer.getDrawingBufferSize(new THREE.Vector2()).y;
    });
    window.addEventListener('pointerdown', () => this.audio.unlock(), { once: true });
  }

  setCam(name: string) {
    const s = this.start;
    const parts = name.split(',').map(Number);
    if (parts.length === 5 && parts.every((n) => !Number.isNaN(n))) {
      this.rts.setView(parts[0], parts[1], parts[2], parts[3], parts[4], true);
      return;
    }
    const presets: Record<string, [number, number]> = { start: [800, 0.72], hero: [430, 0.2], close: [170, 0.42], far: [2600, 0.95], top: [1500, 1.42] };
    const [d, pitch] = presets[name] ?? presets.start;
    this.rts.setView(s.x, s.z, d, s.yaw, pitch, true);
  }

  /** Apply settings in one go (used by the UI and by screenshot scripts). */
  set(o: { day?: number; hour?: number; weather?: WeatherKind | 'auto'; cam?: string; lp?: number; moon?: number | null; tilt?: boolean; city?: number; play?: boolean }) {
    if (o.day !== undefined) this.time.dayOfYear = ((o.day % 365) + 365) % 365;
    if (o.hour !== undefined) this.time.hour = ((o.hour % 24) + 24) % 24;
    if (o.weather) {
      if (o.weather === 'auto') this.weather.force('clear', 0.05);
      else this.weather.force(o.weather, 9999);
    }
    if (o.cam) this.setCam(o.cam);
    if (o.lp !== undefined) this.env.lightPollution = o.lp;
    if (o.moon !== undefined) this.env.moonPhaseOverride = o.moon;
    if (o.tilt !== undefined) this.post.tiltShift = o.tilt;
    if (o.city !== undefined) this.city = o.city;
    if (o.play !== undefined) this.playing = o.play;
    return this.weather.debug();
  }

  /** Skip visual easing (after a scripted change, before a screenshot). */
  settle() {
    this.weather.settle();
  }

  /** Advance n frames synchronously (hidden tabs pause requestAnimationFrame). */
  step(n = 120, dt = 1 / 60) {
    for (let i = 0; i < n; i++) this.frame(dt);
    return this.readout();
  }

  /** set() + settle() + step(): one call per scripted screenshot. */
  go(o: Parameters<Lab['set']>[0], n = 120) {
    this.set(o);
    this.frame(1 / 60);
    this.settle();
    return this.step(n);
  }

  /** Step until the next lightning strike with a bolt, then freeze on it. */
  catchLightning(maxFrames = 3000) {
    this.paused = true;
    let hit = false;
    const prev = this.weather.onLightning;
    this.weather.onLightning = (_x, _z, _d, bolt) => (hit = bolt);
    for (let i = 0; i < maxFrames && !hit; i++) this.frame(1 / 60);
    this.step(2);
    this.weather.onLightning = prev;
    return hit;
  }

  run() {
    const loop = () => {
      requestAnimationFrame(loop);
      this.clock.update();
      if (!this.paused) this.frame(Math.min(0.1, this.clock.getDelta()));
    };
    loop();
  }

  /** Same order as Game.frame. */
  frame(dt: number) {
    this.t += dt;
    this.fps += (1 / Math.max(dt, 1e-3) - this.fps) * 0.05;
    const spd = this.playing ? this.daysPerSec * 360 : 0; // weather spells run in game days (360 s each at 1x)
    if (this.playing) {
      this.time.day += dt * this.daysPerSec;
      this.time.dayOfYear = (this.time.dayOfYear + dt * this.daysPerSec) % 365;
      this.time.year = Math.floor(this.time.day / 365);
    }
    this.time.hour = (this.time.hour + dt * this.hoursPerSec) % 24;
    this.rts.update(dt);
    this.env.hour = this.time.hour;
    const nearWant = THREE.MathUtils.clamp(this.rts.distance * 0.008, 1, 10);
    if (Math.abs(this.camera.near - nearWant) > 0.05) {
      this.camera.near = nearWant;
      this.camera.updateProjectionMatrix();
    }
    this.env.update(0, this.rts.target, this.rts.distance, this.camera.position);
    this.weather.update(dt, this.time, this.camera, spd, this.rts.distance);
    this.terrain.updateLOD(this.camera.position);
    this.trees.setDayOfYear(this.time.dayOfYear);
    this.trees.update(this.t, this.rts.target, this.rts.distance);

    if (this.fx) {
      this.fxTimer -= dt;
      if (this.fxTimer <= 0) {
        const p = this.rts.target;
        const burst = this.fx === 'confetti' || this.fx === 'money' || this.fx === 'spark' || this.fx === 'splash' || this.fx === 'dust';
        this.fxTimer = burst ? 1.2 : this.fx === 'cigarette' ? 0.35 : 0.12;
        this.particles.emit(this.fx, p.x, p.y + (this.fx === 'cigarette' ? 1.6 : 1), p.z, { count: burst ? 30 : 3 });
        if (this.fx === 'fire' && Math.random() < 0.3) this.particles.emit('smoke', p.x, p.y + 3, p.z, { count: 1 });
      }
    }
    this.particles.night = this.env.night;
    this.particles.wind.copy(this.weather.wind);
    this.particles.update(dt, this.camera);
    this.terrain.flush();

    const n = this.env.night;
    const wu = this.water.mat.uniforms;
    wu.uTime.value = this.t;
    (wu.uSunDir.value as THREE.Vector3).copy(this.env.sunDirection);
    wu.uNight.value = n;
    (wu.uSky.value as THREE.Color).copy(this.env.fog.color);
    (wu.uSunColor.value as THREE.Color).copy(this.env.sunColor);
    (wu.uSkyTop.value as THREE.Color).copy(this.env.hemi.color).multiplyScalar(0.55 * (1 - n * 0.9)).lerp(this.env.fog.color, this.env.overcast * 0.8);
    this.post.aoRadius = THREE.MathUtils.clamp(this.rts.distance * 0.011, 2.2, 16);

    const m = this.mix;
    m.zoom = Math.min(1, this.rts.distance / 1500);
    m.nature = this.nature * this.trees.naturePct;
    m.traffic = this.city;
    m.construction = this.city * 0.4;
    m.people = this.city * 0.7;
    m.night = n;
    m.weather = this.weather.kind;
    m.weatherIntensity = this.weather.intensity;
    m.season = this.weather.season;
    this.audio.update(dt, m);

    this.water.reflection?.render(this.renderer, this.scene, this.camera, [this.water.mesh]);
    this.post.render(n);
    this.onTick?.();
  }

  readout() {
    const d = this.time.dayOfYear;
    return `${dateLabel(d)} (day ${d.toFixed(0)}, ${seasonOf(d)}) · ${fmtHour(this.time.hour)}\n${this.weather.debug()}\nfx ${JSON.stringify(this.weather.effects(), (_k, v) => (typeof v === 'number' ? +v.toFixed(2) : v))}\nsun ${this.env.sunElevation.toFixed(1)}° · moon ${(this.env.moonPhase * 100).toFixed(0)}% · ${this.fps.toFixed(0)} fps · ${this.q.name}`;
  }
}

function fmtHour(h: number) {
  const hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
  return `${hh.toString().padStart(2, '0')}:${mm.toString().padStart(2, '0')}`;
}

let toastEl: HTMLDivElement | null = null;
let toastTimer = 0;
function toast(text: string) {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'atmo-toast';
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = text;
  toastEl.style.opacity = '1';
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl && (toastEl.style.opacity = '0'), 1600);
}

// ------------------------------------------------------------------ UI
function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]) {
  const e = document.createElement(tag);
  Object.assign(e, props);
  for (const k of kids) e.append(k);
  return e;
}

function buildUI(lab: Lab) {
  const panel = el('div', { className: 'atmo-panel' });
  const head = el('div', { className: 'atmo-head' }, el('h1', { textContent: 'Atmosphere Lab' }));
  const collapse = el('button', { textContent: '–', title: 'Collapse' });
  collapse.onclick = () => {
    panel.classList.toggle('collapsed');
    collapse.textContent = panel.classList.contains('collapsed') ? '+' : '–';
  };
  head.append(collapse);
  panel.append(head);

  const section = (title: string) => panel.appendChild(el('h2', { textContent: title }));
  const row = () => panel.appendChild(el('div', { className: 'atmo-row' }));
  const nav = (patch: Record<string, string>) => {
    const h = { ...P, ...patch };
    location.hash = Object.entries(h).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    location.reload();
  };

  section('Map');
  const mr = row();
  for (const m of MAPS) {
    const b = el('button', { textContent: m.name, className: m.id === lab.mapId ? 'on' : '' });
    b.onclick = () => nav({ map: m.id });
    mr.append(b);
  }

  section('Calendar');
  const dayLabel = el('span', { className: 'atmo-val' });
  const day = el('input', { type: 'range', min: '0', max: '364', step: '1' });
  day.oninput = () => lab.set({ day: +day.value });
  const pr = row();
  const play = el('button', { textContent: lab.playing ? 'Pause' : 'Play year' });
  play.onclick = () => {
    lab.playing = !lab.playing;
    play.textContent = lab.playing ? 'Pause' : 'Play year';
  };
  const speed = el('input', { type: 'range', min: '0.1', max: '12', step: '0.1', value: String(lab.daysPerSec) });
  speed.oninput = () => (lab.daysPerSec = +speed.value);
  pr.append(play, el('label', {}, 'days/s', speed));
  panel.append(el('label', {}, 'Day', dayLabel), day);
  const sr = row();
  for (const [name, d] of [['Spring', 30], ['Summer', 122], ['Fall', 214], ['Winter', 300]] as [string, number][]) {
    const b = el('button', { textContent: name });
    b.onclick = () => lab.set({ day: d });
    sr.append(b);
  }

  section('Time of day');
  const hourLabel = el('span', { className: 'atmo-val' });
  const hour = el('input', { type: 'range', min: '0', max: '23.99', step: '0.05' });
  hour.oninput = () => lab.set({ hour: +hour.value });
  panel.append(el('label', {}, 'Hour', hourLabel), hour);
  const hr = row();
  for (const [name, h] of [['Dawn', 6.2], ['Noon', 13], ['Golden', 18.6], ['Dusk', 19.9], ['Night', 23]] as [string, number][]) {
    const b = el('button', { textContent: name });
    b.onclick = () => lab.set({ hour: h });
    hr.append(b);
  }
  const cyc = el('input', { type: 'range', min: '0', max: '3', step: '0.05', value: String(lab.hoursPerSec) });
  cyc.oninput = () => (lab.hoursPerSec = +cyc.value);
  panel.append(el('label', {}, 'Clock h/s', cyc));

  section('Weather');
  const wr = row();
  const wbtns = new Map<string, HTMLButtonElement>();
  for (const k of [...WEATHER, 'auto'] as (WeatherKind | 'auto')[]) {
    const b = el('button', { textContent: k === 'wildfireSmoke' ? 'smoke' : k });
    b.onclick = () => lab.set({ weather: k });
    wbtns.set(k, b);
    wr.append(b);
  }

  section('Sky');
  const moon = el('input', { type: 'range', min: '0', max: '1', step: '0.01', value: String(lab.env.moonPhaseOverride ?? 0.5) });
  moon.oninput = () => lab.set({ moon: +moon.value });
  const lp = el('input', { type: 'range', min: '0', max: '1', step: '0.01', value: String(lab.env.lightPollution) });
  lp.oninput = () => lab.set({ lp: +lp.value });
  const city = el('input', { type: 'range', min: '0', max: '1', step: '0.01', value: String(lab.city) });
  city.oninput = () => lab.set({ city: +city.value });
  panel.append(el('label', {}, 'Moon', moon), el('label', {}, 'Light pollution', lp), el('label', {}, 'City noise', city));

  section('Post');
  const por = row();
  const vig = el('button', { textContent: 'Vignette', className: lab.post.vignette ? 'on' : '' });
  vig.onclick = () => {
    lab.post.vignette = !lab.post.vignette;
    vig.classList.toggle('on', lab.post.vignette);
  };
  const tilt = el('button', { textContent: 'Tilt-shift', className: lab.post.tiltShift ? 'on' : '' });
  tilt.onclick = () => {
    lab.post.tiltShift = !lab.post.tiltShift;
    tilt.classList.toggle('on', lab.post.tiltShift);
  };
  const qual = el('button', { textContent: `Quality: ${lab.q.name}` });
  qual.onclick = () => nav({ q: lab.q.name === 'low' ? 'high' : 'low' });
  por.append(vig, tilt, qual);
  if (!lab.post.enabled) por.append(el('span', { textContent: 'post off (low)' }));

  section('Camera');
  const cr = row();
  for (const c of ['start', 'hero', 'close', 'far', 'top']) {
    const b = el('button', { textContent: c });
    b.onclick = () => lab.setCam(c);
    cr.append(b);
  }

  section('Particles (at camera target)');
  const fr = row();
  for (const k of PARTICLES) {
    const b = el('button', { textContent: k });
    b.onclick = () => {
      lab.fx = lab.fx === k ? null : k;
      for (const x of fr.children) x.classList.toggle('on', (x as HTMLElement).textContent === lab.fx);
    };
    fr.append(b);
  }

  section('Sound');
  const ar = row();
  const unlock = el('button', { textContent: 'Enable audio' });
  unlock.onclick = () => {
    lab.audio.unlock();
    unlock.classList.add('on');
  };
  const vol = el('input', { type: 'range', min: '0', max: '1', step: '0.01', value: '0.7' });
  vol.oninput = () => lab.audio.setVolume(+vol.value);
  ar.append(unlock, el('label', {}, 'vol', vol));
  const sfr = row();
  for (const k of SFX) {
    const b = el('button', { textContent: k });
    b.onclick = () => {
      lab.audio.unlock();
      lab.audio.play(k);
    };
    sfr.append(b);
  }

  const readout = el('div', { className: 'atmo-readout' });
  panel.append(readout);
  document.body.append(panel);

  let acc = 0;
  lab.onTick = () => {
    acc++;
    if (acc % 6) return;
    if (document.activeElement !== day) day.value = String(Math.round(lab.time.dayOfYear));
    if (document.activeElement !== hour) hour.value = lab.time.hour.toFixed(2);
    dayLabel.textContent = `${dateLabel(lab.time.dayOfYear)} · ${seasonOf(lab.time.dayOfYear)}`;
    hourLabel.textContent = fmtHour(lab.time.hour);
    for (const [k, b] of wbtns) b.classList.toggle('on', k === lab.weather.kind);
    readout.textContent = lab.readout();
  };
}

const lab = new Lab(document.getElementById('app')!);
(window as unknown as { __atmo: unknown }).__atmo = lab;
if (P.ui !== '0') buildUI(lab);
lab.run();
