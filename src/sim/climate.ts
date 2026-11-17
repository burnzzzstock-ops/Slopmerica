// The weather the simulation runs on. It decides the spells (what, how long, how strong) and what they do to the county:
// traffic speed, crashes, building, demand, who is outdoors, fires, solar output, the wind that carries smoke and wildfire.
// It advances in game time only, draws from its own seeded stream and is saved, so the same county has the same weather on
// every machine, at every frame rate and after every reload. What the sky looks like (src/world/weather.ts) follows it.
//
// The tables are the game's own: the gameplay multipliers and the per-map, per-season odds that were in the sky's module.
import type { Season, WeatherEffects, WeatherKind } from '../contracts';
import { Rng } from '../core/rng';
import type { MapId } from '../world/maps';
import { newSeasonLook, sampleSeason, seasonOf, temperatureC, YEAR } from '../world/seasons';
import { DAY_SECONDS } from './sim';

const FX: Record<WeatherKind, WeatherEffects> = {
  clear: { speedMul: 1, crashMul: 1, buildMul: 1, demandMul: 1, outdoorPeopleMul: 1 },
  cloudy: { speedMul: 1, crashMul: 1, buildMul: 1, demandMul: 1, outdoorPeopleMul: 0.9 },
  rain: { speedMul: 0.88, crashMul: 1.5, buildMul: 0.85, demandMul: 0.98, outdoorPeopleMul: 0.5 },
  storm: { speedMul: 0.8, crashMul: 2, buildMul: 0.6, demandMul: 0.95, outdoorPeopleMul: 0.25 },
  snow: { speedMul: 0.75, crashMul: 2.2, buildMul: 0.6, demandMul: 0.95, outdoorPeopleMul: 0.5 },
  blizzard: { speedMul: 0.55, crashMul: 3.5, buildMul: 0.2, demandMul: 0.9, outdoorPeopleMul: 0.1 },
  fog: { speedMul: 0.82, crashMul: 1.9, buildMul: 1, demandMul: 1, outdoorPeopleMul: 0.8 },
  heatwave: { speedMul: 0.95, crashMul: 1.2, buildMul: 0.8, demandMul: 0.98, outdoorPeopleMul: 0.35 },
  hurricane: { speedMul: 0.5, crashMul: 3.5, buildMul: 0.1, demandMul: 0.85, outdoorPeopleMul: 0.05 },
  wildfireSmoke: { speedMul: 0.9, crashMul: 1.3, buildMul: 0.8, demandMul: 0.96, outdoorPeopleMul: 0.3 },
};

type Table = Partial<Record<WeatherKind, number>>;
const ODDS: Record<MapId, Record<Season, Table>> = {
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
    winter: { rain: 0.36, storm: 0.1, cloudy: 0.26, clear: 0.2, fog: 0.06, snow: 0.02 },
  },
  florida: {
    spring: { clear: 0.55, cloudy: 0.2, storm: 0.15, rain: 0.1 },
    summer: { storm: 0.34, clear: 0.3, rain: 0.15, heatwave: 0.16, hurricane: 0.05 },
    fall: { clear: 0.4, storm: 0.15, rain: 0.15, hurricane: 0.08, cloudy: 0.22 },
    winter: { clear: 0.6, cloudy: 0.25, fog: 0.1, rain: 0.05, snow: 0.006 },   // "snow" = the one-flake joke
  },
};
/** how much rain or snow falls, how hard it blows and how many degrees it shifts the air, at full strength */
const FALL: Record<WeatherKind, { rain: number; snow: number; wind: number; temp: number }> = {
  clear: { rain: 0, snow: 0, wind: 1, temp: 0 },
  cloudy: { rain: 0, snow: 0, wind: 1.4, temp: 0 },
  rain: { rain: 0.7, snow: 0, wind: 1.8, temp: -1.4 },
  storm: { rain: 1, snow: 0, wind: 2.8, temp: -2 },
  snow: { rain: 0, snow: 0.7, wind: 1.3, temp: -2.1 },
  blizzard: { rain: 0, snow: 1, wind: 3.4, temp: -3 },
  fog: { rain: 0, snow: 0, wind: 0.5, temp: 0 },
  heatwave: { rain: 0, snow: 0, wind: 0.6, temp: 7 },
  hurricane: { rain: 1.35, snow: 0, wind: 5, temp: -2.7 },
  wildfireSmoke: { rain: 0, snow: 0, wind: 1.2, temp: 0 },
};

const isWet = (k: WeatherKind) => k === 'rain' || k === 'storm' || k === 'snow' || k === 'blizzard' || k === 'hurricane';
/** Florida's "snow" is a single flake: nothing else about the day changes. */
const isFlakeJoke = (map: MapId, kind: WeatherKind) => map === 'florida' && (kind === 'snow' || kind === 'blizzard');
/** the shortest a spell lasts, in real seconds at the speed it began at (so top speed does not strobe), as calendar days per unit of speed */
const SPELL_MIN_DAYS_PER_SPEED = 12 / DAY_SECONDS;
/** the longest a spell takes to build and to fade, in calendar days */
const EASE_MAX = 0.18 * (360 / DAY_SECONDS);

function pick(t: Table, r: number): WeatherKind {
  let s = 0;
  for (const k in t) s += t[k as WeatherKind] ?? 0;
  let x = r * s;
  for (const k in t) {
    x -= t[k as WeatherKind] ?? 0;
    if (x <= 0) return k as WeatherKind;
  }
  return 'clear';
}

export class Climate {
  kind: WeatherKind = 'clear';
  /** 0..1: how far into the spell's full strength */
  intensity = 0;
  season: Season = 'spring';
  /** air temperature, C */
  temperature = 15;
  /** 0..1: how wet the roads are */
  wet = 0;
  /** 0..1: snow lying on the ground */
  snowCover = 0;
  /** the surface wind (m/s-ish): carries pollution and wildfire */
  readonly wind = { x: 0.72, y: 0.36 };
  /** goes up by one each time a spell begins: what follows the weather (the sky, the feed) watches it */
  spell = 0;
  /** the spell's length in calendar days, as it began (the sky is told this) */
  spellDays = 0;
  private start = 0;
  private end = 0;
  private ease = 1;
  private strength = 1;
  /** the calendar length the spell was rolled with, before the speed's floor */
  private cal = 0;
  private forced = false;
  private spd = 1;
  private windAngle: number;
  private readonly rng: Rng;
  private readonly look = newSeasonLook();
  private readonly fx: WeatherEffects = { speedMul: 1, crashMul: 1, buildMul: 1, demandMul: 1, outdoorPeopleMul: 1 };

  constructor(private readonly map: MapId, seed: number) {
    this.rng = new Rng(seed);
    this.windAngle = this.rng.range(0, Math.PI * 2);
    this.wind.x = Math.cos(this.windAngle) * 0.9; this.wind.y = Math.sin(this.windAngle) * 0.9;
    // start the county on a nice couple of weeks
    this.cal = this.spellDays = 10 + this.rng.float() * 15;
    this.end = this.cal;
    this.ease = Math.min(EASE_MAX, this.cal / 6);
  }

  private pickKind(): WeatherKind {
    const one = () => {
      let kind = pick(ODDS[this.map][this.season], this.rng.float());
      // temperature decides rain vs snow in the hollers
      if (this.map === 'appalachia') {
        if (kind === 'rain' && this.temperature < 0.5) kind = 'snow';
        else if ((kind === 'snow' || kind === 'blizzard') && this.temperature > 5) kind = 'rain';
      }
      return kind;
    };
    // wet weather breaks between spells (back-to-back rain spells read as a month of rain)
    let kind = one();
    for (let i = 0; i < 4 && isWet(kind) && isWet(this.kind); i++) kind = one();
    return isWet(kind) && isWet(this.kind) ? 'cloudy' : kind;
  }

  private begin(kind: WeatherKind, day: number, days: number, forced: boolean) {
    this.kind = kind;
    this.start = day;
    // on the calendar: fair spells last one to a few weeks, rain and snow a few days, storms a day or two
    if (!forced) {
      this.cal = kind === 'clear' ? 5 + this.rng.float() * 20 : kind === 'storm' || kind === 'hurricane' || kind === 'blizzard' ? 1 + this.rng.float() * 2 : 2 + this.rng.float() * 6;
      days = Math.max(this.cal, SPELL_MIN_DAYS_PER_SPEED * Math.max(1, this.spd));
    }
    this.forced = forced;
    this.end = day + days;
    this.spellDays = days;
    this.ease = Math.min(EASE_MAX, days / 6);
    this.strength = forced || kind === 'clear' ? 1 : 0.55 + this.rng.float() * 0.45;
    this.spell++;
  }

  /** A spell by decree (the playtest weather buttons, a scripted scene): `days` calendar days of it, at full strength, from now. */
  force(kind: WeatherKind, day: number, days: number) {
    this.begin(kind, day, days, true);
    this.start = day - this.ease;   // no slow build: the button is instant
  }

  /** One fixed step: `h` game seconds on, at calendar day `day` (float) and clock hour `hour`; `spd` is the speed the player has set (1, 2 or 4). */
  step(h: number, day: number, hour: number, spd: number) {
    const dDays = h / DAY_SECONDS;
    const doy = ((day % YEAR) + YEAR) % YEAR;
    this.season = seasonOf(doy);
    if (spd > 0 && spd !== this.spd) {
      this.spd = spd;
      // a spell begun at another speed keeps to the calendar at this one
      if (!this.forced) this.end = Math.max(this.start + Math.max(this.cal, SPELL_MIN_DAYS_PER_SPEED * spd), day + this.ease);
    }
    const flake = isFlakeJoke(this.map, this.kind);
    const fall = FALL[flake ? 'cloudy' : this.kind];
    this.temperature = temperatureC(this.map, doy, hour) + fall.temp * this.intensity;
    if (day >= this.end) this.begin(this.pickKind(), day, 0, false);
    const into = (day - this.start) / this.ease, left = (this.end - day) / this.ease;
    this.intensity = Math.max(0, Math.min(1, into, left)) * this.strength;

    // the ground: wet roads, the snowpack
    const rain = fall.rain * this.intensity, snow = fall.snow * this.intensity;
    const wantWet = rain > 0.05 ? 1 : this.kind === 'fog' && this.intensity > 0.5 ? 0.35 : 0;
    this.wet += (wantWet - this.wet) * (1 - Math.exp(-dDays / (wantWet > this.wet ? 0.6 : 4)));
    if (this.kind === 'heatwave' && this.intensity > 0.3) this.wet = Math.max(0, this.wet - dDays * 0.02);
    const snowing = this.map === 'florida' ? 0 : Math.max(snow, this.map === 'norcal' && this.season === 'winter' ? rain * 0.8 : 0);
    if (snowing > 0.05) this.snowCover = Math.min(1, this.snowCover + dDays * 0.0375 * snowing);
    else this.snowCover = Math.max(0, this.snowCover - (dDays / 144) * (this.season === 'winter' ? 0.2 : this.season === 'fall' ? 1 : 3) * (1 + rain * 2));
    // the hollers keep a winter snowpack of their own between storms
    if (this.map === 'appalachia') {
      const floor = sampleSeason(this.map, doy, this.look).snowClimate * (this.temperature < 3 ? 1 : 0.4);
      if (this.snowCover < floor) this.snowCover += (floor - this.snowCover) * (1 - Math.exp(-dDays / 12));
    }
    if (this.map === 'florida') this.snowCover = 0;

    // the wind swings slowly, and backs round in a storm
    this.windAngle += (Math.sin(day * 0.031) * 0.005 + (this.kind === 'storm' || this.kind === 'hurricane' ? 0.02 * this.intensity : 0)) * h;
    const w = 0.9 * (1 + (fall.wind - 1) * this.intensity);
    this.wind.x = Math.cos(this.windAngle) * w; this.wind.y = Math.sin(this.windAngle) * w;
  }

  /** Gameplay multipliers for the sim (1 = neutral). Returns a reused object. */
  effects(): WeatherEffects {
    const f = FX[this.kind], t = isFlakeJoke(this.map, this.kind) ? 0 : this.intensity, out = this.fx;
    out.speedMul = 1 + (f.speedMul - 1) * t;
    out.crashMul = 1 + (f.crashMul - 1) * t;
    out.buildMul = 1 + (f.buildMul - 1) * t;
    out.demandMul = 1 + (f.demandMul - 1) * t;
    out.outdoorPeopleMul = 1 + (f.outdoorPeopleMul - 1) * t;
    // lingering snow and ice on the roads
    out.speedMul *= 1 - this.snowCover * 0.2;
    out.crashMul *= 1 + this.snowCover * 0.6 + (this.temperature < 0 ? this.wet * 0.6 : 0);
    return out;
  }

  save() {
    return { kind: this.kind, intensity: this.intensity, temperature: this.temperature, wet: this.wet, snowCover: this.snowCover, spell: this.spell, spellDays: this.spellDays,
      start: this.start, end: this.end, ease: this.ease, strength: this.strength, cal: this.cal, forced: this.forced, spd: this.spd, windAngle: this.windAngle, rng: this.rng.state };
  }

  load(d: ReturnType<Climate['save']> | undefined) {
    if (!d) return;
    this.kind = d.kind; this.intensity = d.intensity; this.temperature = d.temperature; this.wet = d.wet; this.snowCover = d.snowCover; this.spell = d.spell; this.spellDays = d.spellDays;
    this.start = d.start; this.end = d.end; this.ease = d.ease; this.strength = d.strength; this.cal = d.cal; this.forced = d.forced; this.spd = d.spd; this.windAngle = d.windAngle; this.rng.state = d.rng;
    const w = Math.hypot(this.wind.x, this.wind.y) || 0.9;
    this.wind.x = Math.cos(this.windAngle) * w; this.wind.y = Math.sin(this.windAngle) * w;
  }
}
