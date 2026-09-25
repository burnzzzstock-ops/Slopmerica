// One big water plane at y = WATER. The terrain height texture gives depth, so
// shallows glow turquoise, deep water goes navy and shorelines get foam.
import * as THREE from 'three';
import { HALF, HM_N, WATER, WORLD } from '../config';
import type { Terrain } from './terrain';

/**
 * Planar reflection for the water plane (high quality). A mirrored camera
 * renders the scene (minus the water) at reduced resolution into an HDR target
 * that the water shader samples by projecting its world position.
 */
export class WaterReflection {
  readonly rt: THREE.WebGLRenderTarget;
  readonly texMat = new THREE.Matrix4();
  private cam = new THREE.PerspectiveCamera();
  private clip = [new THREE.Plane(new THREE.Vector3(0, 1, 0), -WATER + 0.25)];
  private v = new THREE.Vector3();
  private t = new THREE.Vector3();
  private size = new THREE.Vector2();
  private bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
  enabled = true;

  constructor(private scale = 0.5) {
    this.rt = new THREE.WebGLRenderTarget(16, 16, { type: THREE.HalfFloatType, samples: 0 });
    this.rt.texture.generateMipmaps = false;
  }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, hide: THREE.Object3D[]) {
    if (!this.enabled) return;
    renderer.getDrawingBufferSize(this.size);
    const w = Math.max(64, Math.min(1400, Math.floor(this.size.x * this.scale))), h = Math.max(64, Math.floor((w * this.size.y) / Math.max(1, this.size.x)));
    if (this.rt.width !== w || this.rt.height !== h) this.rt.setSize(w, h);
    // mirror the camera across y = WATER (kept a proper rotation, like three's Reflector)
    const c = this.cam;
    c.copy(camera, false);
    camera.getWorldDirection(this.t);
    this.v.copy(camera.position);
    c.position.set(this.v.x, 2 * WATER - this.v.y, this.v.z);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    c.up.set(up.x, -up.y, up.z);
    c.lookAt(this.v.x + this.t.x, 2 * WATER - (this.v.y + this.t.y), this.v.z + this.t.z);
    c.updateMatrixWorld();
    c.projectionMatrix.copy(camera.projectionMatrix);
    c.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
    this.texMat.copy(this.bias).multiply(c.projectionMatrix).multiply(c.matrixWorldInverse);
    // render without the water, clipped below the surface, reusing this frame's shadows
    const vis = hide.map((o) => o.visible);
    hide.forEach((o) => (o.visible = false));
    const prevTarget = renderer.getRenderTarget();
    const prevClip = renderer.clippingPlanes;
    const prevShadow = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    renderer.clippingPlanes = this.clip;
    renderer.setRenderTarget(this.rt);
    renderer.clear();
    renderer.render(scene, c);
    renderer.setRenderTarget(prevTarget);
    renderer.clippingPlanes = prevClip;
    renderer.shadowMap.autoUpdate = prevShadow;
    hide.forEach((o, i) => (o.visible = vis[i]));
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

export function createWater(terrain: Terrain, colors: { shallow: number; deep: number; murk: number }, reflect = false, mapId = 'appalachia') {
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uTime: { value: 0 },
      uHeight: { value: null as THREE.Texture | null },
      uShallow: { value: new THREE.Color(colors.shallow) },
      uDeep: { value: new THREE.Color(colors.deep) },
      uMurk: { value: new THREE.Color(colors.murk) },
      uPollution: { value: 0 },
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
    },
  ]);
  const reflection = reflect ? new WaterReflection(0.5) : undefined;
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
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        vec4 mvPosition = viewMatrix * w;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      uniform float uTime, uPollution, uNight, uRain, uWindAmp, uReflOn;
      uniform sampler2D uHeight, uRefl, uInland;
      uniform vec3 uInShallow, uInDeep;
      uniform mat4 uReflMat;
      uniform vec3 uShallow, uDeep, uMurk, uSunDir, uSunColor, uSky, uSkyTop;
      varying vec3 vW;
      float h1(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
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
        float ground = texture2D(uHeight, clamp(uv, 0.0, 1.0)).r;
        float outsideDepth = 30.0;
        float depth = mix(outsideDepth, ${WATER.toFixed(1)} - ground, inside);
        if (depth < -0.02) discard;
        float camD = length(cameraPosition - vW);
        // widen the sampling footprint and calm the normals with distance so
        // far water doesn't alias into white noise
        float e = 0.8 + camD * 0.004;
        float inl0 = inside * texture2D(uInland, clamp(uv, 0.0, 1.0)).r;
        float amp = 2.2 * uWindAmp * (1.0 - 0.85 * smoothstep(250.0, 2600.0, camD)) * (1.0 - 0.55 * inl0);
        float c0 = wave(vW.xz), cx = wave(vW.xz + vec2(e,0.0)), cz = wave(vW.xz + vec2(0.0,e));
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
        base = mix(base, uMurk, uPollution);
        // sky reflection: horizon haze to zenith blue along the reflected ray
        vec3 rd = reflect(-viewDir, n);
        vec3 skyR = mix(uSky, uSkyTop, smoothstep(0.02, 0.6, rd.y)) * mix(1.0, 0.28, uNight);
        base *= mix(1.0, 0.28, uNight);
        vec3 refl = skyR;
        float rk = 0.85;
        if (uReflOn > 0.5) {
          // planar reflection: project the surface point with the mirrored camera,
          // wobble it by the wave normal (less far away)
          vec4 rc = uReflMat * vec4(vW.x, ${WATER.toFixed(1)}, vW.z, 1.0);
          vec2 ruv = rc.xy / rc.w + n.xz * 0.045 * (1.0 - smoothstep(150.0, 2500.0, camD));
          float inView = step(0.0, ruv.x) * step(ruv.x, 1.0) * step(0.0, ruv.y) * step(ruv.y, 1.0);
          vec3 tex = texture2D(uRefl, clamp(ruv, 0.001, 0.999)).rgb;
          // the mirror sees above the fog, so fade it into the sky tint far away
          inView *= 1.0 - smoothstep(900.0, 3500.0, camD);
          // real water isn't a perfect mirror: a little darker and tinted by the water body
          tex *= mix(vec3(0.82), uShallow * 1.4, 0.12);
          refl = mix(skyR, tex, inView);
          rk = 0.82;
        }
        vec3 col = mix(base, refl, clamp(fres * 1.1, 0.0, rk));
        vec3 h = normalize(uSunDir + viewDir);
        float spec = pow(max(dot(n, h), 0.0), mix(420.0, 80.0, smoothstep(300.0, 3000.0, camD))) * (1.0 - uNight);
        col += uSunColor * spec * mix(2.2, 0.7, smoothstep(300.0, 3000.0, camD)) * (1.0 - uRain * 0.7);
        // surf: foam lines rolling in over the shallows (bigger on open coast)
        float shore = (1.0 - smoothstep(0.0, 2.2, depth)) * (1.0 - inland * 0.85);
        float roll = sin(depth * 5.5 - uTime * 1.6 + vn(vW.xz * 0.05) * 6.0);
        float surf = smoothstep(0.55, 0.95, roll) * shore * smoothstep(0.02, 0.25, depth) * (0.4 + 0.6 * vn(vW.xz * 0.2 + uTime * 0.2));
        float edge = (1.0 - smoothstep(0.0, 0.45, depth)) * smoothstep(0.3, 0.75, vn(vW.xz*0.5 + uTime*0.3));
        float foam = max(edge, surf * uWindAmp);
        col = mix(col, vec3(0.93) * mix(1.0, 0.3, uNight), foam * 0.7 * (1.0 - uPollution*0.5));
        float alpha = mix(mix(0.5, 0.95, smoothstep(0.0, 3.5, depth)), mix(0.75, 0.97, smoothstep(0.0, 1.5, depth)), inland);
        alpha = max(alpha, foam*0.8);
        gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  });
  const geo = new THREE.PlaneGeometry(WORLD * 8, WORLD * 8, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = WATER;
  mesh.renderOrder = 2;
  mesh.frustumCulled = false;
  return { mesh, mat, reflection };
}
