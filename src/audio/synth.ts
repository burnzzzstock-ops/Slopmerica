// Tiny procedural synth kit: cached noise buffers, envelopes, one-shot voices
// and a generated reverb impulse. No audio files anywhere.
export type NoiseColor = 'white' | 'pink' | 'brown';

export interface ToneOpts {
  type?: OscillatorType;
  f0: number;
  f1?: number; // glide target (exponential)
  t?: number; // start offset, seconds
  dur: number;
  a?: number; // attack
  gain: number;
  pan?: number;
  vibrato?: number; // Hz depth
  vibratoRate?: number;
}

export interface BurstOpts {
  color?: NoiseColor;
  type?: BiquadFilterType;
  f0: number;
  f1?: number;
  q?: number;
  t?: number;
  dur: number;
  a?: number;
  gain: number;
  pan?: number;
}

export class Synth {
  private buffers = new Map<NoiseColor, AudioBuffer>();

  constructor(readonly ctx: AudioContext) {}

  noise(color: NoiseColor): AudioBuffer {
    let b = this.buffers.get(color);
    if (b) return b;
    const len = Math.floor(this.ctx.sampleRate * 3);
    b = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = b.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (color === 'white') d[i] = w;
      else if (color === 'pink') {
        // Paul Kellet's refined pink filter
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      } else {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      }
    }
    // crossfade the loop seam
    const fade = Math.floor(this.ctx.sampleRate * 0.05);
    for (let i = 0; i < fade; i++) {
      const t = i / fade;
      d[len - fade + i] = d[len - fade + i] * (1 - t) + d[i] * t;
    }
    this.buffers.set(color, b);
    return b;
  }

  /** Endless noise source for ambience beds (started at a random offset). */
  loop(color: NoiseColor): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise(color);
    src.loop = true;
    src.start(0, Math.random() * 2.5);
    return src;
  }

  private out(dest: AudioNode, pan?: number): AudioNode {
    if (pan === undefined || !this.ctx.createStereoPanner) return dest;
    const p = this.ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(dest);
    return p;
  }

  tone(dest: AudioNode, o: ToneOpts) {
    const c = this.ctx;
    const t0 = c.currentTime + (o.t ?? 0);
    const osc = c.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.f0, t0);
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t0 + o.dur);
    if (o.vibrato) {
      const lfo = c.createOscillator();
      const lg = c.createGain();
      lfo.frequency.value = o.vibratoRate ?? 6;
      lg.gain.value = o.vibrato;
      lfo.connect(lg).connect(osc.frequency);
      lfo.start(t0);
      lfo.stop(t0 + o.dur + 0.05);
    }
    const g = c.createGain();
    const a = o.a ?? 0.005;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain), t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    osc.connect(g).connect(this.out(dest, o.pan));
    osc.start(t0);
    osc.stop(t0 + o.dur + 0.05);
  }

  burst(dest: AudioNode, o: BurstOpts) {
    const c = this.ctx;
    const t0 = c.currentTime + (o.t ?? 0);
    const src = c.createBufferSource();
    src.buffer = this.noise(o.color ?? 'white');
    const f = c.createBiquadFilter();
    f.type = o.type ?? 'bandpass';
    f.frequency.setValueAtTime(o.f0, t0);
    if (o.f1) f.frequency.exponentialRampToValueAtTime(Math.max(10, o.f1), t0 + o.dur);
    f.Q.value = o.q ?? 0.8;
    const g = c.createGain();
    const a = o.a ?? 0.004;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain), t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    src.connect(f).connect(g).connect(this.out(dest, o.pan));
    src.start(t0, Math.random() * 2);
    src.stop(t0 + o.dur + 0.05);
  }

  /** Stereo reverb impulse: decaying noise with a darker tail. */
  impulse(seconds: number, decay: number): AudioBuffer {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const b = this.ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        lp += (Math.random() * 2 - 1 - lp) * (0.9 - t * 0.7);
        d[i] = lp * Math.pow(1 - t, decay);
      }
    }
    return b;
  }
}
