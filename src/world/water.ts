// One big water plane at y = WATER (+ storm surge). The terrain height texture
// gives depth, so shallows glow turquoise, deep water goes navy and shorelines
// get foam. Weather adds wind chop, rain rings, ice creeping out from the banks
// in a hard freeze, a surge that floods the lowlands, a moon path at night and
// lightning flashes; the water body takes on the light of the hour.
import * as THREE from 'three';
import { HALF, HM_N, HM_STEP, WATER, WORLD } from '../config';
import type { Terrain } from './terrain';
import type { WorldFields } from '../contracts';
import { riverFlowTexture, WaterPollution, WATER_POLLUTION_RANGE } from './waterFields';
import { RiverFire } from './riverFire';
import { batchGroundSurface } from '../render/groundSurfaceBatch';

/**
 * Planar reflection for the water plane (high quality). A mirrored camera
 * renders the scene (minus the water) at reduced resolution into an HDR target
 * that the water shader samples by projecting its world position.
 */
export class WaterReflection {
  readonly rt: THREE.WebGLRenderTarget;
  readonly texMat = new THREE.Matrix4();
  private cam = new THREE.PerspectiveCamera();
  /** the water plane in the mirrored camera's view space, and the oblique projection's helper */
  private plane = new THREE.Plane();
  private cp = new THREE.Vector4();
  private q = new THREE.Vector4();
  private frustum = new THREE.Frustum();
  private viewProjection = new THREE.Matrix4();
  private waterBounds: THREE.Box3[] = [];
  private waterBoundsBuilt = false;
  private v = new THREE.Vector3();
  private t = new THREE.Vector3();
  private size = new THREE.Vector2();
  private up = new THREE.Vector3();
  private vis: boolean[] = [];
  private lastEye = new THREE.Vector3();
  private lastOrientation = new THREE.Quaternion();
  private lastProjection = new THREE.Matrix4();
  private lastPlaneY = NaN;
  private lastRefresh = -Infinity;
  private bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
  enabled = true;

  constructor(private scale = 0.5, terrain?: Terrain) {
    this.rt = new THREE.WebGLRenderTarget(16, 16, { type: THREE.HalfFloatType, samples: 0 });
    this.rt.texture.generateMipmaps = false;
    if (terrain) this.buildWaterBounds(terrain);
  }

  setScale(scale: number) { this.scale = Math.max(.1, Math.min(1, scale)); this.lastRefresh = -Infinity; }

  /**
   * Whether planar reflections can affect a visible water fragment. The shader
   * has fully faded the reflection to its sky fallback at 750 m, so water
   * beyond this range does not justify another scene render.
   */
  shouldRender(camera: THREE.PerspectiveCamera, terrain?: Terrain): boolean {
    if (!this.enabled) return false;
    if (!this.waterBoundsBuilt && terrain) this.buildWaterBounds(terrain);
    // No terrain means an older/direct caller cannot safely be culled.
    if (!this.waterBoundsBuilt) return true;
    if (!this.waterBounds.length) return false;
    this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.viewProjection);
    for (const box of this.waterBounds) {
      const distance = box.distanceToPoint(camera.position);
      // Keep nearby water warm through quick camera turns; otherwise require it
      // to intersect the view before paying for the mirrored scene render.
      if (distance <= 160 || (distance <= 750 && this.frustum.intersectsBox(box))) return true;
    }
    return false;
  }

  /** Returns true when the reflection target was refreshed this frame. */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, hide: THREE.Object3D[], seconds?: number): boolean {
    if (!this.shouldRender(camera)) {
      this.lastRefresh = -Infinity;
      return false;
    }
    renderer.getDrawingBufferSize(this.size);
    const limit = this.scale >= 1 ? renderer.capabilities.maxTextureSize : 1400;
    const w = Math.max(64, Math.min(limit, Math.floor(this.size.x * this.scale)));
    const h = Math.max(64, Math.min(renderer.capabilities.maxTextureSize, Math.floor((w * this.size.y) / Math.max(1, this.size.x))));
    // Mirror about the current water height, including a hurricane surge.
    const planeY = hide[0]?.position.y ?? WATER;
    const resized = this.rt.width !== w || this.rt.height !== h;
    // Ripples, rain and specular highlights are evaluated afresh by the main
    // water shader. On a stationary camera only moving scenery needs a new
    // mirror image. Refresh it at 30 Hz; refresh every moving-camera frame.
    const angularTolerance = Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5) * 0.25 / h;
    const positionTolerance = Math.max(1, Math.abs(camera.position.y - planeY)) * angularTolerance;
    if (seconds !== undefined && seconds >= this.lastRefresh && seconds - this.lastRefresh < 1 / 30 - 1e-6 &&
        !resized && planeY === this.lastPlaneY &&
        this.lastEye.distanceToSquared(camera.position) <= positionTolerance ** 2 &&
        1 - Math.abs(this.lastOrientation.dot(camera.quaternion)) <= angularTolerance ** 2 / 8 &&
        this.lastProjection.equals(camera.projectionMatrix)) return false;
    if (resized) this.rt.setSize(w, h);
    const c = this.cam;
    c.copy(camera, false);
    camera.getWorldDirection(this.t);
    this.v.copy(camera.position);
    c.position.set(this.v.x, 2 * planeY - this.v.y, this.v.z);
    const up = this.up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    c.up.set(up.x, -up.y, up.z);
    c.lookAt(this.v.x + this.t.x, 2 * planeY - (this.v.y + this.t.y), this.v.z + this.t.z);
    c.updateMatrixWorld();
    c.projectionMatrix.copy(camera.projectionMatrix);
    this.texMat.copy(this.bias).multiply(c.projectionMatrix).multiply(c.matrixWorldInverse);
    // Clip below the surface by making the water plane the camera's near plane
    // (Lengyel's oblique frustum, as three's Reflector does). The renderer's
    // clipping planes did the same job but made every material compile a second,
    // clipped program the first time water came into view (the playtest's
    // 124 ms reflection frame) and switch programs twice a frame after that.
    this.plane.set(this.t.set(0, 1, 0), -(planeY - 0.25)).applyMatrix4(c.matrixWorldInverse);
    const cp = this.cp.set(this.plane.normal.x, this.plane.normal.y, this.plane.normal.z, this.plane.constant);
    const e = c.projectionMatrix.elements;
    this.q.set((Math.sign(cp.x) + e[8]) / e[0], (Math.sign(cp.y) + e[9]) / e[5], -1, (1 + e[10]) / e[14]);
    cp.multiplyScalar(2 / cp.dot(this.q));
    e[2] = cp.x;
    e[6] = cp.y;
    e[10] = cp.z + 1;
    e[14] = cp.w;
    c.projectionMatrixInverse.copy(c.projectionMatrix).invert();
    // render without the water, reusing this frame's shadows
    const vis = this.vis;
    vis.length = hide.length;
    for (let i = 0; i < hide.length; i++) {
      vis[i] = hide[i].visible;
      hide[i].visible = false;
    }
    const prevTarget = renderer.getRenderTarget();
    const prevShadow = renderer.shadowMap.autoUpdate;
    this.lastRefresh = -Infinity;
    try {
      renderer.shadowMap.autoUpdate = false;
      renderer.setRenderTarget(this.rt);
      renderer.clear();
      renderer.render(scene, c);
    } finally {
      renderer.setRenderTarget(prevTarget);
      renderer.shadowMap.autoUpdate = prevShadow;
      for (let i = 0; i < hide.length; i++) hide[i].visible = vis[i];
    }
    this.lastEye.copy(camera.position);
    this.lastOrientation.copy(camera.quaternion);
    this.lastProjection.copy(camera.projectionMatrix);
    this.lastPlaneY = planeY;
    this.lastRefresh = seconds ?? -Infinity;
    return true;
  }

  private buildWaterBounds(terrain: Terrain) {
    // 128 m tiles keep narrow rivers discoverable without making the per-frame
    // visibility test expensive. Padding avoids toggling at shore/frustum edges.
    const tileCells = 32;
    const tileSize = tileCells * HM_STEP;
    for (let j0 = 0; j0 < HM_N - 1; j0 += tileCells) {
      for (let i0 = 0; i0 < HM_N - 1; i0 += tileCells) {
        const i1 = Math.min(HM_N - 1, i0 + tileCells);
        const j1 = Math.min(HM_N - 1, j0 + tileCells);
        let hasWater = false;
        for (let j = j0; j <= j1 && !hasWater; j++)
          for (let i = i0; i <= i1; i++)
            if (terrain.heights[j * HM_N + i] <= WATER + 1.6) { hasWater = true; break; }
        if (!hasWater) continue;
        const x = i0 * HM_STEP - HALF;
        const z = j0 * HM_STEP - HALF;
        this.waterBounds.push(new THREE.Box3(
          new THREE.Vector3(x - 24, WATER - 1, z - 24),
          new THREE.Vector3(Math.min(HALF, x + tileSize) + 24, WATER + 3, Math.min(HALF, z + tileSize) + 24),
        ));
      }
    }
    this.waterBoundsBuilt = true;
  }
}

/** Freshwater palettes (shallow, deep) for rivers, lakes, bayous per map. */
const INLAND: Record<string, [number, number]> = {
  appalachia: [0x6f8a5a, 0x2a4a3a],
  norcal: [0x4f7f70, 0x173a42],
  florida: [0x7a7440, 0x2c3a1e],
};

/**
 * 0 = open sea, 1 = inland water (rivers, lakes, bayous). The sea is wide water
 * connected to the map edge: erode the water mask so narrow channels drop out,
 * flood-fill from the edges through what's left, then grow it back.
 */
function inlandMask(terrain: Terrain, hasSea: boolean): THREE.DataTexture {
  const N = 256, cell = WORLD / N;
  const water = new Uint8Array(N * N);
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const gi = Math.min(HM_N - 1, Math.round(((i + 0.5) * cell) / (WORLD / (HM_N - 1))));
      const gj = Math.min(HM_N - 1, Math.round(((j + 0.5) * cell) / (WORLD / (HM_N - 1))));
      water[j * N + i] = terrain.heights[gj * HM_N + gi] < WATER - 0.3 ? 1 : 0;
    }
  const sea = new Uint8Array(N * N);
  if (hasSea) {
    const R = 3;
    const eroded = new Uint8Array(N * N);
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        let ok = 1;
        for (let dj = -R; dj <= R && ok; dj++)
          for (let di = -R; di <= R; di++) {
            const x = i + di, y = j + dj;
            if (x < 0 || y < 0 || x >= N || y >= N) continue;
            if (!water[y * N + x]) { ok = 0; break; }
          }
        eroded[j * N + i] = ok;
      }
    const stack: number[] = [];
    for (let k = 0; k < N; k++) for (const id of [k, (N - 1) * N + k, k * N, k * N + N - 1]) if (eroded[id] && !sea[id]) { sea[id] = 1; stack.push(id); }
    while (stack.length) {
      const id = stack.pop()!;
      const x = id % N, y = (id / N) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const nid = ny * N + nx;
        if (eroded[nid] && !sea[nid]) { sea[nid] = 1; stack.push(nid); }
      }
    }
    // grow back to the real shoreline
    for (let pass = 0; pass < R + 1; pass++) {
      const grown = sea.slice();
      for (let j = 0; j < N; j++)
        for (let i = 0; i < N; i++) {
          const id = j * N + i;
          if (sea[id] || !water[id]) continue;
          if ((i > 0 && sea[id - 1]) || (i < N - 1 && sea[id + 1]) || (j > 0 && sea[id - N]) || (j < N - 1 && sea[id + N])) grown[id] = 1;
        }
      sea.set(grown);
    }
  }
  const data = new Uint8Array(N * N * 4);
  for (let k = 0; k < N * N; k++) {
    const v = sea[k] ? 0 : 255;
    data[k * 4] = v;
    data[k * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

export function waterGeometry(segments: number, flow: THREE.DataTexture) {
  // A tessellated county surface carries the sub-metre river relief. The
  // uninhabited ocean beyond it uses coarse strips instead of a giant grid.
  // Shared boundary subdivisions keep raised river inlets watertight.
  const geo = new THREE.PlaneGeometry(WORLD, WORLD, segments, segments);
  geo.rotateX(-Math.PI / 2);
  const positions = Array.from(geo.attributes.position.array);
  const indices: number[] = [];
  const stride = segments + 1;
  const { width, height, data } = flow.image;
  if (!data) throw new Error('Water relief texture has no samples');
  const relief = new Uint8Array(stride * stride);
  // Relief multiplies the blue channel of the linearly filtered flow texture.
  // A zero footprint is planar for every bed height, tide and terrain edit.
  for (let z = 0; z <= segments; z++) for (let x = 0; x <= segments; x++) {
    const u = Math.floor(x / segments * width - 0.5), v = Math.floor(z / segments * height - 0.5);
    for (let j = v; j <= v + 1; j++) for (let i = u; i <= u + 1; i++) {
      const texel = Math.max(0, Math.min(height - 1, j)) * width + Math.max(0, Math.min(width - 1, i));
      if (data[texel * 4 + 2]) relief[z * stride + x] = 1;
    }
  }
  const tile = (x: number, z: number, side: number) => {
    let flat = true;
    for (let j = z; j <= z + side && flat; j++) for (let i = x; i <= x + side; i++) {
      if (relief[j * stride + i]) { flat = false; break; }
    }
    const start = z * stride + x;
    if (flat) {
      // Keep every original boundary vertex, including where an adjacent tile
      // has river relief. The fan has exactly the same planar coverage.
      const middle = start + (side / 2) * (stride + 1);
      for (let k = 0; k < side; k++) {
        const left = start + k * stride, bottom = start + side * stride + k;
        indices.push(middle, left, left + stride, middle, bottom, bottom + 1);
        indices.push(middle, left + side + stride, left + side, middle, start + k + 1, start + k);
      }
    } else if (side > 4) {
      const half = side / 2;
      tile(x, z, half); tile(x + half, z, half);
      tile(x, z + half, half); tile(x + half, z + half, half);
    } else {
      for (let j = 0; j < side; j++) for (let i = 0; i < side; i++) {
        const a = start + j * stride + i, b = a + stride;
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
  };
  for (let z = 0; z < segments; z += 16) for (let x = 0; x < segments; x += 16) tile(x, z, 16);
  for (const [x0, z0, x1, z1] of [
    [-HALF, -HALF, HALF, -HALF], [HALF, -HALF, HALF, HALF],
    [HALF, HALF, -HALF, HALF], [-HALF, HALF, -HALF, -HALF],
  ]) for (let i = 0; i < segments; i++) {
    const ax = x0 + (x1 - x0) * i / segments, az = z0 + (z1 - z0) * i / segments;
    const bx = x0 + (x1 - x0) * (i + 1) / segments, bz = z0 + (z1 - z0) * (i + 1) / segments;
    const base = positions.length / 3;
    positions.push(ax, 0, az, ax * 8, 0, az * 8, bx * 8, 0, bz * 8, bx, 0, bz);
    indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  // This shader builds normals from waves; unused grid UV/normal arrays need
  // not be padded for the horizon vertices.
  geo.deleteAttribute('normal');
  geo.deleteAttribute('uv');
  return geo;
}

export function createWater(terrain: Terrain, colors: { shallow: number; deep: number; murk: number }, reflect: boolean | number = false, mapId = 'appalachia') {
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uTime: { value: 0 },
      uHeight: { value: null as THREE.Texture | null },
      uShallow: { value: new THREE.Color(colors.shallow) },
      uDeep: { value: new THREE.Color(colors.deep) },
      uMurk: { value: new THREE.Color(colors.murk) },
      uPollution: { value: 0 }, // explicit diagnostic override; normal Game uses the spatial field
      uPollutionField: { value: null as THREE.Texture | null },
      uFlow: { value: null as THREE.Texture | null },
      uSceneColor: { value: null as THREE.Texture | null },
      uSceneDepth: { value: null as THREE.Texture | null },
      uRefractionOn: { value: 0 },
      // Tannic bayous keep their body color even over Florida's bright, shallow bed.
      uInAbsorption: { value: new THREE.Vector3().fromArray(mapId === 'florida' ? [1.6, .95, 1.3] : [.70, .38, .50]) },
      uViewport: { value: new THREE.Vector2(1, 1) },
      uCameraRange: { value: new THREE.Vector2(.1, 12000) },
      uSunDir: { value: new THREE.Vector3(0.3, 0.8, 0.2) },
      uSunColor: { value: new THREE.Color(1, 0.95, 0.85) },
      uSky: { value: new THREE.Color(0x9fc4e8) },
      uSkyTop: { value: new THREE.Color(0x3f6fb0) },
      uNight: { value: 0 },
      uRain: { value: 0 },
      uWindAmp: { value: 1 },
      uRefl: { value: null as THREE.Texture | null },
      uInland: { value: null as THREE.Texture | null },
      uInShallow: { value: new THREE.Color(INLAND[mapId]?.[0] ?? colors.shallow) },
      uInDeep: { value: new THREE.Color(INLAND[mapId]?.[1] ?? colors.deep) },
      uReflMat: { value: new THREE.Matrix4() },
      uReflOn: { value: 0 },
      // atmosphere extras (WeatherSystem keeps these current)
      uIce: { value: 0 },
      uLevel: { value: 0 },
      uLight: { value: 1 },
      uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
      uMoonLight: { value: 0 },
      uFlash: { value: 0 },
    },
  ]);
  let reflection = reflect ? new WaterReflection(typeof reflect === 'number' ? reflect : .5, terrain) : undefined;
  const pollution = new WaterPollution();
  uniforms.uPollutionField.value = pollution.texture;
  const flow = riverFlowTexture(terrain);
  uniforms.uFlow.value = flow;
  uniforms.uInland.value = inlandMask(terrain, mapId !== 'appalachia');
  if (reflection) {
    uniforms.uRefl.value = reflection.rt.texture;
    uniforms.uReflMat.value = reflection.texMat;
    uniforms.uReflOn.value = 1;
  }
  uniforms.uHeight.value = terrain.heightTex;

  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    fog: true,
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      varying vec3 vW;
      varying float vViewDepth;
      uniform sampler2D uFlow, uHeight;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vec2 uv = (w.xz + ${HALF.toFixed(1)}) / ${WORLD.toFixed(1)};
        float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
        vec2 huv = uv * ${((HM_N - 1) / HM_N).toFixed(8)} + ${(0.5 / HM_N).toFixed(8)};
        float bed = texture2D(uHeight, clamp(huv, 0.0, 1.0)).r;
        w.y += texture2D(uFlow, clamp(uv, 0.0, 1.0)).b * smoothstep(.4, 3.0, w.y - bed) * inside;
        vW = w.xyz;
        vec4 mvPosition = viewMatrix * w;
        vViewDepth = -mvPosition.z;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      uniform float uTime, uPollution, uNight, uRain, uWindAmp, uReflOn;
      uniform float uIce, uLevel, uLight, uMoonLight, uFlash;
      uniform sampler2D uHeight, uRefl, uInland, uFlow, uPollutionField;
      uniform sampler2D uSceneColor, uSceneDepth;
      uniform float uRefractionOn;
      uniform vec3 uInAbsorption;
      uniform vec2 uViewport, uCameraRange;
      uniform vec3 uInShallow, uInDeep;
      uniform mat4 uReflMat;
      uniform vec3 uShallow, uDeep, uMurk, uSunDir, uSunColor, uSky, uSkyTop, uMoonDir;
      varying vec3 vW;
      varying float vViewDepth;
      float sceneDistance(float d) {
        return uCameraRange.x * uCameraRange.y / (uCameraRange.y - d * (uCameraRange.y - uCameraRange.x));
      }
      float h1(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(h1(i),h1(i+vec2(1,0)),f.x), mix(h1(i+vec2(0,1)),h1(i+vec2(1,1)),f.x), f.y); }
      float wave(vec2 p){
        return vn(p*0.08 + vec2(uTime*0.05, uTime*0.03))*0.5 + vn(p*0.21 - vec2(uTime*0.07, -uTime*0.04))*0.3 + vn(p*0.6 + uTime*0.1)*0.2;
      }
      // expanding raindrop rings on a jittered grid
      float ripples(vec2 p) {
        vec2 cell = floor(p / 2.2);
        float acc = 0.0;
        for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
          vec2 c = cell + vec2(float(i), float(j));
          float r = h1(c);
          vec2 ctr = (c + 0.2 + 0.6 * vec2(r, h1(c + 7.1))) * 2.2;
          float t = fract(uTime * 0.9 + r * 7.0);
          float d = length(p - ctr);
          acc += sin(clamp((d - t * 1.6) * 9.0, -3.14159, 3.14159)) * (1.0 - t) * smoothstep(0.9, 0.0, abs(d - t * 1.6));
        }
        return acc;
      }
      void main() {
        vec2 uv = (vW.xz + ${HALF.toFixed(1)}) / ${WORLD.toFixed(1)};
        float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
        // the height texture has HM_N texels, the first centre on the map's edge sample and the last on the other edge: its
        // uv is (i + 0.5) / HM_N for sample i, not i / (HM_N - 1), or the depth read is up to half a texel (2 m) off,
        // and the visible waterline with it (0 at the middle of the map, a full 2 m at its edges)
        vec2 huv = clamp(uv * ${((HM_N - 1) / HM_N).toFixed(8)} + ${(0.5 / HM_N).toFixed(8)}, 0.0, 1.0);
        float ground = texture2D(uHeight, huv).r;
        float outsideDepth = 30.0;
        float depth = mix(outsideDepth, vW.y - ground, inside);
        if (depth < -0.02) discard;
        float camD = length(cameraPosition - vW);
        // widen the sampling footprint and calm the normals with distance so
        // far water doesn't alias into white noise
        float e = 0.8 + camD * 0.004;
        float inl0 = inside * texture2D(uInland, clamp(uv, 0.0, 1.0)).r;
        float amp = 2.2 * uWindAmp * (1.0 - 0.85 * smoothstep(250.0, 2600.0, camD)) * (1.0 - 0.55 * inl0);
        vec4 flow = texture2D(uFlow, clamp(uv, 0.0, 1.0)) * inside;
        vec2 flowing = vW.xz - flow.rg * uTime * (.45 + uWindAmp * .15) * flow.a;
        float c0 = wave(flowing), cx = wave(flowing + vec2(e,0.0)), cz = wave(flowing + vec2(0.0,e));
        vec3 n = normalize(vec3((c0-cx)*amp*0.8/e, 1.0, (c0-cz)*amp*0.8/e));
        if (uRain > 0.01 && camD < 400.0) {
          float k = uRain * (1.0 - smoothstep(120.0, 400.0, camD));
          float r0 = ripples(vW.xz), rx = ripples(vW.xz + vec2(0.05, 0.0)), rz = ripples(vW.xz + vec2(0.0, 0.05));
          n = normalize(n + vec3((r0 - rx), 0.0, (r0 - rz)) * 2.5 * k);
        }
        vec3 viewDir = normalize(cameraPosition - vW);
        float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, viewDir), 0.0), 5.0);
        float dT = smoothstep(0.0, 9.0, depth);
        // open sea vs rivers / lakes / bayous (tea-dark, mirror-calm)
        float inland = inside * texture2D(uInland, clamp(uv, 0.0, 1.0)).r;
        vec3 base = mix(mix(uShallow, uDeep, dT), mix(uInShallow, uInDeep, smoothstep(0.0, 4.0, depth)), inland);
        // Severity bands are presentation styling, not chemical classifications.
        float pollution = max(uPollution, texture2D(uPollutionField, clamp(uv, 0.0, 1.0)).r * ${WATER_POLLUTION_RANGE.toFixed(1)} * inside);
        float dirty = smoothstep(.08, .7, pollution);
        vec3 sediment = mix(uMurk, vec3(.24, .125, .045), .5);
        vec3 polluted = mix(sediment, vec3(.11, .22, .035), smoothstep(.65, 1.3, pollution));
        polluted = mix(polluted, vec3(.48, .13, .018), smoothstep(1.5, 2.5, pollution));
        base = mix(base, polluted, dirty * .88);
        // sky reflection: horizon haze to zenith blue along the reflected ray
        vec3 rd = reflect(-viewDir, n);
        vec3 skyR = mix(uSky, uSkyTop, smoothstep(0.02, 0.6, rd.y)) * mix(1.0, 0.28, uNight);
        // the water body is lit like everything else: dim and warm at dusk, dark at night
        // the night grade lifts exposure, so the water body stays properly dark
        float light = min(uLight, mix(1.0, 0.2, uNight));
        vec3 sunTint = uSunColor / max(max(uSunColor.r, uSunColor.g), max(uSunColor.b, 1e-3));
        base *= light * mix(vec3(1.0), sunTint, 0.55 * (1.0 - uNight));
        vec3 refl = skyR;
        float rk = 0.85;
        if (uReflOn > 0.5) {
          // planar reflection: project the surface point with the mirrored camera,
          // wobble it by the wave normal (less far away)
          vec4 rc = uReflMat * vec4(vW.x, ${WATER.toFixed(1)} + uLevel, vW.z, 1.0);
          vec2 ruv = rc.xy / rc.w + n.xz * 0.045 * (1.0 - smoothstep(150.0, 2500.0, camD));
          float inView = step(0.0, ruv.x) * step(ruv.x, 1.0) * step(0.0, ruv.y) * step(ruv.y, 1.0);
          vec3 tex = textureLod(uRefl, clamp(ruv, 0.001, 0.999), 0.0).rgb;
          // the mirror sees above the fog, so fade it into the sky tint far away
          inView *= 1.0 - smoothstep(500.0, 750.0, camD);
          // real water isn't a perfect mirror: a little darker and tinted by the water body
          tex *= mix(vec3(0.82), uShallow * 1.4, 0.12);
          refl = mix(skyR, tex, inView);
          rk = 0.82;
        }
        // Beer-Lambert absorption uses the actual opaque scene depth when a
        // refraction copy is available; the terrain depth remains the cheap fallback.
        float path = max(0.0, depth) / max(.25, abs(viewDir.y));
        vec3 absorption = mix(vec3(.42, .19, .10), uInAbsorption, inland) + pollution * vec3(.18, .14, .2);
        vec3 transmission = exp(-absorption * path);
        if (uRefractionOn > .5) {
          vec2 suv = gl_FragCoord.xy / uViewport;
          vec2 refracted = clamp(suv + n.xz * .012 * (1.0 - exp(-depth * .3)), vec2(.001), vec2(.999));
          float sceneD = sceneDistance(textureLod(uSceneDepth, refracted, 0.0).r);
          // A distorted sample that crosses foreground land must not drag it under water.
          if (sceneD < vViewDepth + .05) {
            refracted = suv;
            sceneD = sceneDistance(textureLod(uSceneDepth, suv, 0.0).r);
          }
          path = min(path, max(0.0, sceneD - vViewDepth));
          transmission = exp(-absorption * path);
          base = textureLod(uSceneColor, refracted, 0.0).rgb * transmission + base * (1.0 - transmission);
        }
        vec3 col = mix(base, refl, clamp(fres * 1.1, 0.0, rk));
        vec3 h = normalize(uSunDir + viewDir);
        float spec = pow(max(dot(n, h), 0.0), mix(420.0, 80.0, smoothstep(300.0, 3000.0, camD))) * (1.0 - uNight);
        col += uSunColor * spec * mix(1.5, 0.55, smoothstep(300.0, 3000.0, camD)) * (1.0 - uRain * 0.7);
        // a silver moon path at night
        vec3 hm = normalize(uMoonDir + viewDir);
        col += vec3(0.72, 0.8, 1.0) * pow(max(dot(n, hm), 0.0), 140.0) * uMoonLight * 5.0 * step(0.0, uMoonDir.y) * uNight;
        // surf: foam lines rolling in over the shallows (bigger on open coast)
        float shore = (1.0 - smoothstep(0.0, 2.2, depth)) * (1.0 - inland * 0.85);
        // Dividing depth by its screen gradient keeps a contour ribbon readable
        // on both steep banks and shallow beaches, without a white polygon rim.
        float contour = max(fwidth(depth), .018);
        float roll = sin(depth * 5.5 - uTime * 1.6 + vn(flowing * 0.05) * 6.0);
        float surf = smoothstep(0.55, 0.95, roll) * shore * smoothstep(0.02, 0.25, depth) * (0.4 + 0.6 * vn(vW.xz * 0.2 + uTime * 0.2));
        // the lap line at the edge: broken up, and mostly a coastal thing (rivers and ponds
        // get a dark wet margin instead of a white rim; playtest 5: "angular bright shorelines")
        float edge = (1.0 - smoothstep(0.0, 0.45, depth)) * smoothstep(0.3, 0.75, vn(vW.xz*0.5 + uTime*0.3)) * smoothstep(0.25, 0.6, vn(vW.xz * 0.06)) * (1.0 - inland * 0.8);
        col *= 1.0 - 0.3 * inland * (1.0 - smoothstep(0.0, 0.8, depth));
        float riverLap = (1.0 - smoothstep(.06 + contour, .22 + contour * 2.0, depth)) * smoothstep(.015, .08, depth);
        riverLap *= smoothstep(.55, .85, vn(flowing * .22)) * inland * .32;
        float foam = max(max(edge, riverLap), surf * uWindAmp);
        col = mix(col, vec3(0.86) * mix(1.0, 0.16, uNight), foam * .6 * (1.0 - min(1.0, pollution) * .5));
        // winter ice creeping in from the banks
        float ice = 0.0;
        if (uIce > 0.001) {
          float iceN = vn(vW.xz * 0.07) * 0.6 + vn(vW.xz * 0.5) * 0.4;
          ice = uIce * (1.0 - smoothstep(0.2, 0.35 + uIce * 2.4, depth + (iceN - 0.5) * 1.2));
          float crack = smoothstep(0.025, 0.0, abs(vn(vW.xz * 0.35) - 0.5)) * 0.35;
          vec3 iceCol = vec3(0.72, 0.8, 0.88) * max(light, 0.15) * (0.85 + 0.15 * vn(vW.xz * 2.0)) * (1.0 - crack);
          col = mix(col, iceCol + skyR * 0.12, ice);
        }
        col += vec3(0.55, 0.6, 0.85) * uFlash * (0.25 + fres);
        // (river and pond water is thin at the bank: the bottom shows through it, not an opaque green lip)
        float alpha = mix(mix(0.5, 0.95, smoothstep(0.0, 3.5, depth)), mix(0.34, 0.97, smoothstep(0.0, 1.9, depth)), inland);
        // Without a color copy, alpha transmission still gives the riverbed a
        // depth- and pollution-dependent absorption rather than a constant lip.
        alpha = mix(alpha, 1.0 - dot(transmission, vec3(.2126, .7152, .0722)) * .65, .65);
        if (uRefractionOn > .5) alpha = 1.0;
        alpha = max(alpha, foam*0.8);
        alpha = mix(alpha, 0.97, ice);
        // melt into the bank: the visible edge follows the smooth depth contour, not the
        // terrain triangles crossing the water plane
        // the contour itself wanders a little, by -15 to +7 cm of depth (metres of bank on a gentle slope): the water laps
        // an uneven margin instead of laying a ruler along the bank. It mostly pulls the edge back into the water (4 cm on
        // average); where the ground stands above the plane the terrain hides it anyway
        float dEdge = depth + (vn(vW.xz * 0.8) - 0.75) * 0.17 + (vn(vW.xz * 3.3) - 0.5) * 0.05;
        alpha *= mix(smoothstep(0.0, 0.35, dEdge), 1.0, ice);
        gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  });
  const geo = waterGeometry(reflect ? 256 : 128, flow);
  const mesh = new THREE.Mesh(geo, mat);
  const batchSurface = (geometry: THREE.BufferGeometry) => {
    const batch = batchGroundSurface(geometry, mat, 512, .3);
    batch.renderOrder = 2;
    geometry.setDrawRange(0, 0);
    mesh.add(batch);
    return batch;
  };
  let surface = batchSurface(geo);
  mesh.position.y = WATER;
  mesh.renderOrder = 2;
  mesh.frustumCulled = false;
  const fire = new RiverFire(terrain, uniforms.uTime, uniforms.uNight, uniforms.uLevel);
  mesh.add(fire.mesh);
  return { mesh, mat, pollution, fire,
    get reflection() { return reflection; },
    setQuality(name: 'low' | 'medium' | 'high' | 'ultra') {
      const scale = name === 'low' ? 0 : name === 'medium' ? .25 : name === 'high' ? .5 : 1;
      if (!scale) { reflection?.rt.dispose(); reflection = undefined; }
      else if (!reflection) reflection = new WaterReflection(scale, terrain);
      else reflection.setScale(scale);
      uniforms.uRefl.value = reflection?.rt.texture ?? null;
      uniforms.uReflMat.value = reflection?.texMat ?? uniforms.uReflMat.value;
      uniforms.uReflOn.value = reflection ? 1 : 0;
      const segments = scale ? 256 : 128;
      if ((mesh.geometry as THREE.PlaneGeometry).parameters.widthSegments !== segments) {
        mesh.remove(surface); surface.dispose();
        mesh.geometry.dispose(); mesh.geometry = waterGeometry(segments, flow);
        surface = batchSurface(mesh.geometry);
      }
    },
    updateFields(fields: WorldFields) { if (pollution.update(fields)) fire.update(fields); },
    dispose() {
      surface.dispose();
      mesh.geometry.dispose(); mat.dispose(); reflection?.rt.dispose(); pollution.dispose(); fire.dispose();
      (uniforms.uFlow.value as THREE.Texture).dispose();
      (uniforms.uInland.value as THREE.Texture).dispose();
    },
  };
}
