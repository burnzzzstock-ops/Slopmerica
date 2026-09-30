// Everything the vehicles emit that isn't a solid model, in ONE instanced draw call (docs/HANDOFF_CARS_LOOK.md, items 3 and 4):
//   * lamp halos (headlamps, tail and brake lights, reverse, blinkers, sirens): additive soft discs that face the camera;
//   * headlight pools on the road ahead of a moving car at night, and the red glow behind a braking one;
//   * emergency-light tint on the ground around a siren;
//   * exhaust puffs (cold mornings, heavy trucks pulling away), dust off gravel roads and spray in rain.
// Blending is premultiplied (ONE, ONE_MINUS_SRC_ALPHA): a halo writes alpha 0 and adds; a puff writes its alpha and covers. So light and
// smoke share a single mesh, and it costs no draw call per car. The particles are simulated here on the CPU with a fixed pool.
import * as THREE from 'three';
import { GLOW } from '../config';
import { ATMOS } from '../world/atmos';

const TYPE_HALO = 0, TYPE_POOL = 1, TYPE_PUFF = 2, TYPE_DISC = 3;

export interface FxEnvironment { temperature: number; wet: number; rain: number; snow: number }

interface Particle { x: number; y: number; z: number; vx: number; vy: number; vz: number; age: number; life: number; s0: number; s1: number; r: number; g: number; b: number; a: number }

function fxMaterial(nightUniform: { value: number }, timeUniform: { value: number }): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: true, toneMapped: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendEquation: THREE.AddEquation,
    side: THREE.DoubleSide,
    uniforms: { uNight: nightUniform, uTime: timeUniform, uGlow: GLOW, uWet: ATMOS.uWet },
    vertexShader: /* glsl */ `
attribute vec4 iFx0; attribute vec4 iFx1; attribute vec4 iFx2;
varying vec2 vUv; varying vec4 vCol; varying float vType; varying float vAux;
void main() {
  vUv = position.xy + 0.5; vCol = iFx1; vType = iFx2.x; vAux = iFx2.z;
  vec3 c = iFx0.xyz; float size = iFx0.w;
  if (iFx2.x < 0.5 || (iFx2.x > 1.5 && iFx2.x < 2.5)) {            // halo, puff: a billboard
    vec4 mv = viewMatrix * vec4(c, 1.0);
    mv.xy += position.xy * size;
    gl_Position = projectionMatrix * mv;
  } else if (iFx2.x < 1.5) {                                        // pool: a strip along the ground, narrow at the car and wide at the far end
    float yaw = iFx2.y, pitch = iFx2.w;
    vec3 f = vec3(sin(yaw) * cos(pitch), -sin(pitch), cos(yaw) * cos(pitch));
    vec3 r = vec3(cos(yaw), 0.0, -sin(yaw));
    float t = vUv.y;
    float w = mix(0.3, 1.0, t) * vAux;
    vec3 p = c + f * (t * size) + r * (position.x * w);
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  } else {                                                          // disc on the ground
    vec3 p = c + vec3(position.x * size, 0.0, position.y * size);
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }
}`,
    fragmentShader: /* glsl */ `
uniform float uNight, uTime, uGlow, uWet;
varying vec2 vUv; varying vec4 vCol; varying float vType; varying float vAux;
void main() {
  vec2 q = vUv - 0.5;
  float d = length(q) * 2.0;
  if (vType < 0.5) {                                                // halo
    float a = pow(max(1.0 - d, 0.0), 2.4);
    float core = pow(max(1.0 - d * 1.9, 0.0), 2.0);
    vec3 col = vCol.rgb * (a * 0.7 + core * 1.6) * vCol.a * uGlow;
    gl_FragColor = vec4(col, 0.0);
  } else if (vType < 1.5) {                                         // headlight pool
    float along = vUv.y, across = abs(q.x) * 2.0;
    float a = pow(max(1.0 - along, 0.0), 1.5) * exp(-across * across * 2.6) * (1.0 - smoothstep(0.75, 1.0, across)) * smoothstep(0.0, 0.08, along);   // soft-edged, fading with distance
    float wetBoost = 1.0 + uWet * 0.6;
    gl_FragColor = vec4(vCol.rgb * a * vCol.a * wetBoost * uGlow, 0.0);
  } else if (vType < 2.5) {                                         // puff: covers what is behind it
    float a = pow(smoothstep(1.0, 0.0, d), 1.7) * vCol.a;                 // dense in the middle, thin at the edge: a wisp, not a disc
    gl_FragColor = vec4(vCol.rgb * a * (1.0 - 0.6 * uNight), a);           // (smoke takes the light of the hour: it is not a lamp)
  } else {                                                          // ground disc (siren tint, brake glow)
    float a = pow(max(1.0 - d, 0.0), 1.8);
    gl_FragColor = vec4(vCol.rgb * a * vCol.a * uGlow, 0.0);
  }
  if (gl_FragColor.a <= 0.0 && dot(gl_FragColor.rgb, vec3(1.0)) < 0.002) discard;
}`,
  });
  m.customProgramCacheKey = () => 'aa-vehicle-fx-v4';
  return m;
}

export class VehicleFx {
  readonly mesh: THREE.Mesh;
  private readonly cap: number;
  private readonly a0: THREE.InstancedBufferAttribute; private readonly a1: THREE.InstancedBufferAttribute; private readonly a2: THREE.InstancedBufferAttribute;
  private readonly f0: Float32Array; private readonly f1: Float32Array; private readonly f2: Float32Array;
  private n = 0;
  private readonly range = { start: 0, count: 0 };   // reused every frame (no allocation in the frame loop)
  private readonly attrs: THREE.InstancedBufferAttribute[];
  private readonly parts: Particle[] = [];
  private readonly maxParticles: number;
  private seed = 12345;
  env: FxEnvironment = { temperature: 15, wet: 0, rain: 0, snow: 0 };

  constructor(capacity: number, maxParticles: number, nightUniform: { value: number }, timeUniform: { value: number }) {
    this.cap = capacity + maxParticles;
    this.maxParticles = maxParticles;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    this.f0 = new Float32Array(this.cap * 4); this.f1 = new Float32Array(this.cap * 4); this.f2 = new Float32Array(this.cap * 4);
    this.a0 = new THREE.InstancedBufferAttribute(this.f0, 4).setUsage(THREE.DynamicDrawUsage);
    this.a1 = new THREE.InstancedBufferAttribute(this.f1, 4).setUsage(THREE.DynamicDrawUsage);
    this.a2 = new THREE.InstancedBufferAttribute(this.f2, 4).setUsage(THREE.DynamicDrawUsage);
    this.attrs = [this.a0, this.a1, this.a2];
    g.setAttribute('iFx0', this.a0); g.setAttribute('iFx1', this.a1); g.setAttribute('iFx2', this.a2);
    g.instanceCount = 0;
    // a plain Mesh on an InstancedBufferGeometry: Three draws geometry.instanceCount of it (an InstancedMesh would use its own count)
    this.mesh = new THREE.Mesh(g, fxMaterial(nightUniform, timeUniform));
    this.mesh.name = 'vehicle-fx'; this.mesh.frustumCulled = false; this.mesh.renderOrder = 5;
    this.mesh.castShadow = false; this.mesh.receiveShadow = false;
  }

  private rnd(): number { let x = this.seed; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.seed = x >>> 0; return this.seed / 4294967296; }

  begin(): void { this.n = 0; }

  private put(x: number, y: number, z: number, size: number, r: number, g: number, b: number, a: number, type: number, p1 = 0, p2 = 0, p3 = 0): void {
    if (this.n >= this.cap) return;
    const i = this.n++ * 4;
    this.f0[i] = x; this.f0[i + 1] = y; this.f0[i + 2] = z; this.f0[i + 3] = size;
    this.f1[i] = r; this.f1[i + 1] = g; this.f1[i + 2] = b; this.f1[i + 3] = a;
    this.f2[i] = type; this.f2[i + 1] = p1; this.f2[i + 2] = p2; this.f2[i + 3] = p3;
  }

  /** A soft glow of a lamp. `a` is its strength 0..~1.5. */
  halo(x: number, y: number, z: number, size: number, r: number, g: number, b: number, a: number): void {
    if (a > 0.01) this.put(x, y, z, size, r, g, b, a, TYPE_HALO);
  }
  /** A pool of light on the ground ahead: from (x, y, z) along `yaw`, `len` long, `width` wide at the far end. */
  pool(x: number, y: number, z: number, yaw: number, pitch: number, len: number, width: number, r: number, g: number, b: number, a: number): void {
    if (a > 0.01) this.put(x, y, z, len, r, g, b, a, TYPE_POOL, yaw, width, pitch);
  }
  /** A round glow on the ground (siren tint, brake glow on the road behind). */
  disc(x: number, y: number, z: number, radius: number, r: number, g: number, b: number, a: number): void {
    if (a > 0.01) this.put(x, y, z, radius * 2, r, g, b, a, TYPE_DISC);
  }

  // ------------------------------------------------------------------------------------------------------- particles
  private spawn(p: Particle): void {
    if (this.parts.length >= this.maxParticles) this.parts.shift();
    this.parts.push(p);
  }
  /** Exhaust: grey-white in the cold, dark soot from a diesel pulling away. */
  exhaust(x: number, y: number, z: number, vx: number, vz: number, heavy: boolean, cold: number): void {
    const soot = heavy && this.rnd() < 0.5;
    const shade = soot ? 0.16 : 0.78 + this.rnd() * 0.12;
    this.spawn({ x, y, z, vx: vx * 0.2 + (this.rnd() - 0.5) * 0.3, vy: 0.5 + this.rnd() * 0.3, vz: vz * 0.2 + (this.rnd() - 0.5) * 0.3, age: 0, life: 0.9 + cold * 1.4 + this.rnd() * 0.4, s0: 0.1, s1: soot ? 0.65 : 0.4 + cold * 0.4, r: shade, g: shade, b: shade * 1.02, a: soot ? 0.5 : 0.2 + cold * 0.25 });
  }
  /** Dust thrown off a gravel road by a wheel. */
  dust(x: number, y: number, z: number, vx: number, vz: number, speed: number): void {
    this.spawn({ x, y, z, vx: vx * 0.15 + (this.rnd() - 0.5) * 0.9, vy: 0.35 + this.rnd() * 0.45, vz: vz * 0.15 + (this.rnd() - 0.5) * 0.9, age: 0, life: 1.4 + this.rnd() * 0.9, s0: 0.3, s1: 1.4 + speed * 0.05, r: 0.62, g: 0.55, b: 0.44, a: 0.3 });
  }
  /** Rain spray off the tyres. */
  spray(x: number, y: number, z: number, vx: number, vz: number, speed: number): void {
    this.spawn({ x, y, z, vx: vx * 0.1 + (this.rnd() - 0.5) * 0.7, vy: 0.25 + this.rnd() * 0.35, vz: vz * 0.1 + (this.rnd() - 0.5) * 0.7, age: 0, life: 0.55 + this.rnd() * 0.35, s0: 0.2, s1: 0.8 + speed * 0.03, r: 0.85, g: 0.9, b: 0.95, a: 0.16 });
  }
  get particleCount(): number { return this.parts.length; }

  /** Advance the particles and write them, then hand the batch to the GPU. */
  end(dt: number): void {
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.age += dt;
      if (p.age >= p.life) { this.parts.splice(i, 1); continue; }
      const k = p.age / p.life;
      p.x += p.vx * dt; p.y += p.vy * dt * (1 - k * 0.6); p.z += p.vz * dt;
      p.vx *= 1 - dt * 0.8; p.vz *= 1 - dt * 0.8;
      const size = p.s0 + (p.s1 - p.s0) * Math.sqrt(k);
      const fade = (1 - k) * Math.min(1, k * 8);
      this.put(p.x, p.y, p.z, size, p.r, p.g, p.b, p.a * fade, TYPE_PUFF);
    }
    const g = this.mesh.geometry as THREE.InstancedBufferGeometry;
    g.instanceCount = this.n;
    this.mesh.visible = this.n > 0;
    this.range.count = this.n * 4;
    for (let k = 0; k < 3; k++) { const a = this.attrs[k]; a.updateRanges.length = 0; if (this.n) { a.updateRanges.push(this.range); a.needsUpdate = true; } }
  }
}
