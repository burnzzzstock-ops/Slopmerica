// STUB — owned by the Atmosphere & People workstream (replace wholesale).
import type * as THREE from 'three';
import type { GameTime, Season, WeatherEffects, WeatherKind } from '../contracts';
import type { MapId } from './maps';
import type { Environment } from './sky';
import type { Terrain } from './terrain';
import type { Trees } from './trees';
import type { Quality } from '../config';

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

export class WeatherSystem {
  season: Season = 'spring';
  kind: WeatherKind = 'clear';
  intensity = 0;
  /** Called when season or weather kind changes (for the feed / UI). */
  onChange?: (kind: WeatherKind, season: Season) => void;

  constructor(private ctx: AtmosphereContext) {}

  update(dt: number, time: GameTime, camera: THREE.Camera) {
    const s = seasonOf(time.dayOfYear);
    if (s !== this.season) {
      this.season = s;
      this.onChange?.(this.kind, s);
    }
  }

  /** Debug / UI override: force a weather kind for N game days. */
  force(kind: WeatherKind, days = 3) {
    this.kind = kind;
    this.onChange?.(kind, this.season);
  }

  effects(): WeatherEffects {
    return { speedMul: 1, crashMul: 1, buildMul: 1, demandMul: 1, outdoorPeopleMul: 1 };
  }
}
