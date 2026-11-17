import { applySmogLook } from './aerialPerspective';
import * as THREE from 'three';
import type { Game } from '../game';
import { FOV_MAX, FOV_MIN, GLOW, HALF, nightLift, WATER } from '../config';
import { setBuildingNight } from '../buildings/generator';
import { setKitNight } from '../buildings/kitGenerator';
import { applyLowGrade, lowExposure } from './lowGrade';
import { photoPNG } from './postcard';

export type PhotoWeather = 'clear' | 'cloudy' | 'rain' | 'fog';
export interface PhotoSize { width: number; height: number }

/** A separate lens on the frozen city. Only the rendering loop enters this
 * session; tool state, simulation time and the game's orbit camera stay put. */
export class PhotoMode {
  active = false;
  hour = 12;
  weather: PhotoWeather | null = null;
  fov = 50;
  focusDistance = 700;
  tilt = 0;
  private lens = new THREE.PerspectiveCamera();
  private angles = new THREE.Euler(0, 0, 0, 'YXZ');
  private target = new THREE.Vector3();
  private keys = new Set<string>();
  private listeners?: AbortController;
  private hud: HTMLElement | null = null;
  private hudVisibility = '';
  private controlsWereEnabled = true;

  constructor(private g: Game) {}

  enter() {
    if (this.active) return;
    const g = this.g;
    this.lens.copy(g.camera);
    this.angles.setFromQuaternion(this.lens.quaternion, 'YXZ');
    this.fov = g.camera.fov; this.hour = g.hour; this.weather = null;
    this.focusDistance = g.rts.distance; this.tilt = g.post.tiltShift ? g.post.tiltStrength : 0;
    this.controlsWereEnabled = g.rts.enabled; g.rts.enabled = false;
    this.hud = g.container.querySelector('.hud');
    if (this.hud) { this.hudVisibility = this.hud.style.visibility; this.hud.style.visibility = 'hidden'; }
    this.active = true;
    this.listen();
  }

  exit() {
    if (!this.active) return;
    this.active = false; this.listeners?.abort(); this.keys.clear();
    if (this.hud) this.hud.style.visibility = this.hudVisibility;
    const g = this.g; g.rts.enabled = this.controlsWereEnabled;
    g.weather.photoLook(null, g.hour, g.camera, g.rts.target, g.rts.distance);
  }

  /** Metres in the county, with yaw and elevation in radians. */
  setPose(x: number, y: number, z: number, yaw: number, elevation: number) {
    this.lens.position.set(x, y, z);
    this.angles.set(THREE.MathUtils.clamp(elevation, -1.54, 1.54), yaw, 0, 'YXZ');
    this.constrain();
  }

  street(x = this.g.rts.target.x, z = this.g.rts.target.z) {
    this.setPose(x, Math.max(WATER, this.g.terrain.h(x, z)) + 1.75, z, this.angles.y, -0.015);
    this.focusDistance = 60;
  }

  move(right: number, up: number, forward: number) {
    const pos = this.lens.position, yaw = this.angles.y;
    pos.x += Math.cos(yaw) * right - Math.sin(yaw) * forward;
    pos.z -= Math.sin(yaw) * right + Math.cos(yaw) * forward;
    pos.y += up; this.constrain();
  }

  private constrain() {
    const p = this.lens.position;
    p.x = THREE.MathUtils.clamp(p.x, -HALF, HALF); p.z = THREE.MathUtils.clamp(p.z, -HALF, HALF);
    p.y = THREE.MathUtils.clamp(p.y, Math.max(WATER, this.g.terrain.h(p.x, p.z)) + 1.5, 8500);
  }

  private listen() {
    const canvas = this.g.renderer.domElement, ctrl = this.listeners = new AbortController(), signal = ctrl.signal;
    const fingers = new Map<number, { x: number; y: number }>();
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input,select,textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
      e.stopImmediatePropagation();
      const k = e.key.toLowerCase();
      if (!['w','a','s','d','q','e','shift','escape'].includes(k)) return;
      e.preventDefault();
      if (e.type === 'keyup') this.keys.delete(k);
      else if (k === 'escape') this.exit();
      else this.keys.add(k);
    };
    window.addEventListener('keydown', key, { capture: true, signal });
    window.addEventListener('keyup', key, { capture: true, signal });
    window.addEventListener('blur', () => { this.keys.clear(); fingers.clear(); }, { signal });
    canvas.addEventListener('pointerdown', e => { fingers.set(e.pointerId, { x: e.clientX, y: e.clientY }); canvas.setPointerCapture(e.pointerId); }, { signal });
    const up = (e: PointerEvent) => { fingers.delete(e.pointerId); };
    canvas.addEventListener('pointerup', up, { signal }); canvas.addEventListener('pointercancel', up, { signal });
    canvas.addEventListener('pointermove', e => {
      const p = fingers.get(e.pointerId); if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
      if (fingers.size > 1) this.move(-dx * 0.09, 0, dy * 0.14);
      else { this.angles.y -= dx * 0.004; this.angles.x = THREE.MathUtils.clamp(this.angles.x - dy * 0.004, -1.54, 1.54); }
    }, { signal });
    canvas.addEventListener('wheel', e => { e.preventDefault(); this.move(0, 0, -e.deltaY * 0.12); }, { passive: false, signal });
  }

  frame(dt: number, aspect = this.g.camera.aspect, warmShadows = false) {
    if (this.keys.size) {
      const speed = dt * (this.keys.has('shift') ? 120 : 18), d = (key: string) => Number(this.keys.has(key));
      this.move((d('d') - d('a')) * speed, (d('e') - d('q')) * speed, (d('w') - d('s')) * speed);
    }
    const g = this.g, cam = this.lens;
    cam.aspect = aspect; cam.fov = THREE.MathUtils.clamp(this.fov, FOV_MIN, FOV_MAX);
    const eyeHeight = cam.position.y - Math.max(WATER, g.terrain.h(cam.position.x, cam.position.z));
    cam.near = THREE.MathUtils.clamp(eyeHeight * 0.006, 0.2, 8); cam.quaternion.setFromEuler(this.angles);
    cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    const dist = THREE.MathUtils.clamp(this.focusDistance, 2, 6500);
    cam.getWorldDirection(this.target).multiplyScalar(dist).add(cam.position);
    g.env.smog = g.fields.smog();
    const wet = g.weather.photoLook(this.weather, this.hour, cam, this.target, dist), n = g.env.night;
    applySmogLook(g.post.look, g.env.smog, n);
    g.water.updateFields(g.fields);
    GLOW.value = 1 / nightLift(n, g.env.moonLight);
    setBuildingNight(n); setKitNight(n); g.roads.setNight(n); g.roads.setWet(wet, (g.pendingQuality ?? g.q.name) === 'ultra');
    g.zones.setNight(n); g.traffic.setNight(n); g.peds.setNight(n); g.nightLights.update(0, n);
    g.terrain.updateLOD(cam.position); g.trees.update(g.time, this.target, dist);
    g.groundDetail.update(g.time, this.target, dist, { season: g.weather.season, snowCover: g.weather.snowCover, wind: g.weather.wind });
    const wu = g.water.mat.uniforms;
    wu.uNight.value = n; wu.uSky.value.copy(g.env.fog.color); wu.uSunDir.value.copy(g.env.sunDirection); wu.uSunColor.value.copy(g.env.sunColor);
    wu.uSkyTop.value.copy(g.env.hemi.color).multiplyScalar(0.55 * (1 - n * 0.9)).lerp(g.env.fog.color, g.env.overcast * 0.8);
    wu.uMoonDir.value.copy(g.env.moonDirection); wu.uMoonLight.value = g.env.moonLight * (1 - g.env.overcast);
    const mirror = g.water.reflection;
    wu.uReflOn.value = mirror?.shouldRender(cam) ? 1 : 0;
    g.renderer.toneMappingExposure = 0.95 * (g.post.active ? 1 : lowExposure(g.env, g.post.look));
    if (!g.post.active) applyLowGrade(g.env, g.post.look, g.renderer);
    else g.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const oldTilt = g.post.tiltShift, oldStrength = g.post.tiltStrength;
    try {
      g.post.tiltShift = this.tilt > 0; g.post.tiltStrength = this.tilt;
      g.renderer.info.reset();
      if (warmShadows) g.shadows.warm(g.renderer, cam);
      if (wu.uReflOn.value) mirror?.render(g.renderer, g.scene, cam, [g.water.mesh]);
      g.roads.renderReflection(g.renderer, g.scene, cam);
      g.post.render(n, dist, cam);
      g.perf.calls = g.renderer.info.render.calls; g.perf.triangles = g.renderer.info.render.triangles;
    } finally { g.post.tiltShift = oldTilt; g.post.tiltStrength = oldStrength; }
  }

  capture(framed = true, size?: PhotoSize) {
    const g = this.g, renderer = g.renderer;
    const draw = (aspect = g.camera.aspect) => {
      if (this.active) return this.frame(0, aspect, true);
      const camera = aspect === g.camera.aspect ? g.camera : g.camera.clone();
      camera.aspect = aspect; camera.updateProjectionMatrix(); camera.updateMatrixWorld();
      // Direct exports also need a mirror for this exact lens and buffer size.
      // Warm it before the final scene draw, without stepping the game.
      const mirror = g.water.reflection, wu = g.water.mat.uniforms;
      wu.uReflOn.value = mirror?.shouldRender(camera) ? 1 : 0;
      if (!g.post.active) applyLowGrade(g.env, g.post.look, renderer);
      else renderer.toneMapping = THREE.ACESFilmicToneMapping;
      g.shadows.warm(renderer, camera);
      if (wu.uReflOn.value) mirror?.render(renderer, g.scene, camera, [g.water.mesh]);
      g.roads.setWet(g.weather.wet, (g.pendingQuality ?? g.q.name) === 'ultra');
      g.roads.renderReflection(renderer, g.scene, camera);
      g.post.render(g.env.night, g.rts.distance, camera);
    };
    if (!size) return photoPNG(renderer.domElement, draw, g.map.def.name, framed);
    const { width, height } = size, max = Math.min(renderer.capabilities.maxTextureSize, 3840);
    if (![width, height].every(v => Number.isInteger(v) && v > 0 && v <= max) || width * height > 3840 * 2160) {
      throw new RangeError('Choose a photo size within 3840 × 2160 pixels (landscape or portrait) and the graphics device limit');
    }
    const old = renderer.getSize(new THREE.Vector2()), ratio = renderer.getPixelRatio();
    const viewport = renderer.getViewport(new THREE.Vector4()), scissor = renderer.getScissor(new THREE.Vector4());
    const test = renderer.getScissorTest(), target = renderer.getRenderTarget(), aspect = width / height;
    try {
      renderer.setRenderTarget(null); renderer.setScissorTest(false);
      renderer.setDrawingBufferSize(width, height, 1); g.post.setSize(width, height);
      // photoPNG copies the rendered pixels synchronously, before awaiting fonts or the encoder.
      return photoPNG(renderer.domElement, () => draw(aspect), g.map.def.name, framed);
    } finally {
      renderer.setDrawingBufferSize(old.x, old.y, ratio); g.post.setSize(old.x, old.y);
      renderer.setViewport(viewport); renderer.setScissor(scissor); renderer.setScissorTest(test);
      draw(); renderer.setRenderTarget(target);
    }
  }

  async download(framed = true, size?: PhotoSize) {
    const blob = await this.capture(framed, size), url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = `${this.g.map.def.name.toLowerCase().replace(/\s+/g, '-')}-${framed ? 'postcard' : 'photo'}.png`;
    a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
}
