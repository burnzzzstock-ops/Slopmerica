// Procedural soundscape (no audio files): wind and birds over the countryside,
// crickets at night, a traffic drone that grows with the city, rain and
// thunder, construction clanks, crowd murmur, plus synthesized UI and game
// sound effects. Everything is built from oscillators and filtered noise.
import type { SfxKind, SoundMix } from '../contracts';

type Bed = { gain: GainNode; level: number };

export class AudioEngine {
  muted = false;
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private noise!: AudioBuffer;
  private beds: Record<'wind' | 'traffic' | 'rain' | 'crowd' | 'crickets', Bed> = {} as never;
  private volume = 0.8;
  private birdT = 2;
  private clankT = 1;
  private honkT = 6;
  private mix: SoundMix | null = null;

  /** Must be called from a user gesture (browsers block audio until then). */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
    } catch {
      return;
    }
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(c.destination);
    this.sfxBus = c.createGain();
    this.sfxBus.gain.value = 0.9;
    this.sfxBus.connect(this.master);
    // 3 s of white noise shared by every noise source
    this.noise = c.createBuffer(1, c.sampleRate * 3, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.beds.wind = this.bed([['bandpass', 520, 0.6], ['lowpass', 1400, 0.7]], 0.9);
    this.beds.traffic = this.bed([['lowpass', 260, 0.8], ['lowpass', 420, 0.5]], 1.4);
    this.beds.rain = this.bed([['highpass', 900, 0.5], ['lowpass', 7000, 0.4]], 0.7);
    this.beds.crowd = this.bed([['bandpass', 700, 1.2], ['bandpass', 1300, 1.0]], 0.8);
    // crickets: a pulsing high sine
    {
      const g = c.createGain();
      g.gain.value = 0;
      const osc = c.createOscillator();
      osc.frequency.value = 4400;
      const am = c.createGain();
      am.gain.value = 0;
      const lfo = c.createOscillator();
      lfo.frequency.value = 22;
      const lfoGain = c.createGain();
      lfoGain.gain.value = 0.5;
      lfo.connect(lfoGain).connect(am.gain);
      osc.connect(am).connect(g).connect(this.master);
      osc.start();
      lfo.start();
      this.beds.crickets = { gain: g, level: 0 };
    }
  }

  private bed(filters: [BiquadFilterType, number, number][], rate: number): Bed {
    const c = this.ctx!;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.playbackRate.value = rate;
    let node: AudioNode = src;
    for (const [type, f, q] of filters) {
      const b = c.createBiquadFilter();
      b.type = type;
      b.frequency.value = f;
      b.Q.value = q;
      node.connect(b);
      node = b;
    }
    const g = c.createGain();
    g.gain.value = 0;
    node.connect(g).connect(this.master);
    src.start(0, Math.random() * 2);
    return { gain: g, level: 0 };
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : v, this.ctx.currentTime, 0.05);
  }

  setMuted(m: boolean) {
    this.muted = m;
    this.setVolume(this.volume);
  }

  update(dt: number, mix: SoundMix) {
    this.mix = mix;
    const c = this.ctx;
    if (!c || c.state !== 'running') return;
    if (this.master.gain.value > 0 === this.muted) this.setVolume(this.volume);
    const near = 1 - mix.zoom * 0.7;
    const wx = mix.weather;
    const wet = wx === 'rain' || wx === 'storm' || wx === 'hurricane' ? mix.weatherIntensity : 0;
    const windy = wx === 'storm' || wx === 'blizzard' || wx === 'hurricane' ? mix.weatherIntensity : 0;
    const set = (b: Bed, v: number) => {
      b.level = v;
      b.gain.gain.setTargetAtTime(v, c.currentTime, 0.4);
    };
    set(this.beds.wind, 0.05 + mix.nature * 0.05 * near + windy * 0.22 + mix.zoom * 0.05);
    set(this.beds.traffic, mix.traffic * 0.22 * near);
    set(this.beds.rain, wet * (wx === 'hurricane' ? 0.5 : 0.32));
    set(this.beds.crowd, mix.people * 0.05 * near * (1 - mix.night * 0.5));
    set(this.beds.crickets, mix.night > 0.6 && mix.season !== 'winter' && wet < 0.2 ? 0.012 * mix.nature * near : 0);

    // birds by day in nature, clanks near construction, the odd honk in traffic
    this.birdT -= dt;
    if (this.birdT <= 0) {
      this.birdT = 1.5 + Math.random() * 4;
      if (mix.night < 0.3 && wet < 0.3 && mix.season !== 'winter' && Math.random() < mix.nature * near) this.chirp();
    }
    this.clankT -= dt;
    if (this.clankT <= 0) {
      this.clankT = 0.6 + Math.random() * 2.2;
      if (Math.random() < mix.construction * near) this.clank();
    }
    this.honkT -= dt;
    if (this.honkT <= 0) {
      this.honkT = 3 + Math.random() * 10;
      if (Math.random() < mix.traffic * near * 0.8) this.play('honk', 0.25);
    }
  }

  // ---------------------------------------------------------------- synth helpers
  private env(g: GainNode, t: number, a: number, peak: number, d: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  private tone(type: OscillatorType, f0: number, f1: number, t: number, dur: number, vol: number, attack = 0.005) {
    const c = this.ctx!;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = c.createGain();
    this.env(g, t, attack, vol, dur);
    o.connect(g).connect(this.sfxBus);
    o.start(t);
    o.stop(t + attack + dur + 0.05);
  }

  private burst(t: number, dur: number, vol: number, filter: BiquadFilterType, freq: number, q = 0.7, freqEnd?: number) {
    const c = this.ctx!;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const b = c.createBiquadFilter();
    b.type = filter;
    b.frequency.setValueAtTime(freq, t);
    if (freqEnd) b.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    b.Q.value = q;
    const g = c.createGain();
    this.env(g, t, 0.004, vol, dur);
    s.connect(b).connect(g).connect(this.sfxBus);
    s.start(t, Math.random() * 2);
    s.stop(t + dur + 0.1);
  }

  private chirp() {
    const t = this.ctx!.currentTime;
    const base = 2600 + Math.random() * 1800;
    const n = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) this.tone('sine', base * (1 + Math.random() * 0.2), base * (1.3 + Math.random() * 0.4), t + i * 0.11, 0.07, 0.02);
  }

  private clank() {
    const t = this.ctx!.currentTime;
    this.burst(t, 0.12, 0.05, 'bandpass', 1800 + Math.random() * 1500, 6);
    this.tone('triangle', 820 + Math.random() * 300, 780, t, 0.18, 0.02);
  }

  play(kind: SfxKind, volume = 1) {
    const c = this.ctx;
    if (!c || c.state !== 'running' || this.muted) return;
    const t = c.currentTime;
    const v = volume;
    switch (kind) {
      case 'click':
        this.tone('sine', 1250, 900, t, 0.05, 0.12 * v);
        break;
      case 'build':
        this.tone('triangle', 180, 120, t, 0.18, 0.25 * v);
        this.burst(t, 0.12, 0.12 * v, 'lowpass', 900);
        break;
      case 'bulldoze':
        this.burst(t, 0.7, 0.35 * v, 'lowpass', 600, 0.7, 120);
        this.tone('sawtooth', 70, 45, t, 0.6, 0.12 * v);
        break;
      case 'zone':
        this.burst(t, 0.18, 0.1 * v, 'bandpass', 2400, 1.5, 900);
        break;
      case 'cash':
        this.tone('sine', 1568, 1568, t, 0.12, 0.14 * v);
        this.tone('sine', 2093, 2093, t + 0.07, 0.3, 0.14 * v);
        break;
      case 'error':
        this.tone('square', 150, 110, t, 0.22, 0.09 * v);
        break;
      case 'notify':
        this.tone('sine', 880, 880, t, 0.1, 0.1 * v);
        this.tone('sine', 1320, 1320, t + 0.09, 0.18, 0.1 * v);
        break;
      case 'crash':
        this.burst(t, 0.5, 0.5 * v, 'lowpass', 2500, 0.8, 300);
        this.burst(t + 0.02, 0.35, 0.3 * v, 'bandpass', 3200, 4);
        this.tone('square', 240, 60, t, 0.25, 0.1 * v);
        // tinkle of glass
        for (let i = 0; i < 5; i++) this.tone('sine', 3000 + Math.random() * 3000, 2800, t + 0.08 + i * 0.05, 0.08, 0.03 * v);
        break;
      case 'honk':
        this.tone('square', 392, 392, t, 0.28, 0.05 * v, 0.01);
        this.tone('square', 494, 494, t, 0.28, 0.05 * v, 0.01);
        break;
      case 'siren':
        for (let i = 0; i < 3; i++) this.tone('sine', 700, 1300, t + i * 0.6, 0.55, 0.06 * v, 0.05);
        break;
      case 'thunder':
        this.burst(t, 2.8, 0.55 * v, 'lowpass', 260, 0.6, 60);
        this.burst(t + 0.05, 0.4, 0.3 * v, 'lowpass', 1400, 0.5, 200);
        break;
      case 'cannon':
        this.burst(t, 0.9, 0.6 * v, 'lowpass', 500, 0.7, 50);
        this.tone('sine', 90, 35, t, 0.6, 0.5 * v);
        break;
      case 'levelUp':
        [523, 659, 784, 1047].forEach((f, i) => this.tone('triangle', f, f, t + i * 0.07, 0.16, 0.1 * v));
        break;
    }
  }
}
