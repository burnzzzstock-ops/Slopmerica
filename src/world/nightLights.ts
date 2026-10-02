// Practical light after dark (playtest 5: "The observed night view was too dark
// to evaluate assets... Add practical lighting at entrances, streets, signs,
// parking areas, and civic sites"). Street lamps, shopfronts and their parking
// lots, office and apartment entrances, civic sites, factory yards and porches
// throw pools of light on the ground. The pools are painted top-down into one
// texture over the built-up area (repainted when roads or buildings change, a
// few times a second at most), and every ground-level surface (terrain, roads,
// lots, the bottom few metres of walls) adds that light times its own colour:
// a pool on asphalt stays asphalt-dark, one on a pale sidewalk reads bright,
// like real light. One texture read per pixel; nothing per lamp at run time.
import * as THREE from 'three';
import { GLOW } from '../config';
import type { Bld } from '../sim/buildings';

/** a pool of light on the ground */
export interface Pool {
  x: number;
  z: number;
  /** radius (m); rx/rz for an oval, turned by yaw */
  r: number;
  rz?: number;
  yaw?: number;
  /** 0..1 */
  k: number;
  kind: 'street' | 'shop' | 'cool' | 'porch';
}

/**
 * colours of the fixtures, as LINEAR light (painted as 0..255; the texture isn't colour-converted).
 * Owner, 2026-09-30: "make it cozy warm night lights": sodium, incandescent, amber. The old values
 * (street 255,178,104; shop 255,226,180; cool 196,214,255; porch 255,196,130) looked right as sRGB
 * but are used as linear, so on screen a sodium pool was a pale cream (255,218,171) and the yard
 * floods were 6500 K blue. These are the on-screen colours in the comments, encoded to linear
 * (scripts/nightwarmth.mjs).
 */
const TINT: Record<Pool['kind'], [number, number, number]> = {
  street: [255, 122, 40], // high-pressure sodium, ~2100 K: on screen 255,184,110
  shop: [255, 170, 100], // incandescent warm white, ~2900 K: shopfronts, entrances, civic (255,213,169)
  cool: [255, 196, 146], // floodlit yards and big lots, now warm-white LED ~3500 K (255,228,199)
  porch: [255, 132, 50], // an amber porch bulb (255,191,122)
};

/** how bright a full pool is, on top of the surface's own colour (tuned with scripts/nighttest.mjs) */
// (1.85 before the sodium tint above, which carries a quarter less luma: raised to keep the roads
// as readable; scripts/nighttest.mjs)
export const POOL_GAIN = 2.25;

export const LAMPS = {
  uLampMap: { value: null as THREE.Texture | null },
  /** minX, minZ, 1/width, 1/depth of the painted area */
  uLampRect: { value: new THREE.Vector4(0, 0, 0, 0) },
  /** 0 by day; POOL_GAIN at night (divided by the night exposure lift, like every other light source) */
  uLampOn: { value: 0 },
};

/**
 * How much of a pool's light a tree takes, against the ground's 1: TREE_LAMP for the civic street trees (their foliage is a pale PBR
 * texture), FOREST_LAMP for the forest trees' near meshes (a darker leaf atlas tinted by a dark instance colour, so they take more to read
 * as much). Uniforms, so a test page can sweep them (scripts/nightlook.mjs).
 */
export const TREE_LAMP = { value: 1 };
export const FOREST_LAMP = { value: 3 };
/**
 * Car paint and glass at night, as a share of the pool's light the gloss throws back: x on the panels that face up (the lamp overhead,
 * mirrored), y along the grazing edges (the outline of the car), z on the sides (the lamp-lit ground, mirrored). Uniform so the same
 * test page can sweep it.
 */
export const CAR_SHEEN = { value: new THREE.Vector3(0.6, 0.3, 0.05) };

/** GLSL: uniforms for the fragment shader */
export const LAMP_PARS = /* glsl */ `
uniform sampler2D uLampMap;
uniform vec4 uLampRect;
uniform float uLampOn;
vec3 lampPool(vec3 wp) {
  vec2 luv = (wp.xz - uLampRect.xy) * uLampRect.zw;
  if (uLampOn < 0.001 || any(lessThan(luv, vec2(0.0))) || any(greaterThan(luv, vec2(1.0)))) return vec3(0.0);
  return texture2D(uLampMap, luv).rgb * uLampOn;
}`;

/** GLSL: add the pool light at world position `wp`, scaled by `k` (a float expression), into the emissive term */
export const lampAdd = (wp: string, k = '1.0') => /* glsl */ `
totalEmissiveRadiance += diffuseColor.rgb * lampPool(${wp}) * (${k});`;

/** hook the uniforms into a compiled shader */
export function bindLamps(sh: { uniforms: Record<string, THREE.IUniform> }) {
  sh.uniforms.uLampMap = LAMPS.uLampMap;
  sh.uniforms.uLampRect = LAMPS.uLampRect;
  sh.uniforms.uLampOn = LAMPS.uLampOn;
}

/**
 * Give a plain MeshStandardMaterial (roads, sidewalks) the pools. Chains any
 * onBeforeCompile the material already has.
 */
export function litByLamps(mat: THREE.MeshStandardMaterial, share?: { name: string; u: THREE.IUniform<number> }) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r);
    bindLamps(sh);
    if (share) sh.uniforms[share.name] = share.u;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLampW;')
      .replace('#include <project_vertex>', `#include <project_vertex>
{
  vec4 lw = vec4(transformed, 1.0);
#ifdef USE_BATCHING
  lw = batchingMatrix * lw;
#endif
#ifdef USE_INSTANCING
  lw = instanceMatrix * lw;
#endif
  vLampW = (modelMatrix * lw).xyz;
}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vLampW;\n${share ? `uniform float ${share.name};\n` : ''}${LAMP_PARS}`)
      .replace('#include <lights_physical_fragment>', `${lampAdd('vLampW', share?.name ?? '1.0')}\n#include <lights_physical_fragment>`);
  };
  const key = mat.customProgramCacheKey.bind(mat);
  mat.customProgramCacheKey = () => key() + (share ? `|lamps:${share.name}` : '|lamps');
  mat.needsUpdate = true;
}

/** Paints the pools. Owned by the game; fed by the roads and buildings. */
export class NightLights {
  private canvas = document.createElement('canvas');
  private tex: THREE.CanvasTexture;
  private sprites = new Map<Pool['kind'], HTMLCanvasElement>();
  private dirty = true;
  private wait = 0;
  pools = 0;

  constructor(private size: number, private collect: () => Pool[]) {
    this.canvas.width = this.canvas.height = size;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.NoColorSpace; // the pixels are light, not colours to convert
    this.tex.generateMipmaps = false;
    this.tex.minFilter = this.tex.magFilter = THREE.LinearFilter;
    this.tex.flipY = false; // canvas row 0 is the area's north edge (min z), like the uv
    this.tex.wrapS = this.tex.wrapT = THREE.ClampToEdgeWrapping;
    LAMPS.uLampMap.value = this.tex;
    for (const kind of Object.keys(TINT) as Pool['kind'][]) {
      const s = document.createElement('canvas');
      s.width = s.height = 64;
      const c = s.getContext('2d')!, [r, g, b] = TINT[kind];
      const grad = c.createRadialGradient(32, 32, 0, 32, 32, 32);
      // bright under the lamp, a long soft tail
      for (const [t, a] of [[0, 1], [0.25, 0.72], [0.5, 0.36], [0.75, 0.11], [1, 0]]) grad.addColorStop(t, `rgba(${r},${g},${b},${a})`);
      c.fillStyle = grad;
      c.fillRect(0, 0, 64, 64);
      this.sprites.set(kind, s);
    }
  }

  /** the roads or buildings changed */
  invalidate() {
    this.dirty = true;
  }

  /** night 0..1; repaints (throttled) when something changed and it's dark enough to matter */
  update(dt: number, night: number) {
    const on = THREE.MathUtils.smoothstep(night, 0.15, 0.7);
    LAMPS.uLampOn.value = on * POOL_GAIN * GLOW.value;
    this.wait -= dt;
    if (on > 0 && this.dirty && this.wait <= 0) this.paint();
  }

  /** repaint now (tests, loading a save at night) */
  paint() {
    this.dirty = false;
    this.wait = 0.5;
    const pools = this.collect();
    this.pools = pools.length;
    const ctx = this.canvas.getContext('2d')!;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.size, this.size);
    if (!pools.length) {
      LAMPS.uLampRect.value.set(0, 0, 0, 0);
      this.tex.needsUpdate = true;
      return;
    }
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const p of pools) {
      const r = Math.max(p.r, p.rz ?? 0);
      x0 = Math.min(x0, p.x - r); x1 = Math.max(x1, p.x + r);
      z0 = Math.min(z0, p.z - r); z1 = Math.max(z1, p.z + r);
    }
    // a square area (one scale both ways), a texel or two of black border so the edge clamps dark
    const span = Math.max(x1 - x0, z1 - z0, 64) * (1 + 4 / this.size);
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const ox = cx - span / 2, oz = cz - span / 2, s = this.size / span;
    LAMPS.uLampRect.value.set(ox, oz, 1 / span, 1 / span);
    ctx.globalCompositeOperation = 'lighter';
    for (const p of pools) {
      const rx = p.r * s, rz = (p.rz ?? p.r) * s;
      if (rx < 0.4 && rz < 0.4) continue;
      ctx.globalAlpha = Math.min(1, p.k);
      ctx.setTransform(1, 0, 0, 1, (p.x - ox) * s, (p.z - oz) * s);
      if (p.yaw) ctx.rotate(-p.yaw);
      ctx.drawImage(this.sprites.get(p.kind)!, -rx, -rz, rx * 2, rz * 2);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    this.tex.needsUpdate = true;
  }
}

/**
 * Where the light falls: under every street lamp, and at each working lot a
 * fixture that fits it. Lots face +z (their road side).
 */
export function practicalPools(lamps: readonly { x: number; z: number; yaw: number }[], blds: Iterable<Bld>): Pool[] {
  const out: Pool[] = [];
  // the lamp head hangs 2 m out over the road; its pool is centred a little further out
  for (const L of lamps) out.push({ x: L.x - 3.5 * Math.sin(L.yaw), z: L.z - 3.5 * Math.cos(L.yaw), r: 14, k: 0.8, kind: 'street' });
  for (const b of blds) {
    if (b.state !== 'active' || b.abandoned !== undefined) continue;
    const fx = Math.sin(b.yaw), fz = Math.cos(b.yaw);
    const add = (f: number, side: number, r: number, k: number, kind: Pool['kind'], rz?: number) =>
      out.push({ x: b.x + fx * f + fz * side, z: b.z + fz * f - fx * side, r, rz, yaw: b.yaw, k, kind });
    const big = Math.max(b.hw, b.hd);
    const h = (((b.id + 1) * 2654435761) >>> 0) / 4294967296;
    switch (b.zone) {
      case 'comLow':
        // the shopfront and its parking out front
        add(b.hd * 0.3, 0, b.hw * 0.95, 0.5, 'shop', b.hd * 0.75);
        if (b.hw > 11) add(b.hd * 0.55, (h - 0.5) * b.hw, 9, 0.45, 'cool');
        break;
      case 'comHigh':
      case 'office':
        add(b.hd + 1, 0, Math.min(14, b.hw * 0.8), 0.55, 'shop', 6);
        break;
      case 'resHigh':
        add(b.hd + 0.5, 0, 6, 0.45, 'shop');
        break;
      case 'resLow':
        // a porch light at most houses
        if (h < 0.7) add(b.hd * 0.45, (h - 0.35) * b.hw, 3.6, 0.5, 'porch');
        break;
      case 'industry':
        add(b.hd * 0.35, -b.hw * 0.4, big * 0.6, 0.45, 'cool');
        add(-b.hd * 0.2, b.hw * 0.4, big * 0.5, 0.35, 'cool');
        break;
      case 'service':
        add(b.hd * 0.8, 0, Math.min(12, b.hw * 0.8), 0.65, 'shop', 7);
        add(0, 0, big * 0.9, 0.3, 'cool');
        break;
      case 'landmark':
        add(0, 0, big * 0.95, 0.45, 'shop');
        break;
    }
  }
  return out;
}
