// One recipe per SfxKind. Every sound is synthesized on the spot.
import type { SfxKind } from '../contracts';
import type { Synth } from './synth';

export type SfxRecipe = (s: Synth, out: AudioNode, rev: AudioNode, v: number) => void;

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

function honk(s: Synth, out: AudioNode, v: number, pitch = 1, t = 0, len = 0.32, pan?: number) {
  const c = s.ctx;
  const t0 = c.currentTime + t;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 2400;
  lp.Q.value = 1.2;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.16 * v, t0 + 0.012);
  g.gain.setValueAtTime(0.16 * v, t0 + len);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + len + 0.06);
  let dest: AudioNode = out;
  if (pan !== undefined && c.createStereoPanner) {
    const p = c.createStereoPanner();
    p.pan.value = pan;
    p.connect(out);
    dest = p;
  }
  lp.connect(g).connect(dest);
  for (const f of [415, 523]) {
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f * pitch * 0.97, t0);
    o.frequency.linearRampToValueAtTime(f * pitch, t0 + 0.03);
    o.connect(lp);
    o.start(t0);
    o.stop(t0 + len + 0.1);
  }
}

export const SFX: Record<SfxKind, SfxRecipe> = {
  click(s, out, _rev, v) {
    s.tone(out, { type: 'triangle', f0: 1850, f1: 1120, dur: 0.042, a: 0.001, gain: 0.24 * v });
    s.burst(out, { type: 'bandpass', f0: 3800, q: 1.5, dur: 0.022, a: 0.001, gain: 0.08 * v });
  },
  build(s, out, rev, v) {
    s.tone(out, { f0: 165, f1: 58, dur: 0.19, a: 0.002, gain: 0.48 * v });
    s.burst(out, { type: 'bandpass', f0: 1050, q: 2.0, dur: 0.06, gain: 0.24 * v });
    s.tone(out, { type: 'triangle', f0: 587.3, f1: 592, t: 0.025, dur: 0.18, a: 0.003, gain: 0.13 * v });
    s.tone(out, { type: 'triangle', f0: 880, dur: 0.26, t: 0.07, a: 0.003, gain: 0.12 * v });
    s.tone(rev, { type: 'triangle', f0: 880, dur: 0.24, t: 0.07, a: 0.003, gain: 0.05 * v });
  },
  bulldoze(s, out, rev, v) {
    s.burst(out, { color: 'brown', type: 'lowpass', f0: 1100, f1: 180, dur: 0.75, a: 0.01, gain: 0.8 * v });
    s.tone(out, { type: 'sawtooth', f0: 72, f1: 38, dur: 0.55, a: 0.01, gain: 0.07 * v });
    for (let i = 0; i < 6; i++) s.burst(out, { type: 'bandpass', f0: rnd(1200, 3400), q: 3, t: rnd(0, 0.4), dur: rnd(0.04, 0.09), gain: rnd(0.08, 0.16) * v });
    s.burst(rev, { color: 'brown', type: 'lowpass', f0: 600, dur: 0.5, gain: 0.3 * v });
  },
  zone(s, out, rev, v) {
    s.burst(out, { color: 'pink', type: 'bandpass', f0: 700, f1: 2400, q: 1.4, dur: 0.16, a: 0.02, gain: 0.14 * v });
    s.tone(out, { type: 'triangle', f0: 523.25, f1: 659.25, dur: 0.11, t: 0.01, a: 0.003, gain: 0.16 * v });
    s.tone(out, { type: 'sine', f0: 1046.5, dur: 0.14, t: 0.055, a: 0.003, gain: 0.11 * v });
    s.tone(rev, { type: 'sine', f0: 1046.5, dur: 0.14, t: 0.055, a: 0.003, gain: 0.04 * v });
  },
  cash(s, out, rev, v) {
    s.burst(out, { type: 'bandpass', f0: 2400, q: 1.2, dur: 0.045, a: 0.001, gain: 0.2 * v });
    s.tone(out, { type: 'triangle', f0: 220, f1: 140, dur: 0.055, a: 0.001, gain: 0.12 * v });
    const bells = [1567.98, 2093, 2637, 3136];
    bells.forEach((f, i) => {
      const onset = 0.045 + i * 0.022;
      s.tone(out, { type: 'triangle', f0: f * rnd(0.999, 1.001), t: onset, dur: 0.65 - i * 0.08, a: 0.003, gain: (0.11 - i * 0.016) * v });
      s.tone(rev, { type: 'sine', f0: f, t: onset, dur: 0.45, a: 0.003, gain: 0.035 * v });
    });
  },
  error(s, out, _rev, v) {
    s.tone(out, { type: 'triangle', f0: 293.66, f1: 277.18, dur: 0.11, a: 0.004, gain: 0.16 * v });
    s.tone(out, { type: 'triangle', f0: 220, f1: 196, dur: 0.19, t: 0.11, a: 0.004, gain: 0.15 * v });
  },
  notify(s, out, rev, v) {
    s.tone(out, { type: 'triangle', f0: 988, dur: 0.2, a: 0.004, gain: 0.1 * v });
    s.tone(out, { type: 'triangle', f0: 1319, dur: 0.42, t: 0.1, a: 0.004, gain: 0.09 * v });
    s.tone(rev, { type: 'sine', f0: 1319, dur: 0.4, t: 0.1, gain: 0.04 * v });
  },
  crash(s, out, rev, v) {
    s.burst(out, { type: 'lowpass', f0: 7000, f1: 380, dur: 0.75, a: 0.002, gain: 0.75 * v });
    s.tone(out, { f0: 95, f1: 38, dur: 0.35, a: 0.002, gain: 0.55 * v });
    for (const f of [311, 587, 919, 1373, 1861]) s.tone(out, { type: 'triangle', f0: f * rnd(0.97, 1.03), dur: rnd(0.35, 0.8), a: 0.002, gain: 0.06 * v });
    for (let i = 0; i < 8; i++) s.tone(out, { f0: rnd(3000, 7200), t: rnd(0.04, 0.5), dur: rnd(0.06, 0.16), a: 0.001, gain: rnd(0.02, 0.05) * v, pan: rnd(-0.6, 0.6) });
    s.burst(rev, { type: 'lowpass', f0: 3000, dur: 0.5, gain: 0.3 * v });
  },
  honk(s, out, _rev, v) {
    honk(s, out, v, rnd(0.94, 1.06));
  },
  siren(s, out, rev, v) {
    const c = s.ctx;
    const t0 = c.currentTime;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2600;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.09 * v, t0 + 0.08);
    g.gain.setValueAtTime(0.09 * v, t0 + 3.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 3.6);
    o.frequency.setValueAtTime(640, t0);
    for (let k = 0; k < 2; k++) {
      o.frequency.linearRampToValueAtTime(1380, t0 + k * 1.8 + 0.9);
      o.frequency.linearRampToValueAtTime(640, t0 + k * 1.8 + 1.8);
    }
    o.connect(lp).connect(g);
    g.connect(out);
    g.connect(rev);
    o.start(t0);
    o.stop(t0 + 3.7);
  },
  thunder(s, out, rev, v) {
    const c = s.ctx;
    const t0 = c.currentTime;
    if (v > 0.7) s.burst(out, { type: 'highpass', f0: 1600, dur: 0.14, a: 0.002, gain: 0.25 * v });
    const src = c.createBufferSource();
    src.buffer = s.noise('brown');
    src.loop = true; // the rumble outlasts the 3 s noise buffer
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(480, t0);
    lp.frequency.exponentialRampToValueAtTime(160, t0 + 5);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    let t = t0 + 0.06;
    g.gain.exponentialRampToValueAtTime(1.2 * v, t);
    // the rumble rolls on in uneven swells for several seconds
    const swells = 5 + Math.floor(Math.random() * 3);
    for (let i = 0; i < swells; i++) {
      t += rnd(0.35, 0.9);
      g.gain.exponentialRampToValueAtTime(rnd(0.5, 1.4) * v * (1 - i / (swells + 5)), t);
    }
    g.gain.exponentialRampToValueAtTime(0.0001, t + rnd(1.8, 2.8));
    src.connect(lp).connect(g);
    g.connect(out);
    g.connect(rev);
    src.start(t0, Math.random() * 2);
    src.stop(t + 3);
  },
  cannon(s, out, rev, v) {
    s.tone(out, { f0: 125, f1: 30, dur: 1.0, a: 0.003, gain: 0.7 * v });
    s.burst(out, { color: 'brown', type: 'lowpass', f0: 1400, f1: 140, dur: 0.7, a: 0.002, gain: 0.6 * v });
    s.burst(out, { type: 'highpass', f0: 2200, dur: 0.06, a: 0.001, gain: 0.3 * v });
    s.burst(rev, { color: 'brown', type: 'lowpass', f0: 900, dur: 1.2, a: 0.01, gain: 0.6 * v });
  },
  levelUp(s, out, rev, v) {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => s.tone(out, { type: 'triangle', f0: f, t: i * 0.075, dur: 0.36, a: 0.004, gain: 0.11 * v }));
    notes.forEach((f) => {
      s.tone(out, { f0: f, t: 0.32, dur: 0.95, a: 0.02, gain: 0.055 * v });
      s.tone(rev, { f0: f, t: 0.32, dur: 0.95, a: 0.02, gain: 0.04 * v });
    });
    s.tone(out, { type: 'triangle', f0: 1567.98, t: 0.34, dur: 0.55, a: 0.012, gain: 0.045 * v });
  },
};

export { honk as honkVoice };
