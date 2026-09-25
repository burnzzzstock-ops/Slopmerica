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
      uNight: { value: 0 },
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
      uniform float uTime, uPollution, uNight;
      uniform sampler2D uHeight;
      uniform vec3 uShallow, uDeep, uMurk, uSunDir, uSunColor, uSky;
      varying vec3 vW;
      float h1(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(h1(i),h1(i+vec2(1,0)),f.x), mix(h1(i+vec2(0,1)),h1(i+vec2(1,1)),f.x), f.y); }
      float wave(vec2 p){
        return vn(p*0.08 + vec2(uTime*0.05, uTime*0.03))*0.5 + vn(p*0.21 - vec2(uTime*0.07, -uTime*0.04))*0.3 + vn(p*0.6 + uTime*0.1)*0.2;
      }
      void main() {
        vec2 uv = (vW.xz + ${HALF.toFixed(1)}) / ${WORLD.toFixed(1)};
        float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
        float ground = texture2D(uHeight, clamp(uv, 0.0, 1.0)).r;
        float outsideDepth = 30.0;
        float depth = mix(outsideDepth, ${WATER.toFixed(1)} - ground, inside);
        if (depth < -0.02) discard;
        float e = 0.8;
        float c0 = wave(vW.xz), cx = wave(vW.xz + vec2(e,0.0)), cz = wave(vW.xz + vec2(0.0,e));
        vec3 n = normalize(vec3((c0-cx)*2.2, 1.0, (c0-cz)*2.2));
        vec3 viewDir = normalize(cameraPosition - vW);
        float fres = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0);
        float dT = smoothstep(0.0, 9.0, depth);
        vec3 base = mix(uShallow, uDeep, dT);
        base = mix(base, uMurk, uPollution);
        vec3 col = mix(base, uSky, fres * 0.55);
        vec3 h = normalize(uSunDir + viewDir);
        float spec = pow(max(dot(n, h), 0.0), 180.0) * (1.0 - uNight);
        col += uSunColor * spec * 1.6;
        float foam = (1.0 - smoothstep(0.0, 0.55, depth)) * smoothstep(0.35, 0.75, vn(vW.xz*0.5 + uTime*0.3));
        col = mix(col, vec3(0.95), foam * 0.6 * (1.0 - uPollution*0.5));
        col *= mix(1.0, 0.28, uNight);
        float alpha = mix(0.45, 0.93, smoothstep(0.0, 3.5, depth));
        alpha = max(alpha, foam*0.8);
        gl_FragColor = vec4(col, alpha);
        #include <fog_fragment>
      }
    `,
  });
  const geo = new THREE.PlaneGeometry(WORLD + 12000, WORLD + 12000, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = WATER;
  mesh.renderOrder = 2;
  mesh.frustumCulled = false;
  return { mesh, mat };
}
