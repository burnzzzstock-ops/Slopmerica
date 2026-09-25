// Trees for 6 km maps. Hundreds of thousands of trees live in compact typed
// arrays; around the camera the nearest ones are drawn as detailed card-foliage
// models and the rest as pre-rendered billboard impostors. Every tree can be cut
// and counts toward the Nature meter. Seasons change leaf color and density.
import * as THREE from 'three';
import { HALF, Quality, WATER, WORLD } from '../config';
import { hash2, Rng } from '../core/rng';
import type { MapData, TreeKind } from './maps';
import type { Terrain } from './terrain';
import { createFoliageAtlas, makeTreeModel, padTransparent } from './foliage';

const KINDS: TreeKind[] = ['decid', 'pine', 'redwood', 'oak', 'palm', 'cypress', 'mangrove', 'shrub'];
const DECIDUOUS = new Set<TreeKind>(['decid', 'cypress']);
const VARIANTS = 3;
const CELL = 64;
const GRID_N = Math.ceil(WORLD / CELL);
const SPRITE_W = 256, SPRITE_H = 512;

const BASE_COLOR: Record<TreeKind, number> = {
  decid: 0x6f9a45, pine: 0x3f6a3a, redwood: 0x3c6238, oak: 0x6a8045, palm: 0x7aa84a, cypress: 0x7a9a50, mangrove: 0x55803e, shrub: 0x7a9448,
};
// Alpha test for card foliage. Mip levels average alpha down, which makes
// distant canopies go see-through, so alpha is boosted per mip level. Deciduous
// leaves thin out in winter by raising the threshold.
const LEAF_ALPHA = `
#ifdef USE_MAP
  vec2 tsz = vec2(textureSize(map, 0));
  vec2 dxu = dFdx(vMapUv * tsz), dyu = dFdy(vMapUv * tsz);
  float mipL = max(0.0, 0.5 * log2(max(dot(dxu, dxu), dot(dyu, dyu))));
  diffuseColor.a *= 1.0 + mipL * 0.3;
#endif
float thr = mix(0.42, 0.995, (1.0 - uLeaf) * step(0.5, vCanopy));
#ifdef ALPHA_TO_COVERAGE
  diffuseColor.a = smoothstep(thr, thr + fwidth(diffuseColor.a), diffuseColor.a);
  if (diffuseColor.a == 0.0) discard;
#else
  if (diffuseColor.a < thr) discard;
#endif`;
const FALL = [0xd9822b, 0xc9452a, 0xe6b83a, 0xa8321f, 0xcf6a2a, 0xb5a03a];

export class Trees {
  readonly group = new THREE.Group();
  readonly wind = { value: 0 };
  total = 0;
  alive = 0;
  private n = 0;
  private X!: Float32Array;
  private Z!: Float32Array;
  private Y!: Float32Array;
  private S!: Float32Array;
  private Rt!: Float32Array;
  private K!: Uint8Array;
  private Vr!: Uint8Array;
  private Hue!: Float32Array;
  private A!: Uint8Array;
  private cellStart!: Int32Array;
  private cellItems!: Int32Array;
  private near: THREE.InstancedMesh[] = [];
  private far: THREE.InstancedMesh[] = [];
  private spriteSize: { w: number; h: number; y0: number }[] = [];
  private uniforms = { uTime: { value: 0 }, uLeaf: { value: 1 } };
  private lastFocus = new THREE.Vector3(1e9, 0, 1e9);
  private lastDist = 0;
  private dirty = true;
  private season = { day: 0, fall: 0, bare: 0, spring: 0, blossom: 0 };
  private mapId: string;

  constructor(private terrain: Terrain, map: MapData, private q: Quality, renderer: THREE.WebGLRenderer) {
    this.mapId = map.def.id;
    this.place(map, q.treeDensity);
    const atlas = createFoliageAtlas(renderer);
    const counts = new Array(KINDS.length).fill(0);
    for (let i = 0; i < this.n; i++) counts[this.K[i]]++;
    const share = counts.map((c) => c / Math.max(1, this.n));

    // soft, non-shimmering foliage edges when the canvas is multisampled
    const msaa = renderer.getContext().getContextAttributes()?.antialias === true;
    const mkNearMat = (decid: boolean) => {
      const m = new THREE.MeshStandardMaterial({ map: atlas, vertexColors: true, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.82, metalness: 0, alphaToCoverage: msaa });
      m.onBeforeCompile = (sh) => {
        sh.uniforms.uTime = this.uniforms.uTime;
        sh.uniforms.uLeaf = decid ? this.uniforms.uLeaf : { value: 1 };
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nattribute float canopy;\nuniform float uTime;\nvarying float vCanopy;')
          .replace('#include <color_vertex>', `
#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
  vColor = vec4( 1.0 );
#endif
#ifdef USE_COLOR
  vColor.rgb *= color;
#endif
#ifdef USE_INSTANCING_COLOR
  vColor.rgb *= mix(vec3(1.0), instanceColor.rgb, canopy);
#endif
vCanopy = canopy;`)
          .replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
  vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
  float sway = sin(uTime * 1.3 + ip.x * 0.05 + ip.z * 0.07) + 0.4 * sin(uTime * 3.1 + ip.z * 0.2);
  transformed.x += sway * 0.02 * transformed.y * canopy;
  transformed.z += sway * 0.012 * transformed.y * canopy;
#endif`);
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform float uLeaf;\nvarying float vCanopy;')
          .replace('#include <alphatest_fragment>', LEAF_ALPHA)
          // leaf cards carry bent "crown" normals: don't flip them on back faces
          .replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', 'normal *= mix(faceDirection, 1.0, step(0.5, vCanopy));'));
      };
      return m;
    };
    // Shadows use the same seasonal leaf threshold, so bare trees cast bare shadows.
    const mkDepthMat = (decid: boolean) => {
      const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: atlas, alphaTest: 0.42 });
      m.onBeforeCompile = (sh) => {
        sh.uniforms.uLeaf = decid ? this.uniforms.uLeaf : { value: 1 };
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nattribute float canopy;\nvarying float vCanopy;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCanopy = canopy;');
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform float uLeaf;\nvarying float vCanopy;')
          .replace('#include <alphatest_fragment>', LEAF_ALPHA);
      };
      m.customProgramCacheKey = () => 'treeDepth';
      return m;
    };
    const depthMats = [mkDepthMat(false), mkDepthMat(true)];
    const nearMats = [mkNearMat(false), mkNearMat(true)];
    const models: THREE.BufferGeometry[][] = KINDS.map((k) => Array.from({ length: VARIANTS }, (_, v) => makeTreeModel(k, v)));
    KINDS.forEach((kind, ki) => {
      for (let v = 0; v < VARIANTS; v++) {
        const cap = Math.max(200, Math.ceil((share[ki] * q.treeNearCap * 1.6) / VARIANTS));
        const im = new THREE.InstancedMesh(models[ki][v], nearMats[DECIDUOUS.has(kind) ? 1 : 0], share[ki] > 0 ? cap : 1);
        im.count = 0;
        im.castShadow = true;
        im.receiveShadow = true;
        im.frustumCulled = false;
        im.customDepthMaterial = depthMats[DECIDUOUS.has(kind) ? 1 : 0];
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        im.setColorAt(0, new THREE.Color());
        this.near.push(im);
        this.group.add(im);
      }
    });

    const spriteTex = this.bakeSprites(renderer, models.map((m) => m[0]), atlas);
    const farMat = new THREE.MeshLambertMaterial({ map: spriteTex, alphaTest: 0.5, side: THREE.DoubleSide, alphaToCoverage: msaa });
    farMat.onBeforeCompile = (sh) => {
      sh.uniforms.uLeaf = { value: 1 };
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uLeaf;\nconst float vCanopy = 0.0;')
        .replace('#include <alphatest_fragment>', LEAF_ALPHA.replace('0.42', '0.5'));
      sh.vertexShader = sh.vertexShader
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);')
        .replace('#include <project_vertex>', `
vec4 instP = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
float sc = length(instanceMatrix[0].xyz);
vec3 camR = normalize(vec3(viewMatrix[0][0], 0.0, viewMatrix[2][0]));
vec3 wp = instP.xyz + camR * position.x * sc + vec3(0.0, position.y * sc, 0.0);
vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
gl_Position = projectionMatrix * mvPosition;`);
    };
    KINDS.forEach((kind, ki) => {
      const sz = this.spriteSize[ki];
      const g = new THREE.PlaneGeometry(sz.w, sz.h);
      g.translate(0, sz.y0 + sz.h / 2, 0);
      const uv = g.getAttribute('uv') as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setX(i, (ki + uv.getX(i)) / KINDS.length);
      const cap = Math.max(100, Math.ceil(share[ki] * q.treeFarCap * 1.3));
      const im = new THREE.InstancedMesh(g, farMat, share[ki] > 0 ? cap : 1);
      im.count = 0;
      im.frustumCulled = false;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.setColorAt(0, new THREE.Color());
      this.far.push(im);
      this.group.add(im);
      void kind;
    });
  }

  // ------------------------------------------------------------------ placement
  private place(map: MapData, density: number) {
    const rng = new Rng(map.def.seed + 99);
    const step = 9;
    const cap = Math.ceil((WORLD / step + 1) ** 2);
    const X = new Float32Array(cap), Z = new Float32Array(cap), Y = new Float32Array(cap), S = new Float32Array(cap), Rt = new Float32Array(cap);
    const K = new Uint8Array(cap), Vr = new Uint8Array(cap), Hue = new Float32Array(cap);
    let n = 0;
    const dens = density * map.def.treeDensity;
    for (let gz = -HALF + step / 2; gz < HALF; gz += step)
      for (let gx = -HALF + step / 2; gx < HALF; gx += step) {
        const x = gx + (rng.float() - 0.5) * step * 0.95;
        const z = gz + (rng.float() - 0.5) * step * 0.95;
        if (!this.terrain.inBounds(x, z, 2)) continue;
        const h = this.terrain.h(x, z);
        if (h < WATER - 1.2) continue;
        const rule = map.treeRule(x, z, h, this.terrain.slope(x, z), this.terrain.coverAt(x, z), rng.float());
        if (!rule) continue;
        const clump = hash2(Math.floor(x / 45), Math.floor(z / 45), 9) * 0.6 + 0.7;
        if (rng.float() > rule.p * dens * clump * 0.62) continue;
        X[n] = x;
        Z[n] = z;
        Y[n] = h - 0.25;
        S[n] = 0.75 + rng.float() * 0.55;
        Rt[n] = rng.float() * Math.PI * 2;
        K[n] = KINDS.indexOf(rule.kind);
        Vr[n] = Math.floor(rng.float() * VARIANTS);
        Hue[n] = rng.float();
        n++;
      }
    this.n = n;
    this.X = X.slice(0, n);
    this.Z = Z.slice(0, n);
    this.Y = Y.slice(0, n);
    this.S = S.slice(0, n);
    this.Rt = Rt.slice(0, n);
    this.K = K.slice(0, n);
    this.Vr = Vr.slice(0, n);
    this.Hue = Hue.slice(0, n);
    this.A = new Uint8Array(n).fill(1);
    const cellOf = (i: number) => Math.min(GRID_N - 1, Math.floor((this.Z[i] + HALF) / CELL)) * GRID_N + Math.min(GRID_N - 1, Math.floor((this.X[i] + HALF) / CELL));
    const starts = new Int32Array(GRID_N * GRID_N + 1);
    for (let i = 0; i < n; i++) starts[cellOf(i) + 1]++;
    for (let c = 0; c < GRID_N * GRID_N; c++) starts[c + 1] += starts[c];
    this.cellStart = starts;
    this.cellItems = new Int32Array(n);
    const fill = starts.slice(0, GRID_N * GRID_N);
    for (let i = 0; i < n; i++) this.cellItems[fill[cellOf(i)]++] = i;
    this.total = this.alive = n;
  }

  // ------------------------------------------------------------------ impostor sprites
  private bakeSprites(renderer: THREE.WebGLRenderer, geos: THREE.BufferGeometry[], atlas: THREE.Texture): THREE.Texture {
    const rt = new THREE.WebGLRenderTarget(SPRITE_W * KINDS.length, SPRITE_H);
    rt.texture.generateMipmaps = true;
    rt.texture.minFilter = THREE.LinearMipmapLinearFilter;
    rt.texture.colorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x6a6a5a, 2.0));
    const sun = new THREE.DirectionalLight(0xffffff, 1.3);
    sun.position.set(0.4, 1, 0.8);
    scene.add(sun);
    const mat = new THREE.MeshLambertMaterial({ map: atlas, vertexColors: true, alphaTest: 0.42, side: THREE.DoubleSide });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uLeaf = { value: 1 };
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uLeaf;\nconst float vCanopy = 0.0;')
        .replace('#include <alphatest_fragment>', LEAF_ALPHA);
    };
    const prevTarget = renderer.getRenderTarget();
    const prevClear = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    const prevTone = renderer.toneMapping;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 0);
    renderer.setScissorTest(true);
    geos.forEach((g, i) => {
      g.computeBoundingBox();
      const bb = g.boundingBox!;
      const w = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z, (bb.max.y - bb.min.y) / 2) * 1.04;
      const h = w * 2;
      const y0 = bb.min.y;
      this.spriteSize[i] = { w, h, y0 };
      const cam = new THREE.OrthographicCamera(-w / 2, w / 2, y0 + h, y0, 0.1, 400);
      cam.position.set(0, 0, 150);
      cam.lookAt(0, 0, 0);
      const mesh = new THREE.Mesh(g, mat);
      scene.add(mesh);
      renderer.setViewport(i * SPRITE_W, 0, SPRITE_W, SPRITE_H);
      renderer.setScissor(i * SPRITE_W, 0, SPRITE_W, SPRITE_H);
      renderer.clear();
      renderer.render(scene, cam);
      scene.remove(mesh);
    });
    renderer.setScissorTest(false);
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClear, prevAlpha);
    renderer.toneMapping = prevTone;
    const size = renderer.getSize(new THREE.Vector2());
    renderer.setViewport(0, 0, size.x, size.y);
    // Read back and pad the transparent texels so mips don't halo the impostors
    // black; a data texture also survives render-target churn.
    const W = SPRITE_W * KINDS.length;
    const px = new Uint8Array(W * SPRITE_H * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, W, SPRITE_H, px);
    rt.dispose();
    padTransparent(px, W, SPRITE_H, 8);
    const tex = new THREE.DataTexture(px, W, SPRITE_H, THREE.RGBAFormat);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = true;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.needsUpdate = true;
    return tex;
  }

  // ------------------------------------------------------------------ seasons
  /** 0 = Mar 20 (spring). Drives leaf color and leaf density. */
  setDayOfYear(day: number) {
    const d = ((day % 365) + 365) % 365;
    const sm = (a: number, b: number, v: number) => Math.min(1, Math.max(0, (v - a) / (b - a)));
    let fall = 0, bare = 0, spring = 0, blossom = 0;
    if (this.mapId === 'appalachia') {
      spring = d < 60 ? 1 - sm(0, 60, d) : 0;
      blossom = d < 35 ? 1 - sm(10, 35, d) : 0;
      fall = d > 190 && d < 290 ? sm(190, 225, d) : 0;
      // leaves drop Nov-Dec, bud out late Feb and are full by the end of March
      bare = d >= 330 ? 1 - sm(330, 375, d) : d < 10 ? 1 - sm(330, 375, d + 365) : d >= 245 ? sm(245, 285, d) : 0;
    } else if (this.mapId === 'florida') {
      fall = d > 230 && d < 320 ? sm(230, 270, d) * 0.4 : 0;
      bare = d > 280 ? sm(280, 320, d) * 0.3 : 0;
    } else {
      fall = d > 200 && d < 300 ? sm(200, 240, d) * 0.25 : 0;
    }
    const changed = Math.abs(fall - this.season.fall) + Math.abs(bare - this.season.bare) + Math.abs(spring - this.season.spring) > 0.03;
    if (changed || this.season.day === 0) {
      this.season = { day: d, fall, bare, spring, blossom };
      this.dirty = true;
    }
    this.uniforms.uLeaf.value = 1 - bare * 0.92;
  }

  private tmpC = new THREE.Color();
  private colorOf(i: number, out: THREE.Color) {
    const k = KINDS[this.K[i]];
    out.setHex(BASE_COLOR[k]);
    const h = this.Hue[i];
    out.offsetHSL((h - 0.5) * 0.05, (h - 0.5) * 0.12, (h - 0.5) * 0.12);
    const s = this.season;
    if (DECIDUOUS.has(k) || (this.mapId === 'norcal' && k === 'oak')) {
      const t = this.tmpC;
      if (s.spring > 0) out.lerp(t.setHex(0x9cc860), s.spring * 0.6);
      if (s.blossom > 0 && h > 0.93) out.lerp(t.setHex(h > 0.97 ? 0xf6d8e6 : 0xe9a6cc), s.blossom);
      if (s.fall > 0) out.lerp(t.setHex(k === 'cypress' ? 0xa5602e : FALL[Math.floor(h * FALL.length) % FALL.length]), s.fall * (0.6 + h * 0.4));
      if (s.bare > 0) out.lerp(t.setHex(0x6b5a48), s.bare * 0.8);
    }
  }

  // ------------------------------------------------------------------ per-frame
  update(time: number, focus: THREE.Vector3, camDist: number) {
    this.uniforms.uTime.value = time;
    this.wind.value = time;
    const nearR = Math.min(this.q.treeNear, Math.max(160, camDist * 0.85));
    const moved = Math.hypot(focus.x - this.lastFocus.x, focus.z - this.lastFocus.z);
    if (!this.dirty && moved < nearR * 0.2 && Math.abs(camDist - this.lastDist) < this.lastDist * 0.2) return;
    this.dirty = false;
    this.lastFocus.copy(focus);
    this.lastDist = camDist;
    const farR = Math.min(9000, camDist * 3.2 + 1800);
    const nearCounts = new Array(this.near.length).fill(0);
    const farCounts = new Array(this.far.length).fill(0);
    const col = new THREE.Color();
    const c0 = Math.max(0, Math.floor((focus.x - farR + HALF) / CELL)), c1 = Math.min(GRID_N - 1, Math.floor((focus.x + farR + HALF) / CELL));
    const r0 = Math.max(0, Math.floor((focus.z - farR + HALF) / CELL)), r1 = Math.min(GRID_N - 1, Math.floor((focus.z + farR + HALF) / CELL));
    const nearR2 = nearR * nearR, farR2 = farR * farR;
    const thinStart = Math.max(1500, farR * 0.35);
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        const cell = r * GRID_N + c;
        const cx = (c + 0.5) * CELL - HALF, cz = (r + 0.5) * CELL - HALF;
        if ((cx - focus.x) ** 2 + (cz - focus.z) ** 2 > (farR + CELL) ** 2) continue;
        for (let p = this.cellStart[cell]; p < this.cellStart[cell + 1]; p++) {
          const i = this.cellItems[p];
          if (!this.A[i]) continue;
          const dx = this.X[i] - focus.x, dz = this.Z[i] - focus.z;
          const d2 = dx * dx + dz * dz;
          if (d2 > farR2) continue;
          const k = this.K[i];
          if (d2 < nearR2) {
            const mi = k * VARIANTS + this.Vr[i];
            const im = this.near[mi];
            const slot = nearCounts[mi];
            if (slot >= im.instanceMatrix.count) continue;
            nearCounts[mi]++;
            this.colorOf(i, col);
            const s = this.S[i], cs = Math.cos(this.Rt[i]) * s, sn = Math.sin(this.Rt[i]) * s;
            const e = im.instanceMatrix.array as Float32Array;
            const o = slot * 16;
            e[o] = cs; e[o + 1] = 0; e[o + 2] = -sn; e[o + 3] = 0;
            e[o + 4] = 0; e[o + 5] = s * (0.9 + this.Hue[i] * 0.2); e[o + 6] = 0; e[o + 7] = 0;
            e[o + 8] = sn; e[o + 9] = 0; e[o + 10] = cs; e[o + 11] = 0;
            e[o + 12] = this.X[i]; e[o + 13] = this.Y[i]; e[o + 14] = this.Z[i]; e[o + 15] = 1;
            const ca = im.instanceColor!.array as Float32Array;
            ca[slot * 3] = col.r; ca[slot * 3 + 1] = col.g; ca[slot * 3 + 2] = col.b;
          } else {
            const d = Math.sqrt(d2);
            if (d > thinStart && hash2(i, 7, 1) > Math.max(0.2, 1 - (d - thinStart) / (farR - thinStart))) continue;
            const im = this.far[k];
            const slot = farCounts[k];
            if (slot >= im.instanceMatrix.count) continue;
            farCounts[k]++;
            this.colorOf(i, col);
            const s = this.S[i] * (d > thinStart ? 1.25 : 1);
            const e = im.instanceMatrix.array as Float32Array;
            const o = slot * 16;
            e[o] = s; e[o + 1] = 0; e[o + 2] = 0; e[o + 3] = 0;
            e[o + 4] = 0; e[o + 5] = s; e[o + 6] = 0; e[o + 7] = 0;
            e[o + 8] = 0; e[o + 9] = 0; e[o + 10] = s; e[o + 11] = 0;
            e[o + 12] = this.X[i]; e[o + 13] = this.Y[i]; e[o + 14] = this.Z[i]; e[o + 15] = 1;
            const ca = im.instanceColor!.array as Float32Array;
            ca[slot * 3] = col.r * 1.08; ca[slot * 3 + 1] = col.g * 1.08; ca[slot * 3 + 2] = col.b * 1.08;
          }
        }
      }
    const commit = (im: THREE.InstancedMesh, count: number) => {
      im.count = count;
      im.instanceMatrix.clearUpdateRanges();
      im.instanceMatrix.addUpdateRange(0, Math.max(1, count) * 16);
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) {
        im.instanceColor.clearUpdateRanges();
        im.instanceColor.addUpdateRange(0, Math.max(1, count) * 3);
        im.instanceColor.needsUpdate = true;
      }
    };
    this.near.forEach((im, i) => commit(im, nearCounts[i]));
    this.far.forEach((im, i) => commit(im, farCounts[i]));
  }

  // ------------------------------------------------------------------ editing / queries
  private forCells(minX: number, minZ: number, maxX: number, maxZ: number, fn: (i: number) => void) {
    const c0 = Math.max(0, Math.floor((minX + HALF) / CELL)), c1 = Math.min(GRID_N - 1, Math.floor((maxX + HALF) / CELL));
    const r0 = Math.max(0, Math.floor((minZ + HALF) / CELL)), r1 = Math.min(GRID_N - 1, Math.floor((maxZ + HALF) / CELL));
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        const cell = r * GRID_N + c;
        for (let p = this.cellStart[cell]; p < this.cellStart[cell + 1]; p++) fn(this.cellItems[p]);
      }
  }

  /** Remove trees inside the predicate within a box. Returns count cut. */
  cut(minX: number, minZ: number, maxX: number, maxZ: number, inside: (x: number, z: number) => boolean): number {
    let n = 0;
    this.forCells(minX, minZ, maxX, maxZ, (i) => {
      if (!this.A[i] || !inside(this.X[i], this.Z[i])) return;
      this.A[i] = 0;
      n++;
    });
    if (n) {
      this.alive -= n;
      this.dirty = true;
    }
    return n;
  }

  countIn(x: number, z: number, r: number): number {
    let n = 0;
    const r2 = r * r;
    this.forCells(x - r, z - r, x + r, z + r, (i) => {
      if (this.A[i] && (this.X[i] - x) ** 2 + (this.Z[i] - z) ** 2 < r2) n++;
    });
    return n;
  }

  get naturePct() {
    return this.total ? this.alive / this.total : 0;
  }
}
