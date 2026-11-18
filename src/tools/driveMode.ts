// Playable Drive Mode (GAME_DESIGN.md §5.12) & Then-and-Now Split-Screen
// Comparison Studio (GAME_DESIGN.md §5.11):
//   - Press V (or click "🛻 Drive Vehicle" in the car inspector) to hop
//     into a lifted truck / Cyberslop with WASD throttle/steering, horn (H),
//     and SlopRadio (Porch Banjo, Gas-N-Go Muzak, FM 106.9 Patriot Country).
//   - Press N (or click "📷 Then & Now" in the inspector) to open the
//     interactive "Then & Now" split-screen comparison slider and export a PNG.
import * as THREE from 'three';
import { clamp } from '../core/math';
import { WATER } from '../config';
import { DEBUG } from '../core/flags';
import { registerInspector, registerSystem } from '../ext/registry';
import type { Game, Selection } from '../game';
import type { Car } from '../agents/traffic';
import { RADIO_ADS, SlopRadio, type RadioAd, type RadioStation } from '../audio/radio';
import { advisorPortraitHTML } from '../art/advisors';

const STATION_META: Record<RadioStation, { freq: string; title: string; dj: 'earl' | 'chad' | 'dale' | 'rick' }> = {
  banjo: { freq: '94.1 AM', title: 'Holler Porch Pickin’', dj: 'earl' },
  muzak: { freq: '101.5 FM', title: 'Gas-N-Go Smooth Lite', dj: 'chad' },
  country: { freq: '106.9 FM', title: 'THE SLOP · Patriot Country', dj: 'dale' },
  piano: { freq: '88.5 FM', title: 'Valley Public Felt Piano', dj: 'earl' },
};

const STATIONS: RadioStation[] = ['country', 'muzak', 'banjo', 'piano'];

interface TerrainInternal {
  paint: Uint8Array;
  chunks: { cx: number; cz: number; lod: number; mesh: THREE.Mesh }[];
  buildChunk(ch: { cx: number; cz: number; lod: number }, lod: number): THREE.BufferGeometry;
}

export class ThenAndNowViewer {
  active = false;
  split = 0.5;
  private modalEl: HTMLElement | null = null;
  private thenDataUrl = '';
  private nowDataUrl = '';

  constructor(private g: Game) {
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
      if (e.key.toLowerCase() === 'n' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        if (this.active) this.close();
        else this.open();
      } else if (e.key === 'Escape' && this.active) {
        e.preventDefault();
        this.close();
      }
    });
  }

  private captureCurrentCanvas(): string {
    const g = this.g;
    const mirror = g.water.reflection, wu = g.water.mat.uniforms;
    wu.uReflOn.value = mirror?.shouldRender(g.camera) ? 1 : 0;
    if (wu.uReflOn.value) mirror?.render(g.renderer, g.scene, g.camera, [g.water.mesh]);
    g.post.render(g.env.night, g.rts.distance, g.camera);
    return g.renderer.domElement.toDataURL('image/jpeg', 0.92);
  }

  open() {
    const g = this.g;
    // 1. Capture NOW (current city)
    this.nowDataUrl = this.captureCurrentCanvas();

    // 2. Capture THEN (untouched valley from identical camera: hide city meshes & temporarily clear lot dirt paint)
    const roadIdx = g.scene.children.indexOf(g.roads.group);
    const toggled: { obj: THREE.Object3D; vis: boolean }[] = [];
    g.scene.children.forEach((child, idx) => {
      if (idx >= roadIdx && child !== g.groundDetail.group) {
        toggled.push({ obj: child, vis: child.visible });
        child.visible = false;
      }
    });

    const terr = g.terrain as unknown as TerrainInternal;
    const savedPaint = new Uint8Array(terr.paint);
    const swappedGeos: { mesh: THREE.Mesh; oldGeo: THREE.BufferGeometry; tempGeo: THREE.BufferGeometry }[] = [];
    try {
      terr.paint.fill(0);
      for (const ch of terr.chunks) {
        const tempGeo = terr.buildChunk(ch, ch.lod);
        swappedGeos.push({ mesh: ch.mesh, oldGeo: ch.mesh.geometry, tempGeo });
        ch.mesh.geometry = tempGeo;
      }
      this.thenDataUrl = this.captureCurrentCanvas();
    } finally {
      terr.paint.set(savedPaint);
      for (const s of swappedGeos) {
        s.mesh.geometry = s.oldGeo;
        s.tempGeo.dispose();
      }
      for (const item of toggled) item.obj.visible = item.vis;
      this.captureCurrentCanvas();
    }

    this.active = true;
    this.split = 0.5;
    this.mountModal();
  }

  close() {
    this.active = false;
    this.modalEl?.remove();
    this.modalEl = null;
  }

  private mountModal() {
    this.modalEl?.remove();
    const g = this.g;
    const dayInt = Math.floor(g.sim.day);
    const treesLostPct = Math.round((1 - g.sim.naturePct) * 100);
    const bldCount = g.buildings.list.size;
    const segCount = g.net.segs.size;
    const modal = document.createElement('div');
    modal.id = 'slop-then-now-modal';
    modal.style.cssText = [
      'position:fixed',
      'inset:0',
      'z-index:120',
      'background:rgba(10,10,12,0.88)',
      'display:flex',
      'flex-direction:column',
      'align-items:center',
      'justify-content:center',
      'padding:16px',
      'color:#efe6cf',
      'font-family:Overpass,system-ui,sans-serif',
    ].join(';');

    modal.innerHTML = `
      <div style="width:min(94vw,980px);background:#18181b;border:2px solid #c6f432;border-radius:16px;overflow:hidden;box-shadow:0 20px 50px rgba(0,0,0,0.8)">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #27272a;flex-wrap:wrap;gap:8px">
          <div style="display:flex;align-items:center;gap:10px">
            ${advisorPortraitHTML('earl', 40)}
            <div>
              <div style="font-family:Bungee,sans-serif;font-size:16px;color:#c6f432">THEN &amp; NOW · ${g.cityName.toUpperCase()}</div>
              <div style="font-size:12px;color:#a1a1aa">Day ${dayInt} · Pop ${g.sim.population.toLocaleString()} · ${bldCount} Buildings · ${segCount} Road Segments · ${treesLostPct}% Forest Cleared</div>
            </div>
          </div>
          <div style="display:flex;gap:8px">
            <button type="button" id="tn-postcard" style="background:#f4b432;color:#111;border:none;border-radius:8px;padding:8px 12px;font-weight:800;font-size:12px;cursor:pointer">📮 Save Postcard</button>
            <button type="button" id="tn-download" style="background:#c6f432;color:#111;border:none;border-radius:8px;padding:8px 12px;font-weight:800;font-size:12px;cursor:pointer">💾 Save Split PNG</button>
            <button type="button" id="tn-close" style="background:#b3202a;color:#efe6cf;border:none;border-radius:8px;padding:8px 12px;font-weight:800;font-size:12px;cursor:pointer">✕ Close<span class="kbd-hint"> (Esc)</span></button>
          </div>
        </div>
        <div id="tn-stage" style="position:relative;width:100%;aspect-ratio:16/9;max-height:68vh;background:#000;overflow:hidden;user-select:none;cursor:ew-resize">
          <img src="${this.nowDataUrl}" alt="Now" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover" />
          <div id="tn-left-clip" style="position:absolute;inset:0;clip-path:inset(0 50% 0 0)">
            <img src="${this.thenDataUrl}" alt="Then" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover" />
          </div>
          <div id="tn-bar" style="position:absolute;top:0;bottom:0;left:50%;width:3px;background:#c6f432;transform:translateX(-50%);box-shadow:0 0 12px rgba(0,0,0,0.9)">
            <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:36px;height:36px;border-radius:50%;background:#c6f432;color:#111;font-weight:900;display:flex;align-items:center;justify-content:center;border:2px solid #111">↔</div>
          </div>
          <div style="position:absolute;top:12px;left:12px;background:rgba(17,17,17,0.88);padding:5px 10px;border-radius:6px;font-weight:800;font-size:12px;border:1px solid #efe6cf">🌲 THEN: DAY 0 UNTOUCHED VALLEY</div>
          <div style="position:absolute;top:12px;right:12px;background:rgba(17,17,17,0.88);padding:5px 10px;border-radius:6px;font-weight:800;font-size:12px;border:1px solid #c6f432;color:#c6f432">🛣️ NOW: ${g.cityName.toUpperCase()} (DAY ${dayInt})</div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    this.modalEl = modal;

    const stage = modal.querySelector('#tn-stage') as HTMLElement;
    const clip = modal.querySelector('#tn-left-clip') as HTMLElement;
    const bar = modal.querySelector('#tn-bar') as HTMLElement;
    const setSplit = (clientX: number) => {
      const r = stage.getBoundingClientRect();
      this.split = clamp((clientX - r.left) / Math.max(1, r.width), 0.02, 0.98);
      const pct = (this.split * 100).toFixed(1);
      clip.style.clipPath = `inset(0 ${100 - this.split * 100}% 0 0)`;
      bar.style.left = `${pct}%`;
    };
    let dragging = false;
    stage.addEventListener('pointerdown', (e) => { dragging = true; stage.setPointerCapture(e.pointerId); setSplit(e.clientX); });
    stage.addEventListener('pointermove', (e) => { if (dragging) setSplit(e.clientX); });
    stage.addEventListener('pointerup', () => { dragging = false; });

    modal.querySelector('#tn-close')?.addEventListener('click', () => this.close());
    modal.querySelector('#tn-postcard')?.addEventListener('click', () => { void g.photo.download(true); });
    modal.querySelector('#tn-download')?.addEventListener('click', () => { void this.downloadComposite(); });
  }

  async downloadComposite() {
    const load = (src: string) => new Promise<HTMLImageElement>((res) => { const i = new Image(); i.onload = () => res(i); i.src = src; });
    const [thenImg, nowImg] = await Promise.all([load(this.thenDataUrl), load(this.nowDataUrl)]);
    const c = document.createElement('canvas');
    c.width = nowImg.width || 1280;
    c.height = nowImg.height || 720;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(nowImg, 0, 0, c.width, c.height);
    const sx = Math.round(c.width * this.split);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, sx, c.height);
    ctx.clip();
    ctx.drawImage(thenImg, 0, 0, c.width, c.height);
    ctx.restore();
    ctx.fillStyle = '#c6f432';
    ctx.fillRect(sx - 2, 0, 4, c.height);
    const a = document.createElement('a');
    a.href = c.toDataURL('image/png');
    a.download = `${this.g.cityName.toLowerCase().replace(/\s+/g, '-')}-then-and-now.png`;
    a.click();
  }
}

export class DriveModeController {
  active = false;
  carId: number | null = null;
  private yaw = 0;
  private latOffset = 0;
  private keys = new Set<string>();
  private savedStation: RadioStation = 'piano';
  private savedCam: { x: number; z: number; dist: number; yaw: number; pitch: number } | null = null;
  private hudEl: HTMLElement | null = null;
  private hiddenEls: { el: HTMLElement; vis: string }[] = [];
  private currentAd: RadioAd = RADIO_ADS[0];

  constructor(private g: Game, private thenNow: ThenAndNowViewer) {
    window.addEventListener('keydown', (e) => this.onKeyDown(e), { capture: true });
    window.addEventListener('keyup', (e) => this.onKeyUp(e), { capture: true });
    window.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement | null)?.closest?.('[data-drive-car]') as HTMLElement | null;
      if (btn) {
        const id = Number(btn.getAttribute('data-drive-car'));
        this.enter(Number.isFinite(id) && id > 0 ? id : undefined);
        return;
      }
      const tnBtn = (e.target as HTMLElement | null)?.closest?.('[data-then-now]') as HTMLElement | null;
      if (tnBtn) {
        this.thenNow.open();
      }
    });
  }

  private onKeyDown(e: KeyboardEvent) {
    if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
    const k = e.key.toLowerCase();
    if (k === 'v' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      if (this.active) this.exit();
      else this.enter();
      return;
    }
    if (!this.active) return;
    if (k === 'escape') {
      e.preventDefault();
      e.stopPropagation();
      this.exit();
      return;
    }
    if (k === 'h') {
      e.preventDefault();
      e.stopPropagation();
      this.honk();
      return;
    }
    if (k === 'r') {
      e.preventDefault();
      e.stopPropagation();
      this.cycleStation();
      return;
    }
    if (k === 'tab') {
      e.preventDefault();
      e.stopPropagation();
      this.nextCar();
      return;
    }
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) {
      e.stopPropagation();
      this.keys.add(k);
    }
  }

  private onKeyUp(e: KeyboardEvent) {
    const k = e.key.toLowerCase();
    this.keys.delete(k);
  }

  private pickBestCar(preferId?: number): Car | null {
    const cars = this.g.traffic.cars;
    if (!cars.length) return null;
    if (preferId !== undefined) {
      const found = cars.find((c) => c.id === preferId && !c.crashed);
      if (found) return found;
    }
    if (this.g.selection?.kind === 'car' && !this.g.selection.c.crashed) {
      return this.g.selection.c;
    }
    const tx = this.g.rts.target.x, tz = this.g.rts.target.z;
    let best: Car | null = null;
    let bestScore = Infinity;
    for (const c of cars) {
      if (c.crashed || c.parked || c.h < 0) continue;
      const d = Math.hypot(c.x - tx, c.z - tz);
      const movingBonus = c.v > 5 ? 0.35 : c.v > 1 ? 0.7 : 2.5;
      const kindBonus = c.kind === 'liftedTruck' || c.kind === 'cyberslop' ? 0.5 : c.kind === 'pickup' || c.kind === 'suv' ? 0.75 : 1;
      const s = (d + 20) * movingBonus * kindBonus;
      if (s < bestScore) {
        bestScore = s;
        best = c;
      }
    }
    return best ?? cars[0];
  }

  enter(preferId?: number): boolean {
    const car = this.pickBestCar(preferId);
    if (!car) {
      this.g.ui.toast('Build a road and wait for a vehicle before entering Drive Mode.');
      return false;
    }
    if (!this.active) {
      this.savedCam = {
        x: this.g.rts.target.x,
        z: this.g.rts.target.z,
        dist: this.g.rts.distance,
        yaw: this.g.rts.yaw,
        pitch: this.g.rts.pitch,
      };
      this.savedStation = this.g.audio.station;
      // On a phone a card is a sheet over the lower half of the screen, where the driving panel goes: put the card away. And
      // the camera's own "Following a car, tap to let go" pill is not shown while driving: the panel has its Exit.
      if (window.innerWidth <= 760) this.g.select(null);
      this.hiddenEls = [];
      for (const sel of ['.side-cards', '.next-bar', '.follow-pill']) {
        const el = document.querySelector(sel) as HTMLElement | null;
        if (el) {
          this.hiddenEls.push({ el, vis: el.style.visibility });
          el.style.visibility = 'hidden';
        }
      }
    }
    this.active = true;
    this.carId = car.id;
    this.yaw = car.ryaw ?? car.yaw;
    this.latOffset = 0;
    if (car.v < 9) car.v = 14;

    const dx = Math.sin(this.yaw), dz = Math.cos(this.yaw);
    const groundY = Math.max(WATER, this.g.terrain.h(car.x, car.z));
    this.g.camera.position.set(car.x - dx * 8.5, groundY + 2.9, car.z - dz * 8.5);
    this.g.rts.target.set(car.x + dx * 8, groundY + 1.1, car.z + dz * 8);
    this.g.camera.lookAt(this.g.rts.target);
    this.g.rts.follow({ kind: 'car', id: car.id });

    this.g.audio.unlock();
    const autoStation = SlopRadio.stationForPopulation(this.g.sim.population);
    this.setStation(autoStation === 'piano' ? 'country' : autoStation);
    if (this.g.audio.radio) {
      this.g.audio.radio.onAd = (ad) => {
        this.currentAd = ad;
        this.renderHud();
      };
    }

    this.mountHud();
    this.renderHud();
    return true;
  }

  exit() {
    if (!this.active) return;
    this.active = false;
    this.carId = null;
    this.keys.clear();
    this.g.rts.follow(null);
    this.g.audio.station = this.savedStation;
    for (const h of this.hiddenEls) h.el.style.visibility = h.vis;
    this.hiddenEls = [];
    if (this.hudEl) {
      this.hudEl.remove();
      this.hudEl = null;
    }
    if (this.savedCam) {
      const c = this.savedCam;
      this.g.rts.setView(c.x, c.z, c.dist, c.yaw, c.pitch, false);
      this.savedCam = null;
    }
  }

  honk() {
    this.g.audio.unlock();
    this.g.audio.play('honk', 1.15);
    const car = this.g.traffic.cars.find((c) => c.id === this.carId);
    if (car) {
      this.g.ui.floatText('📣 HONK!', new THREE.Vector3(car.x, car.y + 2.6, car.z), '#c6f432');
    }
  }

  setStation(st: RadioStation) {
    this.g.audio.unlock();
    this.g.audio.station = st;
    this.currentAd = RADIO_ADS[Math.floor(Math.random() * RADIO_ADS.length)];
    this.renderHud();
  }

  cycleStation() {
    const idx = STATIONS.indexOf(this.g.audio.station);
    this.setStation(STATIONS[(idx + 1) % STATIONS.length]);
  }

  nextCar() {
    const cars = this.g.traffic.cars.filter((c) => !c.crashed && !c.parked);
    if (!cars.length) return;
    const idx = cars.findIndex((c) => c.id === this.carId);
    const next = cars[(idx + 1) % cars.length];
    this.enter(next.id);
  }

  update(dt: number) {
    if (!this.active) return;
    let car = this.g.traffic.cars.find((c) => c.id === this.carId);
    if (!car || car.crashed) {
      car = this.pickBestCar() ?? undefined;
      if (!car) {
        this.exit();
        return;
      }
      this.carId = car.id;
      this.g.rts.follow({ kind: 'car', id: car.id });
    }

    if (!this.g.rts.following || this.g.rts.following.id !== car.id) {
      this.g.rts.follow({ kind: 'car', id: car.id });
    }

    const throttle = (this.keys.has('w') || this.keys.has('arrowup') ? 1 : 0) - (this.keys.has('s') || this.keys.has('arrowdown') ? 1 : 0);
    const steer = (this.keys.has('a') || this.keys.has('arrowleft') ? 1 : 0) - (this.keys.has('d') || this.keys.has('arrowright') ? 1 : 0);

    if (throttle !== 0) {
      car.v = clamp(car.v + throttle * 16 * dt, 0, 38);
      car.hold = undefined;
    }
    if (steer !== 0) {
      this.latOffset = clamp(this.latOffset - steer * 6.5 * dt, -5.5, 5.5);
      car.lat = clamp(car.lat - steer * 4.5 * dt, -6, 6);
    }

    this.updateSpeedometer(car);
  }

  private mountHud() {
    if (this.hudEl) return;
    const el = document.createElement('div');
    el.id = 'slop-drive-hud';
    el.style.cssText = [
      'position:fixed',
      'left:50%',
      'bottom:68px',
      'transform:translateX(-50%)',
      'z-index:85',
      'width:min(94vw,640px)',
      'background:rgba(17,17,17,0.94)',
      'border:2px solid #c6f432',
      'border-radius:14px',
      'padding:10px 14px',
      'color:#efe6cf',
      'font-family:Overpass,system-ui,sans-serif',
      'box-shadow:0 12px 32px rgba(0,0,0,0.65)',
      'pointer-events:auto',
    ].join(';');
    document.body.appendChild(el);
    this.hudEl = el;
  }

  private updateSpeedometer(car: Car) {
    const mphEl = this.hudEl?.querySelector('#drive-mph');
    if (mphEl) {
      const mph = Math.round(car.v * 2.23694);
      mphEl.textContent = `${mph}`;
    }
    const kindEl = this.hudEl?.querySelector('#drive-kind');
    if (kindEl) {
      kindEl.textContent = `${car.kind.toUpperCase()} #${car.id} · ${car.dest || 'Cruising the Stroad'}`;
    }
  }

  private renderHud() {
    if (!this.hudEl) return;
    const st = this.g.audio.station;
    const meta = STATION_META[st];
    const ad = this.currentAd;
    this.hudEl.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="background:#111;border:2px solid #c6f432;border-radius:10px;padding:4px 10px;text-align:center;min-width:68px">
            <div id="drive-mph" style="font-family:Bungee,sans-serif;font-size:22px;line-height:1;color:#c6f432">31</div>
            <div style="font-size:10px;letter-spacing:0.08em;color:#a1a1aa">MPH</div>
          </div>
          <div>
            <div style="font-weight:800;font-size:13px;color:#c6f432;letter-spacing:0.04em">🛻 COMMISSIONER DRIVE MODE</div>
            <div id="drive-kind" style="font-size:12px;color:#efe6cf;opacity:0.9">LIFTED TRUCK · W/S Gas &amp; Brake · A/D Lane Steer</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          <button type="button" id="drive-honk" style="background:#c6f432;color:#111;border:none;border-radius:8px;padding:7px 11px;font-weight:800;font-size:12px;cursor:pointer">📣 Honk<span class="kbd-hint"> (H)</span></button>
          <button type="button" id="drive-radio" style="background:#27272a;color:#efe6cf;border:1px solid #52525b;border-radius:8px;padding:7px 11px;font-weight:700;font-size:12px;cursor:pointer">📻 ${meta.freq}</button>
          <button type="button" id="drive-next" style="background:#27272a;color:#efe6cf;border:1px solid #52525b;border-radius:8px;padding:7px 10px;font-weight:700;font-size:12px;cursor:pointer">🔄 Next Car</button>
          <button type="button" id="drive-exit" style="background:#b3202a;color:#efe6cf;border:none;border-radius:8px;padding:7px 11px;font-weight:800;font-size:12px;cursor:pointer">✕ Exit<span class="kbd-hint"> (Esc)</span></button>
        </div>
      </div>
      <div style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(239,230,207,0.16);display:flex;align-items:center;gap:10px">
        ${advisorPortraitHTML(meta.dj, 36)}
        <div style="flex:1;min-width:0">
          <div style="font-size:11px;font-weight:800;color:#f4b432;letter-spacing:0.04em">📻 ${meta.freq} · ${meta.title} — SPONSORED BY ${ad.sponsor.toUpperCase()}</div>
          <div style="font-size:12px;color:#efe6cf;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">“${ad.copy}”</div>
        </div>
      </div>
    `;
    this.hudEl.querySelector('#drive-honk')?.addEventListener('click', () => this.honk());
    this.hudEl.querySelector('#drive-radio')?.addEventListener('click', () => this.cycleStation());
    this.hudEl.querySelector('#drive-next')?.addEventListener('click', () => this.nextCar());
    this.hudEl.querySelector('#drive-exit')?.addEventListener('click', () => this.exit());
  }
}

let controller: DriveModeController | null = null;
let thenNow: ThenAndNowViewer | null = null;

registerSystem({
  id: 'driveMode',
  init(g: Game) {
    thenNow = new ThenAndNowViewer(g);
    controller = new DriveModeController(g, thenNow);
    // (debug hooks, like the game's others: a player's build has none of them; src/core/flags.ts decides)
    if (DEBUG) {
      const win = window as unknown as { __drive?: DriveModeController; __thenNow?: ThenAndNowViewer };
      win.__drive = controller;
      win.__thenNow = thenNow;
    }
  },
  frame(_g: Game, dt: number) {
    controller?.update(dt);
  },
});

registerInspector((sel: NonNullable<Selection>) => {
  if (sel.kind === 'car') {
    return `<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap"><button type="button" class="act" data-drive-car="${sel.c.id}" style="flex:1;background:#c6f432;color:#111111;font-weight:800;border-radius:8px;padding:8px 12px;cursor:pointer">🛻 Drive Vehicle<span class="kbd-hint"> (V)</span></button><button type="button" class="act" data-then-now="1" style="background:#27272a;color:#efe6cf;font-weight:700;border-radius:8px;padding:8px 10px;cursor:pointer">📷 Then &amp; Now<span class="kbd-hint"> (N)</span></button></div>`;
  }
  if (sel.kind === 'road' || sel.kind === 'building') {
    return `<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap"><button type="button" class="act" data-drive-car="0" style="flex:1;background:#27272a;color:#c6f432;border:1px solid #c6f432;font-weight:800;border-radius:8px;padding:7px 10px;cursor:pointer">🛻 Drive Stroad<span class="kbd-hint"> (V)</span></button><button type="button" class="act" data-then-now="1" style="background:#27272a;color:#efe6cf;font-weight:700;border-radius:8px;padding:7px 10px;cursor:pointer">📷 Then &amp; Now<span class="kbd-hint"> (N)</span></button></div>`;
  }
  return null;
});
