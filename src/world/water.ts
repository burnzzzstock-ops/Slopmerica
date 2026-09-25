// One big water plane at y = WATER (+ storm surge). The terrain height texture
// gives depth, so shallows glow turquoise, deep water goes navy and shorelines
// get foam. Weather adds wind chop and whitecaps, rain rings, ice along the
// banks, a moon path at night and lightning flashes.
import * as THREE from 'three';
import { HALF, WATER, WORLD } from '../config';
import type { Terrain } from './terrain';
import { atmo } from './seasons';

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
      // atmosphere extras (WeatherSystem keeps these current)
      uZenith: { value: new THREE.Color(0x4a78c0) },
      uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
      uMoonLight: { value: 0 },
      uLight: { value: 1 },
      uLevel: { value: 0 },
      uWindS: { value: 0.15 },
    },
  ]);
  uniforms.uHeight.value = terrain.heightTex;
  // shared uniform objects (same references as every other atmosphere shader)
  Object.assign(uniforms, {
    uRain: atmo.uRain, uIce: atmo.uIce, uFlash: atmo.uFlash, uWindDir: atmo.uWindDir,
    uCloudCover: atmo.uCloudCover, uCloudShadow: atmo.uCloudShadow, uCloudOffset: atmo.uCloudOffset,
  });

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
      uniform float uTime, uPollution, uNight, uMoonLight, uLight, uLevel, uWindS, uRain, uIce, uFlash, uCloudCover, uCloudShadow;
      uniform sampler2D uHeight;
      uniform vec3 uShallow, uDeep, uMurk, uSunDir, uSunColor, uSky, uZenith, uMoonDir;
      uniform vec2 uWindDir, uCloudOffset;
      varying vec3 vW;
      float h1(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(h1(i),h1(i+vec2(1,0)),f.x), mix(h1(i+vec2(0,1)),h1(i+vec2(1,1)),f.x), f.y); }
      // fine octaves fade out with distance so the far water doesn't sparkle-alias
      float wave(vec2 p, float lod){
        vec2 drift = uWindDir * uTime * (0.4 + uWindS * 2.0);
        return vn(p*0.08 + vec2(uTime*0.05, uTime*0.03) - drift*0.08)*0.5
             + vn(p*0.21 - vec2(uTime*0.07, -uTime*0.04) - drift*0.21)*0.3 * (1.0 - smoothstep(700.0, 2400.0, lod))
             + vn(p*0.6 + uTime*0.1 - drift*0.6)*0.2 * (1.0 - smoothstep(120.0, 500.0, lod));
      }
      float cloudLight(vec2 xz){
        vec2 p = xz + uCloudOffset;
        float n = vn(p*0.0021)*0.55 + vn(p*0.0057+3.7)*0.3 + vn(p*0.016-1.3)*0.15;
        return 1.0 - uCloudShadow * smoothstep(1.02 - uCloudCover, 1.18 - uCloudCover, n);
      }
      void main() {
        vec2 uv = (vW.xz + ${HALF.toFixed(1)}) / ${WORLD.toFixed(1)};
        float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
        float ground = texture2D(uHeight, clamp(uv, 0.0, 1.0)).r;
        float outsideDepth = 30.0;
        float depth = mix(outsideDepth, ${WATER.toFixed(1)} + uLevel - ground, inside);
        if (depth < -0.02) discard;
        float camDist = length(cameraPosition - vW);

        float e = 0.8;
        float c0 = wave(vW.xz, camDist), cx = wave(vW.xz + vec2(e,0.0), camDist), cz = wave(vW.xz + vec2(0.0,e), camDist);
        float amp = 1.5 * (1.0 + uWindS * 3.0) * mix(1.0, 0.45, smoothstep(300.0, 1600.0, camDist));
        vec2 slope = vec2(c0 - cx, c0 - cz) * amp;
        // raindrop rings (close up only)
        if (uRain > 0.01) {
          float nearK = 1.0 - smoothstep(60.0, 260.0, camDist);
          for (int k = 0; k < 2; k++) {
            vec2 rp = vW.xz * (0.9 + float(k) * 0.37) + float(k) * 13.1;
            vec2 rc = floor(rp);
            vec2 ro = fract(rp) - 0.5 - (vec2(h1(rc + 1.7), h1(rc + 2.9)) - 0.5) * 0.5;
            float rt = fract(uTime * 1.1 + h1(rc));
            float rd = length(ro);
            float ring = sin((rd - rt * 0.5) * 60.0) * smoothstep(0.12, 0.0, abs(rd - rt * 0.5)) * (1.0 - rt);
            slope += ro / max(rd, 1e-3) * ring * uRain * nearK * 0.35;
          }
        }
        vec3 n = normalize(vec3(slope.x, 1.0, slope.y));
        vec3 viewDir = normalize(cameraPosition - vW);
        float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, viewDir), 0.0), 5.0);
        float light = min(uLight, mix(1.0, 0.3, uNight));
        float cl = cloudLight(vW.xz);

        float dT = smoothstep(0.0, 9.0, depth);
        vec3 base = mix(uShallow, uDeep, dT);
        base = mix(base, uMurk, uPollution);
        base *= light * light * mix(1.0, cl, 0.6);
        // the water body takes on the sun's color (orange at dusk, red in smoke)
        vec3 sunTint = uSunColor / max(max(uSunColor.r, uSunColor.g), max(uSunColor.b, 1e-3));
        base *= mix(vec3(1.0), sunTint, 0.55 * (1.0 - uNight));
        vec3 r = reflect(-viewDir, n);
        vec3 refl = mix(uSky, uZenith, clamp(r.y * 1.6, 0.0, 1.0));
        vec3 col = mix(base, refl, clamp(fres * 0.85 + 0.06, 0.0, 1.0));

        // sun glitter and a silver moon path
        vec3 hs = normalize(uSunDir + viewDir);
        float ns = max(dot(n, hs), 0.0);
        col += uSunColor * (pow(ns, 260.0) * 2.4 + pow(ns, 28.0) * 0.06) * smoothstep(-0.02, 0.05, uSunDir.y) * cl * (1.0 - uNight);
        vec3 hm = normalize(uMoonDir + viewDir);
        col += vec3(0.72, 0.8, 1.0) * pow(max(dot(n, hm), 0.0), 140.0) * uMoonLight * 5.0 * step(0.0, uMoonDir.y);

        // shoreline foam + wind whitecaps
        float foam = (1.0 - smoothstep(0.0, 0.55 + uWindS * 0.8, depth)) * smoothstep(0.35, 0.75, vn(vW.xz*0.5 + uTime*0.3));
        float caps = smoothstep(0.74 - uWindS * 0.2, 0.9, c0) * smoothstep(0.3, 0.8, uWindS) * smoothstep(2.0, 6.0, depth);
        foam = max(foam, caps);
        col = mix(col, vec3(0.92) * light, foam * 0.6 * (1.0 - uPollution*0.5));

        // winter ice creeping in from the banks
        float ice = 0.0;
        if (uIce > 0.001) {
          float iceN = vn(vW.xz * 0.07) * 0.6 + vn(vW.xz * 0.5) * 0.4;
          ice = uIce * (1.0 - smoothstep(0.2, 0.35 + uIce * 2.4, depth + (iceN - 0.5) * 1.2));
          float crack = smoothstep(0.025, 0.0, abs(vn(vW.xz * 0.35) - 0.5)) * 0.35;
          vec3 iceCol = vec3(0.72, 0.8, 0.88) * light * (0.85 + 0.15 * vn(vW.xz * 2.0)) * (1.0 - crack);
          iceCol += refl * 0.12;
          col = mix(col, iceCol, ice);
        }
        col += vec3(0.55, 0.6, 0.85) * uFlash * (0.25 + fres);

        float alpha = mix(0.45, 0.93, smoothstep(0.0, 3.5, depth));
        alpha = max(alpha, foam * 0.8);
        alpha = mix(alpha, 0.97, ice);
        gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
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
