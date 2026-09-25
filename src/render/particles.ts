// Pooled GPU particles. Every puff, spark and dollar bill is one instanced quad
// in a ring buffer: emit() writes spawn data (position, velocity, birth time,
// size, kind), and the vertex shader animates the whole life from that, so
// update() only advances a clock and uploads the slots that changed.
import * as THREE from 'three';
import type { Quality } from '../config';
import type { ParticleKind } from '../contracts';

export interface EmitOpts {
  count?: number;
  spread?: number; // meters
  vel?: [number, number, number];
  /** Size multiplier (1 = the kind's default size). */
  size?: number;
  life?: number; // seconds
}

interface Spec {
  id: number;
  additive: boolean;
  count: number;
  spread: number;
  vel: [number, number, number];
  jitter: number;
  size: [number, number]; // start, end (meters)
  life: number;
}

const SPECS: Record<ParticleKind, Spec> = {
  smoke: { id: 0, additive: false, count: 3, spread: 1.5, vel: [0, 2.4, 0], jitter: 0.7, size: [2.2, 10], life: 6 },
  cigarette: { id: 1, additive: false, count: 1, spread: 0.04, vel: [0, 0.45, 0], jitter: 0.12, size: [0.12, 0.8], life: 2.4 },
  fire: { id: 2, additive: true, count: 4, spread: 0.8, vel: [0, 3.2, 0], jitter: 0.9, size: [1.6, 0.3], life: 0.9 },
  dust: { id: 3, additive: false, count: 10, spread: 2.5, vel: [0, 0.9, 0], jitter: 3.2, size: [1.2, 5.5], life: 2.6 },
  spark: { id: 4, additive: true, count: 14, spread: 0.3, vel: [0, 4.5, 0], jitter: 6, size: [0.18, 0.06], life: 0.8 },
  steam: { id: 5, additive: false, count: 2, spread: 0.6, vel: [0, 2.6, 0], jitter: 0.5, size: [1.2, 6.5], life: 3.6 },
  confetti: { id: 6, additive: false, count: 40, spread: 1.5, vel: [0, 9, 0], jitter: 5, size: [0.28, 0.28], life: 4.2 },
  money: { id: 7, additive: false, count: 24, spread: 1.5, vel: [0, 7.5, 0], jitter: 4, size: [0.45, 0.45], life: 5.5 },
  splash: { id: 8, additive: false, count: 14, spread: 0.6, vel: [0, 5.5, 0], jitter: 2.8, size: [0.28, 0.12], life: 0.9 },
};

const NO_OPTS: EmitOpts = {};

const VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
attribute vec2 corner;
attribute vec4 aP0; // xyz spawn, w birth time
attribute vec4 aV;  // xyz velocity, w life
attribute vec4 aK;  // kind, size0, size1, seed
uniform float uTime;
uniform vec3 uWind;
varying vec2 vUv;
varying float vT;
varying float vKind;
varying float vSeed;
void main() {
  float age = uTime - aP0.w;
  float t = age / max(aV.w, 1e-3);
  vKind = aK.x; vSeed = aK.w; vT = t; vUv = corner;
  if (t < 0.0 || t > 1.0 || aV.w <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  int k = int(aK.x + 0.5);
  float drag = 0.4, grav = 0.0, windK = 0.0, spin = 0.0;
  if (k == 0) { drag = 0.35; grav = 0.25; windK = 1.0; spin = 0.25; }
  else if (k == 1) { drag = 0.8; grav = 0.1; windK = 0.7; spin = 0.6; }
  else if (k == 2) { drag = 0.6; grav = 1.5; windK = 0.4; }
  else if (k == 3) { drag = 1.4; grav = -0.4; windK = 0.8; spin = 0.3; }
  else if (k == 4) { drag = 0.25; grav = -9.8; windK = 0.1; }
  else if (k == 5) { drag = 0.5; grav = 0.6; windK = 1.0; spin = 0.3; }
  else if (k == 6) { drag = 1.6; grav = -3.0; windK = 0.9; spin = 4.0; }
  else if (k == 7) { drag = 1.8; grav = -2.2; windK = 1.0; spin = 2.5; }
  else { drag = 0.3; grav = -12.0; }
  float dd = (1.0 - exp(-drag * age)) / drag;
  vec3 p = aP0.xyz + aV.xyz * dd + vec3(0.0, 0.5 * grav * age * age, 0.0) + uWind * windK * age * (0.4 + 0.6 * t);
  if (k == 6 || k == 7) {
    p.x += sin(age * 3.0 + aK.w * 30.0) * 0.7 * t;
    p.z += cos(age * 2.6 + aK.w * 20.0) * 0.7 * t;
  }
  float size = mix(aK.y, aK.z, 1.0 - (1.0 - t) * (1.0 - t));
  if (k == 3) p.y += size * 0.45; // dust clouds billow up as they grow, instead of into the ground
  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
  vec2 c = corner;
  if (k == 7) c.y *= 0.5; // dollar bill aspect
  if (k == 6 || k == 7) c.x *= abs(cos(age * 5.0 + aK.w * 10.0)) * 0.8 + 0.2; // tumbling paper
  float ang = aK.w * 6.2831 + age * spin * (aK.w > 0.5 ? 1.0 : -1.0);
  float ca = cos(ang), sa = sin(ang);
  mvPosition.xy += vec2(ca * c.x - sa * c.y, sa * c.x + ca * c.y) * size;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform float uLight;
varying vec2 vUv;
varying float vT;
varying float vKind;
varying float vSeed;
float ph(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float pn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(ph(i),ph(i+vec2(1,0)),f.x), mix(ph(i+vec2(0,1)),ph(i+vec2(1,1)),f.x), f.y); }
void main() {
  if (vT < 0.0 || vT > 1.0) discard;
  int k = int(vKind + 0.5);
  float r = length(vUv);
  float fadeIn = smoothstep(0.0, 0.06, vT);
  vec3 col = vec3(1.0);
  float a = 0.0;
  if (k == 0) { // smoke
    float n = pn(vUv * 1.8 + vSeed * 17.0) * 0.6 + pn(vUv * 3.7 - vSeed * 9.0) * 0.4;
    a = smoothstep(1.0, 0.15, r + (n - 0.5) * 0.5) * 0.55 * (1.0 - vT) * fadeIn;
    col = mix(vec3(0.14), vec3(0.3), vSeed) * mix(0.8, 1.5, vT) * uLight; // sooty, thinning out
  } else if (k == 1) { // cigarette
    a = smoothstep(1.0, 0.1, r) * 0.42 * (1.0 - vT) * fadeIn;
    col = vec3(0.78, 0.82, 0.88) * uLight;
  } else if (k == 2) { // fire
    a = smoothstep(1.0, 0.0, r) * (1.0 - vT);
    col = mix(vec3(4.0, 2.7, 1.0), vec3(2.4, 0.45, 0.06), smoothstep(0.0, 0.7, vT));
  } else if (k == 3) { // dust
    float n = pn(vUv * 2.2 + vSeed * 13.0);
    a = smoothstep(1.0, 0.2, r + (n - 0.5) * 0.4) * 0.5 * (1.0 - vT) * fadeIn;
    col = vec3(0.56, 0.47, 0.34) * uLight;
  } else if (k == 4) { // spark
    a = pow(smoothstep(1.0, 0.0, r), 3.0) * (1.0 - vT * vT);
    col = vec3(6.0, 3.8, 1.2);
  } else if (k == 5) { // steam
    float n = pn(vUv * 1.6 + vSeed * 11.0);
    a = smoothstep(1.0, 0.1, r + (n - 0.5) * 0.45) * 0.45 * pow(1.0 - vT, 1.5) * fadeIn;
    col = vec3(0.95) * uLight;
  } else if (k == 6) { // confetti
    vec2 q = abs(vUv);
    a = step(q.x, 0.8) * step(q.y, 0.45);
    float pick = fract(vSeed * 7.0);
    col = pick < 0.2 ? vec3(0.56, 0.9, 0.03) : pick < 0.4 ? vec3(1.0, 0.1, 0.45) : pick < 0.6 ? vec3(0.1, 0.7, 1.0) : pick < 0.8 ? vec3(1.0, 0.8, 0.05) : vec3(0.45, 0.02, 0.03);
    col *= 0.6 + 0.6 * uLight;
    a *= smoothstep(1.0, 0.85, vT);
  } else if (k == 7) { // money
    vec2 q = abs(vUv);
    a = step(q.x, 0.95) * step(q.y, 0.9);
    float border = step(0.78, q.x) + step(0.7, q.y);
    float seal = smoothstep(0.34, 0.28, length(vUv * vec2(1.0, 0.6)));
    col = mix(vec3(0.24, 0.42, 0.2), vec3(0.62, 0.74, 0.55), clamp(border, 0.0, 1.0));
    col = mix(col, vec3(0.12, 0.25, 0.1), seal);
    col *= 0.5 + 0.7 * uLight;
    a *= smoothstep(1.0, 0.85, vT);
  } else { // splash
    a = smoothstep(1.0, 0.3, r) * 0.8 * (1.0 - vT);
    col = vec3(0.8, 0.9, 1.0) * (0.4 + 0.8 * uLight);
  }
  if (a < 0.004) discard;
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

class Pool {
  readonly mesh: THREE.Mesh;
  readonly p0: Float32Array;
  readonly v: Float32Array;
  readonly k: Float32Array;
  private attrs: THREE.InstancedBufferAttribute[];
  head = 0;
  dirtyMin = Infinity;
  dirtyMax = -1;

  constructor(readonly size: number, mat: THREE.ShaderMaterial) {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('corner', new THREE.BufferAttribute(new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), 2));
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.p0 = new Float32Array(size * 4);
    this.v = new Float32Array(size * 4);
    this.k = new Float32Array(size * 4);
    const a0 = new THREE.InstancedBufferAttribute(this.p0, 4).setUsage(THREE.DynamicDrawUsage);
    const a1 = new THREE.InstancedBufferAttribute(this.v, 4).setUsage(THREE.DynamicDrawUsage);
    const a2 = new THREE.InstancedBufferAttribute(this.k, 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aP0', a0);
    g.setAttribute('aV', a1);
    g.setAttribute('aK', a2);
    g.instanceCount = size;
    this.attrs = [a0, a1, a2];
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
  }

  next(): number {
    const i = this.head;
    this.head = (this.head + 1) % this.size;
    if (i < this.dirtyMin) this.dirtyMin = i;
    if (i > this.dirtyMax) this.dirtyMax = i;
    return i;
  }

  flush() {
    if (this.dirtyMax < 0) return;
    const start = this.dirtyMin, count = this.dirtyMax - this.dirtyMin + 1;
    for (const a of this.attrs) {
      a.clearUpdateRanges();
      a.addUpdateRange(start * 4, count * 4);
      a.needsUpdate = true;
    }
    this.dirtyMin = Infinity;
    this.dirtyMax = -1;
  }
}

export class Particles {
  /** Breeze (m/s, x/z) that carries smoke, steam and paper. The game copies WeatherSystem.wind here. */
  readonly wind = new THREE.Vector2(0.8, 0.4);
  /** 0 day .. 1 night: dims unlit particles (smoke, dust) after dark. */
  night = 0;
  /** Drawing-buffer height in pixels (set on resize; quads are world-sized, so it's informational). */
  pxH = 800;
  private wind3 = new THREE.Vector3();
  private normal: Pool;
  private additive: Pool;
  private time = 0;
  private uniforms: Record<string, THREE.IUniform>[] = [];
  private scale: number;

  constructor(scene: THREE.Scene, q: Quality) {
    const low = q.name === 'low';
    this.scale = low ? 0.5 : 1;
    const mk = (blending: THREE.Blending) => {
      const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uLight: { value: 1 } }]);
      uniforms.uWind = { value: this.wind3 };
      this.uniforms.push(uniforms);
      return new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending, fog: true, side: THREE.DoubleSide });
    };
    this.normal = new Pool(low ? 1800 : 6000, mk(THREE.NormalBlending));
    this.additive = new Pool(low ? 700 : 2500, mk(THREE.AdditiveBlending));
    this.additive.mesh.renderOrder = 5;
    scene.add(this.normal.mesh, this.additive.mesh);
  }

  emit(kind: ParticleKind, x: number, y: number, z: number, opts: EmitOpts = NO_OPTS) {
    const s = SPECS[kind];
    if (!s) return;
    const pool = s.additive ? this.additive : this.normal;
    const n = Math.max(1, Math.round((opts.count ?? s.count) * this.scale));
    const spread = opts.spread ?? s.spread;
    const vx = opts.vel ? opts.vel[0] : s.vel[0];
    const vy = opts.vel ? opts.vel[1] : s.vel[1];
    const vz = opts.vel ? opts.vel[2] : s.vel[2];
    const sz = opts.size ?? 1;
    const life = opts.life ?? s.life;
    const J = s.jitter;
    // ground-hugging puffs start half a size up so the terrain doesn't slice them flat
    if (kind === 'dust' || kind === 'smoke' || kind === 'steam') y += s.size[0] * sz * 0.6;
    for (let c = 0; c < n; c++) {
      const i = pool.next() * 4;
      // uniform-ish point in a sphere
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, rr = Math.cbrt(Math.random()) * spread;
      const sq = Math.sqrt(1 - u * u);
      pool.p0[i] = x + Math.cos(th) * sq * rr;
      pool.p0[i + 1] = y + u * rr * 0.5;
      pool.p0[i + 2] = z + Math.sin(th) * sq * rr;
      pool.p0[i + 3] = this.time;
      pool.v[i] = vx + (Math.random() - 0.5) * J;
      pool.v[i + 1] = vy + (Math.random() - 0.5) * J * (kind === 'spark' || kind === 'splash' ? 0.8 : 0.4);
      pool.v[i + 2] = vz + (Math.random() - 0.5) * J;
      pool.v[i + 3] = life * (0.75 + Math.random() * 0.5);
      pool.k[i] = s.id;
      pool.k[i + 1] = s.size[0] * sz * (0.8 + Math.random() * 0.4);
      pool.k[i + 2] = s.size[1] * sz * (0.8 + Math.random() * 0.4);
      pool.k[i + 3] = Math.random();
    }
  }

  update(dt: number, camera: THREE.Camera) {
    void camera;
    this.time += dt;
    this.wind3.set(this.wind.x, 0, this.wind.y);
    const light = 1 - this.night * 0.7;
    for (const u of this.uniforms) {
      u.uTime.value = this.time;
      u.uLight.value = light;
    }
    this.normal.flush();
    this.additive.flush();
  }
}
