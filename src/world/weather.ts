// Four seasons and weather. Each map has its own climate (Appalachian snow,
// NorCal marine fog + fire season + green winters, Florida afternoon storms and
// hurricanes). A weather "spell" lasts a few days and blends in smoothly; it
// drives clouds and their shadows, sky/fog, rain and snow, lightning, snow
// cover, wet ground, the post-processing grade and gameplay multipliers.
import * as THREE from 'three';
import type { GameTime, Season, WeatherEffects, WeatherKind } from '../contracts';
import type { MapId } from './maps';
import type { Environment } from './sky';
import type { Terrain } from './terrain';
import type { Trees } from './trees';
import type { Quality } from '../config';
import { ATMOS } from './atmos';
import { CloudLayer } from './clouds';

export interface AtmosphereContext {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  env: Environment;
  terrain: Terrain;
  trees: Trees;
  water: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial };
  quality: Quality;
  mapId: MapId;
}

export function seasonOf(dayOfYear: number): Season {
  const d = ((dayOfYear % 365) + 365) % 365;
  return d < 92 ? 'spring' : d < 184 ? 'summer' : d < 275 ? 'fall' : 'winter';
}

interface Look {
  cover: number; // cloud coverage 0..1
  overcast: number; // sky veil + dimmer sun
  fog: number; // fog density multiplier
  rain: number;
  snow: number;
  wind: number;
  dark: number; // cloud darkness
  whiteout: number;
  smoke: number;
  haze: number;
  lightning: number;
  tint: [number, number, number];
  sat: number;
  contrast: number;
  exposure: number;
}

const L = (o: Partial<Look>): Look => ({
  cover: 0.3, overcast: 0, fog: 1, rain: 0, snow: 0, wind: 1, dark: 0, whiteout: 0, smoke: 0, haze: 0, lightning: 0,
  tint: [1, 1, 1], sat: 1.0, contrast: 1.05, exposure: 1, ...o,
});

const LOOKS: Record<WeatherKind, Look> = {
  clear: L({}),
  cloudy: L({ cover: 0.66, overcast: 0.45, fog: 1.4, wind: 1.4, dark: 0.15, sat: 0.98 }),
  rain: L({ cover: 0.86, overcast: 0.8, fog: 2.6, rain: 0.7, wind: 1.8, dark: 0.4, tint: [0.95, 0.98, 1.03], sat: 0.84, contrast: 1.02, exposure: 0.95 }),
  storm: L({ cover: 0.96, overcast: 0.92, fog: 2.4, rain: 1, wind: 2.8, dark: 0.65, lightning: 1, tint: [0.9, 0.95, 1.05], sat: 0.76, exposure: 0.88 }),
  snow: L({ cover: 0.84, overcast: 0.78, fog: 2.4, snow: 0.7, wind: 1.3, dark: 0.2, whiteout: 0.45, tint: [0.98, 1, 1.05], sat: 0.9 }),
  blizzard: L({ cover: 0.97, overcast: 0.95, fog: 7, snow: 1, wind: 3.4, dark: 0.35, whiteout: 1, tint: [0.97, 1, 1.06], sat: 0.8, contrast: 0.96 }),
  fog: L({ cover: 0.5, overcast: 0.55, fog: 11, wind: 0.5, dark: 0.1, whiteout: 0.2, sat: 0.84, contrast: 0.94 }),
  heatwave: L({ cover: 0.08, fog: 1.5, wind: 0.6, haze: 1, tint: [1.08, 1.0, 0.86], sat: 1.14, contrast: 1.09, exposure: 1.05 }),
  hurricane: L({ cover: 1, overcast: 1, fog: 3.2, rain: 1.35, wind: 5, dark: 0.75, lightning: 0.6, tint: [0.85, 0.92, 1.0], sat: 0.68, exposure: 0.85 }),
  wildfireSmoke: L({ cover: 0.25, overcast: 0.3, fog: 4.5, wind: 1.2, dark: 0.2, smoke: 1, tint: [1.12, 0.9, 0.72], sat: 0.9, contrast: 1.02 }),
};

const FX: Record<WeatherKind, WeatherEffects> = {
  clear: { speedMul: 1, crashMul: 1, buildMul: 1, demandMul: 1, outdoorPeopleMul: 1 },
  cloudy: { speedMul: 1, crashMul: 1, buildMul: 1, demandMul: 1, outdoorPeopleMul: 0.9 },
  rain: { speedMul: 0.88, crashMul: 1.5, buildMul: 0.85, demandMul: 0.98, outdoorPeopleMul: 0.5 },
  storm: { speedMul: 0.8, crashMul: 2, buildMul: 0.6, demandMul: 0.95, outdoorPeopleMul: 0.25 },
  snow: { speedMul: 0.75, crashMul: 2.2, buildMul: 0.6, demandMul: 0.95, outdoorPeopleMul: 0.5 },
  blizzard: { speedMul: 0.55, crashMul: 3.5, buildMul: 0.2, demandMul: 0.9, outdoorPeopleMul: 0.1 },
  fog: { speedMul: 0.82, crashMul: 1.9, buildMul: 1, demandMul: 1, outdoorPeopleMul: 0.8 },
  heatwave: { speedMul: 0.95, crashMul: 1.2, buildMul: 0.8, demandMul: 0.98, outdoorPeopleMul: 0.6 },
  hurricane: { speedMul: 0.5, crashMul: 3.5, buildMul: 0.1, demandMul: 0.85, outdoorPeopleMul: 0.05 },
  wildfireSmoke: { speedMul: 0.9, crashMul: 1.3, buildMul: 0.8, demandMul: 0.96, outdoorPeopleMul: 0.3 },
};

type Table = Partial<Record<WeatherKind, number>>;
const CLIMATE: Record<MapId, Record<Season, Table>> = {
  appalachia: {
    spring: { clear: 0.34, cloudy: 0.26, rain: 0.24, storm: 0.08, fog: 0.08 },
    summer: { clear: 0.42, cloudy: 0.16, storm: 0.2, rain: 0.1, heatwave: 0.08, fog: 0.04 },
    fall: { clear: 0.42, cloudy: 0.24, rain: 0.18, fog: 0.16 },
    winter: { cloudy: 0.28, snow: 0.34, blizzard: 0.07, clear: 0.2, fog: 0.11 },
  },
  norcal: {
    spring: { clear: 0.5, cloudy: 0.18, rain: 0.14, fog: 0.18 },
    summer: { clear: 0.42, fog: 0.3, heatwave: 0.16, wildfireSmoke: 0.12 },
    fall: { clear: 0.42, wildfireSmoke: 0.2, heatwave: 0.14, fog: 0.12, cloudy: 0.12 },
    winter: { rain: 0.38, storm: 0.1, cloudy: 0.26, clear: 0.2, fog: 0.06 },
  },
  florida: {
    spring: { clear: 0.55, cloudy: 0.2, storm: 0.15, rain: 0.1 },
    summer: { storm: 0.34, clear: 0.3, rain: 0.15, heatwave: 0.16, hurricane: 0.05 },
    fall: { clear: 0.4, storm: 0.15, rain: 0.15, hurricane: 0.08, cloudy: 0.22 },
    winter: { clear: 0.6, cloudy: 0.25, fog: 0.1, rain: 0.05 },
  },
};

/** Grass color multipliers through the year (day 0 = Mar 20). */
const GRASS: Record<MapId, [number, number, number, number][]> = {
  appalachia: [[0, 0.9, 0.93, 0.78], [40, 1, 1.08, 0.9], [120, 1, 1, 1], [200, 1.06, 0.95, 0.78], [255, 0.92, 0.8, 0.64], [300, 0.84, 0.77, 0.66], [365, 0.9, 0.93, 0.78]],
  norcal: [[0, 0.72, 1.02, 0.74], [60, 0.84, 1.0, 0.82], [100, 1, 1, 1], [240, 1, 0.98, 0.95], [275, 0.88, 1.0, 0.82], [320, 0.72, 1.02, 0.72], [365, 0.72, 1.02, 0.74]],
  florida: [[0, 1, 1.02, 0.98], [150, 1, 1.04, 1], [280, 0.97, 0.96, 0.9], [340, 0.96, 0.95, 0.9], [365, 1, 1.02, 0.98]],
};
const SNOWLINE: Record<MapId, number> = { appalachia: -100, norcal: 380, florida: 1e5 };

function pick(t: Table, r: number): WeatherKind {
  let s = 0;
  for (const v of Object.values(t)) s += v ?? 0;
  let x = r * s;
  for (const [k, v] of Object.entries(t)) {
    x -= v ?? 0;
    if (x <= 0) return k as WeatherKind;
  }
  return 'clear';
}

// ------------------------------------------------------------------ rain + snow
class Precip {
  readonly rain: THREE.LineSegments;
  readonly snow: THREE.Points;
  private rainMat: THREE.ShaderMaterial;
  private snowMat: THREE.ShaderMaterial;

  constructor(scene: THREE.Scene, q: Quality) {
    const N = q.name === 'high' ? 9000 : 3500;
    // rain: two vertices per streak
    {
      const seed = new Float32Array(N * 2 * 4), end = new Float32Array(N * 2);
      for (let i = 0; i < N; i++) {
        const a = Math.random(), b = Math.random(), c = Math.random(), r = Math.random();
        for (let k = 0; k < 2; k++) {
          seed.set([a, b, c, r], (i * 2 + k) * 4);
          end[i * 2 + k] = k;
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 2 * 3), 3));
      g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
      g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
      this.rainMat = new THREE.ShaderMaterial({
        uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uOrigin: { value: new THREE.Vector3() }, uBox: { value: 200 }, uTime: { value: 0 }, uAmt: { value: 0 }, uWind: { value: new THREE.Vector2() }, uLen: { value: 1.4 }, uCol: { value: new THREE.Color(0.75, 0.8, 0.88) } }]),
        transparent: true,
        depthWrite: false,
        fog: true,
        vertexShader: /* glsl */ `
          #include <common>
          #include <fog_pars_vertex>
          attribute vec4 aSeed;
          attribute float aEnd;
          uniform vec3 uOrigin;
          uniform float uBox, uTime, uAmt, uLen;
          uniform vec2 uWind;
          varying float vA;
          void main() {
            vec3 wp;
            wp.x = uOrigin.x + mod(aSeed.x * uBox - uOrigin.x, uBox);
            wp.z = uOrigin.z + mod(aSeed.z * uBox - uOrigin.z, uBox);
            wp.y = uOrigin.y + mod(aSeed.y * uBox - uTime * 26.0, uBox);
            vec3 dir = normalize(vec3(uWind.x, -1.0, uWind.y));
            wp -= dir * uLen * aEnd;
            vA = step(aSeed.w, uAmt) * (0.35 + 0.65 * aEnd);
            vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
            gl_Position = projectionMatrix * mvPosition;
            #include <fog_vertex>
          }`,
        fragmentShader: /* glsl */ `
          #include <common>
          #include <fog_pars_fragment>
          uniform vec3 uCol;
          varying float vA;
          void main() {
            if (vA < 0.01) discard;
            gl_FragColor = vec4(uCol, vA * 0.42);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
            #include <fog_fragment>
          }`,
      });
      this.rain = new THREE.LineSegments(g, this.rainMat);
      this.rain.frustumCulled = false;
      this.rain.renderOrder = 5;
      this.rain.visible = false;
      scene.add(this.rain);
    }
    // snow: soft round points drifting on the wind
    {
      const seed = new Float32Array(N * 4);
      for (let i = 0; i < N * 4; i++) seed[i] = Math.random();
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
      g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
      this.snowMat = new THREE.ShaderMaterial({
        uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uOrigin: { value: new THREE.Vector3() }, uBox: { value: 200 }, uTime: { value: 0 }, uAmt: { value: 0 }, uWind: { value: new THREE.Vector2() }, uScale: { value: 400 } }]),
        transparent: true,
        depthWrite: false,
        fog: true,
        vertexShader: /* glsl */ `
          #include <common>
          #include <fog_pars_vertex>
          attribute vec4 aSeed;
          uniform vec3 uOrigin;
          uniform float uBox, uTime, uAmt, uScale;
          uniform vec2 uWind;
          varying float vA;
          void main() {
            float fall = uTime * (1.3 + aSeed.w * 0.8);
            vec3 wp;
            wp.x = uOrigin.x + mod(aSeed.x * uBox - uOrigin.x + uWind.x * fall * 3.0 + sin(uTime * 0.9 + aSeed.z * 30.0) * 1.2, uBox);
            wp.z = uOrigin.z + mod(aSeed.z * uBox - uOrigin.z + uWind.y * fall * 3.0 + cos(uTime * 0.7 + aSeed.x * 30.0) * 1.2, uBox);
            wp.y = uOrigin.y + mod(aSeed.y * uBox - fall, uBox);
            vA = step(aSeed.w, uAmt);
            vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
            gl_Position = projectionMatrix * mvPosition;
            gl_PointSize = (0.18 + aSeed.w * 0.14) * uScale / -mvPosition.z;
            #include <fog_vertex>
          }`,
        fragmentShader: /* glsl */ `
          #include <common>
          #include <fog_pars_fragment>
          varying float vA;
          void main() {
            vec2 q = gl_PointCoord - 0.5;
            float a = smoothstep(0.5, 0.15, length(q)) * vA;
            if (a < 0.02) discard;
            gl_FragColor = vec4(vec3(0.96, 0.97, 1.0), a * 0.9);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
            #include <fog_fragment>
          }`,
      });
      this.snow = new THREE.Points(g, this.snowMat);
      this.snow.frustumCulled = false;
      this.snow.renderOrder = 5;
      this.snow.visible = false;
      scene.add(this.snow);
    }
  }

  update(camera: THREE.PerspectiveCamera, camDist: number, time: number, rain: number, snow: number, wind: THREE.Vector2, night: number, pxH: number) {
    const B = THREE.MathUtils.clamp(camDist * 0.4, 45, 300);
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    const c = camera.position.clone().addScaledVector(fwd, B * 0.55);
    const origin = c.subScalar(B / 2);
    for (const [m, amt] of [[this.rainMat, rain], [this.snowMat, snow]] as const) {
      const u = m.uniforms;
      u.uOrigin.value.copy(origin);
      u.uBox.value = B;
      u.uTime.value = time;
      u.uAmt.value = Math.min(1, amt);
      u.uWind.value.copy(wind);
    }
    this.rainMat.uniforms.uLen.value = 0.8 + B * 0.006;
    this.rainMat.uniforms.uCol.value.setRGB(0.75, 0.8, 0.88).multiplyScalar(1 - night * 0.75);
    this.snowMat.uniforms.uScale.value = pxH * 0.6;
    this.rain.visible = rain > 0.01;
    this.snow.visible = snow > 0.01;
  }
}

// ------------------------------------------------------------------ weather system
export class WeatherSystem {
  season: Season = 'spring';
  kind: WeatherKind = 'clear';
  intensity = 0;
  /** Called when season or weather kind changes (for the feed / UI). */
  onChange?: (kind: WeatherKind, season: Season) => void;
  /** Lightning: delay (s) until the thunder arrives and how far the strike was. */
  onThunder?: (delay: number, dist: number) => void;
  /** Written each frame: the post-processing look (tint/sat/contrast/exposure). */
  look?: { tint: THREE.Color; sat: number; contrast: number; lift: THREE.Color; exposure: number };

  /** 0..1 wet ground (roads get glossy) */
  wet = 0;
  /** 0..1 snow on the ground */
  snowCover = 0;
  /** Surface breeze in m/s (x, z) for smoke and particles. */
  readonly wind = new THREE.Vector2(0.8, 0.4);

  private clouds: CloudLayer;
  private precip: Precip;
  private bolt: THREE.Line;
  private boltT = 0;
  private cur: Look = L({});
  private gameDays = 0;
  private spellEnd = 0.6;
  private spellStart = 0;
  private strength = 0.8;
  private flash = 0;
  private strikeT = 4;
  private windDir = new THREE.Vector2(0.6, 0.3);
  private realT = 0;
  private cloudOff = new THREE.Vector2(Math.random() * 10, Math.random() * 10);

  constructor(private ctx: AtmosphereContext) {
    this.clouds = new CloudLayer(ctx.scene);
    this.precip = new Precip(ctx.scene, ctx.quality);
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(40 * 3), 3));
    this.bolt = new THREE.Line(bg, new THREE.LineBasicMaterial({ color: new THREE.Color(4, 4, 5.5), fog: false, transparent: true, depthWrite: false }));
    this.bolt.frustumCulled = false;
    this.bolt.visible = false;
    ctx.scene.add(this.bolt);
    ATMOS.uSnowLine.value = SNOWLINE[ctx.mapId];
    // start the county on a nice day
    this.kind = 'clear';
    this.spellEnd = 1.2 + Math.random();
  }

  /** dt: real seconds; spd: sim speed multiplier (0 = paused). */
  update(dt: number, time: GameTime, camera: THREE.Camera, spd = 1, camDist = 800) {
    this.realT += dt;
    const dDays = (dt * spd) / 360;
    this.gameDays += dDays;
    const s = seasonOf(time.dayOfYear);
    if (s !== this.season) {
      this.season = s;
      this.onChange?.(this.kind, s);
    }
    // next spell
    if (this.gameDays >= this.spellEnd) this.startSpell(pick(CLIMATE[this.ctx.mapId][this.season], Math.random()), 0.5 + Math.random() * 2.5, false);

    // spell intensity: ease in and out
    const into = (this.gameDays - this.spellStart) / 0.18, left = (this.spellEnd - this.gameDays) / 0.18;
    this.intensity = Math.max(0, Math.min(1, into, left)) * this.strength;

    // blend every look parameter toward the target (game time, with a real-time floor)
    const target = LOOKS[this.kind], base = LOOKS.clear;
    const k = 1 - Math.exp(-(dDays / 0.06 + dt / 3));
    const cur = this.cur as unknown as Record<string, number | number[]>;
    for (const key of Object.keys(target) as (keyof Look)[]) {
      const tv = target[key], bv = base[key];
      if (Array.isArray(tv)) {
        const arr = cur[key] as number[];
        for (let i = 0; i < 3; i++) arr[i] += ((bv as number[])[i] + (tv[i] - (bv as number[])[i]) * this.intensity - arr[i]) * k;
      } else {
        const want = (bv as number) + ((tv as number) - (bv as number)) * this.intensity;
        cur[key] = (cur[key] as number) + (want - (cur[key] as number)) * k;
      }
    }
    const c = this.cur;

    // ground: wetness and snow cover
    const wantWet = c.rain > 0.05 ? 1 : c.fog > 5 ? 0.35 : 0;
    this.wet += (wantWet - this.wet) * (1 - Math.exp(-(dDays / (wantWet > this.wet ? 0.08 : 0.5) + (wantWet > this.wet ? dt / 20 : 0))));
    if (c.haze > 0.3) this.wet = Math.max(0, this.wet - dDays * 3);
    const mountainSnow = this.ctx.mapId === 'norcal' && this.season === 'winter' ? c.rain * 0.8 : 0;
    const snowing = Math.max(c.snow, mountainSnow);
    if (snowing > 0.05) this.snowCover = Math.min(1, this.snowCover + (dDays * 1.8 + dt / 25) * snowing);
    else {
      const melt = this.season === 'winter' ? 0.2 : this.season === 'fall' ? 1 : 3;
      this.snowCover = Math.max(0, this.snowCover - dDays * melt * (1 + c.rain * 2));
    }

    // shared uniforms
    const env = this.ctx.env;
    ATMOS.uCloudCover.value = c.cover;
    ATMOS.uCloudShadow.value = (0.35 + c.overcast * 0.2) * (1 - env.night) * (1 - c.overcast * 0.6);
    ATMOS.uSnow.value = this.snowCover;
    ATMOS.uWet.value = this.wet;
    ATMOS.uWind.value = c.wind;
    // clouds drift with the wind
    const windSpeed = 0.0000009 * (0.6 + c.wind);
    this.cloudOff.x += this.windDir.x * windSpeed * dt * (1 + spd * 3);
    this.cloudOff.y += this.windDir.y * windSpeed * dt * (1 + spd * 3);
    ATMOS.uCloudOffset.value.copy(this.cloudOff);
    // seasonal grass
    const keys = GRASS[this.ctx.mapId];
    const d = ((time.dayOfYear % 365) + 365) % 365;
    for (let i = 0; i < keys.length - 1; i++) {
      const a = keys[i], b = keys[i + 1];
      if (d >= a[0] && d <= b[0]) {
        const t = (d - a[0]) / Math.max(1, b[0] - a[0]);
        ATMOS.uGrassTint.value.setRGB(a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t);
        break;
      }
    }

    // sky / fog / lighting inputs
    env.overcast = c.overcast;
    env.fogMul = c.fog;
    env.smoke = c.smoke;
    env.haze = c.haze;
    env.whiteout = c.whiteout;

    // lightning
    if (c.lightning > 0.35 && env.night < 2) {
      this.strikeT -= dt * (0.4 + c.lightning);
      if (this.strikeT <= 0) {
        this.strikeT = 2.5 + Math.random() * 7;
        this.strike(camera);
      }
    }
    this.flash = Math.max(0, this.flash - dt * 3.2);
    const flicker = this.flash > 0.05 ? this.flash * (0.6 + 0.4 * Math.sin(this.realT * 70)) : 0;
    env.flash = flicker;
    this.boltT -= dt;
    this.bolt.visible = this.boltT > 0;

    this.clouds.update(env.sunColor, env.fog.color, env.night, c.dark, flicker);
    const pc = camera as THREE.PerspectiveCamera;
    const pxH = this.ctx.renderer.getDrawingBufferSize(new THREE.Vector2()).y;
    this.windDir.set(0.6, 0.3).normalize();
    const w = this.windDir.clone().multiplyScalar(0.08 * c.wind);
    this.wind.copy(this.windDir).multiplyScalar(0.9 * c.wind);
    this.precip.update(pc, camDist, this.realT, c.rain, c.snow, w, env.night, pxH);

    // water: rain ripples + wind chop
    const wu = this.ctx.water.mat.uniforms;
    if (wu.uRain) wu.uRain.value = c.rain;
    if (wu.uWindAmp) wu.uWindAmp.value = 0.7 + c.wind * 0.3;

    if (this.look) {
      this.look.tint.setRGB(c.tint[0], c.tint[1], c.tint[2]);
      this.look.sat = c.sat;
      this.look.contrast = c.contrast;
      this.look.exposure = c.exposure;
      this.look.lift.setRGB(0.03, 0.03, 0.035).multiplyScalar(Math.min(1, (c.fog - 1) / 8));
    }
  }

  private startSpell(kind: WeatherKind, days: number, forced: boolean) {
    const changed = kind !== this.kind;
    this.kind = kind;
    this.spellStart = this.gameDays;
    this.spellEnd = this.gameDays + days;
    this.strength = forced ? 1 : kind === 'clear' ? 1 : 0.55 + Math.random() * 0.45;
    // quick handover so the new spell ramps in from whatever is on screen
    if (changed) this.onChange?.(kind, this.season);
  }

  private strike(camera: THREE.Camera) {
    const T = this.ctx.terrain;
    const a = Math.random() * Math.PI * 2, r = 250 + Math.random() * 1600;
    const cx = camera.position.x + Math.cos(a) * r, cz = camera.position.z + Math.sin(a) * r;
    const gy = T.inBounds(cx, cz, 0) ? Math.max(0, T.h(cx, cz)) : 0;
    const pos = this.bolt.geometry.getAttribute('position') as THREE.BufferAttribute;
    let x = cx + (Math.random() - 0.5) * 300, z = cz + (Math.random() - 0.5) * 300;
    const top = ATMOS.uCloudH.value * 0.55;
    for (let i = 0; i < 40; i++) {
      const t = i / 39;
      const y = top + (gy - top) * t;
      x += (Math.random() - 0.5) * 70 * (1 - t * 0.5) + (cx - x) * 0.12;
      z += (Math.random() - 0.5) * 70 * (1 - t * 0.5) + (cz - z) * 0.12;
      pos.setXYZ(i, i === 39 ? cx : x, y, i === 39 ? cz : z);
    }
    pos.needsUpdate = true;
    this.boltT = 0.16 + Math.random() * 0.12;
    this.flash = 1;
    const dist = Math.hypot(cx - camera.position.x, cz - camera.position.z);
    this.onThunder?.(dist / 340, dist);
  }

  /** Debug / UI override: force a weather kind for N game days. */
  force(kind: WeatherKind, days = 3) {
    this.startSpell(kind, days, true);
    // skip the slow ease-in so the button feels instant
    this.spellStart = this.gameDays - 0.18;
  }

  effects(): WeatherEffects {
    const f = FX[this.kind], t = this.intensity;
    return {
      speedMul: 1 + (f.speedMul - 1) * t,
      crashMul: 1 + (f.crashMul - 1) * t,
      buildMul: 1 + (f.buildMul - 1) * t,
      demandMul: 1 + (f.demandMul - 1) * t,
      outdoorPeopleMul: 1 + (f.outdoorPeopleMul - 1) * t,
    };
  }
}
