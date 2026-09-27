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
import { bindAtmos, CLOUD_GLSL, cloudShadowChunk } from './atmos';
import { newSeasonLook, sampleSeason } from './seasons';
import type { MapId } from './maps';

/** The densest preset's tree density: every tree that any preset can draw. */
const MAX_DENSITY = 1.15;
/** The tree set the simulation counts, whatever the preset draws. */
const REF_DENSITY = 1;

const KINDS: TreeKind[] = ['decid', 'pine', 'redwood', 'oak', 'palm', 'cypress', 'mangrove', 'shrub'];
const DECIDUOUS = new Set<TreeKind>(['decid', 'cypress']);
const VARIANTS = 3;
const CELL = 64;
const GRID_N = Math.ceil(WORLD / CELL);
const SPRITE_W = 256, SPRITE_H = 512;
/** average of the canopy's own shading baked into impostors (1 = as bright as fully lit) */
const IMPOSTOR_SHADE = 0.66;
// Broadleaf crowns shade themselves far more than conifers or open oaks (the
// shadow map darkens their inner and lower cards), so their impostors, lit as
// one sunny face, were ~40% too bright and read as a lime carpet past the
// detailed ring. Measured by scripts/treelod.mjs on each map.
const IMPOSTOR_SHADE_KIND: Partial<Record<string, number>> = { decid: 0.4, mangrove: 0.46, cypress: 0.52 };

const BASE_COLOR: Record<TreeKind, number> = {
  decid: 0x6f9a45, pine: 0x557f48, redwood: 0x527a45, oak: 0x7f9852, palm: 0x7aa84a, cypress: 0x7a9a50, mangrove: 0x55803e, shrub: 0x7a9448,
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
  /** Per-tree density weight in [0, MAX_DENSITY]. A preset draws the trees
   * whose weight is under its density; the simulation (land value, nature)
   * always counts the same reference set, so graphics quality never changes
   * the city's numbers. */
  private W!: Float32Array;
  private renderDensity = 1;
  private cellStart!: Int32Array;
  private cellItems!: Int32Array;
  private near: THREE.InstancedMesh[] = [];
  private far: THREE.InstancedMesh[] = [];
  private spriteSize: { w: number; h: number; y0: number; yc: number }[] = [];
  private uniforms = { uTime: { value: 0 }, uLeaf: { value: 1 } };
  private lastFocus = new THREE.Vector3(1e9, 0, 1e9);
  private lastDist = 0;
  private dirty = true;
  private season = { day: -1, fall: 0, bare: 0, spring: 0, blossom: 0, dry: 0, dull: 0 };
  private look = newSeasonLook();
  private mapId: MapId;

  constructor(private terrain: Terrain, map: MapData, private q: Quality, renderer: THREE.WebGLRenderer) {
    this.mapId = map.def.id;
    this.renderDensity = q.treeDensity;
    this.place(map);
    const atlas = createFoliageAtlas(renderer);
    const counts = new Array(KINDS.length).fill(0);
    for (let i = 0; i < this.n; i++) counts[this.K[i]]++;
    const share = counts.map((c) => c / Math.max(1, this.n));

    // soft, non-shimmering foliage edges when the canvas is multisampled
    const msaa = q.post || renderer.getContext().getContextAttributes()?.antialias === true;
    const mkNearMat = (decid: boolean) => {
      const m = new THREE.MeshStandardMaterial({ map: atlas, vertexColors: true, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.9, metalness: 0, alphaToCoverage: msaa, envMapIntensity: 0.35 });
      m.onBeforeCompile = (sh) => {
        sh.uniforms.uTime = this.uniforms.uTime;
        sh.uniforms.uLeaf = decid ? this.uniforms.uLeaf : { value: 1 };
        bindAtmos(sh);
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nattribute float canopy;\nuniform float uTime, uWind;\nvarying float vCanopy;\nvarying vec3 vTWPos;')
          .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
{
  vec4 twp = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
  twp = instanceMatrix * twp;
#endif
  vTWPos = (modelMatrix * twp).xyz;
}`)
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
  float sway = sin(uTime * (1.3 + uWind * 0.6) + ip.x * 0.05 + ip.z * 0.07) + 0.4 * sin(uTime * 3.1 * (0.8 + uWind * 0.4) + ip.z * 0.2);
  transformed.x += sway * 0.02 * uWind * transformed.y * canopy + 0.012 * (uWind - 1.0) * transformed.y * canopy;
  transformed.z += sway * 0.012 * uWind * transformed.y * canopy;
#endif`);
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', `#include <common>\nuniform float uLeaf, uSnow, uSnowLine;\nvarying float vCanopy;\nvarying vec3 vTWPos;\n${CLOUD_GLSL}`)
          .replace('#include <alphatest_fragment>', LEAF_ALPHA)
          .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec3 wN = normalize((vec4(vNormal, 0.0) * viewMatrix).xyz);
  float sn = uSnow * smoothstep(0.1, 0.75, wN.y) * smoothstep(uSnowLine - 30.0, uSnowLine + 60.0, vTWPos.y);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.88, 0.9, 0.95), sn * (0.35 + 0.45 * vCanopy));
}`)
          .replace('#include <lights_fragment_end>', `
#if NUM_DIR_LIGHTS > 0
{
  // leaves are thin: looking toward the sun through a crown, its edge glows
  // yellow-green (directLight is the sun, already shadowed)
  float back = pow(max(dot(-geometryViewDir, directLight.direction), 0.0), 3.0);
  reflectedLight.directDiffuse += directLight.color * diffuseColor.rgb * vec3(0.95, 1.05, 0.55) * (back * 0.55 + 0.06) * vCanopy;
}
#endif
` + cloudShadowChunk('vTWPos'))
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
          .replace('#include <common>', `#include <common>\nuniform float uLeaf, uSnow, uSnowLine;\nvarying float vCanopy;\nvarying vec3 vTWPos;\n${CLOUD_GLSL}`)
          .replace('#include <alphatest_fragment>', LEAF_ALPHA)
          .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec3 wN = normalize((vec4(vNormal, 0.0) * viewMatrix).xyz);
  float sn = uSnow * smoothstep(0.1, 0.75, wN.y) * smoothstep(uSnowLine - 30.0, uSnowLine + 60.0, vTWPos.y);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.88, 0.9, 0.95), sn * (0.35 + 0.45 * vCanopy));
}`)
          .replace('#include <lights_fragment_end>', cloudShadowChunk('vTWPos'));
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
    const farMat = new THREE.MeshLambertMaterial({ map: spriteTex, alphaTest: 0.3, side: THREE.DoubleSide, alphaToCoverage: msaa });
    farMat.onBeforeCompile = (sh) => {
      sh.uniforms.uLeaf = { value: 1 };
      bindAtmos(sh);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>\nuniform float uLeaf, uSnow, uSnowLine;\nconst float vCanopy = 0.0;\nvarying vec3 vTWPos;\nvarying float vTop;\nvarying float vK;\n${CLOUD_GLSL}`)
        // two baked views: the side (row 0) and from above (row 1), blended by
        // how steeply the camera looks down at the tree
        .replace('#include <map_fragment>', `#ifdef USE_MAP
  vec4 sprSide = texture2D(map, vec2(vMapUv.x, vMapUv.y * 0.5));
  vec4 sprTop = texture2D(map, vec2(vMapUv.x, 0.5 + vMapUv.y * 0.5));
  diffuseColor *= mix(sprSide, sprTop, vK);
#endif`)
        // a lower cut than the cards': the baked crown's edge is soft, and at 0.5
        // impostors covered only half the ground the detailed trees did
        .replace('#include <alphatest_fragment>', LEAF_ALPHA.replace('0.42', '0.3'))
        .replace('#include <color_fragment>', `#include <color_fragment>
diffuseColor.rgb *= cloudShade(vTWPos);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.88, 0.93), uSnow * 0.55 * vTop * smoothstep(uSnowLine - 30.0, uSnowLine + 60.0, vTWPos.y));`);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vTWPos;\nvarying float vTop;\nvarying float vK;\nattribute vec2 aSprite;')
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);')
        .replace('#include <project_vertex>', `
vec4 instP = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
float sc = length(instanceMatrix[0].xyz);
vec3 camR = normalize(vec3(viewMatrix[0][0], 0.0, viewMatrix[2][0]));
vec3 camU = normalize(vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]));
// looking down on a tree shows its canopy, not its trunk (the side view read
// as dark flags on poles from the usual camera angle)
vec3 toCam = cameraPosition - instP.xyz;
vK = smoothstep(0.34, 0.7, toCam.y / max(length(toCam), 1e-3));
// side view stands on the base; the top view faces the camera around the canopy centre
vec3 sideP = instP.xyz + camR * position.x * sc + vec3(0.0, position.y * sc, 0.0);
vec3 topP = instP.xyz + camR * position.x * sc + camU * (position.y - aSprite.x) * sc + vec3(0.0, aSprite.y * sc, 0.0);
vec3 wp = mix(sideP, topP, vK);
vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
gl_Position = projectionMatrix * mvPosition;
vTWPos = wp;
vTop = smoothstep(0.35, 1.0, uv.y);`);
    };
    KINDS.forEach((kind, ki) => {
      const sz = this.spriteSize[ki];
      const g = new THREE.PlaneGeometry(sz.w, sz.h);
      g.translate(0, sz.y0 + sz.h / 2, 0);
      const uv = g.getAttribute('uv') as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setX(i, (ki + uv.getX(i)) / KINDS.length);
      // the quad's middle and the canopy centre, for the top view
      const spr = new Float32Array(uv.count * 2);
      for (let i = 0; i < uv.count; i++) { spr[i * 2] = sz.y0 + sz.h / 2; spr[i * 2 + 1] = sz.yc; }
      g.setAttribute('aSprite', new THREE.BufferAttribute(spr, 2));
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
  private place(map: MapData) {
    // Every preset places the same trees (the densest set, same random
    // draws); each tree keeps its weight so presets only differ in drawing.
    const rng = new Rng(map.def.seed + 99);
    const step = 9;
    const cap = Math.ceil((WORLD / step + 1) ** 2);
    const X = new Float32Array(cap), Z = new Float32Array(cap), Y = new Float32Array(cap), S = new Float32Array(cap), Rt = new Float32Array(cap);
    const K = new Uint8Array(cap), Vr = new Uint8Array(cap), Hue = new Float32Array(cap), W = new Float32Array(cap);
    let n = 0;
    const dens = map.def.treeDensity;
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
        const odds = rule.p * dens * clump * 0.62;
        const roll = rng.float();
        if (roll > odds * MAX_DENSITY) continue;
        W[n] = odds > 0 ? roll / odds : MAX_DENSITY;
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
    this.W = W.slice(0, n);
    this.A = new Uint8Array(n).fill(1);
    const cellOf = (i: number) => Math.min(GRID_N - 1, Math.floor((this.Z[i] + HALF) / CELL)) * GRID_N + Math.min(GRID_N - 1, Math.floor((this.X[i] + HALF) / CELL));
    const starts = new Int32Array(GRID_N * GRID_N + 1);
    for (let i = 0; i < n; i++) starts[cellOf(i) + 1]++;
    for (let c = 0; c < GRID_N * GRID_N; c++) starts[c + 1] += starts[c];
    this.cellStart = starts;
    this.cellItems = new Int32Array(n);
    const fill = starts.slice(0, GRID_N * GRID_N);
    for (let i = 0; i < n; i++) this.cellItems[fill[cellOf(i)]++] = i;
    let ref = 0;
    for (let i = 0; i < n; i++) if (this.W[i] <= REF_DENSITY) ref++;
    this.total = this.alive = ref;
  }

  // ------------------------------------------------------------------ impostor sprites
  private bakeSprites(renderer: THREE.WebGLRenderer, geos: THREE.BufferGeometry[], atlas: THREE.Texture): THREE.Texture {
    // two rows: the side view (bottom) and the view from 55 degrees up (top)
    const rt = new THREE.WebGLRenderTarget(SPRITE_W * KINDS.length, SPRITE_H * 2);
    rt.texture.generateMipmaps = true;
    rt.texture.minFilter = THREE.LinearMipmapLinearFilter;
    rt.texture.colorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    // Two passes: lit (for the canopy's own light and shade) and unlit (its
    // albedo). The impostor is lit again in the scene, so the stored picture is
    // the albedo times the canopy's *relative* shading (average IMPOSTOR_SHADE),
    // which keeps far trees as bright as the detailed models they replace.
    scene.add(new THREE.HemisphereLight(0xffffff, 0x6a6a5a, 2.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(0.4, 1, 0.8);
    scene.add(sun);
    const leafAlpha = (m: THREE.Material) => {
      m.onBeforeCompile = (sh) => {
        sh.uniforms.uLeaf = { value: 1 };
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform float uLeaf;\nconst float vCanopy = 0.0;')
          .replace('#include <alphatest_fragment>', LEAF_ALPHA);
      };
      return m;
    };
    const litMat = leafAlpha(new THREE.MeshLambertMaterial({ map: atlas, vertexColors: true, alphaTest: 0.42, side: THREE.DoubleSide }));
    const albMat = leafAlpha(new THREE.MeshBasicMaterial({ map: atlas, vertexColors: true, alphaTest: 0.42, side: THREE.DoubleSide }));
    let mat: THREE.Material = litMat;
    const prevTarget = renderer.getRenderTarget();
    const prevClear = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    const prevTone = renderer.toneMapping;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setClearColor(0x000000, 0);
    const W = SPRITE_W * KINDS.length, H = SPRITE_H * 2;
    const passes: Uint8Array[] = [];
    for (const m of [litMat, albMat]) {
    mat = m;
    renderer.setRenderTarget(rt);
    renderer.setScissorTest(true);
    geos.forEach((g, i) => {
      g.computeBoundingBox();
      const bb = g.boundingBox!;
      const w = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z, (bb.max.y - bb.min.y) / 2) * 1.04;
      const h = w * 2;
      const y0 = bb.min.y;
      const yc = (bb.min.y + bb.max.y) / 2;
      this.spriteSize[i] = { w, h, y0, yc };
      const mesh = new THREE.Mesh(g, mat);
      scene.add(mesh);
      // side view: the frame stands on the base
      const side = new THREE.OrthographicCamera(-w / 2, w / 2, y0 + h, y0, 0.1, 400);
      side.position.set(0, 0, 150);
      side.lookAt(0, 0, 0);
      // from above (55 deg): the frame is centred on the canopy
      const el = THREE.MathUtils.degToRad(55);
      const top = new THREE.OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, 0.1, 400);
      top.position.set(0, yc + Math.sin(el) * 150, Math.cos(el) * 150);
      top.lookAt(0, yc, 0);
      [side, top].forEach((cam, row) => {
        renderer.setViewport(i * SPRITE_W, row * SPRITE_H, SPRITE_W, SPRITE_H);
        renderer.setScissor(i * SPRITE_W, row * SPRITE_H, SPRITE_W, SPRITE_H);
        renderer.clear();
        renderer.render(scene, cam);
      });
      scene.remove(mesh);
    });
    renderer.setScissorTest(false);
    const buf = new Uint8Array(W * H * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, W, H, buf);
    passes.push(buf);
    }
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClear, prevAlpha);
    renderer.toneMapping = prevTone;
    const size = renderer.getSize(new THREE.Vector2());
    renderer.setViewport(0, 0, size.x, size.y);
    rt.dispose();
    litMat.dispose();
    albMat.dispose();
    // albedo x relative shading, per species and view
    const [lit, alb] = passes;
    const px = lit;
    for (let row = 0; row < 2; row++)
      for (let k = 0; k < KINDS.length; k++) {
        let sl = 0, sa = 0;
        const each = (fn: (i: number) => void) => {
          for (let y = row * SPRITE_H; y < (row + 1) * SPRITE_H; y++)
            for (let x = k * SPRITE_W; x < (k + 1) * SPRITE_W; x++) { const i = (y * W + x) * 4; if (lit[i + 3] > 128) fn(i); }
        };
        each((i) => { sl += lit[i] + lit[i + 1] + lit[i + 2]; sa += alb[i] + alb[i + 1] + alb[i + 2]; });
        const gain = sl > 0 ? ((IMPOSTOR_SHADE_KIND[KINDS[k]] ?? IMPOSTOR_SHADE) * sa) / sl : 1;
        // shaded leaves take the sky's blue: a touch cooler than the sunlit picture
        const tint = [0.96, 1, 1.25];
        each((i) => { for (let c = 0; c < 3; c++) px[i + c] = Math.min(255, Math.round(lit[i + c] * gain * tint[c])); });
      }
    // Pad the transparent texels so mips don't halo the impostors black; a data
    // texture also survives render-target churn.
    padTransparent(px, W, H, 8);
    const tex = new THREE.DataTexture(px, W, H, THREE.RGBAFormat);
    // three renders into a target in linear (working) space: the pixels read
    // back are linear. Tagging them sRGB decoded them a second time and made
    // every distant tree ~3x too dark (the dark flat silhouettes at the edge
    // of the detailed-tree radius).
    tex.colorSpace = THREE.LinearSRGBColorSpace;
    tex.generateMipmaps = true;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.needsUpdate = true;
    return tex;
  }

  // ------------------------------------------------------------------ seasons
  /**
   * 0 = Mar 20 (spring). Drives leaf color and leaf density from the per-map
   * season curves in seasons.ts. Colors are re-streamed only when the season
   * has moved a little (they ride along with the instance streaming anyway).
   */
  setDayOfYear(day: number) {
    const d = ((day % 365) + 365) % 365;
    const L = sampleSeason(this.mapId, d, this.look);
    const s = this.season;
    const moved = Math.abs(L.fall - s.fall) + Math.abs(L.bare - s.bare) + Math.abs(L.fresh - s.spring) + Math.abs(L.blossom - s.blossom) + Math.abs(L.dry - s.dry) + Math.abs(L.dull - s.dull);
    if (moved > 0.03 || s.day < 0) {
      // the first time streams everything; after that only colours change,
      // and they're repainted a slice per frame (a full re-stream on every new
      // day was a 90-130 ms hitch about once a second at top speed on Ultra)
      if (s.day < 0) this.dirty = true;
      else { this.recolor = true; this.recolorMesh = 0; this.recolorSlot = 0; }
      s.day = d; s.fall = L.fall; s.bare = L.bare; s.spring = L.fresh; s.blossom = L.blossom; s.dry = L.dry; s.dull = L.dull;
    }
    this.uniforms.uLeaf.value = 1 - L.bare * 0.92;
  }

  private tmpC = new THREE.Color();
  private colorOf(i: number, out: THREE.Color) {
    const k = KINDS[this.K[i]];
    out.setHex(BASE_COLOR[k]);
    const h = this.Hue[i];
    out.offsetHSL((h - 0.5) * 0.05, (h - 0.5) * 0.12, (h - 0.5) * 0.12);
    const s = this.season;
    const t = this.tmpC;
    if (DECIDUOUS.has(k) || (this.mapId === 'norcal' && k === 'oak')) {
      if (s.spring > 0) out.lerp(t.setHex(0x9cc860), s.spring * 0.6);
      // redbud and dogwood bloom in the understory before full leaf-out. Seen
      // from above through bare branches they read as dusty rose and off-white,
      // not neon: a full magenta crown looked like a missing texture
      if (s.blossom > 0 && k === 'decid' && h > 0.86) out.lerp(t.setHex(h > 0.94 ? 0xa8708f : 0xd9d6c8), s.blossom * 0.7);
      if (s.fall > 0) {
        // stands share a palette (maples, hickories, oaks); each tree turns on its own schedule
        const stand = hash2(Math.floor(this.X[i] / 90), Math.floor(this.Z[i] / 90), 3);
        const pick = (h * 7.13 + stand * 0.65) % 1;
        const turn = Math.min(1, Math.max(0, (s.fall - h * 0.4) / 0.6));
        out.lerp(t.setHex(k === 'cypress' ? 0xa5602e : FALL[Math.floor(pick * FALL.length) % FALL.length]), turn * (0.75 + h * 0.25));
      }
      if (s.dry > 0) out.lerp(t.setRGB(out.r * 1.3, out.g * 1.02, out.b * 0.5), s.dry * 0.6);
      // bare: grey twigs; oaks hang on to brown leaves all winter
      if (s.bare > 0) out.lerp(t.setHex(k === 'decid' && h < 0.2 ? 0x7a4a2a : 0x6b5a48), s.bare * 0.8);
    } else if (s.dull > 0) {
      out.multiplyScalar(1 - s.dull * 0.14);
    }
  }

  // ------------------------------------------------------------------ per-frame
  /** which tree each instance slot shows, per mesh (near meshes, then far) */
  private slots: Int32Array[] = [];
  /** where each tree is drawn: (mesh << 20) | slot, or -1 when it isn't */
  private slotOf?: Int32Array;

  /**
   * Edit the drawn instances of some trees in place (hide a cut tree, move one
   * to new ground) instead of re-streaming every tree on the map: that was a
   * 50-130 ms hitch each time a building went up in the woods.
   */
  private editDrawn(ids: Iterable<number>, fn: (e: Float32Array, o: number, i: number) => void) {
    const map = this.slotOf;
    if (!map) return;
    const meshes = [...this.near, ...this.far];
    const lo = new Map<number, [number, number]>();
    for (const i of ids) {
      const v = map[i];
      if (v < 0) continue;
      const m = v >>> 20, slot = v & 0xfffff, im = meshes[m];
      if (!im || slot >= im.count) continue;
      fn(im.instanceMatrix.array as Float32Array, slot * 16, i);
      const r = lo.get(m);
      if (!r) lo.set(m, [slot, slot]); else { r[0] = Math.min(r[0], slot); r[1] = Math.max(r[1], slot); }
    }
    for (const [m, [a, b]] of lo) {
      const im = meshes[m];
      im.instanceMatrix.addUpdateRange(a * 16, (b - a + 1) * 16);
      im.instanceMatrix.needsUpdate = true;
    }
  }
  private recolor = false;
  private recolorMesh = 0;
  private recolorSlot = 0;

  /** Repaint up to `budget` instances' colours for the season, continuing next frame. */
  private recolorStep(budget: number) {
    const meshes = [...this.near, ...this.far];
    const col = new THREE.Color();
    while (budget > 0 && this.recolorMesh < meshes.length) {
      const m = this.recolorMesh, im = meshes[m], map = this.slots[m];
      const far = m >= this.near.length;
      const from = this.recolorSlot, to = Math.min(im.count, from + budget);
      if (map && im.instanceColor && to > from) {
        const ca = im.instanceColor.array as Float32Array;
        const k = far ? 1.08 : 1;
        for (let slot = from; slot < to; slot++) {
          this.colorOf(map[slot], col);
          ca[slot * 3] = col.r * k; ca[slot * 3 + 1] = col.g * k; ca[slot * 3 + 2] = col.b * k;
        }
        im.instanceColor.addUpdateRange(from * 3, (to - from) * 3);
        im.instanceColor.needsUpdate = true;
      }
      budget -= Math.max(1, to - from);
      if (to >= im.count) { this.recolorMesh++; this.recolorSlot = 0; } else this.recolorSlot = to;
    }
    if (this.recolorMesh >= meshes.length) this.recolor = false;
  }

  update(time: number, focus: THREE.Vector3, camDist: number) {
    this.uniforms.uTime.value = time;
    this.wind.value = time;
    // Detailed trees cover the view when zoomed in. Zoomed out past what their
    // budget can cover, they fade out tree by tree everywhere instead of
    // shrinking to a disc of different-looking trees that follows the camera
    // (the playtest's "circle of trees"), and the edge between them and the
    // impostors is ragged (each tree has its own cut-over distance).
    const R = this.q.treeNear;
    const nearR = Math.min(R, Math.max(160, camDist * 1.1));
    const detail = Math.max(0, Math.min(1, (R * 1.5 - camDist) / (R * 0.4)));
    const moved = Math.hypot(focus.x - this.lastFocus.x, focus.z - this.lastFocus.z);
    if (!this.dirty && moved < nearR * 0.2 && Math.abs(camDist - this.lastDist) < this.lastDist * 0.2) {
      if (this.recolor) this.recolorStep(8000);
      return;
    }
    this.dirty = false;
    this.recolor = false; // a full stream paints every colour anyway
    if (this.slots.length !== this.near.length + this.far.length) this.slots = [...this.near, ...this.far].map((im) => new Int32Array(im.instanceMatrix.count));
    (this.slotOf ??= new Int32Array(this.n)).fill(-1);
    const nearN = this.near.length;
    this.lastFocus.copy(focus);
    this.lastDist = camDist;
    const farR = Math.min(9000, camDist * 3.2 + 1800);
    const nearCounts = new Array(this.near.length).fill(0);
    const farCounts = new Array(this.far.length).fill(0);
    const col = new THREE.Color();
    const nearR2 = nearR * nearR, farR2 = farR * farR;
    const thinStart = Math.max(1500, farR * 0.35);
    // cells in rings outward from the focus: when a batch fills up, it's the
    // farthest trees that go without (row by row, whole strips next to the
    // camera went bare when zoomed out)
    const fc = Math.floor((focus.x + HALF) / CELL), fr = Math.floor((focus.z + HALF) / CELL);
    const rings = Math.ceil(farR / CELL) + 1;
    const ringCells = function* () {
      for (let k = 0; k <= rings; k++) {
        if (k === 0) { yield [fc, fr]; continue; }
        for (let c = fc - k; c <= fc + k; c++) { yield [c, fr - k]; yield [c, fr + k]; }
        for (let r = fr - k + 1; r <= fr + k - 1; r++) { yield [fc - k, r]; yield [fc + k, r]; }
      }
    };
    for (const [c, r] of ringCells()) {
      if (c < 0 || r < 0 || c >= GRID_N || r >= GRID_N) continue;
      {
        const cell = r * GRID_N + c;
        const cx = (c + 0.5) * CELL - HALF, cz = (r + 0.5) * CELL - HALF;
        if ((cx - focus.x) ** 2 + (cz - focus.z) ** 2 > (farR + CELL) ** 2) continue;
        for (let p = this.cellStart[cell]; p < this.cellStart[cell + 1]; p++) {
          const i = this.cellItems[p];
          if (!this.A[i] || this.W[i] > this.renderDensity) continue;
          const dx = this.X[i] - focus.x, dz = this.Z[i] - focus.z;
          const d2 = dx * dx + dz * dz;
          if (d2 > farR2) continue;
          const k = this.K[i];
          const mi = k * VARIANTS + this.Vr[i];
          // this tree's own cut-over (0.8..1 of the radius) and its place in the fade
          const cut = 0.8 + 0.2 * hash2(i, 3, 5);
          // a full detailed batch hands the rest to the impostors: never a gap
          if (d2 < nearR2 * cut * cut && hash2(i, 11, 2) < detail && nearCounts[mi] < this.near[mi].instanceMatrix.count) {
            const im = this.near[mi];
            const slot = nearCounts[mi];
            nearCounts[mi]++;
            this.slots[mi][slot] = i;
            this.slotOf[i] = (mi << 20) | slot;
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
            this.slots[nearN + k][slot] = i;
            this.slotOf[i] = ((nearN + k) << 20) | slot;
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

  /** while set, cut() records the trees it removes (so an undo can put them back) */
  private cutLog: number[] | null = null;
  recordCuts() { this.cutLog = []; }
  takeCuts(): number[] { const l = this.cutLog ?? []; this.cutLog = null; return l; }

  /** Put back trees an undone road or building cut (standing on today's ground). */
  replant(ids: readonly number[]) {
    let ref = 0;
    for (const i of ids) {
      if (i < 0 || i >= this.n || this.A[i]) continue;
      const h = this.terrain.h(this.X[i], this.Z[i]);
      if (h < WATER - 1.2) continue;
      this.A[i] = 1;
      this.Y[i] = h - 0.25;
      if (this.W[i] <= REF_DENSITY) ref++;
    }
    if (ids.length) { this.alive += ref; this.dirty = true; }
    return ref;
  }

  /** How many trees (of the simulation's reference set) a path of half-width hw would clear. */
  countAlong(pts: readonly { x: number; z: number }[], hw: number): number {
    const seen = new Set<number>();
    const hw2 = hw * hw;
    for (let k = 0; k < pts.length; k += 2) {
      const p = pts[k];
      this.forCells(p.x - hw, p.z - hw, p.x + hw, p.z + hw, (i) => {
        if (!this.A[i] || this.W[i] > REF_DENSITY || seen.has(i)) return;
        if ((this.X[i] - p.x) ** 2 + (this.Z[i] - p.z) ** 2 < hw2) seen.add(i);
      });
    }
    return seen.size;
  }

  /** Remove trees inside the predicate within a box. Returns count cut. */
  cut(minX: number, minZ: number, maxX: number, maxZ: number, inside: (x: number, z: number) => boolean): number {
    let n = 0;
    let ref = 0;
    const gone: number[] = [];
    this.forCells(minX, minZ, maxX, maxZ, (i) => {
      if (!this.A[i] || !inside(this.X[i], this.Z[i])) return;
      this.A[i] = 0;
      this.cutLog?.push(i);
      gone.push(i);
      n++;
      if (this.W[i] <= REF_DENSITY) ref++;
    });
    if (n) {
      this.alive -= ref;
      // collapse their instances where they're drawn; the next re-stream drops them
      this.editDrawn(gone, (e, o) => { for (let k = 0; k < 15; k++) e[o + k] = 0; });
      for (const i of gone) if (this.slotOf) this.slotOf[i] = -1;
    }
    return ref;
  }

  /**
   * Trees stand on the ground: after the terrain under them changes (a road's
   * cut and fill, a building pad's embankment, terraforming) they move with
   * it, and ones now under water are gone. Without this, trees on a graded
   * slope were left floating over the cut or buried in the fill.
   */
  resettle(minX: number, minZ: number, maxX: number, maxZ: number) {
    let ref = 0;
    const moved: number[] = [], drowned: number[] = [];
    this.forCells(minX, minZ, maxX, maxZ, (i) => {
      if (!this.A[i]) return;
      const x = this.X[i], z = this.Z[i];
      if (x < minX || x > maxX || z < minZ || z > maxZ) return;
      // planted 0.25 m into the ground; gone where it's now deeper than a cypress stands
      const h = this.terrain.h(x, z);
      if (Math.abs(h - 0.25 - this.Y[i]) < 0.12) return;
      if (h < WATER - 1.2) { this.A[i] = 0; if (this.W[i] <= REF_DENSITY) ref++; drowned.push(i); }
      else { this.Y[i] = h - 0.25; moved.push(i); }
    });
    this.alive -= ref;
    this.editDrawn(moved, (e, o, i) => { e[o + 13] = this.Y[i]; });
    this.editDrawn(drowned, (e, o) => { for (let k = 0; k < 15; k++) e[o + k] = 0; });
  }

  /** Trees near x,z in the simulation's reference set (same on every preset). */
  countIn(x: number, z: number, r: number): number {
    let n = 0;
    const r2 = r * r;
    this.forCells(x - r, z - r, x + r, z + r, (i) => {
      if (this.A[i] && this.W[i] <= REF_DENSITY && (this.X[i] - x) ** 2 + (this.Z[i] - z) ** 2 < r2) n++;
    });
    return n;
  }

  get naturePct() {
    return this.total ? this.alive / this.total : 0;
  }
}
