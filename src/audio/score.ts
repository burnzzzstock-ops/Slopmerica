// Original procedural accompaniment, synchronized to the existing felt piano.
import type { Season } from '../contracts';
import { mulberry32 } from '../core/rng';
import { tierAt } from '../sim/milestones';
import { AmbientPiano, type PianoBar } from './piano';
import type { Synth } from './synth';

export interface ScoreState {
  population?: number;
  moneyTrouble?: number;
  flowEma?: number;
  disaster?: number;
}

/** Copy for the feed owner. The callback fires when the matching jingle begins. */
export const RADIO_ADS = [
  'Dillo’s Mega Stop. One hundred pumps. One destination. Every exit.',
  'SLOP Home Loans. Build your future on the equity of your future.',
  'Freedom Motors. More truck for every square foot of driveway.',
] as const;

type Stem = 'banjo' | 'fiddle' | 'muzak' | 'guitar' | 'bass' | 'tension' | 'jingle';
const clamp = (x: number) => Math.max(0, Math.min(1, x));
const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

export class AdaptiveScore {
  readonly piano: AmbientPiano;
  readonly weights = { piano: 1, porch: 0, muzak: 0, country: 0, tension: 0 };
  onRadioAd?: (text: string) => void;
  /** Optional note observer for the offline pitch and tempo checks. */
  onNote?: (stem: Stem, midi: number, key: number, time: number) => void;
  private bus: GainNode;
  private porch: GainNode;
  private muzak: GainNode;
  private country: GainNode;
  private tension: GainNode;
  private jingle: GainNode;
  private season: Season = 'summer';
  private tempo = 62;
  private rng = mulberry32(0x5c0a3);
  private nextAd = 0;
  private pendingAd = -1;
  private adAt = 0;

  constructor(private s: Synth, out: AudioNode, reverb: AudioNode) {
    const c = s.ctx;
    this.piano = new AmbientPiano(s, out, reverb);
    this.piano.rng = this.rng;
    this.piano.onBar = bar => this.schedule(bar);
    this.bus = c.createGain();
    this.bus.gain.value = 0;
    this.bus.connect(out);
    const send = c.createGain();
    send.gain.value = 0.28;
    this.bus.connect(send).connect(reverb);
    const stem = () => {
      const gain = c.createGain();
      gain.gain.value = 0;
      gain.connect(this.bus);
      return gain;
    };
    this.porch = stem(); this.muzak = stem(); this.country = stem(); this.tension = stem(); this.jingle = stem();
  }

  update(dt: number, night: number, state: ScoreState & { season?: Season }, eventDisaster = 0) {
    const pop = Math.max(0, state.population ?? 0), tier = tierAt(pop);
    const commercial = clamp((tier - 2) / 2), radio = clamp((tier - 5) / 2);
    const trouble = clamp(state.moneyTrouble ?? 0), jam = 1 - clamp(state.flowEma ?? 1), disaster = clamp(Math.max(state.disaster ?? 0, eventDisaster));
    const w = this.weights;
    w.piano = 1 - clamp(pop / 1100) * 0.9;
    w.porch = clamp(pop / 150) * (1 - commercial);
    w.muzak = commercial * (1 - radio);
    w.country = radio;
    w.tension = Math.max(trouble * 0.6, jam * 0.45, disaster);
    this.season = state.season ?? 'summer';
    this.tempo += (62 + commercial * 10 + radio * 24 - trouble * 5 - disaster * 8 - this.tempo) * (1 - Math.exp(-Math.max(0, dt) / 4));
    this.piano.tempoScale = this.tempo / 62;
    this.piano.layerGain = w.piano;
    const now = this.s.ctx.currentTime, active = this.piano.enabled ? 1 : 0;
    this.bus.gain.setTargetAtTime(active * this.piano.volume * 0.28 * (1 - night * 0.3), now, 0.6);
    const calm = 1 - disaster * 0.5;
    this.porch.gain.setTargetAtTime(w.porch * calm, now, 1.5);
    this.muzak.gain.setTargetAtTime(w.muzak * calm, now, 1.5);
    this.country.gain.setTargetAtTime(w.country * calm, now, 1.5);
    this.tension.gain.setTargetAtTime(w.tension, now, 1.5);
    this.jingle.gain.setTargetAtTime(w.country * calm, now, 1.5);
    if (!active) this.pendingAd = -1;
    if (this.pendingAd >= 0 && now >= this.adAt) {
      if (now - this.adAt < 0.5) this.onRadioAd?.(RADIO_ADS[this.pendingAd]);
      this.pendingAd = -1;
    }
    this.piano.update(night);
  }

  private pluck(stem: Stem, bus: GainNode, bar: PianoBar, midi: number, time: number, gain: number, duration: number, pan: number) {
    this.onNote?.(stem, midi, bar.key, time);
    const c = this.s.ctx, f = hz(midi);
    const tone = c.createBiquadFilter();
    tone.type = 'lowpass'; tone.frequency.value = stem === 'banjo' ? 4800 : 2800;
    const position = c.createStereoPanner(); position.pan.value = pan;
    tone.connect(position).connect(bus);
    // Decaying string partials with a short pick transient, slightly stretched.
    for (let harmonic = 1; harmonic <= 4; harmonic++) {
      const oscillator = c.createOscillator(), envelope = c.createGain();
      oscillator.frequency.value = f * harmonic * (1 + 0.0002 * harmonic * harmonic);
      envelope.gain.setValueAtTime(0, time);
      envelope.gain.linearRampToValueAtTime(gain / (harmonic * harmonic), time + 0.004);
      envelope.gain.exponentialRampToValueAtTime(0.00001, time + duration / Math.sqrt(harmonic));
      oscillator.connect(envelope).connect(tone);
      oscillator.start(time); oscillator.stop(time + duration + 0.02);
    }
  }

  private tone(stem: Stem, bus: GainNode, bar: PianoBar, midi: number, offset: number, duration: number, gain: number, pan = 0) {
    const time = bar.time + offset * bar.beat;
    this.onNote?.(stem, midi, bar.key, time);
    this.s.tone(bus, {
      type: stem === 'fiddle' ? 'sawtooth' : 'triangle', f0: hz(midi), t: time - this.s.ctx.currentTime,
      dur: duration * bar.beat, a: stem === 'fiddle' ? 0.12 : 0.025, gain, pan,
      vibrato: stem === 'fiddle' ? 1.5 : 0, vibratoRate: 5.1,
    });
  }

  private schedule(bar: PianoBar) {
    const w = this.weights, k = bar.key, b = bar.beat;
    const quiet = bar.night > 0.5 || this.season === 'winter';
    if (w.porch > 0.005 || this.porch.gain.value > 0.005) {
      const steps = quiet ? 4 : 8;
      for (let i = 0; i < steps; i++) {
        const degree = bar.tones[(i + (bar.index % 2)) % 3];
        this.pluck('banjo', this.porch, bar, k - 12 + degree, bar.time + i * 4 / steps * b, 0.16, 0.65, -0.35);
      }
      this.tone('fiddle', this.porch, bar, k + bar.tones[1], 0.25, quiet ? 2.7 : 1.6, 0.026, 0.35);
      if (!quiet) this.tone('fiddle', this.porch, bar, k + bar.tones[2], 2.25, 1.5, 0.021, 0.35);
    }
    if (w.muzak > 0.005 || this.muzak.gain.value > 0.005) {
      for (let i = 0; i < 4; i++) this.tone('muzak', this.muzak, bar, k + bar.tones[i % 3], i + 0.25, 0.65, 0.12, (i % 2 - 0.5) * 0.4);
      for (let i = 0; i < 3; i++) this.tone('muzak', this.muzak, bar, k - 12 + bar.tones[i], 0, 3.8, 0.025);
    }
    const ad = w.country > 0.45 && bar.index % 16 === 15;
    if (ad) {
      const melody = [0, 4, 7, 9, 7, 4, 2, 0];
      for (let i = 0; i < melody.length; i++) this.tone('jingle', this.jingle, bar, k + 12 + melody[i], i * 0.5, 0.42, 0.13);
      this.pendingAd = this.nextAd;
      this.nextAd = (this.nextAd + 1) % RADIO_ADS.length;
      this.adAt = bar.time;
    } else if (w.country > 0.005 || this.country.gain.value > 0.005) {
      for (const beat of [0, 1.5, 2, 3.5]) for (let i = 0; i < 3; i++) {
        this.pluck('guitar', this.country, bar, k - 12 + bar.tones[i], bar.time + beat * b + i * 0.016, 0.1, 1.15, -0.25);
      }
      const root = k - 24 + bar.root;
      const bass = root < 36 ? root + 12 : root;
      this.tone('bass', this.country, bar, bass, 0, 1.7, 0.16);
      this.tone('bass', this.country, bar, bass + 7, 2, 1.7, 0.12);
      this.pluck('guitar', this.country, bar, k + bar.tones[(bar.index + 1) % 3], bar.time + 2.5 * b, 0.12, 1.25, 0.3);
      for (let beat = 0; beat < 4; beat++) {
        const offset = bar.time + beat * b - this.s.ctx.currentTime;
        if (beat % 2 === 0) this.s.tone(this.country, { f0: 85, f1: 42, t: offset, dur: 0.14, gain: quiet ? 0.06 : 0.12 });
        else this.s.burst(this.country, { color: 'pink', type: 'highpass', f0: 950, t: offset, dur: 0.12, gain: quiet ? 0.018 : 0.04, pan: 0.15 });
        this.s.burst(this.country, { type: 'highpass', f0: 5800, t: offset + b * 0.5, dur: 0.045, gain: quiet ? 0.008 : 0.018, pan: -0.15 });
      }
    }
    if (w.tension > 0.005 || this.tension.gain.value > 0.005) {
      const root = k - 24 + bar.root;
      this.tone('tension', this.tension, bar, root < 36 ? root + 12 : root, 0, 3.8, 0.12);
      this.tone('tension', this.tension, bar, k - 12 + 2, 1.5, 0.8, 0.05);
      this.tone('tension', this.tension, bar, k - 12 + 9, 3, 0.7, 0.035);
    }
  }
}
