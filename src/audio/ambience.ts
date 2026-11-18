// The soundscape is a health bar: birds, bugs, frogs and the creek scale with
// nature and season; wind, rain, traffic hum, honks and construction clank
// scale with the weather and the city. Continuous beds are built once and only
// their gains move; critters are short synthesized calls scheduled at random.
import type { Season, SoundMix, WeatherKind } from '../contracts';
import type { MapId } from '../world/maps';
import type { Synth } from './synth';
import { honkVoice } from './sfx';
import type { AmbientSpecies } from '../agents/models/ambientModels';
import type { ScoreState } from './score';

/** Reused camera-visible sources, ordered by audibility. Zero level is an empty slot. */
export interface AmbientSoundSource { kind: AmbientSpecies; level: number; pan: number; speed: number }
export interface SoundscapeMix extends SoundMix, ScoreState {
  pollution?: number;
  /** Local reference-tree cover, independent of graphics density. */
  habitat?: number;
  surf?: number;
  clearing?: number;
  speed?: number;
  sources?: readonly AmbientSoundSource[];
}
const NO_SOURCES: readonly AmbientSoundSource[] = [];
const MOTOR_BOATS = new Set(['fishingBoat', 'bassBoat', 'jetSki']);

const SEASON_BIRDS: Record<Season, number> = { spring: 1, summer: 0.75, fall: 0.4, winter: 0.1 };
export const RAIN: Partial<Record<WeatherKind, number>> = { rain: 0.6, storm: 1, hurricane: 1 };
const WIND: Partial<Record<WeatherKind, number>> = { clear: 0.08, cloudy: 0.2, rain: 0.3, storm: 0.6, snow: 0.22, blizzard: 0.95, fog: 0.03, heatwave: 0.05, hurricane: 1, wildfireSmoke: 0.15 };

type Voice = (t: number, gain: number, pan: number) => void;

export class Ambience {
  mapId: MapId = 'appalachia';
  private c: AudioContext;
  private wind: GainNode;
  private windHi: GainNode;
  private rainHiss: GainNode;
  private rainDrum: GainNode;
  private creek: GainNode;
  private traffic: GainNode;
  private cicada: GainNode;
  private crowd: GainNode;
  private surf: GainNode;
  private boats: { gain: GainNode; frequency: AudioParam; pan: AudioParam }[] = [];
  private callEnds = new Float64Array(8);
  private clearing = 0;
  private tick = 0;
  private voices: Record<string, Voice>;
  /**
   * Random honks and pass-bys (the old stand-in for traffic). The street audio (streetAudio.ts) replaces
   * them with sounds from the real cars, and switches this off the first time it is fed cars.
   */
  randomTraffic = true;

  constructor(private s: Synth, private out: AudioNode, private rev: AudioNode) {
    const c = (this.c = s.ctx);
    const filt = (type: BiquadFilterType, f: number, q = 0.7) => {
      const b = c.createBiquadFilter();
      b.type = type;
      b.frequency.value = f;
      b.Q.value = q;
      return b;
    };
    const lfo = (rate: number, depth: number, target: AudioParam, type: OscillatorType = 'sine') => {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.value = rate;
      const g = c.createGain();
      g.gain.value = depth;
      o.connect(g).connect(target);
      o.start();
    };
    // an irregular swell (slow noise, not a sine): steady LFOs on noise beds
    // pulse like a steam engine; water and crowds wander instead
    const wander = (hz: number, depth: number, target: AudioParam) => {
      const g = c.createGain();
      g.gain.value = depth;
      s.loop('pink').connect(filt('lowpass', hz, 0.5)).connect(filt('lowpass', hz, 0.5)).connect(g).connect(target);
    };
    const bed = (...chain: AudioNode[]) => {
      for (let i = 0; i < chain.length - 1; i++) chain[i].connect(chain[i + 1]);
      const g = c.createGain();
      g.gain.value = 0;
      chain[chain.length - 1].connect(g);
      g.connect(out);
      return g;
    };
    this.wind = bed(s.loop('pink'), filt('bandpass', 380, 0.7), filt('lowpass', 1300));
    const howl = filt('bandpass', 900, 5);
    lfo(0.13, 320, howl.frequency);
    this.windHi = bed(s.loop('pink'), howl);
    this.rainHiss = bed(s.loop('white'), filt('highpass', 1000), filt('lowpass', 8000));
    this.rainDrum = bed(s.loop('pink'), filt('bandpass', 420, 0.6));
    const babble = c.createGain();
    babble.gain.value = 0.65;
    wander(3.2, 0.55, babble.gain);
    this.creek = bed(s.loop('pink'), filt('bandpass', 620, 0.75), filt('lowpass', 1850), babble);
    this.traffic = bed(s.loop('brown'), filt('lowpass', 240));
    const buzz = c.createGain();
    buzz.gain.value = 0.5;
    lfo(24, 0.45, buzz.gain, 'square');
    const swell = c.createGain();
    swell.gain.value = 0.6;
    lfo(0.09, 0.4, swell.gain);
    this.cicada = bed(s.loop('white'), filt('bandpass', 4700, 7), buzz, swell);
    const walla = c.createGain();
    walla.gain.value = 0.6;
    wander(1.5, 1.2, walla.gain);
    this.crowd = bed(s.loop('pink'), filt('bandpass', 650, 1), walla);

    const wash = c.createGain();
    wash.gain.value = 0.6;
    wander(0.22, 2.2, wash.gain);
    this.surf = bed(s.loop('pink'), filt('highpass', 70), filt('lowpass', 4200), wash);
    for (let i = 0; i < 3; i++) {
      const engine = c.createOscillator();
      engine.type = 'sawtooth'; engine.frequency.value = 65;
      const pan = c.createStereoPanner();
      const gain = c.createGain(); gain.gain.value = 0;
      engine.connect(filt('lowpass', 420)).connect(gain).connect(pan).connect(out);
      engine.start();
      this.boats.push({ gain, frequency: engine.frequency, pan: pan.pan });
    }

    this.voices = this.makeVoices();
  }

  private rnd = (a: number, b: number) => a + this.s.random() * (b - a);
  private pick = <T>(a: readonly T[]) => a[Math.floor(this.s.random() * a.length)];
  private randPan = () => this.rnd(-0.8, 0.8);
  private randDist = () => this.rnd(0.35, 1);

  /** Bound concurrent phrases, including all of their scheduled notes. */
  private emit(voice: Voice, gain: number, pan: number) {
    const now = this.c.currentTime;
    for (let i = 0; i < this.callEnds.length; i++) {
      if (this.callEnds[i] > now) continue;
      this.callEnds[i] = now + 2.2;
      voice(0.02, gain, pan);
      return;
    }
  }

  private makeVoices(): Record<string, Voice> {
    const s = this.s;
    const rnd = this.rnd;
    const out = this.out, rev = this.rev;
    return {
      sparrow: (t, g, p) => {
        const n = 3 + Math.floor(this.s.random() * 4);
        let tt = t;
        for (let i = 0; i < n; i++) {
          s.tone(out, { f0: rnd(3800, 5400), f1: rnd(2500, 3600), t: tt, dur: rnd(0.04, 0.07), a: 0.004, gain: g, pan: p });
          tt += rnd(0.07, 0.12);
        }
      },
      cardinal: (t, g, p) => {
        const n = 3 + Math.floor(this.s.random() * 3);
        const lo = rnd(1700, 2100);
        for (let i = 0; i < n; i++) s.tone(out, { f0: lo, f1: lo * 2.1, t: t + i * 0.24, dur: 0.17, a: 0.02, gain: g, pan: p });
      },
      robin: (t, g, p) => {
        for (let i = 0; i < 3; i++) {
          const f = rnd(2200, 2900);
          s.tone(out, { f0: f, f1: f * 1.2, t: t + i * 0.3, dur: 0.1, a: 0.01, gain: g, pan: p, vibrato: 40, vibratoRate: 30 });
          s.tone(out, { f0: f * 1.2, f1: f * 1.05, t: t + i * 0.3 + 0.1, dur: 0.1, a: 0.01, gain: g * 0.9, pan: p });
        }
      },
      thrush: (t, g, p) => {
        const notes = [rnd(1600, 1800), rnd(2100, 2300), rnd(2800, 3100)];
        notes.forEach((f, i) => {
          s.tone(out, { f0: f, t: t + i * 0.19, dur: 0.2, a: 0.02, gain: g, pan: p, vibrato: 12, vibratoRate: 9 });
          s.tone(rev, { f0: f, t: t + i * 0.19, dur: 0.2, a: 0.02, gain: g * 0.6 });
        });
        for (let i = 0; i < 6; i++) s.tone(out, { f0: rnd(4000, 5200), t: t + 0.6 + i * 0.035, dur: 0.03, a: 0.003, gain: g * 0.5, pan: p });
      },
      chickadee: (t, g, p) => {
        s.tone(out, { f0: 3950, t, dur: 0.26, a: 0.03, gain: g, pan: p });
        s.tone(out, { f0: 3450, t: t + 0.3, dur: 0.3, a: 0.03, gain: g * 0.9, pan: p });
      },
      crow: (t, g, p) => {
        const n = 2 + Math.floor(this.s.random() * 2);
        for (let i = 0; i < n; i++) {
          s.tone(out, { type: 'sawtooth', f0: 640, f1: 500, t: t + i * 0.42, dur: 0.28, a: 0.02, gain: g * 0.35, pan: p });
          s.burst(out, { type: 'bandpass', f0: 1300, q: 2, t: t + i * 0.42, dur: 0.26, gain: g * 0.5, pan: p });
        }
      },
      gull: (t, g, p) => {
        const n = 2 + Math.floor(this.s.random() * 3);
        for (let i = 0; i < n; i++) s.tone(out, { type: 'triangle', f0: 1450 - i * 60, f1: 880, t: t + i * 0.38, dur: 0.33, a: 0.03, gain: g, pan: p, vibrato: 18, vibratoRate: 28 });
      },
      cricket: (t, g, p) => {
        const f = rnd(4300, 4900);
        for (let i = 0; i < 3; i++) s.tone(out, { f0: f, t: t + i * 0.034, dur: 0.018, a: 0.003, gain: g, pan: p });
      },
      peeper: (t, g, p) => s.tone(out, { f0: 2500, f1: 3150, t, dur: 0.09, a: 0.01, gain: g, pan: p }),
      chorusFrog: (t, g, p) => {
        s.burst(out, { type: 'bandpass', f0: 1450, q: 7, t, dur: 0.07, gain: g * 2, pan: p });
        s.burst(out, { type: 'bandpass', f0: 1650, q: 7, t: t + 0.09, dur: 0.08, gain: g * 2, pan: p });
      },
      bullfrog: (t, g, p) => {
        s.tone(out, { type: 'triangle', f0: 118, f1: 96, t, dur: 0.3, a: 0.03, gain: g * 3, pan: p });
        s.burst(out, { color: 'brown', type: 'lowpass', f0: 380, t, dur: 0.26, gain: g * 2, pan: p });
      },
      treeFrog: (t, g, p) => s.tone(out, { type: 'square', f0: 820, f1: 700, t, dur: 0.07, a: 0.005, gain: g * 0.4, pan: p }),
      seaLion: (t, g, p) => {
        for (let i = 0; i < 3; i++) {
          s.tone(out, { type: 'sawtooth', f0: 210, f1: 115, t: t + i * 0.34, dur: 0.17, gain: g * 0.5, pan: p });
          s.burst(out, { color: 'pink', type: 'bandpass', f0: 700, q: 1.5, t: t + i * 0.34, dur: 0.19, gain: g, pan: p });
        }
      },
      alligator: (t, g, p) => {
        s.tone(out, { type: 'triangle', f0: 72, f1: 47, t, dur: 1.3, a: 0.12, gain: g * 2, pan: p, vibrato: 4, vibratoRate: 18 });
        s.burst(out, { color: 'brown', type: 'lowpass', f0: 260, t, dur: 1.4, a: 0.1, gain: g, pan: p });
      },
      chainsaw: (t, g, p) => {
        s.tone(out, { type: 'sawtooth', f0: 95, f1: 160, t, dur: 1.8, a: 0.15, gain: g * 0.7, pan: p, vibrato: 11, vibratoRate: 29 });
        s.burst(out, { color: 'pink', type: 'bandpass', f0: 1100, q: 0.6, t, dur: 1.8, a: 0.2, gain: g, pan: p });
      },
      leafBlower: (t, g, p) => {
        s.tone(out, { type: 'sawtooth', f0: 84, f1: 99, t, dur: 2, a: 0.25, gain: g * 0.4, pan: p });
        s.burst(out, { color: 'pink', type: 'bandpass', f0: 680, q: 0.6, t, dur: 2, a: 0.2, gain: g, pan: p });
      },
      owl: (t, g, p) => {
        s.tone(out, { f0: 380, f1: 360, t, dur: 0.38, a: 0.06, gain: g, pan: p, vibrato: 4, vibratoRate: 7 });
        s.tone(rev, { f0: 380, t, dur: 0.38, a: 0.06, gain: g * 0.6 });
        s.tone(out, { f0: 370, f1: 330, t: t + 0.6, dur: 0.55, a: 0.06, gain: g * 0.9, pan: p });
      },
      clank: (t, g, p) => {
        const f = rnd(480, 900);
        for (const k of [1, 2.76, 5.4]) s.tone(out, { type: 'triangle', f0: f * k, t, dur: rnd(0.15, 0.35), a: 0.001, gain: g / k, pan: p });
        s.burst(out, { type: 'highpass', f0: 3000, t, dur: 0.03, a: 0.001, gain: g * 0.6, pan: p });
      },
      beeper: (t, g, p) => {
        for (let i = 0; i < 4; i++) s.tone(out, { type: 'square', f0: 1040, t: t + i * 0.5, dur: 0.25, a: 0.005, gain: g * 0.25, pan: p });
      },
      passby: (t, g, p) => {
        const c = this.c;
        const t0 = c.currentTime + t;
        const src = c.createBufferSource();
        src.buffer = s.noise('pink');
        src.loop = true;
        const f = c.createBiquadFilter();
        f.type = 'bandpass';
        f.Q.value = 0.9;
        f.frequency.setValueAtTime(420, t0);
        f.frequency.exponentialRampToValueAtTime(900, t0 + 0.7);
        f.frequency.exponentialRampToValueAtTime(380, t0 + 1.5);
        const gg = c.createGain();
        gg.gain.setValueAtTime(0.0001, t0);
        gg.gain.exponentialRampToValueAtTime(g, t0 + 0.7);
        gg.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.5);
        let node: AudioNode = gg;
        if (c.createStereoPanner) {
          const pn = c.createStereoPanner();
          pn.pan.setValueAtTime(-p, t0);
          pn.pan.linearRampToValueAtTime(p, t0 + 1.5);
          gg.connect(pn);
          node = pn;
        }
        node.connect(out);
        src.connect(f).connect(gg);
        src.start(t0, this.s.random() * 2);
        src.stop(t0 + 1.6);
      },
    };
  }

  private set(g: GainNode, v: number) {
    g.gain.setTargetAtTime(Math.max(0, v), this.c.currentTime, 0.35);
  }

  private chance(rate: number, dt: number) {
    return this.s.random() < rate * dt;
  }

  update(dt: number, m: SoundscapeMix) {
    const z = Math.min(1, Math.max(0, m.zoom));
    const near = 1 - z;
    const day = 1 - m.night;
    const wk = m.weather;
    const wi = m.weatherIntensity;
    const rain = (RAIN[wk] ?? 0) * wi;
    const windW = 0.06 + (WIND[wk] ?? 0.1) * (0.35 + 0.65 * wi);
    const hush = wk === 'snow' || wk === 'blizzard' ? 0.5 * wi : 0; // snow muffles the world
    const nature = Math.max(0, Math.min(1, m.nature)) * Math.max(0, Math.min(1, m.habitat ?? 1)) * Math.exp(-2 * Math.max(0, m.pollution ?? 0));
    this.clearing = Math.max(0, this.clearing - dt / 6, Math.min(1, m.clearing ?? 0));
    const summer = m.season === 'summer' ? 1 : m.season === 'fall' ? 0.3 : m.season === 'spring' ? 0.15 : 0;

    // beds (throttled; the gains glide anyway)
    this.tick -= dt;
    if (this.tick <= 0) {
      this.tick = 0.08;
      this.set(this.wind, (0.015 + windW * 0.45) * (0.4 + z * 0.9));
      this.set(this.windHi, Math.max(0, windW - 0.45) * 0.4);
      this.set(this.rainHiss, rain * 0.26 * (0.7 + near * 0.3));
      this.set(this.rainDrum, rain * 0.16 * (0.4 + near * 0.6));
      // only where there's water to hear (it played everywhere with the county's nature level)
      const coast = Math.max(0, Math.min(1, m.surf ?? 0));
      this.set(this.creek, (m.water ?? 0) * (1 - coast) * nature * 0.1 * near * near * (m.season === 'winter' ? 0.5 : 1) * (1 - hush));
      this.set(this.surf, coast * near * near * (0.035 + windW * 0.04));
      this.set(this.traffic, m.traffic * (0.1 + z * 0.08) * (1 - hush * 0.5));
      const cicadaMap = this.mapId === 'norcal' ? 0.3 : 1;
      this.set(this.cicada, nature * day * summer * cicadaMap * 0.035 * (1 - rain) * (0.4 + near * 0.6) * (m.season === 'summer' ? 1 : 0.4));
      this.set(this.crowd, m.people * near * 0.05 * (1 - rain * 0.6));
      let boatCount = 0;
      if (m.speed !== 0) for (const source of m.sources ?? NO_SOURCES) {
        if (boatCount >= this.boats.length) break;
        if (source.level <= 0 || source.speed <= 0.2 || !MOTOR_BOATS.has(source.kind)) continue;
        const boat = this.boats[boatCount++];
        this.set(boat.gain, source.level * 0.012 * near);
        boat.frequency.setTargetAtTime(48 + Math.min(14, source.speed) * 9, this.c.currentTime, 0.15);
        boat.pan.setTargetAtTime(source.pan, this.c.currentTime, 0.15);
      }
      for (let i = boatCount; i < this.boats.length; i++) this.set(this.boats[i].gain, 0);
    }

    // critters and the city, one call at a time
    const t = 0.02;
    const p = this.randPan;
    const far = this.randDist;
    const rnd = this.rnd, pick = this.pick;
    const V = this.voices;
    const map = this.mapId;
    const dusk = m.night > 0.15 && m.night < 0.65 ? 1.8 : 1;
    const birdRate = nature * day * SEASON_BIRDS[m.season] * (1 - Math.min(1, rain * 1.2)) * (1 - hush) * (0.35 + near * 0.65) * 1.4 * dusk;
    if (this.chance(birdRate, dt)) {
      const g = 0.03 * far();
      let v: Voice;
      if (m.season === 'winter') v = this.s.random() < 0.55 ? V.chickadee : V.crow;
      else if (map === 'appalachia') v = pick([V.sparrow, V.cardinal, V.robin, V.thrush, V.sparrow]);
      else if (map === 'norcal') v = this.s.random() < 0.2 ? V.gull : pick([V.sparrow, V.robin, V.cardinal]);
      else v = this.s.random() < 0.3 ? V.gull : pick([V.cardinal, V.sparrow, V.robin]);
      if (m.season === 'fall' && this.s.random() < 0.25) v = V.crow;
      this.emit(v, g, p());
    }
    const cricketRate = nature * m.night * summer * (1 - rain) * (1 - hush) * 9 * (0.4 + near * 0.6);
    if (this.chance(cricketRate, dt)) this.emit(V.cricket, 0.012 * far(), p());
    let frogRate = 0;
    if (map === 'appalachia') frogRate = m.season === 'spring' ? 5 : m.season === 'summer' ? 1.5 : 0;
    else if (map === 'florida') frogRate = m.season === 'winter' ? 0.6 : 3;
    else frogRate = m.season === 'spring' || m.season === 'winter' ? 1.5 : 0.3;
    frogRate *= nature * m.night * (1 - hush) * (0.3 + near * 0.7) * (rain > 0 ? 1.5 : 1);
    if (this.chance(frogRate, dt)) {
      const g = 0.02 * far();
      if (map === 'appalachia') this.emit(V.peeper, g, p());
      else if (map === 'florida') this.emit(this.s.random() < 0.4 ? V.bullfrog : V.treeFrog, g, p());
      else this.emit(V.chorusFrog, g, p());
    }
    if (map === 'appalachia' && this.chance(nature * m.night * 0.025 * near, dt)) this.emit(V.owl, 0.03, p());
    if (this.randomTraffic) {
      if (this.chance(m.traffic * 0.12 * (0.4 + near * 0.6) * (1 - hush * 0.5), dt)) honkVoice(this.s, this.out, 0.25 * far() * (0.4 + near * 0.6), rnd(0.85, 1.15), t, rnd(0.12, 0.4), p());
      if (this.chance(m.traffic * near * 0.7, dt)) this.emit(V.passby, 0.035 * far(), p());
    }
    if (this.chance(m.construction * 0.8 * (0.4 + near * 0.6), dt)) this.emit(V.clank, 0.05 * far(), p());
    if (this.chance(m.construction * 0.05, dt)) this.emit(V.beeper, 0.05 * far(), p());
    if (m.speed !== 0 && this.chance(this.clearing * 0.7 * near, dt)) this.emit(V.chainsaw, 0.025 * far(), p());
    if (m.speed !== 0 && this.chance((1 - nature) * m.people * day * near * 0.12, dt)) this.emit(V.leafBlower, 0.02 * far(), p());
    if (m.speed !== 0) for (const source of m.sources ?? NO_SOURCES) {
      if (source.level <= 0) continue;
      const voice = source.kind === 'seagull' || source.kind === 'pelican' ? V.gull
        : source.kind === 'bird' ? V.sparrow : source.kind === 'crow' ? V.crow : source.kind === 'seaLion' ? V.seaLion : source.kind === 'alligator' ? V.alligator : null;
      if (voice && this.chance(0.16 * source.level * (1 - rain * 0.7), dt)) this.emit(voice, 0.04 * source.level * near, source.pan);
    }
  }
}
