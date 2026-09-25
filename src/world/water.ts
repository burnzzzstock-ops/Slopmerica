// One big water plane at y = WATER. The terrain height texture gives depth, so
// shallows glow turquoise, deep water goes navy and shorelines get foam.
import * as THREE from 'three';
import { HALF, WATER, WORLD } from '../config';
import type { Terrain } from './terrain';

export function createWater(terrain: Terrain, colors: { shallow: number; deep: number; murk: number }) {
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
    },
  ]);
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
      uniform float uTime, uPollution, uNight, uRain, uWindAmp;
      uniform sampler2D uHeight;
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
        float amp = 2.2 * uWindAmp * (1.0 - 0.85 * smoothstep(250.0, 2600.0, camD));
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
        vec3 base = mix(uShallow, uDeep, dT);
        base = mix(base, uMurk, uPollution);
        // sky reflection: horizon haze to zenith blue along the reflected ray
        vec3 rd = reflect(-viewDir, n);
        vec3 skyR = mix(uSky, uSkyTop, smoothstep(0.02, 0.6, rd.y));
        vec3 col = mix(base, skyR, clamp(fres * 1.1, 0.0, 0.85));
        vec3 h = normalize(uSunDir + viewDir);
        float spec = pow(max(dot(n, h), 0.0), mix(420.0, 80.0, smoothstep(300.0, 3000.0, camD))) * (1.0 - uNight);
        col += uSunColor * spec * mix(2.2, 0.7, smoothstep(300.0, 3000.0, camD)) * (1.0 - uRain * 0.7);
        // surf: foam lines rolling in over the shallows (bigger on open coast)
        float shore = 1.0 - smoothstep(0.0, 2.2, depth);
        float roll = sin(depth * 5.5 - uTime * 1.6 + vn(vW.xz * 0.05) * 6.0);
        float surf = smoothstep(0.55, 0.95, roll) * shore * smoothstep(0.02, 0.25, depth) * (0.4 + 0.6 * vn(vW.xz * 0.2 + uTime * 0.2));
        float edge = (1.0 - smoothstep(0.0, 0.45, depth)) * smoothstep(0.3, 0.75, vn(vW.xz*0.5 + uTime*0.3));
        float foam = max(edge, surf * uWindAmp);
        col = mix(col, vec3(0.93), foam * 0.7 * (1.0 - uPollution*0.5));
        col *= mix(1.0, 0.28, uNight);
        float alpha = mix(0.5, 0.95, smoothstep(0.0, 3.5, depth));
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
  return { mesh, mat };
}
