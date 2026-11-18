// SlopRadio: procedural adaptive music stems that evolve with the county
// (GAME_DESIGN.md §8):
//   - 'banjo':   Porch Banjo & Fiddle (early rural county / Wide Spot in the Road)
//   - 'muzak':   Gas-N-Go FM Lounge Muzak (strip malls, drive-thrus, Boomburb)
//   - 'country': FM 106.9 THE SLOP Top-40 Country + Parody Ad Jingles (stroad metropolis)
// Zero audio files; 100% WebAudio synthesis in key with AmbientPiano.
import type { Synth } from './synth';

const A4 = 440;
const hz = (midi: number) => A4 * Math.pow(2, (midi - 69) / 12);

export type RadioStation = 'piano' | 'banjo' | 'muzak' | 'country';

export interface RadioAd {
  sponsor: string;
  headline: string;
  copy: string;
}

export const RADIO_ADS: readonly RadioAd[] = [
  {
    sponsor: 'The Tire Iron Law Firm',
    headline: 'HURT IN A STROAD WRECK?',
    copy: 'T-boned in the center turn lane? Call The Tire Iron at 1-800-WRECKED. I don’t just sue drivers—I sue the concrete!',
  },
  {
    sponsor: "Dillo's Travel Center",
    headline: '120 PUMPS · 80 TOILETS · BRISKET',
    copy: "Exit 47! Hold it for 212 more miles and experience cleanest restrooms in the tri-county watershed at Dillo's!",
  },
  {
    sponsor: 'Cousin Dale’s Paving LLC',
    headline: 'NO-BID ASPHALT SPECIAL',
    copy: 'Got an 80% Federal Highway Grant burning a hole in your pocket? Cousin Dale lays four fresh lanes by Friday—guaranteed for 18 months!',
  },
  {
    sponsor: 'Whispering Pines Estates',
    headline: 'LUXURY CUL-DE-SAC LIVING',
    copy: 'We clear-cut every last pine so you can enjoy unobstructed views of our Stormwater Retention Lagoon. Starting in the high $600s!',
  },
  {
    sponsor: 'Mattress Kingdom',
    headline: 'GRAND RE-OPENING ACROSS FROM MATTRESS KINGDOM',
    copy: 'Nobody has ever seen a customer inside, yet we just opened our fourth location at the same intersection! Everything must go!',
  },
  {
    sponsor: 'Pastor Rick’s Megachurch',
    headline: 'DRIVE-THRU COMMUNION & COFFEE BAR',
    copy: 'Praise the Lord and pass the parking minimums! 2,400 newly paved spaces waiting for your lifted truck this Sunday!',
  },
];

export class SlopRadio {
  enabled = false;
  station: RadioStation = 'banjo';
  volume = 0.5;
  rng: () => number = Math.random;
  private bus: GainNode;
  private rev: GainNode;
  private next = 0;
  private bar = 0;
  private key = 62; // D major / G major friendly roots
  private adIndex = 0;
  onAd?: (ad: RadioAd) => void;

  constructor(private s: Synth, out: AudioNode, reverb: AudioNode) {
    const c = s.ctx;
    this.bus = c.createGain();
    this.bus.gain.value = 0;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 4800;
    lp.Q.value = 0.4;
    this.bus.connect(lp).connect(out);
    this.rev = c.createGain();
    this.rev.gain.value = 0.35;
    lp.connect(this.rev).connect(reverb);
  }

  /** Pick the natural radio station for a city's population if in auto mode. */
  static stationForPopulation(pop: number): RadioStation {
    if (pop < 150) return 'piano';
    if (pop < 1100) return 'banjo';
    if (pop < 4200) return 'muzak';
    return 'country';
  }

  update(night = 0) {
    const c = this.s.ctx;
    const active = this.enabled && this.station !== 'piano';
    const target = active ? this.volume * 0.28 * (1 - night * 0.25) : 0;
    this.bus.gain.setTargetAtTime(target, c.currentTime, 0.5);
    if (!active) {
      this.next = 0;
      return;
    }
    const now = c.currentTime;
    if (this.next < now) this.next = now + 0.25;
    while (this.next < now + 1.2) {
      this.scheduleBar(this.next, night);
    }
  }

  scheduleBar(t0: number, night = 0) {
    if (this.station === 'banjo') this.scheduleBanjoBar(t0, night);
    else if (this.station === 'muzak') this.scheduleMuzakBar(t0, night);
    else this.scheduleCountryBar(t0, night);
  }

  /** Plucked string (banjo / acoustic guitar) with resonant body filter. */
  private pluck(t: number, midi: number, vel: number, dur: number, panVal = 0, bright = 1) {
    const c = this.s.ctx;
    const f0 = hz(midi);
    const env = c.createGain();
    const bp = c.createBiquadFilter();
    bp.type = 'lowpass';
    bp.frequency.setValueAtTime(Math.min(6500, f0 * 7 * bright), t);
    bp.frequency.exponentialRampToValueAtTime(Math.max(380, f0 * 1.8), t + dur * 0.85);
    bp.Q.value = 1.4;
    const pan = c.createStereoPanner();
    pan.pan.value = panVal;
    bp.connect(env).connect(pan).connect(this.bus);

    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(vel, t + 0.004);
    env.gain.exponentialRampToValueAtTime(vel * 0.28, t + 0.09);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    const ratios: [number, number, OscillatorType][] = [
      [1, 0.65, 'triangle'],
      [2, 0.35, 'sawtooth'],
      [3, 0.14, 'sine'],
    ];
    for (const [r, g, type] of ratios) {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f0 * r, t);
      const pg = c.createGain();
      pg.gain.value = g;
      o.connect(pg).connect(bp);
      o.start(t);
      o.stop(t + dur + 0.04);
    }
  }

  /** Warm bowed fiddle / pedal-steel swell. */
  private bow(t: number, midi0: number, midi1: number, vel: number, dur: number, panVal = 0.2) {
    const c = this.s.ctx;
    const f0 = hz(midi0), f1 = hz(midi1);
    const env = c.createGain();
    const lp = c.createBiquadFilter();
    lp.type = 'bandpass';
    lp.frequency.value = Math.min(2600, f1 * 2.4);
    lp.Q.value = 1.1;
    const pan = c.createStereoPanner();
    pan.pan.value = panVal;
    lp.connect(env).connect(pan).connect(this.bus);

    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(vel, t + Math.min(0.18, dur * 0.3));
    env.gain.setValueAtTime(vel * 0.85, t + dur * 0.75);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f0, t);
    if (midi1 !== midi0) o.frequency.exponentialRampToValueAtTime(f1, t + Math.min(0.22, dur * 0.4));
    const vib = c.createOscillator();
    const vg = c.createGain();
    vib.frequency.value = 5.5;
    vg.gain.value = f1 * 0.008;
    vib.connect(vg).connect(o.frequency);
    o.connect(lp);
    o.start(t);
    vib.start(t);
    o.stop(t + dur + 0.05);
    vib.stop(t + dur + 0.05);
  }

  /** FM Rhodes electric piano voice for Gas-N-Go Muzak. */
  private epiano(t: number, midi: number, vel: number, dur: number, panVal = 0) {
    const c = this.s.ctx;
    const f0 = hz(midi);
    const env = c.createGain();
    const pan = c.createStereoPanner();
    pan.pan.value = panVal;
    env.connect(pan).connect(this.bus);

    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(vel, t + 0.008);
    env.gain.exponentialRampToValueAtTime(vel * 0.35, t + 0.16);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    const car = c.createOscillator();
    car.type = 'sine';
    car.frequency.value = f0;
    const mod = c.createOscillator();
    mod.type = 'sine';
    mod.frequency.value = f0 * 2;
    const mg = c.createGain();
    mg.gain.setValueAtTime(f0 * 1.4, t);
    mg.gain.exponentialRampToValueAtTime(f0 * 0.15, t + 0.18);
    mod.connect(mg).connect(car.frequency);
    car.connect(env);
    car.start(t);
    mod.start(t);
    car.stop(t + dur + 0.04);
    mod.stop(t + dur + 0.04);
  }

  /** Soft brushed percussion (kick / snare / shaker) for Muzak & Country. */
  private drum(t: number, kind: 'kick' | 'brush' | 'hat', gain: number) {
    const dt = Math.max(0, t - this.s.ctx.currentTime);
    if (kind === 'kick') {
      this.s.tone(this.bus, { type: 'sine', f0: 115, f1: 44, t: dt, dur: 0.14, a: 0.002, gain });
    } else if (kind === 'brush') {
      this.s.burst(this.bus, { color: 'pink', type: 'bandpass', f0: 1800, q: 1.2, t: dt, dur: 0.08, a: 0.004, gain: gain * 0.65 });
    } else {
      this.s.burst(this.bus, { color: 'white', type: 'highpass', f0: 5200, t: dt, dur: 0.035, a: 0.001, gain: gain * 0.35 });
    }
  }

  // 1. Porch Banjo & Fiddle (Appalachian Scruggs-style roll + warm fiddle fifths)
  private scheduleBanjoBar(t0: number, night: number) {
    const bpm = 92 - night * 10;
    const beat = 60 / bpm, barLen = beat * 4;
    const pos = this.bar % 8;
    if (pos === 0) this.key = [62, 67, 60][Math.floor(this.rng() * 3)]; // D, G, C
    const k = this.key;
    // I - IV - I - V progression
    const degs = [
      { root: 0, tones: [0, 4, 7, 12] },
      { root: 5, tones: [5, 9, 12, 17] },
      { root: 0, tones: [0, 4, 7, 12] },
      { root: 7, tones: [7, 11, 14, 19] },
    ];
    const ch = degs[pos % 4];
    // Alternating thumb bass on beats 1 and 3
    this.pluck(t0, k - 12 + ch.root, 0.24, beat * 1.4, -0.2, 0.8);
    this.pluck(t0 + beat * 2, k - 12 + ch.tones[2], 0.2, beat * 1.4, -0.2, 0.8);

    // 8th-note Scruggs roll with 5th-string high drone (k + 12)
    const rollPattern = [0, 1, 3, 2, 0, 3, 1, 2];
    const step = beat * 0.5;
    for (let i = 0; i < 8; i++) {
      if (night > 0.5 && i % 2 === 1 && this.rng() < 0.45) continue;
      const idx = rollPattern[i];
      const note = idx === 3 ? k + 12 : k + ch.tones[idx];
      this.pluck(t0 + i * step, note, 0.14 + (i % 2 === 0 ? 0.04 : 0), step * 1.6, -0.25, 1.15);
    }

    // Fiddle long note on bars 1, 3, 5
    if (pos % 2 === 1 && this.rng() < 0.75) {
      const target = k + ch.tones[1];
      this.bow(t0 + beat, target - 2, target, 0.085, beat * 2.6, 0.35);
    }

    this.next = t0 + barLen;
    this.bar++;
  }

  // 2. Gas-N-Go Muzak (Bossa-nova FM Rhodes lounge + walking bass)
  private scheduleMuzakBar(t0: number, night: number) {
    const bpm = 104 - night * 8;
    const beat = 60 / bpm, barLen = beat * 4;
    const pos = this.bar % 8;
    if (pos === 0) this.key = 60; // C major / Fmaj7 lounge
    const k = this.key;
    // Imaj9 - vi7 - ii9 - V13
    const chords = [
      { root: 0, tones: [4, 7, 11, 14] },
      { root: 9, tones: [0, 4, 7, 12] },
      { root: 2, tones: [5, 9, 12, 16] },
      { root: 7, tones: [5, 9, 11, 16] },
    ];
    const ch = chords[pos % 4];

    // Bossa bass (beat 1, 2.5, 4)
    this.pluck(t0, k - 24 + ch.root, 0.25, beat * 1.3, 0, 0.5);
    this.pluck(t0 + beat * 1.5, k - 24 + ch.root + 7, 0.18, beat * 0.9, 0, 0.5);
    this.pluck(t0 + beat * 3, k - 24 + ch.root, 0.2, beat * 0.9, 0, 0.5);

    // Syncopated FM Rhodes comping (beats 1, 2.5, 3.5)
    for (const slot of [0, 1.5, 3.0]) {
      ch.tones.forEach((d, i) => {
        this.epiano(t0 + slot * beat + i * 0.015, k + d, 0.095, beat * 1.2, (i - 1.5) * 0.2);
      });
    }

    // Lounge vibraphone melody
    const penta = [0, 2, 4, 7, 9, 12, 14];
    for (const slot of [0.5, 2.0, 2.5, 3.5]) {
      if (this.rng() < 0.35) continue;
      const deg = penta[Math.floor(this.rng() * penta.length)];
      this.epiano(t0 + slot * beat, k + 12 + deg, 0.11, beat * 0.9, 0.25);
    }

    // Gentle brushed groove
    for (let i = 0; i < 8; i++) {
      this.drum(t0 + i * beat * 0.5, 'hat', 0.08);
      if (i === 0 || i === 3 || i === 6) this.drum(t0 + i * beat * 0.5, 'kick', 0.14);
      if (i === 2 || i === 5) this.drum(t0 + i * beat * 0.5, 'brush', 0.11);
    }

    this.next = t0 + barLen;
    this.bar++;
  }

  // 3. FM 106.9 THE SLOP (Top-40 Country Synth + Parody Ad Jingle Stingers)
  private scheduleCountryBar(t0: number, night: number) {
    const bpm = 112 - night * 8;
    const beat = 60 / bpm, barLen = beat * 4;
    const pos = this.bar % 8;
    if (pos === 0) this.key = 64; // E / A / B stadium country
    const k = this.key;

    // Every 8th bar: play a 3-note commercial jingle chime & fire a parody radio ad!
    if (pos === 7) {
      const jingle = [0, 4, 7, 12];
      jingle.forEach((d, i) => {
        this.epiano(t0 + i * beat * 0.4, k + 12 + d, 0.15, beat * 1.4, (i - 1.5) * 0.25);
      });
      const ad = RADIO_ADS[this.adIndex % RADIO_ADS.length];
      this.adIndex++;
      this.onAd?.(ad);
      this.next = t0 + barLen;
      this.bar++;
      return;
    }

    // I - V - vi - IV stadium country progression
    const prog = [
      { root: 0, tones: [0, 4, 7, 12] },
      { root: 7, tones: [7, 11, 14, 19] },
      { root: 9, tones: [9, 12, 16, 21] },
      { root: 5, tones: [5, 9, 12, 17] },
    ];
    const ch = prog[pos % 4];

    // Driving bass + kick/snare backbeat
    for (let b = 0; b < 4; b++) {
      this.pluck(t0 + b * beat, k - 24 + ch.root + (b % 2 === 1 ? 7 : 0), 0.24, beat * 0.85, 0, 0.7);
      if (b % 2 === 0) this.drum(t0 + b * beat, 'kick', 0.18);
      else this.drum(t0 + b * beat, 'brush', 0.16);
      this.drum(t0 + (b + 0.5) * beat, 'hat', 0.09);
    }

    // Acoustic guitar strum on beats 1, 2&, 3, 4
    for (const slot of [0, 1.5, 2.0, 3.0, 3.5]) {
      ch.tones.forEach((d, i) => {
        this.pluck(t0 + slot * beat + i * 0.012, k - 12 + d, 0.11, beat * 0.9, -0.3, 1.2);
      });
    }

    // Pedal-steel bend lick
    const lickStart = k + ch.tones[1];
    this.bow(t0 + beat * 0.5, lickStart - 2, lickStart, 0.1, beat * 1.8, 0.35);
    if (this.rng() < 0.7) {
      this.bow(t0 + beat * 2.5, k + ch.tones[2], k + ch.tones[3], 0.09, beat * 1.3, 0.35);
    }

    this.next = t0 + barLen;
    this.bar++;
  }
}
