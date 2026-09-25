// Procedural audio engine: WebAudio only, nothing downloaded. SFX are
// synthesized per call (see sfx.ts); the ambience beds and critters live in
// ambience.ts. Everything goes through a gentle compressor so stacked crashes
// and thunder never clip.
import type { SfxKind, SoundMix } from '../contracts';
import type { MapId } from '../world/maps';
import { Synth } from './synth';
import { SFX } from './sfx';
import { Ambience } from './ambience';

export class AudioEngine {
  muted = false;
  /** Which critters live here (birds, frogs, gulls). Additive; defaults to Holler County. */
  mapId: MapId = 'appalachia';
  private ctx?: AudioContext;
  private synth?: Synth;
  private master?: GainNode;
  private sfxBus?: GainNode;
  private ambBus?: GainNode;
  private revIn?: GainNode;
  private amb?: Ambience;
  private volume = 0.8;
  private wasMuted = false;
  private lastPlay: Partial<Record<SfxKind, number>> = {};

  /** Must be called from a user gesture (browsers block audio until then). */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    let c: AudioContext;
    try {
      c = this.ctx = new Ctx({ latencyHint: 'interactive' });
    } catch {
      return;
    }
    const s = (this.synth = new Synth(c));
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.25;
    comp.connect(c.destination);
    this.master = c.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.wasMuted = this.muted;
    this.master.connect(comp);
    this.sfxBus = c.createGain();
    this.sfxBus.gain.value = 0.9;
    this.sfxBus.connect(this.master);
    this.ambBus = c.createGain();
    this.ambBus.gain.value = 0.8;
    this.ambBus.connect(this.master);
    const conv = c.createConvolver();
    conv.buffer = s.impulse(2.6, 2.4);
    this.revIn = c.createGain();
    this.revIn.gain.value = 0.8;
    const revOut = c.createGain();
    revOut.gain.value = 0.55;
    this.revIn.connect(conv).connect(revOut).connect(this.master);
    this.amb = new Ambience(s, this.ambBus, this.revIn);
    this.amb.mapId = this.mapId;
    if (c.state === 'suspended') void c.resume();
  }

  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.05);
  }

  setMuted(m: boolean) {
    this.muted = m;
    this.wasMuted = m;
    this.setVolume(this.volume);
  }

  update(dt: number, mix: SoundMix) {
    if (!this.ctx || !this.amb || !this.master) return;
    if (this.muted !== this.wasMuted) this.setMuted(this.muted);
    if (this.muted || this.ctx.state !== 'running') return;
    this.amb.mapId = this.mapId;
    this.amb.update(Math.min(dt, 0.1), mix);
  }

  play(kind: SfxKind, volume = 1) {
    if (!this.ctx || !this.synth || !this.sfxBus || !this.revIn || this.muted) return;
    if (this.ctx.state !== 'running') return;
    // don't machine-gun the same sound (e.g. 40 zone cells in one frame)
    const now = this.ctx.currentTime;
    const minGap = kind === 'thunder' || kind === 'siren' ? 0.25 : 0.035;
    if (now - (this.lastPlay[kind] ?? -1) < minGap) return;
    this.lastPlay[kind] = now;
    SFX[kind]?.(this.synth, this.sfxBus, this.revIn, Math.max(0, Math.min(1.5, volume)));
  }
}
