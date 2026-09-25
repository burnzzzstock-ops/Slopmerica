// CPU-simulated, GPU-drawn particles: chimney and exhaust smoke, cigarette
// wisps, fires, construction dust, sparks, steam, confetti, money and splashes.
// Two point clouds (alpha-blended and additive) with fixed ring buffers.
import * as THREE from 'three';
import type { Quality } from '../config';
import type { ParticleKind } from '../contracts';

export interface EmitOpts {
  count?: number;
  spread?: number; // meters
  vel?: [number, number, number];
  size?: number;
  life?: number; // seconds
}

interface KindDef {
  add: boolean; // additive blending
  life: [number, number];
  size: [number, number]; // start, end (m)
  vel: [number, number, number]; // base velocity
  jitter: number; // random velocity
  grav: number;
  drag: number;
  colors: number[];
  alpha: number;
  shape: 0 | 1; // 0 soft puff, 1 flat chip (confetti / bills)
  wind: number; // how much the breeze carries it
}

const KINDS: Record<ParticleKind, KindDef> = {
  smoke: { add: false, life: [4, 7], size: [1.4, 7], vel: [0, 2.2, 0], jitter: 0.6, grav: -0.15, drag: 0.35, colors: [0x6d6a66, 0x55524e, 0x807c76], alpha: 0.45, shape: 0, wind: 1 },
  cigarette: { add: false, life: [1.6, 2.8], size: [0.12, 0.7], vel: [0, 0.55, 0], jitter: 0.12, grav: -0.05, drag: 0.8, colors: [0xd9d6d0, 0xc8c6c2], alpha: 0.4, shape: 0, wind: 0.6 },
  fire: { add: true, life: [0.5, 1.1], size: [1.3, 0.2], vel: [0, 3.2, 0], jitter: 0.8, grav: -1, drag: 0.6, colors: [0xff8a2a, 0xffb347, 0xff5a1a], alpha: 0.9, shape: 0, wind: 0.3 },
  dust: { add: false, life: [2, 4], size: [1.5, 6], vel: [0, 0.8, 0], jitter: 2.2, grav: 0.1, drag: 0.9, colors: [0xa38b6a, 0x8e7a5e, 0xb49c78], alpha: 0.45, shape: 0, wind: 0.8 },
  spark: { add: true, life: [0.3, 0.8], size: [0.25, 0.05], vel: [0, 3, 0], jitter: 5, grav: 9.8, drag: 0.2, colors: [0xffd27a, 0xfff0b0, 0xff9a3a], alpha: 1, shape: 0, wind: 0 },
  steam: { add: false, life: [2, 4], size: [1, 5], vel: [0, 2.5, 0], jitter: 0.4, grav: -0.2, drag: 0.4, colors: [0xf2f2f2, 0xe6e8ea], alpha: 0.4, shape: 0, wind: 0.9 },
  confetti: { add: false, life: [2.2, 3.6], size: [0.45, 0.45], vel: [0, 6, 0], jitter: 4, grav: 5, drag: 1.4, colors: [0xc6f432, 0xff4fa3, 0x4fc3ff, 0xffd23a, 0xffffff], alpha: 1, shape: 1, wind: 0.4 },
  money: { add: false, life: [2.5, 4], size: [0.7, 0.7], vel: [0, 5, 0], jitter: 3, grav: 3.5, drag: 1.6, colors: [0x6fbf5a, 0x8fd37a, 0x5aa44a], alpha: 1, shape: 1, wind: 0.5 },
  splash: { add: false, life: [0.5, 0.9], size: [0.4, 1.2], vel: [0, 4, 0], jitter: 2, grav: 9.8, drag: 0.3, colors: [0xe8f4ff, 0xcfe6f5], alpha: 0.7, shape: 0, wind: 0 },
};
const KIND_LIST = Object.keys(KINDS) as ParticleKind[];

class Pool {
  readonly points: THREE.Points;
  private cap: number;
  private head = 0;
  // simulation state
  private p: Float32Array; // x y z
  private v: Float32Array; // vx vy vz
  private age: Float32Array;
  private life: Float32Array;
  private kind: Uint8Array;
  private col: Float32Array; // r g b
  private seed: Float32Array;
  private size0: Float32Array;
  private size1: Float32Array;
  // draw buffers
  private aPos: THREE.BufferAttribute;
  private aCol: THREE.BufferAttribute; // rgba
  private aSize: THREE.BufferAttribute;
  private aShape: THREE.BufferAttribute;
  readonly mat: THREE.ShaderMaterial;

  constructor(scene: THREE.Scene, cap: number, additive: boolean) {
    this.cap = cap;
    this.p = new Float32Array(cap * 3);
    this.v = new Float32Array(cap * 3);
    this.age = new Float32Array(cap).fill(1e9);
    this.life = new Float32Array(cap).fill(1);
    this.kind = new Uint8Array(cap);
    this.col = new Float32Array(cap * 3);
    this.seed = new Float32Array(cap);
    this.size0 = new Float32Array(cap);
    this.size1 = new Float32Array(cap);
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(new Float32Array(cap * 2), 2).setUsage(THREE.DynamicDrawUsage);
    this.aShape = new THREE.BufferAttribute(new Float32Array(cap), 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('aCol', this.aCol);
    g.setAttribute('aSize', this.aSize);
    g.setAttribute('aShape', this.aShape);
    g.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uScale: { value: 800 }, uLight: { value: 1 } }]),
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      fog: true,
      vertexShader: /* glsl */ `
        #include <common>
        #include <fog_pars_vertex>
        attribute vec4 aCol;
        attribute vec2 aSize; // size (m), rotation seed
        attribute float aShape;
        uniform float uScale;
        varying vec4 vCol;
        varying float vShape, vRot;
        void main() {
          vCol = aCol;
          vShape = aShape;
          vRot = aSize.y;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = clamp(aSize.x * uScale / -mvPosition.z, 1.0, 256.0);
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        #include <common>
        #include <fog_pars_fragment>
        uniform float uLight;
        varying vec4 vCol;
        varying float vShape, vRot;
        void main() {
          vec2 q = gl_PointCoord - 0.5;
          float a;
          if (vShape > 0.5) {
            // tumbling paper chip: rotated, squashed rectangle
            float c = cos(vRot), s = sin(vRot);
            vec2 r = vec2(c * q.x - s * q.y, s * q.x + c * q.y);
            a = step(abs(r.x), 0.42) * step(abs(r.y), 0.22 + 0.2 * abs(sin(vRot * 1.7)));
          } else {
            float d = length(q);
            float n = fract(sin(dot(floor(gl_PointCoord * 6.0) + vRot, vec2(12.9898, 78.233))) * 43758.5453);
            a = smoothstep(0.5, 0.1, d) * (0.8 + 0.2 * n);
          }
          a *= vCol.a;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vCol.rgb * uLight, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
    scene.add(this.points);
  }

  spawn(k: ParticleKind, x: number, y: number, z: number, spread: number, vel: [number, number, number] | undefined, size: number | undefined, life: number | undefined) {
    const d = KINDS[k];
    const i = this.head;
    this.head = (this.head + 1) % this.cap;
    const r = Math.random;
    this.p[i * 3] = x + (r() - 0.5) * spread;
    this.p[i * 3 + 1] = y + (r() - 0.5) * spread * 0.3;
    this.p[i * 3 + 2] = z + (r() - 0.5) * spread;
    const bv = vel ?? d.vel;
    this.v[i * 3] = bv[0] + (r() - 0.5) * d.jitter;
    this.v[i * 3 + 1] = bv[1] + (r() - 0.3) * d.jitter;
    this.v[i * 3 + 2] = bv[2] + (r() - 0.5) * d.jitter;
    this.age[i] = 0;
    this.life[i] = life ?? d.life[0] + r() * (d.life[1] - d.life[0]);
    this.kind[i] = KIND_LIST.indexOf(k);
    const c = new THREE.Color(d.colors[Math.floor(r() * d.colors.length)]);
    this.col[i * 3] = c.r;
    this.col[i * 3 + 1] = c.g;
    this.col[i * 3 + 2] = c.b;
    this.seed[i] = r() * 100;
    const sc = size ?? 1;
    this.size0[i] = d.size[0] * sc * (0.8 + r() * 0.4);
    this.size1[i] = d.size[1] * sc * (0.8 + r() * 0.4);
  }

  update(dt: number, wind: THREE.Vector2, time: number) {
    let n = 0;
    const P = this.aPos.array as Float32Array, C = this.aCol.array as Float32Array, S = this.aSize.array as Float32Array, H = this.aShape.array as Float32Array;
    for (let i = 0; i < this.cap; i++) {
      if (this.age[i] >= this.life[i]) continue;
      const d = KINDS[KIND_LIST[this.kind[i]]];
      this.age[i] += dt;
      const t = this.age[i] / this.life[i];
      if (t >= 1) continue;
      const damp = Math.exp(-d.drag * dt);
      this.v[i * 3] = this.v[i * 3] * damp + wind.x * d.wind * dt;
      this.v[i * 3 + 1] = this.v[i * 3 + 1] * damp - d.grav * dt;
      this.v[i * 3 + 2] = this.v[i * 3 + 2] * damp + wind.y * d.wind * dt;
      if (d.shape === 1) {
        // flutter
        this.v[i * 3] += Math.sin(time * 5 + this.seed[i]) * 2.5 * dt;
        this.v[i * 3 + 2] += Math.cos(time * 4 + this.seed[i]) * 2.5 * dt;
        this.v[i * 3 + 1] = Math.max(this.v[i * 3 + 1], -2.2);
      }
      this.p[i * 3] += this.v[i * 3] * dt;
      this.p[i * 3 + 1] += this.v[i * 3 + 1] * dt;
      this.p[i * 3 + 2] += this.v[i * 3 + 2] * dt;
      P[n * 3] = this.p[i * 3];
      P[n * 3 + 1] = this.p[i * 3 + 1];
      P[n * 3 + 2] = this.p[i * 3 + 2];
      const fadeIn = Math.min(1, t * 8), fadeOut = 1 - t * t;
      C[n * 4] = this.col[i * 3];
      C[n * 4 + 1] = this.col[i * 3 + 1];
      C[n * 4 + 2] = this.col[i * 3 + 2];
      C[n * 4 + 3] = d.alpha * fadeIn * fadeOut;
      S[n * 2] = this.size0[i] + (this.size1[i] - this.size0[i]) * Math.sqrt(t);
      S[n * 2 + 1] = this.seed[i] + (d.shape === 1 ? time * 6 : t * 2);
      H[n] = d.shape;
      n++;
    }
    const g = this.points.geometry;
    g.setDrawRange(0, n);
    for (const [a, sz] of [[this.aPos, 3], [this.aCol, 4], [this.aSize, 2], [this.aShape, 1]] as const) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, Math.max(1, n) * sz);
      a.needsUpdate = true;
    }
    this.points.visible = n > 0;
  }
}

export class Particles {
  private normal: Pool;
  private additive: Pool;
  private time = 0;
  private budget: number;
  /** Breeze (m/s) the weather sets. */
  readonly wind = new THREE.Vector2(0.8, 0.4);
  /** 0 day .. 1 night: dims unlit particles (smoke, dust) after dark. */
  night = 0;

  constructor(scene: THREE.Scene, private q: Quality) {
    const big = q.name === 'high';
    this.normal = new Pool(scene, big ? 6000 : 2500, false);
    this.additive = new Pool(scene, big ? 1500 : 600, true);
    this.budget = big ? 1 : 0.5;
  }

  emit(kind: ParticleKind, x: number, y: number, z: number, opts: EmitOpts = {}) {
    const d = KINDS[kind];
    const count = Math.max(1, Math.round((opts.count ?? 1) * (kind === 'cigarette' ? 1 : this.budget)));
    const pool = d.add ? this.additive : this.normal;
    for (let i = 0; i < count; i++) pool.spawn(kind, x, y, z, opts.spread ?? 0.5, opts.vel, opts.size, opts.life);
  }

  update(dt: number, camera: THREE.Camera) {
    this.time += dt;
    const cam = camera as THREE.PerspectiveCamera;
    // world-size -> pixels: drawing-buffer height over the view height at 1 m
    const scale = (this.pxH || 800) / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov ?? 50) / 2));
    for (const p of [this.normal, this.additive]) {
      p.mat.uniforms.uScale.value = scale;
      p.update(Math.min(dt, 0.1), this.wind, this.time);
    }
    this.normal.mat.uniforms.uLight.value = 1 - this.night * 0.7;
  }

  /** Drawing-buffer height in pixels (set on resize). */
  pxH = 800;
}
