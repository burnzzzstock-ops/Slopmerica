// Street sound that follows the real cars.
//
// The old street audio was one traffic bed scaled by the car count plus random
// honks and pass-bys. This is a small fixed pool of voices that is handed to the
// nearest (loudest) real cars a few times a second:
//
//   car voices   engine (per vehicle kind), tyres, wet-road hiss, air brakes; pitch follows speed
//                and gear, Doppler follows the radial speed, pan follows the bearing
//   horns        a few tones per kind; they come only from cars waiting in a queue (3+ stopped cars
//                nose to tail), the rate rises with the size of the queue and how long it has sat
//   sirens       police / ambulance / fire truck only, and only while they are moving; wail, yelp,
//                hi-lo and an air horn; tow trucks have an amber beacon and stay silent
//
// Cost: the pool (default 8 car voices, 3 sirens, 4 horns; 4/2/2 on Low) is built once, idle voices
// are disconnected from the graph (WebAudio only renders what reaches the destination), the car scan
// runs 4 times a second and the AudioParam updates about 16 times a second. Nothing allocates per frame.
//
// Environment-free on purpose (no three.js, no DOM): it only needs a Synth on any BaseAudioContext, so
// scripts/streetaudio.mjs renders it offline and measures it.
import type { VehicleKind } from '../contracts';
import type { Synth } from './synth';
import {
  ENGINES, HORNS, SIRENS, SLOW_V, dopplerRatio, cents, distGain, hasSiren, hash01, honkRate, impatience, queueLink, sirenAt,
  type EngineProfile, type EngineWave, type SirenNow,
} from './streetProfiles';

/** What the street needs to know about a car. `traffic.cars` (agents/traffic.ts) satisfies this as it is. */
export interface StreetCar {
  id: number;
  kind: VehicleKind;
  x: number;
  y: number;
  z: number;
  /** speed (m/s) and heading (radians: the car faces (sin yaw, cos yaw)) */
  v: number;
  yaw: number;
  /** 0 = driving, > 0 wrecked, -1 leaving the sim */
  crashed: number;
  /** last acceleration (m/s^2): throttle vs engine brake */
  acc?: number;
  len?: number;
  /** pulling out of / into a lot: not part of a queue on the road */
  dep?: number;
  arr?: number;
  /** in a drive-thru lane (off the road, waiting for the window): not a jam either */
  thru?: unknown;
  parked?: boolean;
}
/** The ears: a point (the camera's focus, lifted a little), the camera's right vector on the ground, and its distance. */
export interface StreetView { x: number; y: number; z: number; rx: number; rz: number; dist: number }
export interface StreetEnv {
  /** 0..1 rain falling now, 0..1 how wet the roads are, 0..0.5 snow hush */
  rain: number;
  wet: number;
  hush: number;
  /** game speed (0 = paused, 1, 2, 4) */
  speed: number;
}
export interface StreetOpts {
  voices?: number;
  sirens?: number;
  horns?: number;
  /** random source (the test seeds it) */
  rng?: () => number;
  /** tanh limiter on the street bus so a pile-up of voices can never clip (default true) */
  softClip?: boolean;
  /** where in its wail/yelp pattern a new siren starts (seconds; default random, the test fixes it) */
  sirenPhase?: number;
}

const SCAN_DT = 0.25; // who gets a voice, who honks
const PAR_DT = 0.0625; // AudioParam updates
const FLOOR = 0.0035; // below this a car isn't worth a voice
const HORN_REACH = 320;
// bus trims: a crowd of engines is the loudest thing this makes, sirens are next; keep the sum well under 1
const TRIM_ENGINE = 0.75, TRIM_HORN = 1, TRIM_SIREN = 0.85;
const MAX_SLOW = 160;
const LIVE = 1, RELEASING = 2, IDLE = 0;

const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
const smooth = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/** an AudioParam that skips updates smaller than `eps` (a cruising car changes little between ticks) */
class Ctl {
  last = NaN;
  constructor(readonly p: AudioParam, readonly eps: number) {}
  to(v: number, now: number, tc: number) {
    if (Math.abs(v - this.last) < this.eps) return;
    this.last = v;
    this.p.setTargetAtTime(v, now, tc);
  }
  snap(v: number, now: number) {
    this.last = v;
    this.p.cancelScheduledValues(now);
    this.p.setValueAtTime(v, now);
  }
}

function makeWaves(ctx: BaseAudioContext): Record<EngineWave, PeriodicWave> {
  const mk = (n: number, amp: (k: number) => number) => {
    const re = new Float32Array(n + 1), im = new Float32Array(n + 1);
    for (let k = 1; k <= n; k++) im[k] = amp(k);
    return ctx.createPeriodicWave(re, im);
  };
  return {
    four: mk(22, (k) => Math.pow(k, -1.15) * (k % 2 === 0 ? 1.4 : 1)),
    six: mk(18, (k) => Math.pow(k, -1.45) * (k === 1 ? 0.55 : 1) * (k % 3 === 0 ? 1.3 : 1)),
    v8: mk(26, (k) => Math.pow(k, -1.15) * (k % 2 === 0 ? 1.55 : 1) * (k === 1 ? 0.8 : 1)),
    diesel: mk(30, (k) => Math.pow(k, -0.8) * (1 + 0.45 * Math.cos(k * 1.7))),
    bike: mk(48, (k) => Math.pow(k, -0.5)),
    ev: (() => {
      const re = new Float32Array(14), im = new Float32Array(14);
      im[1] = 1; im[2] = 0.1; im[3] = 0.05; im[6] = 0.07; im[12] = 0.05; // hum + the motor's slot harmonics
      return ctx.createPeriodicWave(re, im);
    })(),
    cart: mk(11, (k) => (k % 2 ? 1 / (k * k) : 0)),
  };
}

// ------------------------------------------------------------------ voices
abstract class Slot {
  state = IDLE;
  car: StreetCar | null = null;
  carId = -1;
  until = 0;
  /** last values, for debugging and the tests */
  dGain = 0; dRatio = 1; dPan = 0; dDist = 0; dFreq = 0;
}

/** engine + tyres + brakes for one car */
class CarVoice extends Slot {
  private oscA: OscillatorNode;
  private oscB: OscillatorNode;
  private lpEng: BiquadFilterNode;
  private lfo: OscillatorNode;
  private whine: OscillatorNode;
  private bpT: BiquadFilterNode;
  private pan: StereoPannerNode | null;
  private tail: AudioNode;
  private fA: Ctl; private fB: Ctl; private cut: Ctl; private amBase: Ctl; private amDepth: Ctl; private lfoHz: Ctl;
  private gE: Ctl; private fW: Ctl; private gW: Ctl; private fmW: Ctl; private gT: Ctl; private fT: Ctl; private gH: Ctl;
  private air: Ctl; private lvl: Ctl; private pn: Ctl;
  p: EngineProfile = ENGINES.sedan;
  private jake = 0;
  private jakeOn = false;
  private hiss = 0;
  private moved = false;
  private detB = 1.012;
  private level: GainNode;

  constructor(s: Synth, private dual: boolean, rng: () => number) {
    super();
    const c = s.ctx;
    const gain = (v: number) => { const g = c.createGain(); g.gain.value = v; return g; };
    const filt = (type: BiquadFilterType, f: number, q = 0.7) => { const b = c.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
    this.detB = 1 + 0.006 + rng() * 0.014;
    this.oscA = c.createOscillator();
    this.oscA.frequency.value = 30;
    this.lpEng = filt('lowpass', 600, 0.9);
    this.oscA.connect(this.lpEng);
    this.oscB = c.createOscillator();
    this.oscB.frequency.value = 30;
    const gB = gain(0.55);
    if (dual) this.oscB.connect(gB).connect(this.lpEng);
    // one road-noise source feeds exhaust (low), tyres (mid) and wet hiss (high)
    const nz = s.loop('white');
    const lpE = filt('lowpass', 420, 0.5);
    const gE = gain(0);
    nz.connect(lpE).connect(gE).connect(this.lpEng);
    // lope / engine brake: an LFO that chops the engine, and warbles the whine
    this.lfo = c.createOscillator();
    this.lfo.frequency.value = 6;
    const am = gain(1);
    const lfoAm = gain(0);
    this.lfo.connect(lfoAm).connect(am.gain);
    this.lpEng.connect(am);
    // motor / turbo / hydraulic whine
    this.whine = c.createOscillator();
    this.whine.frequency.value = 800;
    const gW = gain(0);
    const lfoFm = gain(0);
    this.lfo.connect(lfoFm).connect(this.whine.frequency);
    this.whine.connect(gW);
    // tyres (dry roar) and wet hiss share the road noise
    this.bpT = filt('bandpass', 700, 0.8);
    const gT = gain(0);
    nz.connect(this.bpT).connect(gT);
    const hpW = filt('highpass', 3000, 0.7);
    const gH = gain(0);
    nz.connect(hpW).connect(gH);
    // after air: distance lowpass, level, pan
    const air = filt('lowpass', 9000, 0.5);
    am.connect(air);
    gW.connect(air);
    gT.connect(air);
    gH.connect(air);
    this.level = gain(0);
    air.connect(this.level);
    this.pan = c.createStereoPanner ? c.createStereoPanner() : null;
    if (this.pan) { this.level.connect(this.pan); this.tail = this.pan; } else this.tail = this.level;
    this.oscA.start(); this.oscB.start(); this.lfo.start(); this.whine.start();

    this.fA = new Ctl(this.oscA.frequency, 0.15); this.fB = new Ctl(this.oscB.frequency, 0.15);
    this.cut = new Ctl(this.lpEng.frequency, 8);
    this.amBase = new Ctl(am.gain, 0.01); this.amDepth = new Ctl(lfoAm.gain, 0.01); this.lfoHz = new Ctl(this.lfo.frequency, 0.05);
    this.gE = new Ctl(gE.gain, 0.002); this.fW = new Ctl(this.whine.frequency, 1); this.gW = new Ctl(gW.gain, 0.0004);
    this.fmW = new Ctl(lfoFm.gain, 1); this.gT = new Ctl(gT.gain, 0.01); this.fT = new Ctl(this.bpT.frequency, 10);
    this.gH = new Ctl(gH.gain, 0.01); this.air = new Ctl(air.frequency, 40);
    this.lvl = new Ctl(this.level.gain, 0.00012); this.pn = new Ctl(this.pan ? this.pan.pan : (gain(0).gain), 0.01);
  }

  connect(bus: AudioNode) { this.tail.connect(bus); }
  disconnect() { this.tail.disconnect(); }

  assign(c: StreetCar, S: StreetAudio, now: number) {
    this.car = c;
    this.carId = c.id;
    this.p = ENGINES[c.kind] ?? ENGINES.sedan;
    const w = S.waves[this.p.wave];
    this.oscA.setPeriodicWave(w);
    this.oscB.setPeriodicWave(w);
    this.jake = 0; this.jakeOn = false; this.hiss = 0; this.moved = c.v > 3;
    this.lfo.type = 'sine';
    this.lvl.snap(0, now);
    this.connect(S.engineBus);
    this.state = LIVE;
    this.refresh(S, now, true);
  }

  release(now: number) {
    this.lvl.to(0, now, 0.04);
    this.lvl.last = NaN;
    this.state = RELEASING;
    this.until = now + 0.3;
  }

  idle() {
    this.disconnect();
    this.state = IDLE;
    this.car = null;
    this.carId = -1;
  }

  refresh(S: StreetAudio, now: number, first: boolean) {
    const c = this.car!, p = this.p, L = S.view, E = S.env;
    const v = c.v > 0 ? c.v : 0;
    const acc = c.acc ?? 0;
    const dx = c.x - L.x, dz = c.z - L.z, dy = c.y + 0.9 - L.y;
    const hd = Math.sqrt(dx * dx + dz * dz);
    const d = Math.sqrt(hd * hd + dy * dy) + 0.01;
    // radial speed of the car along the line to the ears (+ = moving away)
    const vr = ((Math.sin(c.yaw) * dx + Math.cos(c.yaw) * dz) / d) * v * S.dopplerSpeed;
    const ratio = dopplerRatio(vr);
    const pan = clamp(((dx * L.rx + dz * L.rz) / (hd + 10)) * 1.15, -1, 1);

    // rpm: gears. Each gear runs from a low to a high revs; first gear starts at idle
    const x = clamp(v / p.vTop, 0, 1);
    const gs = x * p.gears;
    const g = Math.min(p.gears - 1, Math.floor(gs));
    const frac = p.gears === 1 ? x : gs - g;
    const lo = g === 0 ? 0 : 0.4;
    let rpm = lo + (0.92 - lo) * frac;
    const thr = acc > 0 ? Math.min(1, acc / 2) : 0;
    const brk = acc < 0 ? Math.min(1, -acc / 3) : 0;
    rpm = clamp(rpm - 0.08 * brk, 0, 1);
    const f0 = p.idle + (p.top - p.idle) * rpm;

    // engine brake: a heavy diesel lifting off makes a buzz
    const jakeT = p.jake && acc < -1.4 && v > 5 ? 1 : 0;
    this.jake += (jakeT - this.jake) * (first ? 1 : 0.35);
    if (!this.jakeOn && this.jake > 0.6) { this.jakeOn = true; this.lfo.type = 'square'; }
    else if (this.jakeOn && this.jake < 0.2) { this.jakeOn = false; this.lfo.type = 'sine'; }

    // air brakes: a hiss as a heavy vehicle comes to a stop
    if (v > 3) this.moved = true;
    else if (this.moved && v < 0.5) { this.moved = false; if (p.air) this.hiss = 1; }
    this.hiss = this.hiss > 0.02 ? this.hiss * (first ? 0 : 0.86) : 0;

    const run = p.idleLevel + (1 - p.idleLevel) * Math.min(1, v / 6);
    const lvl = p.level * run * (0.72 + 0.42 * thr - 0.2 * brk) * (1 + 0.9 * this.jake);
    const cut = (p.cut0 + (p.cut1 - p.cut0) * clamp(0.55 * rpm + 0.45 * thr, 0, 1)) * (1 + this.jake);
    const lope = p.rough * (1 - Math.min(1, v / 9)) + 0.55 * this.jake;
    const tc = first ? 0 : 0.06;
    const put = (k: Ctl, val: number, tcc = tc) => (first ? k.snap(val, now) : k.to(val, now, tcc));

    put(this.fA, f0 * ratio);
    if (this.dual) put(this.fB, f0 * ratio * this.detB);
    put(this.cut, cut);
    put(this.amBase, 1 - lope);
    put(this.amDepth, lope);
    put(this.lfoHz, (this.jakeOn ? 21 : p.roughHz * (0.8 + 0.5 * rpm)) * ratio);
    put(this.gE, p.noise * 4 * (0.35 + 0.65 * thr + 0.3 * rpm));

    // whine
    let wl = 0, wf = p.whine0;
    if (p.whineMode === 'speed') { wl = p.whine * Math.pow(Math.min(1, v / 3), 0.8); wf = p.whine0 + (p.whine1 - p.whine0) * x; }
    else if (p.whineMode === 'load') { wl = p.whine * (0.2 + thr) * (0.4 + rpm); wf = p.whine0 + (p.whine1 - p.whine0) * rpm; }
    else if (p.whineMode === 'stopped') { wl = p.whine * (v < 0.8 ? 1 : 0.12); }
    put(this.fW, wf * ratio);
    put(this.gW, wl * 4.2, 0.12);
    put(this.fmW, p.whineFm * (p.whineMode === 'stopped' ? 1 : 0) * ratio);

    // tyres and the wet road
    const sp = Math.min(1.5, v / 22);
    put(this.gT, 2.4 * p.tyre * Math.pow(sp, 1.7) * (1 - 0.35 * E.wet));
    put(this.fT, (280 + 32 * v) * ratio);
    const wetHiss = E.wet * (0.6 + 0.4 * E.rain) * 1.2 * Math.pow(p.tyre, 0.7) * Math.pow(Math.min(1, v / 16), 1.1);
    put(this.gH, Math.max(wetHiss, this.hiss * 0.5));

    const a = distGain(d, p.ref, p.reach);
    put(this.air, clamp(11000 / (1 + d / 42), 800, 11000) * (1 - 0.45 * E.hush));
    this.lvl.to(lvl * a, now, 0.05); // never snapped: a new voice fades in from silence
    put(this.pn, pan, 0.05);
    this.dGain = lvl * a; this.dRatio = ratio; this.dPan = pan; this.dDist = d; this.dFreq = f0 * ratio;
  }
}

/** one horn: a couple of oscillators and an envelope, placed at the car that honks */
class HornVoice extends Slot {
  private o: OscillatorNode[] = [];
  private og: GainNode[] = [];
  private env: GainNode;
  private lp: BiquadFilterNode;
  private level: GainNode;
  private pan: StereoPannerNode | null;
  private tail: AudioNode;
  private lvl: Ctl; private pn: Ctl; private fs: Ctl[] = [];
  private prof = HORNS.sedan;
  private pitch = 1;
  private gainMul = 1;
  kind: VehicleKind = 'sedan';

  constructor(s: Synth) {
    super();
    const c = s.ctx;
    this.lp = c.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 2400; this.lp.Q.value = 1.1;
    this.env = c.createGain(); this.env.gain.value = 0;
    this.level = c.createGain(); this.level.gain.value = 0;
    for (let i = 0; i < 3; i++) {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = 400;
      const g = c.createGain(); g.gain.value = 0.5;
      o.connect(g).connect(this.lp);
      o.start();
      this.o.push(o);
      this.og.push(g);
      this.fs.push(new Ctl(o.frequency, 0.2));
    }
    this.lp.connect(this.env).connect(this.level);
    this.pan = c.createStereoPanner ? c.createStereoPanner() : null;
    if (this.pan) { this.level.connect(this.pan); this.tail = this.pan; } else this.tail = this.level;
    this.lvl = new Ctl(this.level.gain, 0.0001);
    this.pn = new Ctl(this.pan ? this.pan.pan : c.createGain().gain, 0.01);
  }

  /** start a honk `delay` seconds from now; `taps` = [len1, gap, len2] (len2 = 0 for a single) */
  start(c: StreetCar, S: StreetAudio, now: number, delay: number, len1: number, gap: number, len2: number, rng: () => number) {
    this.car = c; this.carId = c.id; this.kind = c.kind;
    this.prof = HORNS[c.kind] ?? HORNS.sedan;
    this.pitch = 0.95 + 0.1 * hash01(c.id * 7 + 3) + (rng() - 0.5) * 0.01;
    this.gainMul = this.prof.level;
    this.lp.frequency.setValueAtTime(this.prof.cut, now);
    for (let i = 0; i < 3; i++) {
      const o = this.o[i];
      const g = this.og[i];
      const on = i < this.prof.f.length;
      o.type = this.prof.type;
      g.gain.setValueAtTime(on ? 0.5 : 0, now);
      if (on) this.fs[i].snap(this.prof.f[i] * this.pitch, now);
    }
    const t0 = now + delay;
    const e = this.env.gain;
    e.cancelScheduledValues(now);
    e.setValueAtTime(0, now);
    e.setValueAtTime(0, t0);
    e.linearRampToValueAtTime(1, t0 + 0.012);
    e.setValueAtTime(1, t0 + len1);
    e.linearRampToValueAtTime(0, t0 + len1 + 0.05);
    let end = t0 + len1 + 0.06;
    if (len2 > 0) {
      const t1 = t0 + len1 + gap;
      e.setValueAtTime(0, t1);
      e.linearRampToValueAtTime(1, t1 + 0.012);
      e.setValueAtTime(1, t1 + len2);
      e.linearRampToValueAtTime(0, t1 + len2 + 0.05);
      end = t1 + len2 + 0.06;
    }
    this.until = end;
    this.lvl.snap(0, now);
    this.tail.connect(S.hornBus);
    this.state = LIVE;
    this.refresh(S, now, true);
  }

  refresh(S: StreetAudio, now: number, first: boolean) {
    const c = this.car!, L = S.view;
    const dx = c.x - L.x, dz = c.z - L.z, dy = c.y + 1 - L.y;
    const hd = Math.sqrt(dx * dx + dz * dz);
    const d = Math.sqrt(hd * hd + dy * dy) + 0.01;
    const vr = ((Math.sin(c.yaw) * dx + Math.cos(c.yaw) * dz) / d) * (c.v > 0 ? c.v : 0) * S.dopplerSpeed;
    const ratio = dopplerRatio(vr);
    const pan = clamp(((dx * L.rx + dz * L.rz) / (hd + 10)) * 1.15, -1, 1);
    for (let i = 0; i < this.prof.f.length; i++) {
      if (first) this.fs[i].snap(this.prof.f[i] * this.pitch * ratio, now);
      else this.fs[i].to(this.prof.f[i] * this.pitch * ratio, now, 0.03);
    }
    const a = 0.17 * this.gainMul * distGain(d, 12, HORN_REACH);
    if (first) this.lvl.snap(a, now); else this.lvl.to(a, now, 0.03);
    this.pn.to(pan, now, 0.03);
    this.dGain = a; this.dRatio = ratio; this.dPan = pan; this.dDist = d;
  }

  idle() {
    this.tail.disconnect();
    this.state = IDLE;
    this.car = null;
    this.carId = -1;
  }
}

/** a siren riding one emergency vehicle */
class SirenVoice extends Slot {
  private a: OscillatorNode;
  private b: OscillatorNode;
  private lfo: OscillatorNode;
  private lp: BiquadFilterNode;
  private air: BiquadFilterNode;
  private level: GainNode;
  private hornG: GainNode;
  private hornO: OscillatorNode[] = [];
  private pan: StereoPannerNode | null;
  private tail: AudioNode;
  private cA: Ctl; private cB: Ctl; private cLfo: Ctl; private cDepth: Ctl; private cDepthB: Ctl; private cDepthQ: Ctl; private cDepthQB: Ctl; private cDetA: Ctl; private cDetB: Ctl;
  private cLvl: Ctl; private cPn: Ctl; private cAir: Ctl; private cHorn: Ctl; private cH1: Ctl; private cH2: Ctl; private cDetH1: Ctl; private cDetH2: Ctl;
  private clock = 0;
  private lfoTri = true;
  private now: SirenNow = { center: 900, depth: 300, rate: 0.2, tri: true, horn: 0 };
  private hornOn = 0;
  kind: VehicleKind = 'police';

  constructor(s: Synth) {
    super();
    const c = s.ctx;
    const gain = (v: number) => { const g = c.createGain(); g.gain.value = v; return g; };
    this.a = c.createOscillator(); this.a.type = 'sawtooth'; this.a.frequency.value = 900;
    this.b = c.createOscillator(); this.b.type = 'square'; this.b.frequency.value = 900;
    this.lfo = c.createOscillator(); this.lfo.type = 'triangle'; this.lfo.frequency.value = 0.2;
    // wail / yelp ride a triangle LFO straight onto the carriers; hi-lo rides a sine through a hard limiter (an exact
    // two-tone: the 'square' oscillator is normalised with its Gibbs overshoot, so its tops sit at ~0.85, not 1)
    const dep = gain(0), depB = gain(0), depQ = gain(0), depQB = gain(0);
    const hard = c.createWaveShaper();
    const hc = new Float32Array(257);
    for (let i = 0; i < 257; i++) hc[i] = clamp(((i / 256) * 2 - 1) * 6, -1, 1);
    hard.curve = hc;
    this.lfo.connect(dep).connect(this.a.frequency);
    this.lfo.connect(depB).connect(this.b.frequency);
    this.lfo.connect(hard);
    hard.connect(depQ).connect(this.a.frequency);
    hard.connect(depQB).connect(this.b.frequency);
    const gb = gain(0.35);
    this.lp = c.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 3200; this.lp.Q.value = 0.7;
    this.a.connect(this.lp);
    this.b.connect(gb).connect(this.lp);
    this.hornG = gain(0);
    const hg = [gain(0.5), gain(0.5)];
    for (let i = 0; i < 2; i++) {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 300; o.start();
      o.connect(hg[i]).connect(this.hornG);
      this.hornO.push(o);
    }
    this.hornG.connect(this.lp);
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 260; hp.Q.value = 0.7;
    this.lp.connect(hp);
    this.air = c.createBiquadFilter(); this.air.type = 'lowpass'; this.air.frequency.value = 6000; this.air.Q.value = 0.5;
    hp.connect(this.air);
    this.level = gain(0);
    this.air.connect(this.level);
    this.pan = c.createStereoPanner ? c.createStereoPanner() : null;
    if (this.pan) { this.level.connect(this.pan); this.tail = this.pan; } else this.tail = this.level;
    this.a.start(); this.b.start(); this.lfo.start();
    this.cA = new Ctl(this.a.frequency, 0.5); this.cB = new Ctl(this.b.frequency, 0.5);
    this.cLfo = new Ctl(this.lfo.frequency, 0.01); this.cDepth = new Ctl(dep.gain, 1); this.cDepthB = new Ctl(depB.gain, 1);
    this.cDepthQ = new Ctl(depQ.gain, 1); this.cDepthQB = new Ctl(depQB.gain, 1);
    this.cDetA = new Ctl(this.a.detune, 0.5); this.cDetB = new Ctl(this.b.detune, 0.5);
    this.cLvl = new Ctl(this.level.gain, 0.0001); this.cPn = new Ctl(this.pan ? this.pan.pan : gain(0).gain, 0.01);
    this.cAir = new Ctl(this.air.frequency, 30); this.cHorn = new Ctl(this.hornG.gain, 0.01);
    this.cH1 = new Ctl(this.hornO[0].frequency, 0.5); this.cH2 = new Ctl(this.hornO[1].frequency, 0.5);
    this.cDetH1 = new Ctl(this.hornO[0].detune, 0.5); this.cDetH2 = new Ctl(this.hornO[1].detune, 0.5);
  }

  assign(c: StreetCar, S: StreetAudio, now: number, rng: () => number) {
    this.car = c; this.carId = c.id; this.kind = c.kind;
    const pr = SIRENS[c.kind]!;
    this.lp.frequency.setValueAtTime(pr.cut, now);
    this.hornO[0].frequency.setValueAtTime(pr.hornF[0] || 300, now);
    this.hornO[1].frequency.setValueAtTime(pr.hornF[1] || 300, now);
    this.clock = S.sirenPhase ?? rng() * pr.period; // two sirens in one street don't sing in step
    this.hornOn = 0;
    this.cLvl.snap(0, now);
    this.tail.connect(S.sirenBus);
    this.state = LIVE;
    this.refresh(S, now, 0, true);
  }

  release(now: number) {
    this.cLvl.to(0, now, 0.06);
    this.cLvl.last = NaN;
    this.state = RELEASING;
    this.until = now + 0.4;
  }

  idle() {
    this.tail.disconnect();
    this.state = IDLE;
    this.car = null;
    this.carId = -1;
  }

  refresh(S: StreetAudio, now: number, dt: number, first: boolean) {
    const c = this.car!, L = S.view;
    const pr = SIRENS[c.kind]!;
    const v = c.v > 0 ? c.v : 0;
    const dx = c.x - L.x, dz = c.z - L.z, dy = c.y + 2 - L.y;
    const hd = Math.sqrt(dx * dx + dz * dz);
    const d = Math.sqrt(hd * hd + dy * dy) + 0.01;
    const vr = ((Math.sin(c.yaw) * dx + Math.cos(c.yaw) * dz) / d) * v * S.dopplerSpeed;
    const ratio = dopplerRatio(vr);
    const cd = cents(ratio);
    const pan = clamp(((dx * L.rx + dz * L.rz) / (hd + 10)) * 1.15, -1, 1);
    this.clock += dt;
    const s = sirenAt(c.kind, this.clock, this.now);
    const tc = first ? 0 : 0.04;
    const put = (k: Ctl, val: number, tcc = tc) => (first ? k.snap(val, now) : k.to(val, now, tcc));
    // the pattern rides the carriers' frequency; Doppler rides their detune (cents), so neither fights the other
    put(this.cA, s.center); put(this.cB, s.center * 0.5);
    put(this.cLfo, s.rate * ratio);
    put(this.cDepth, s.tri ? s.depth : 0); put(this.cDepthB, s.tri ? s.depth * 0.5 : 0);
    put(this.cDepthQ, s.tri ? 0 : s.depth); put(this.cDepthQB, s.tri ? 0 : s.depth * 0.5);
    if (s.tri !== this.lfoTri) { this.lfoTri = s.tri; this.lfo.type = s.tri ? 'triangle' : 'sine'; }
    put(this.cDetA, cd); put(this.cDetB, cd); put(this.cDetH1, cd); put(this.cDetH2, cd);
    put(this.cHorn, s.horn * 0.8, 0.03);
    // pitch-down and level come from geometry
    const a = pr.level * distGain(d, 26, 480);
    put(this.cAir, clamp(9000 / (1 + d / 60), 900, 9000));
    this.cLvl.to(a, now, 0.06);
    put(this.cPn, pan, 0.06);
    this.dGain = a; this.dRatio = ratio; this.dPan = pan; this.dDist = d; this.dFreq = s.center * ratio;
  }
}

// ------------------------------------------------------------------ the street
export class StreetAudio {
  readonly ctx: BaseAudioContext;
  /** everything the street makes, after the limiter */
  readonly master: GainNode;
  readonly engineBus: GainNode;
  readonly hornBus: GainNode;
  readonly sirenBus: GainNode;
  readonly waves: Record<EngineWave, PeriodicWave>;
  readonly view: StreetView = { x: 0, y: 0, z: 0, rx: 1, rz: 0, dist: 60 };
  readonly env: StreetEnv = { rain: 0, wet: 0, hush: 0, speed: 1 };
  /** Doppler runs on game speed too, up to 2x (a 4x fast-forward would otherwise scream) */
  dopplerSpeed = 1;
  readonly stats = { voices: 0, sirens: 0, horns: 0, honks: 0, jamCars: 0, jams: 0, cap: 0, sirenCap: 0, hornCap: 0, scans: 0 };
  /** the last honks (ring buffer of preallocated slots: no garbage) */
  readonly honkLog: { t: number; id: number; kind: VehicleKind; size: number }[] = [];
  private honkAt = 0;
  private rng: () => number;
  sirenPhase?: number;
  private voices: CarVoice[] = [];
  private sirens: SirenVoice[] = [];
  private horns: HornVoice[] = [];
  private tSel = 0;
  private tPar = 0;
  private cars: readonly StreetCar[] = [];
  private pausedFor = 0;
  /** false after sleep(): every voice is idle and disconnected */
  awake = true;
  private limited = '';
  private capCars = 99;
  private capSirens = 99;
  private capHorns = 99;
  // scan scratch (allocated once)
  private candCar: (StreetCar | null)[] = [];
  private candScore: Float32Array;
  private sirCar: (StreetCar | null)[] = [];
  private sirScore: Float32Array;
  private slowCar: (StreetCar | null)[] = [];
  private slowSize: Int16Array;
  private parent: Int16Array;
  private dwell = new Map<number, number>();
  private gen = 0;
  private sweep: (value: number, key: number) => void;
  private ctlMaster: Ctl; private ctlEngine: Ctl; private ctlHorn: Ctl; private ctlSiren: Ctl;

  constructor(readonly synth: Synth, out: AudioNode, opts: StreetOpts = {}) {
    const c = this.ctx = synth.ctx;
    this.rng = opts.rng ?? Math.random;
    this.sirenPhase = opts.sirenPhase;
    const nv = opts.voices ?? 8, ns = opts.sirens ?? 3, nh = opts.horns ?? 4;
    this.stats.cap = nv; this.stats.sirenCap = ns; this.stats.hornCap = nh;
    this.waves = makeWaves(c);
    const gain = (v: number) => { const g = c.createGain(); g.gain.value = v; return g; };
    this.master = gain(1);
    this.engineBus = gain(1);
    this.hornBus = gain(1);
    this.sirenBus = gain(1);
    const sum = gain(1);
    this.engineBus.connect(sum); this.hornBus.connect(sum); this.sirenBus.connect(sum);
    if (opts.softClip === false) sum.connect(this.master);
    else {
      // tanh: identity for quiet passages, never above 1 however many voices pile up
      const sh = c.createWaveShaper();
      const n = 2048, curve = new Float32Array(n);
      for (let i = 0; i < n; i++) curve[i] = Math.tanh(((i / (n - 1)) * 2 - 1) * 2);
      sh.curve = curve;
      const pre = gain(0.5);
      sum.connect(pre).connect(sh).connect(this.master);
    }
    this.master.connect(out);
    for (let i = 0; i < nv; i++) this.voices.push(new CarVoice(synth, i < 4 || nv > 4, this.rng));
    for (let i = 0; i < ns; i++) this.sirens.push(new SirenVoice(synth));
    for (let i = 0; i < nh; i++) this.horns.push(new HornVoice(synth));
    for (let i = 0; i < 32; i++) this.honkLog.push({ t: 0, id: -1, kind: 'sedan', size: 0 });
    this.candScore = new Float32Array(nv); this.sirScore = new Float32Array(ns);
    for (let i = 0; i < nv; i++) this.candCar.push(null);
    for (let i = 0; i < ns; i++) this.sirCar.push(null);
    for (let i = 0; i < MAX_SLOW; i++) this.slowCar.push(null);
    this.slowSize = new Int16Array(MAX_SLOW); this.parent = new Int16Array(MAX_SLOW);
    this.ctlMaster = new Ctl(this.master.gain, 0.001); this.ctlEngine = new Ctl(this.engineBus.gain, 0.002);
    this.ctlHorn = new Ctl(this.hornBus.gain, 0.002); this.ctlSiren = new Ctl(this.sirenBus.gain, 0.002);
    const gen = () => this.gen & 4095;
    this.sweep = (value: number, key: number) => { if ((value & 4095) !== gen()) this.dwell.delete(key); };
  }

  /** How many car voices the device can afford: Low (phones) gets a lean pool. */
  static poolFor(quality: string): StreetOpts {
    return quality === 'low' ? { voices: 4, sirens: 2, horns: 2 } : quality === 'medium' ? { voices: 6, sirens: 3, horns: 3 } : { voices: 8, sirens: 3, horns: 4 };
  }

  /** Lower the number of voices that may be live at once (the pool itself is built once): Low = phone. */
  limit(quality: string) {
    if (quality === this.limited) return;
    this.limited = quality;
    const o = StreetAudio.poolFor(quality);
    this.capCars = o.voices!; this.capSirens = o.sirens!; this.capHorns = o.horns!;
    this.stats.cap = Math.min(this.voices.length, this.capCars);
    this.stats.sirenCap = Math.min(this.sirens.length, this.capSirens);
    this.stats.hornCap = Math.min(this.horns.length, this.capHorns);
  }

  /** Every frame: cheap. Voices are re-picked at 4 Hz, parameters glide at 16 Hz. */
  update(dt: number, cars: readonly StreetCar[], view: StreetView, env: StreetEnv) {
    const now = this.ctx.currentTime;
    this.cars = cars;
    const V = this.view;
    V.x = view.x; V.y = view.y; V.z = view.z; V.rx = view.rx; V.rz = view.rz; V.dist = view.dist;
    const E = this.env;
    E.rain = env.rain; E.wet = env.wet; E.hush = env.hush; E.speed = env.speed;
    this.dopplerSpeed = Math.min(2, env.speed);
    // buses: zoomed out you hear the city, not the cars; paused you hear nothing
    const paused = env.speed <= 0;
    const zoom = 1 - smooth(200, 900, V.dist);
    const zoomSiren = 1 - smooth(450, 1600, V.dist);
    const hushG = 1 - 0.5 * clamp(E.hush, 0, 1);
    this.tPar += dt;
    this.tSel += dt;
    if (this.tPar >= PAR_DT) {
      this.ctlEngine.to(paused ? 0 : zoom * hushG * TRIM_ENGINE, now, 0.15);
      this.ctlHorn.to(paused ? 0 : zoom * hushG * TRIM_HORN, now, 0.15);
      this.ctlSiren.to(paused ? 0 : zoomSiren * hushG * TRIM_SIREN, now, 0.15);
    }
    if (paused) {
      this.pausedFor += dt;
      if (this.pausedFor > 1.5 && this.awake) this.sleep();
      this.settle(now);
      this.tPar = 0; this.tSel = 0;
      return;
    }
    this.pausedFor = 0;
    if (zoom < 0.004 && zoomSiren < 0.004) {
      if (this.awake) this.sleep();
      this.settle(now);
      this.tPar = 0; this.tSel = 0;
      return;
    }
    this.awake = true;
    if (this.tSel >= SCAN_DT) {
      const sdt = this.tSel;
      this.tSel = 0;
      this.scan(now, sdt, zoom > 0.004, zoomSiren > 0.004);
    }
    if (this.tPar >= PAR_DT) {
      const pdt = this.tPar;
      this.tPar = 0;
      this.tick(now, pdt);
    }
  }

  /** Release everything (muted, paused, zoomed out to the map). Voices go back to idle and stop costing anything. */
  sleep() {
    const now = this.ctx.currentTime;
    for (const v of this.voices) if (v.state === LIVE) v.release(now);
    for (const v of this.sirens) if (v.state === LIVE) v.release(now);
    for (const v of this.horns) if (v.state === LIVE) v.until = now + 0.1;
    this.awake = false;
    this.stats.voices = this.stats.sirens = this.stats.horns = 0;
  }

  /** frees released voices once their fade is over (also while asleep) */
  private settle(now: number) {
    for (const v of this.voices) if (v.state === RELEASING && now >= v.until) v.idle();
    for (const v of this.sirens) if (v.state === RELEASING && now >= v.until) v.idle();
    for (const v of this.horns) if (v.state === LIVE && now >= v.until) v.idle();
  }

  private alive(c: StreetCar) {
    return c.crashed === 0 && !c.parked && c.yaw === c.yaw && c.x === c.x && c.z === c.z;
  }

  // ------------------------------------------------------------ 4 Hz: who gets a voice, who honks
  private scan(now: number, dt: number, wantCars: boolean, wantSirens: boolean) {
    const cars = this.cars, L = this.view;
    const K = Math.min(this.candScore.length, this.capCars), S = Math.min(this.sirScore.length, this.capSirens);
    let nc = 0, ns = 0, nSlow = 0;
    const V = this.voices, SV = this.sirens;
    const ly = L.y;
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      if (!this.alive(c)) continue;
      const dx = c.x - L.x, dz = c.z - L.z;
      const d2 = dx * dx + dz * dz;
      const p = ENGINES[c.kind] ?? ENGINES.sedan; // a kind added later just sounds like a sedan
      // the pool: loudest first
      if (wantCars && d2 < p.reach * p.reach) {
        const dy = c.y + 0.9 - ly;
        const d = Math.sqrt(d2 + dy * dy);
        let sc = p.level * (p.idleLevel + (1 - p.idleLevel) * Math.min(1, c.v / 6)) * distGain(d, p.ref, p.reach);
        if (sc >= FLOOR) {
          for (let k = 0; k < V.length; k++) if (V[k].car === c && V[k].state === LIVE) { sc *= 1.35; break; }
          if (nc < K || sc > this.candScore[K - 1]) {
            let j = nc < K ? nc++ : K - 1;
            while (j > 0 && this.candScore[j - 1] < sc) { this.candScore[j] = this.candScore[j - 1]; this.candCar[j] = this.candCar[j - 1]; j--; }
            this.candScore[j] = sc; this.candCar[j] = c;
          }
        }
      }
      // sirens: only emergency vehicles that are moving (they keep it a little below the start speed)
      if (wantSirens && hasSiren(c.kind) && d2 < 480 * 480) {
        let owned = false;
        for (let k = 0; k < SV.length; k++) if (SV[k].car === c && SV[k].state === LIVE) { owned = true; break; }
        if (c.v > (owned ? 0.6 : 1.5)) {
          const dy = c.y + 2 - ly;
          const d = Math.sqrt(d2 + dy * dy);
          let sc = distGain(d, 26, 480) * (owned ? 1.4 : 1);
          if (sc > 0.002 && (ns < S || sc > this.sirScore[S - 1])) {
            let j = ns < S ? ns++ : S - 1;
            while (j > 0 && this.sirScore[j - 1] < sc) { this.sirScore[j] = this.sirScore[j - 1]; this.sirCar[j] = this.sirCar[j - 1]; j--; }
            this.sirScore[j] = sc; this.sirCar[j] = c;
          }
        }
      }
      // jams: cars waiting on the road within earshot of a horn
      if (c.v < SLOW_V && nSlow < MAX_SLOW && d2 < HORN_REACH * HORN_REACH && !(c.dep !== undefined && c.dep > 0) && !(c.arr !== undefined && c.arr >= 0) && !c.thru) {
        this.slowCar[nSlow++] = c;
      }
    }
    this.stats.scans++;

    // hand out voices ----------------------------------------------------------------------
    this.reconcile(V, this.candCar, nc, now, false);
    this.reconcile(SV, this.sirCar, ns, now, true);
    this.candCar.fill(null);
    this.sirCar.fill(null);

    this.jams(now, dt, nSlow);
    for (let i = 0; i < nSlow; i++) this.slowCar[i] = null;
  }

  private reconcile(slots: (CarVoice | SirenVoice)[], cand: (StreetCar | null)[], n: number, now: number, siren: boolean) {
    // keep voices whose car is still among the loudest (same object, same id); let the others go
    for (const s of slots) {
      if (s.state !== LIVE) continue;
      let keep = false;
      for (let j = 0; j < n; j++) if (cand[j] === s.car && cand[j]!.id === s.carId) { keep = true; cand[j] = null; break; }
      if (!keep) s.release(now);
    }
    // give free voices to the rest
    for (let j = 0; j < n; j++) {
      const c = cand[j];
      if (!c) continue;
      let free: CarVoice | SirenVoice | null = null;
      for (const s of slots) if (s.state === IDLE) { free = s; break; }
      if (!free) break; // pool full; releasing voices free up on a later scan
      if (siren) (free as SirenVoice).assign(c, this, now, this.rng); else (free as CarVoice).assign(c, this, now);
    }
  }

  // ------------------------------------------------------------ jams: cluster the waiting cars, honk from them
  private jams(now: number, dt: number, n: number) {
    this.gen++;
    const par = this.parent, size = this.slowSize, cars = this.slowCar;
    for (let i = 0; i < n; i++) { par[i] = i; size[i] = 0; }
    for (let i = 0; i < n; i++) {
      const a = cars[i]!;
      const la = a.len ?? 5;
      for (let j = i + 1; j < n; j++) {
        const b = cars[j]!;
        const dx = a.x - b.x, dz = a.z - b.z;
        const r = queueLink(la, b.len ?? 5);
        if (dx * dx + dz * dz < r * r) { const ra = this.find(i), rb = this.find(j); if (ra !== rb) par[ra] = rb; }
      }
    }
    for (let i = 0; i < n; i++) size[this.find(i)]++;
    let jamCars = 0, jams = 0;
    const g = this.gen & 4095;
    for (let i = 0; i < n; i++) {
      const c = cars[i]!;
      const sz = size[this.find(i)];
      // how long has it been sitting here (deciseconds, kept in a Map of small ints: no garbage)
      const prev = this.dwell.get(c.id);
      const ds = Math.min(20000, (prev === undefined ? 0 : Math.floor(prev / 4096)) + Math.round(dt * 10));
      this.dwell.set(c.id, ds * 4096 + g);
      if (sz < 3) continue;
      jamCars++;
      if (par[i] === i) jams++;
      const rate = honkRate(sz, ds / 10, impatience(c.id));
      if (rate > 0 && this.rng() < rate * dt) this.honk(c, sz, now);
    }
    // forget cars that are moving again
    this.dwell.forEach(this.sweep);
    this.stats.jamCars = jamCars;
    this.stats.jams = jams;
  }

  private find(i: number) {
    const par = this.parent;
    while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; }
    return i;
  }

  private honk(c: StreetCar, size: number, now: number) {
    const dx = c.x - this.view.x, dz = c.z - this.view.z;
    if (dx * dx + dz * dz > HORN_REACH * HORN_REACH) return;
    let free: HornVoice | null = null;
    for (let i = 0; i < this.horns.length && i < this.capHorns; i++) if (this.horns[i].state === IDLE) { free = this.horns[i]; break; }
    if (!free) return;
    const pr = HORNS[c.kind] ?? HORNS.sedan;
    const r = this.rng();
    let len = pr.len[0] + this.rng() * (pr.len[1] - pr.len[0]);
    let gap = 0, len2 = 0;
    if (r > 0.7 && r < 0.92) { len = pr.len[0] + this.rng() * 0.6 * (pr.len[1] - pr.len[0]); gap = 0.09 + this.rng() * 0.06; len2 = len * 0.9; } // beep-beep
    else if (r >= 0.92 && size >= 6) len = pr.len[1] * (1.4 + this.rng() * 0.6); // leaning on it
    free.start(c, this, now, this.rng() * 0.18, len, gap, len2, this.rng);
    this.stats.honks++;
    const slot = this.honkLog[this.honkAt++ & 31];
    slot.t = now; slot.id = c.id; slot.kind = c.kind; slot.size = size;
  }

  // ------------------------------------------------------------ 16 Hz: glide the voices to where their cars are
  private tick(now: number, dt: number) {
    let nv = 0, nsr = 0, nh = 0;
    for (const v of this.voices) {
      if (v.state === LIVE) {
        const c = v.car!;
        if (c.id !== v.carId || c.crashed !== 0) v.release(now);
        else { v.refresh(this, now, false); nv++; }
      } else if (v.state === RELEASING && now >= v.until) v.idle();
    }
    for (const v of this.sirens) {
      if (v.state === LIVE) {
        const c = v.car!;
        if (c.id !== v.carId || c.crashed !== 0 || c.v < 0.4) v.release(now);
        else { v.refresh(this, now, dt, false); nsr++; }
      } else if (v.state === RELEASING && now >= v.until) v.idle();
    }
    for (const h of this.horns) {
      if (h.state === LIVE) {
        if (now >= h.until) h.idle(); else { h.refresh(this, now, false); nh++; }
      }
    }
    this.stats.voices = nv; this.stats.sirens = nsr; this.stats.horns = nh;
  }

  /** Debug/test: what each live voice is doing. Allocates; not for the frame loop. */
  debug() {
    const out: { kind: VehicleKind; id: number; type: 'car' | 'siren' | 'horn'; dist: number; ratio: number; gain: number; pan: number; freq: number }[] = [];
    const add = (arr: Slot[], type: 'car' | 'siren' | 'horn') => { for (const s of arr) if (s.state === LIVE && s.car) out.push({ kind: s.car.kind, id: s.carId, type, dist: s.dDist, ratio: s.dRatio, gain: s.dGain, pan: s.dPan, freq: s.dFreq }); };
    add(this.voices, 'car'); add(this.sirens, 'siren'); add(this.horns, 'horn');
    return out;
  }

  /** Nodes built (for the "pool never grows" check): count of voices, not of nodes. */
  get poolSize() { return this.voices.length + this.sirens.length + this.horns.length; }
}
