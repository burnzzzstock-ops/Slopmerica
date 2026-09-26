// Ambient piano: a generative, slow, soft piano bed to lock in to while you
// build. Synthesized (no files): each note is a few slightly stretched
// partials with a felt-hammer tap, a fast attack and a long natural decay,
// darkening as it rings. The music is a loop of four-bar phrases over
// maj7/add9 voicings (rolled chords, a low root, a sparse pentatonic melody
// that leans on chord tones), ~62 bpm, with rests. At night it plays slower,
// sparser and quieter, the melody kept low.
import type { Synth } from './synth';

const A4 = 440;
const hz = (midi: number) => A4 * Math.pow(2, (midi - 69) / 12);

// progressions in scale degrees (semitones from the key's root) with chord tones
type Chord = { root: number; tones: number[] };
const PROGRESSIONS: Chord[][] = [
  // Imaj7 - vi9 - IVmaj7 - V(sus)
  [{ root: 0, tones: [0, 4, 7, 11, 14] }, { root: 9, tones: [9, 12, 16, 19, 23] }, { root: 5, tones: [5, 9, 12, 16, 19] }, { root: 7, tones: [7, 12, 14, 17, 21] }],
  // IVmaj7 - Iadd9 - vi7 - iii7
  [{ root: 5, tones: [5, 9, 12, 16, 19] }, { root: 0, tones: [0, 4, 7, 14, 16] }, { root: 9, tones: [9, 12, 16, 19, 21] }, { root: 4, tones: [4, 7, 11, 14, 19] }],
  // ii9 - V - Imaj7 - IVmaj9
  [{ root: 2, tones: [2, 5, 9, 12, 16] }, { root: 7, tones: [7, 11, 14, 17, 21] }, { root: 0, tones: [0, 4, 7, 11, 14] }, { root: 5, tones: [5, 9, 12, 16, 19] }],
  // vi9 - IVmaj7 - Iadd9 - Vsus
  [{ root: 9, tones: [9, 12, 16, 19, 23] }, { root: 5, tones: [5, 9, 12, 16, 19] }, { root: 0, tones: [0, 4, 7, 14, 16] }, { root: 7, tones: [7, 12, 14, 17, 19] }],
];
const PENTA = [0, 2, 4, 7, 9]; // major pentatonic degrees
const KEYS = [60, 62, 65, 67, 57, 55]; // C, D, F, G, A (low), G (low) as middle-register roots

export class AmbientPiano {
  enabled = true;
  /** 0..1, applied on top of the game's master volume */
  volume = 0.55;
  private bus: GainNode;
  private rev: GainNode;
  private next = 0; // audio time of the next bar
  private bar = 0;
  private prog = PROGRESSIONS[0];
  private key = 60;
  /** random source (tests pass a seeded one) */
  rng: () => number = Math.random;
  private lastMel = 72;
  private phraseRest = false;

  constructor(private s: Synth, out: AudioNode, reverb: AudioNode) {
    const c = s.ctx;
    this.bus = c.createGain();
    this.bus.gain.value = 0;
    // a gentle high cut: soft felt piano, never bright over the city sounds
    const tone = c.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 4200;
    tone.Q.value = 0.3;
    this.bus.connect(tone).connect(out);
    this.rev = c.createGain();
    this.rev.gain.value = 0.55;
    tone.connect(this.rev).connect(reverb);
  }

  /** call every frame; schedules a bar ahead of the audio clock */
  update(night: number) {
    const c = this.s.ctx;
    const target = this.enabled ? this.volume * 0.32 * (1 - night * 0.3) : 0;
    this.bus.gain.setTargetAtTime(target, c.currentTime, 1.2);
    if (!this.enabled) { this.next = 0; return; }
    const now = c.currentTime;
    if (this.next < now) this.next = now + 0.4; // first start / after a pause
    // keep one bar scheduled ahead
    while (this.next < now + 1.2) this.scheduleBar(this.next, night);
  }

  private scheduleBar(t0: number, night: number) {
    const bpm = 62 - night * 6;
    const beat = 60 / bpm, barLen = beat * 4;
    // more pedal at night: the notes ring into the next bar instead of gaps
    const ped = 1 + night * 0.5;
    const pos = this.bar % 16;
    if (pos === 0) {
      // a new 16-bar section: maybe a new key and progression
      if (this.bar === 0 || this.rng() < 0.55) this.key = KEYS[Math.floor(this.rng() * KEYS.length)];
      this.prog = PROGRESSIONS[Math.floor(this.rng() * PROGRESSIONS.length)];
    }
    // every so often a bar of near-silence (just the bass), so it breathes
    if (pos % 4 === 0) this.phraseRest = this.rng() < 0.18;
    const chord = this.prog[pos % 4];
    const k = this.key;
    // bass: the root two octaves down (never below C2: lower is mud), on beat
    // one; by day sometimes a fifth on three
    let bass = k - 24 + chord.root;
    while (bass < 36) bass += 12;
    this.note(t0, bass, 0.34, 6.5 * ped);
    if (!this.phraseRest && night < 0.5 && this.rng() < 0.35) this.note(t0 + beat * 2, bass + 7, 0.18, 4);
    if (this.phraseRest) { this.next = t0 + barLen; this.bar++; return; }
    // chord: three or four tones, rolled upward from just after the bass
    const voicing = chord.tones.slice(0, 3 + (night < 0.5 && this.rng() < 0.5 ? 1 : 0));
    const roll = 0.045 + this.rng() * 0.05;
    voicing.forEach((d, i) => this.note(t0 + 0.02 + i * roll, k - 12 + d, 0.2 - i * 0.02, 5.5 * ped));
    // melody: sparse, stepwise, pentatonic, landing on chord tones; at night
    // it stays in the lower octave (the chords keep their register: lower
    // than this is mud)
    const notes = night > 0.5 ? (this.rng() < 0.55 ? 0 : 1) : 1 + Math.floor(this.rng() * 3);
    const top = night > 0.5 ? 0 : 12;
    for (let n = 0; n < notes; n++) {
      if (this.rng() < 0.25) continue;
      const slot = [0.5, 1.5, 2, 2.5, 3, 3.5][Math.floor(this.rng() * 6)];
      const cands: number[] = [];
      for (let o = 0; o <= top; o += 12) for (const p of PENTA) cands.push(k + o + p);
      // prefer small steps from the last melody note, and chord tones
      cands.sort((a, b) => this.score(a, chord, k) - this.score(b, chord, k));
      const m = cands[Math.floor(this.rng() * Math.min(3, cands.length))];
      this.lastMel = m;
      this.note(t0 + slot * beat + (this.rng() - 0.5) * 0.03, m, 0.16 + this.rng() * 0.05, 4.2 * ped);
    }
    this.next = t0 + barLen;
    this.bar++;
  }

  private score(m: number, chord: Chord, k: number) {
    const step = Math.abs(m - this.lastMel);
    const isTone = chord.tones.some((d) => (m - k - d) % 12 === 0);
    return step + (isTone ? -2 : 1) + (step === 0 ? 3 : 0) + this.rng() * 1.5;
  }

  /** one piano note: stretched partials, a hammer tap, long decay that darkens */
  private note(t: number, midi: number, vel: number, dur: number) {
    const c = this.s.ctx;
    const f0 = hz(midi);
    const env = c.createGain();
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(Math.min(9000, f0 * 9), t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(300, f0 * 2.2), t + dur * 0.7);
    const pan = c.createStereoPanner();
    pan.pan.value = Math.max(-0.6, Math.min(0.6, (midi - 62) / 30));
    lp.connect(env).connect(pan).connect(this.bus);
    // low notes ring longer
    const decay = dur * (1.25 - Math.min(0.6, (midi - 36) / 80));
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(vel, t + 0.006);
    env.gain.setTargetAtTime(vel * 0.45, t + 0.006, 0.18);
    env.gain.setTargetAtTime(0, t + 0.25, decay / 4);
    const stop = t + decay + 0.5;
    const partials: [number, number][] = [[1, 1], [2, 0.42], [3, 0.2], [4, 0.1], [5, 0.05]];
    for (const [h, g] of partials) {
      const o = c.createOscillator();
      o.type = 'sine';
      // piano strings are slightly inharmonic: upper partials a little sharp
      o.frequency.value = f0 * h * (1 + 0.0004 * h * h);
      o.detune.value = (Math.random() - 0.5) * 4;
      const pg = c.createGain();
      pg.gain.value = g * 0.5;
      // higher partials die sooner
      pg.gain.setTargetAtTime(0, t + 0.05, decay / (2 + h * 1.5));
      o.connect(pg).connect(lp);
      o.start(t);
      o.stop(stop);
    }
    // felt hammer: a short soft thump of filtered noise
    const n = c.createBufferSource();
    n.buffer = this.s.noise('pink');
    const nf = c.createBiquadFilter();
    nf.type = 'bandpass';
    nf.frequency.value = Math.min(3000, f0 * 3);
    nf.Q.value = 0.8;
    const ng = c.createGain();
    ng.gain.setValueAtTime(vel * 0.25, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    n.connect(nf).connect(ng).connect(env);
    n.start(t, Math.random() * 2);
    n.stop(t + 0.08);
  }
}
