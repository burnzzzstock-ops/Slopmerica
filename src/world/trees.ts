// Low-poly instanced trees in spatial chunks. Every tree can be cut (for lumber
// money) and counts toward the Nature meter. Seasons and wind live entirely in
// the shader: canopies bloom, turn, drop and bend without touching a buffer.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { HALF, WORLD, WATER } from '../config';
import { hash2, Rng } from '../core/rng';
import type { MapData, TreeKind } from './maps';
import type { Terrain } from './terrain';
import { atmo, GLSL_CLOUD_SHADOW } from './seasons';

const TREE_CHUNKS = 4;
const CH_SIZE = WORLD / TREE_CHUNKS;
const GRID = 12; // placement grid, meters

interface TreeRec {
  x: number;
  z: number;
  kind: TreeKind;
  chunk: number;
  slot: number;
  alive: boolean;
}

/**
 * Per-kind seasonal behaviour, baked into the `aLeaf` attribute:
 * x = how deciduous (bare in winter), y = how much autumn color,
 * z = crown pivot height (bare canopies shrink toward it), w = wind flex.
 */
const LEAF: Record<TreeKind, [number, number, number, number]> = {
  decid: [1, 1, 5.6, 1],
  pine: [0, 0, 0, 0.75],
  redwood: [0, 0, 0, 0.3],
  oak: [0.22, 0.35, 4.6, 0.55],
  palm: [0, 0, 0, 1.7],
  cypress: [0.5, 0.9, 11.4, 0.6],
  mangrove: [0, 0, 0, 0.5],
  shrub: [0.2, 0.45, 0.8, 0.5],
};

// ------------------------------------------------------------------ geometry
function paint(geo: THREE.BufferGeometry, r: number, g: number, b: number, canopy: number) {
  const n = geo.getAttribute('position').count;
  const c = new Float32Array(n * 3);
  const k = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    c[i * 3] = r; c[i * 3 + 1] = g; c[i * 3 + 2] = b;
    k[i] = canopy;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  geo.setAttribute('canopy', new THREE.BufferAttribute(k, 1));
  return geo;
}

function lumpy(geo: THREE.BufferGeometry, amt: number, seed: number) {
  const p = geo.getAttribute('position') as THREE.BufferAttribute;
  const rng = new Rng(seed);
  const map = new Map<string, number>();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(2)},${p.getY(i).toFixed(2)},${p.getZ(i).toFixed(2)}`;
    let s = map.get(key);
    if (s === undefined) { s = 1 + (rng.float() - 0.5) * amt; map.set(key, s); }
    p.setXYZ(i, p.getX(i) * s, p.getY(i) * (1 + (s - 1) * 0.5), p.getZ(i) * s);
  }
  return geo;
}

function nonIndexed(g: THREE.BufferGeometry) {
  return g.index ? g.toNonIndexed() : g;
}

function trunk(h: number, r0: number, r1: number) {
  const g = new THREE.CylinderGeometry(r1, r0, h, 6, 1);
  g.translate(0, h / 2, 0);
  return paint(nonIndexed(g), 0.36, 0.26, 0.18, 0);
}

function makeTree(kind: TreeKind): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  switch (kind) {
    case 'decid': {
      parts.push(trunk(4, 0.35, 0.25));
      const a = lumpy(nonIndexed(new THREE.IcosahedronGeometry(3.2, 1)), 0.35, 1);
      a.translate(0, 6.2, 0);
      const b = lumpy(nonIndexed(new THREE.IcosahedronGeometry(2.3, 0)), 0.3, 2);
      b.translate(1.4, 7.6, 0.6);
      parts.push(paint(a, 1, 1, 1, 1), paint(b, 1, 1, 1, 1));
      break;
    }
    case 'pine': {
      parts.push(trunk(3, 0.3, 0.2));
      for (let k = 0; k < 3; k++) {
        const c = nonIndexed(new THREE.ConeGeometry(2.8 - k * 0.7, 4.2 - k * 0.6, 7));
        c.translate(0, 4.2 + k * 2.4, 0);
        parts.push(paint(c, 1, 1, 1, 1));
      }
      break;
    }
    case 'redwood': {
      parts.push(paint(nonIndexed(new THREE.CylinderGeometry(0.7, 1.6, 30, 7).translate(0, 15, 0)), 0.5, 0.25, 0.16, 0));
      for (let k = 0; k < 4; k++) {
        const c = nonIndexed(new THREE.ConeGeometry(4.2 - k * 0.8, 9 - k, 7));
        c.translate(0, 20 + k * 6, 0);
        parts.push(paint(c, 1, 1, 1, 1));
      }
      break;
    }
    case 'oak': {
      parts.push(trunk(3, 0.5, 0.35));
      const a = lumpy(nonIndexed(new THREE.IcosahedronGeometry(4.2, 1)), 0.3, 3);
      a.scale(1.25, 0.55, 1.1);
      a.translate(0, 5, 0);
      parts.push(paint(a, 1, 1, 1, 1));
      break;
    }
    case 'palm': {
      const t = nonIndexed(new THREE.CylinderGeometry(0.22, 0.35, 9, 5));
      t.translate(0, 4.5, 0);
      const pos = t.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) pos.setX(i, pos.getX(i) + Math.pow(pos.getY(i) / 9, 2) * 1.4);
      parts.push(paint(t, 0.55, 0.45, 0.32, 0));
      for (let k = 0; k < 7; k++) {
        const f = nonIndexed(new THREE.PlaneGeometry(1.1, 4.2, 1, 2));
        const fp = f.getAttribute('position') as THREE.BufferAttribute;
        for (let i = 0; i < fp.count; i++) fp.setZ(i, -Math.pow((fp.getY(i) + 2.1) / 4.2, 2) * 1.6);
        f.rotateX(-Math.PI / 2 + 0.35);
        f.translate(0, 0, 2.1);
        f.rotateY((k / 7) * Math.PI * 2);
        f.translate(1.4, 9, 0);
        parts.push(paint(f, 1, 1, 1, 1));
      }
      break;
    }
    case 'cypress': {
      parts.push(paint(nonIndexed(new THREE.CylinderGeometry(0.3, 1.1, 11, 6).translate(0, 5.5, 0)), 0.45, 0.36, 0.28, 0));
      const a = lumpy(nonIndexed(new THREE.IcosahedronGeometry(3.4, 0)), 0.3, 4);
      a.scale(1.3, 0.45, 1.3);
      a.translate(0, 11.5, 0);
      parts.push(paint(a, 1, 1, 1, 1));
      // Spanish moss drapes
      for (let k = 0; k < 4; k++) {
        const m = nonIndexed(new THREE.ConeGeometry(0.6, 3.2, 4));
        m.rotateX(Math.PI);
        m.translate(Math.cos(k * 1.6) * 2.2, 9.4, Math.sin(k * 1.6) * 2.2);
        parts.push(paint(m, 0.6, 0.65, 0.55, 0));
      }
      break;
    }
    case 'mangrove': {
      const a = lumpy(nonIndexed(new THREE.IcosahedronGeometry(2.6, 1)), 0.4, 5);
      a.scale(1.3, 0.7, 1.2);
      a.translate(0, 2.4, 0);
      parts.push(paint(a, 1, 1, 1, 1));
      for (let k = 0; k < 5; k++) {
        const r = nonIndexed(new THREE.CylinderGeometry(0.08, 0.12, 2.4, 3));
        r.rotateZ(0.5);
        r.translate(0.6, 1, 0);
        r.rotateY((k / 5) * Math.PI * 2);
        parts.push(paint(r, 0.4, 0.33, 0.25, 0));
      }
      break;
    }
    case 'shrub': {
      const a = lumpy(nonIndexed(new THREE.IcosahedronGeometry(1.4, 0)), 0.4, 6);
      a.scale(1.2, 0.8, 1.2);
      a.translate(0, 0.9, 0);
      parts.push(paint(a, 1, 1, 1, 1));
      break;
    }
  }
  const g = mergeGeometries(parts, false)!;
  g.computeVertexNormals();
  const n = g.getAttribute('position').count;
  const leaf = new Float32Array(n * 4);
  const L = LEAF[kind];
  for (let i = 0; i < n; i++) leaf.set(L, i * 4);
  g.setAttribute('aLeaf', new THREE.BufferAttribute(leaf, 4));
  return g;
}

/** Summer canopy color per instance. Spring, fall, bloom and winter are derived in the shader. */
function canopyColor(mapId: string, kind: TreeKind, rng: Rng, c: THREE.Color) {
  if (kind === 'decid' && mapId === 'appalachia') {
    const opts = [0x3f6e27, 0x4b7a2b, 0x557f2f, 0x3d6a2f, 0x62883a, 0x35612a, 0x4f7a36];
    return c.setHex(opts[Math.floor(rng.float() * opts.length)]).offsetHSL((rng.float() - 0.5) * 0.02, 0, (rng.float() - 0.5) * 0.06);
  }
  const base: Record<TreeKind, number> = {
    decid: 0x557f33, pine: 0x2f5a30, redwood: 0x2c5230, oak: 0x55703a, palm: 0x5f9a3a, cypress: 0x5d7a3a, mangrove: 0x3f6e2e, shrub: 0x6a8440,
  };
  return c.setHex(base[kind]).offsetHSL((rng.float() - 0.5) * 0.04, (rng.float() - 0.5) * 0.1, (rng.float() - 0.5) * 0.1);
}

// ------------------------------------------------------------------ shaders
const TREE_VERT_COMMON = /* glsl */ `
attribute float canopy;
attribute vec4 aLeaf;
uniform float uWind; // seconds (Trees.wind)
uniform vec2 uWindDir;
uniform float uWindStrength, uBare;
float treeHash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float treeBare(float h2){ return clamp(uBare * aLeaf.x * 1.2 - h2 * 0.2, 0.0, 1.0); }
// Winter shrink + wind bend, in the tree's local space.
vec3 treeDeform(vec3 p, vec3 ip, mat3 im) {
  float h1 = treeHash(ip.xz);
  float h2 = fract(h1 * 7.13 + 0.37);
  float bareT = treeBare(h2) * canopy;
  p.xz *= 1.0 - bareT * 0.45;
  p.y = mix(p.y, aLeaf.z + (p.y - aLeaf.z) * 0.78, bareT);
  float hw = max(p.y, 0.0) * length(im[1]);
  float ws = uWindStrength;
  float gust = sin(uWind * (1.2 + ws * 2.2) + ip.x * 0.045 + ip.z * 0.06) * 0.6 + sin(uWind * 3.1 + h1 * 6.28) * 0.4;
  float amt = hw * hw * 0.004 * aLeaf.w * (ws * ws * 2.4 + gust * (0.1 + ws * 0.75));
  vec3 wOff = vec3(uWindDir.x * amt, -abs(amt) * 0.12, uWindDir.y * amt);
  return p + (transpose(im) * wOff) / max(dot(im[0], im[0]), 1e-4); // cut trees are zero-scaled
}`;

const TREE_BEGIN = /* glsl */ `#include <begin_vertex>
#ifdef USE_INSTANCING
  transformed = treeDeform(transformed, instanceMatrix[3].xyz, mat3(instanceMatrix));
#endif`;

const TREE_COLOR = /* glsl */ `
vColor = vec4(1.0);
#ifdef USE_COLOR
  vColor.rgb *= color;
#endif
vTreeCanopy = canopy;
#if defined( USE_INSTANCING_COLOR ) && defined( USE_INSTANCING )
{
  vec3 ip = instanceMatrix[3].xyz;
  float h1 = treeHash(ip.xz);
  float h2 = fract(h1 * 7.13 + 0.37);
  float h3 = fract(h1 * 13.71 + 0.11);
  float stand = treeHash(floor(ip.xz / 90.0) + 0.5);
  vec3 base = instanceColor.rgb;
  float bl = dot(base, vec3(0.2126, 0.7152, 0.0722));
  // spring: pale, yellow-green new leaves
  base = mix(base, vec3(bl) * vec3(1.0, 1.65, 0.4) + base * 0.15, uFresh * aLeaf.x * 0.85);
  // autumn: stands share a palette, each tree turns on its own schedule
  float turn = clamp((uFall - h1 * 0.4) / 0.6, 0.0, 1.0) * aLeaf.y;
  float pick = fract(h3 + stand * 0.65);
  vec3 fc = pick < 0.22 ? vec3(0.52, 0.035, 0.02)
          : pick < 0.45 ? vec3(0.82, 0.18, 0.015)
          : pick < 0.68 ? vec3(0.82, 0.48, 0.02)
          : pick < 0.84 ? vec3(0.27, 0.075, 0.016)
          : pick < 0.93 ? vec3(0.42, 0.03, 0.06)
          : vec3(0.38, 0.42, 0.05);
  base = mix(base, fc, turn);
  // redbud and dogwood bloom before the canopy fills in
  vec3 bc = h3 < 0.075 ? vec3(0.62, 0.09, 0.34) : vec3(0.86, 0.84, 0.78);
  base = mix(base, bc, uBlossom * step(h3, 0.14) * aLeaf.x);
  // winter-weary evergreens, summer-dry broadleaves
  base *= mix(vec3(1.0), vec3(0.8, 0.83, 0.8), uDull * (1.0 - aLeaf.x));
  base = mix(base, base * vec3(1.3, 1.02, 0.5), uDry * step(0.01, aLeaf.y) * 0.7);
  // bare: grey twigs; oaks hang on to brown leaves all winter
  vec3 twig = (pick > 0.68 && pick < 0.84) ? vec3(0.14, 0.06, 0.025) : vec3(0.065, 0.052, 0.05) * (0.8 + h1 * 0.4);
  base = mix(base, twig, treeBare(h2));
  vColor.rgb *= mix(vec3(1.0), base, canopy);
}
#endif`;

export function treeMaterial(windUniform: { value: number }) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, flatShading: true });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, {
      uWind: windUniform, uWindDir: atmo.uWindDir, uWindStrength: atmo.uWindStrength, uBare: atmo.uBare, uFall: atmo.uFall,
      uFresh: atmo.uFresh, uBlossom: atmo.uBlossom, uDull: atmo.uDull, uDry: atmo.uDry, uTreeSnow: atmo.uTreeSnow, uSnowLine: atmo.uSnowLine, uWet: atmo.uWet,
      uCloudCover: atmo.uCloudCover, uCloudShadow: atmo.uCloudShadow, uCloudOffset: atmo.uCloudOffset,
    });
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
${TREE_VERT_COMMON}
uniform float uFall, uFresh, uBlossom, uDull, uDry;
varying float vTreeCanopy;
varying vec3 vTreeW;`,
      )
      .replace('#include <color_vertex>', TREE_COLOR)
      .replace('#include <begin_vertex>', TREE_BEGIN)
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
{ vec4 tw = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
  tw = instanceMatrix * tw;
#endif
  vTreeW = (modelMatrix * tw).xyz; }`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying float vTreeCanopy;
varying vec3 vTreeW;
uniform float uTreeSnow, uSnowLine, uWet, uCloudCover, uCloudShadow;
uniform vec2 uCloudOffset;
${GLSL_CLOUD_SHADOW}`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
{
  vec3 upV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
  float sn = uTreeSnow * smoothstep(0.1, 0.6, dot(normal, upV)) * (0.35 + 0.65 * vTreeCanopy);
  sn *= smoothstep(uSnowLine - 14.0, uSnowLine + 6.0, vTreeW.y);
  diffuseColor.rgb = mix(diffuseColor.rgb * (1.0 - uWet * 0.2), vec3(0.8, 0.84, 0.9), sn);
}`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
{ float cl = atmoCloudLight(vTreeW.xz); reflectedLight.directDiffuse *= cl; reflectedLight.directSpecular *= cl; }`,
      );
  };
  return mat;
}

/** Shadow-casting twin: same winter shrink and wind bend, so shadows match. */
function treeDepthMaterial(windUniform: { value: number }) {
  const mat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uWind: windUniform, uWindDir: atmo.uWindDir, uWindStrength: atmo.uWindStrength, uBare: atmo.uBare });
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>\n${TREE_VERT_COMMON}`).replace('#include <begin_vertex>', TREE_BEGIN);
  };
  return mat;
}

export class Trees {
  readonly group = new THREE.Group();
  readonly wind = { value: 0 };
  private recs: TreeRec[] = [];
  private grid = new Map<number, number[]>(); // 16m buckets -> tree indices
  private meshes = new Map<string, THREE.InstancedMesh>(); // `${chunk}:${kind}`
  private geos = new Map<TreeKind, THREE.BufferGeometry>();
  readonly material: THREE.MeshStandardMaterial;
  private depthMat: THREE.MeshDepthMaterial;
  private zero = new THREE.Matrix4().makeScale(0, 0, 0);
  total = 0;
  alive = 0;

  constructor(private terrain: Terrain, map: MapData, density: number) {
    this.material = treeMaterial(this.wind);
    this.depthMat = treeDepthMaterial(this.wind);
    const rng = new Rng(map.def.seed + 99);
    const perChunk = new Map<string, { m: THREE.Matrix4; c: THREE.Color; rec: number }[]>();
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const dens = density * map.def.treeDensity;
    for (let gz = -HALF + GRID / 2; gz < HALF; gz += GRID) {
      for (let gx = -HALF + GRID / 2; gx < HALF; gx += GRID) {
        // jittered sub-samples per grid cell
        for (let k = 0; k < 3; k++) {
          const x = gx + (rng.float() - 0.5) * GRID;
          const z = gz + (rng.float() - 0.5) * GRID;
          if (!terrain.inBounds(x, z, 2)) continue;
          const h = terrain.h(x, z);
          const sl = terrain.slope(x, z);
          const c = terrain.coverAt(x, z);
          const rule = map.treeRule(x, z, h, sl, c, rng.float());
          if (!rule) continue;
          const clump = hash2(Math.floor(x / 40), Math.floor(z / 40), 9) * 0.6 + 0.7;
          if (rng.float() > rule.p * dens * clump * 0.75) continue;
          if (h < WATER - 1.2) continue;
          const kind = rule.kind;
          const cx = Math.min(TREE_CHUNKS - 1, Math.floor((x + HALF) / CH_SIZE));
          const cz = Math.min(TREE_CHUNKS - 1, Math.floor((z + HALF) / CH_SIZE));
          const chunk = cz * TREE_CHUNKS + cx;
          const key = `${chunk}:${kind}`;
          let arr = perChunk.get(key);
          if (!arr) perChunk.set(key, (arr = []));
          const sc = (kind === 'redwood' ? 0.8 : kind === 'shrub' ? 0.8 : 0.75) + rng.float() * 0.6;
          q.setFromAxisAngle(up, rng.float() * Math.PI * 2);
          s.set(sc, sc * (0.85 + rng.float() * 0.3), sc);
          p.set(x, h - 0.2, z);
          m4.compose(p, q, s);
          const col = canopyColor(map.def.id, kind, rng, new THREE.Color());
          const rec: TreeRec = { x, z, kind, chunk, slot: arr.length, alive: true };
          this.recs.push(rec);
          arr.push({ m: m4.clone(), c: col, rec: this.recs.length - 1 });
          const b = this.bucket(x, z);
          let list = this.grid.get(b);
          if (!list) this.grid.set(b, (list = []));
          list.push(this.recs.length - 1);
        }
      }
    }
    for (const [key, arr] of perChunk) {
      const kind = key.split(':')[1] as TreeKind;
      let geo = this.geos.get(kind);
      if (!geo) this.geos.set(kind, (geo = makeTree(kind)));
      const im = new THREE.InstancedMesh(geo, this.material, arr.length);
      arr.forEach((it, i) => {
        im.setMatrixAt(i, it.m);
        im.setColorAt(i, it.c);
      });
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.castShadow = true;
      im.receiveShadow = true;
      im.customDepthMaterial = this.depthMat;
      im.computeBoundingSphere();
      // wind can lean a canopy a few meters out of its resting bounds
      if (im.boundingSphere) im.boundingSphere.radius += 12;
      this.meshes.set(key, im);
      this.group.add(im);
    }
    this.total = this.alive = this.recs.length;
  }

  private bucket(x: number, z: number) {
    return (Math.floor((x + HALF) / 16) << 10) | Math.floor((z + HALF) / 16);
  }

  /** Remove trees whose trunk falls inside the predicate within a box. Returns count cut. */
  cut(minX: number, minZ: number, maxX: number, maxZ: number, inside: (x: number, z: number) => boolean): number {
    let n = 0;
    const touched = new Set<THREE.InstancedMesh>();
    for (let bx = Math.floor((minX + HALF) / 16); bx <= Math.floor((maxX + HALF) / 16); bx++)
      for (let bz = Math.floor((minZ + HALF) / 16); bz <= Math.floor((maxZ + HALF) / 16); bz++) {
        const list = this.grid.get((bx << 10) | bz);
        if (!list) continue;
        for (const id of list) {
          const r = this.recs[id];
          if (!r.alive || !inside(r.x, r.z)) continue;
          r.alive = false;
          const im = this.meshes.get(`${r.chunk}:${r.kind}`)!;
          im.setMatrixAt(r.slot, this.zero);
          touched.add(im);
          n++;
        }
      }
    for (const im of touched) im.instanceMatrix.needsUpdate = true;
    this.alive -= n;
    return n;
  }

  /** Alive tree positions (for fires, communes planting, etc.). */
  countIn(x: number, z: number, r: number): number {
    let n = 0;
    for (let bx = Math.floor((x - r + HALF) / 16); bx <= Math.floor((x + r + HALF) / 16); bx++)
      for (let bz = Math.floor((z - r + HALF) / 16); bz <= Math.floor((z + r + HALF) / 16); bz++) {
        const list = this.grid.get((bx << 10) | bz);
        if (list) for (const id of list) { const t = this.recs[id]; if (t.alive && (t.x - x) ** 2 + (t.z - z) ** 2 < r * r) n++; }
      }
    return n;
  }

  get naturePct() {
    return this.total ? this.alive / this.total : 0;
  }
}
