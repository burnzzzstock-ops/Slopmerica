// Procedural audio engine: WebAudio only, nothing downloaded. SFX are
// synthesized per call (see sfx.ts); the ambience beds and critters live in
// ambience.ts. Everything goes through a gentle compressor so stacked crashes
// and thunder never clip.
import type { SfxKind, SoundMix } from '../contracts';
import type { MapId } from '../world/maps';
import { Synth } from './synth';
import { SFX } from './sfx';
import { Ambience, RAIN } from './ambience';
import { StreetAudio, type StreetCar, type StreetEnv, type StreetView } from './streetAudio';
import { AmbientPiano } from './piano';

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
  private streetVoices?: StreetAudio;
  private streetView: StreetView = { x: 0, y: 0, z: 0, rx: 1, rz: 0, dist: 60 };
  private streetEnv: StreetEnv = { rain: 0, wet: 0, hush: 0, speed: 1 };
  private rainNow = 0;
  private hushNow = 0;
  /** Graphics preset name; the street voice pool is sized from it (Low = phone = fewer voices). */
  quality = 'high';
  private piano?: AmbientPiano;
  /** Settings → Music (remembered): ambient piano on/off and its volume */
  musicOn = true;
  musicVolume = 0.55;
  private volume = 0.8;
  /**
   * Settings → Sound (remembered): the effects, the ambience and the street sound, on/off and how loud. The music has its own pair above;
   * the dev pages' setMuted/setVolume stay the master over everything.
   */
  private soundOn_ = true;
  private soundVolume_ = 1;
  private soundBus?: GainNode;   // sfxBus and ambBus (and so every street voice) go through this one
  private soundRev?: GainNode;   // and their sends to the reverb go through this one, so a muted sound leaves no reverb tail
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
    this.soundBus = c.createGain();
    this.soundBus.connect(this.master);
    this.sfxBus = c.createGain();
    this.sfxBus.gain.value = 0.9;
    this.sfxBus.connect(this.soundBus);
    this.ambBus = c.createGain();
    this.ambBus.gain.value = 0.8;
    this.ambBus.connect(this.soundBus);
    const conv = c.createConvolver();
    conv.buffer = s.impulse(2.6, 2.4);
    this.revIn = c.createGain();
    this.revIn.gain.value = 0.8;
    const revOut = c.createGain();
    revOut.gain.value = 0.55;
    this.revIn.connect(conv).connect(revOut).connect(this.master);
    this.soundRev = c.createGain();
    this.soundRev.connect(this.revIn);
    this.applySound();
    this.amb = new Ambience(s, this.ambBus, this.soundRev);
    this.streetVoices = new StreetAudio(s, this.ambBus, StreetAudio.poolFor(this.quality));
    this.piano = new AmbientPiano(s, this.master, this.revIn);
    this.piano.enabled = this.musicOn;
    this.piano.volume = this.musicVolume;
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

  /** Settings → Sound on/off (effects, ambience, street sound). Safe before the first gesture: it is applied when the audio starts. */
  get soundOn(): boolean { return this.soundOn_; }
  set soundOn(on: boolean) { this.soundOn_ = on; this.applySound(); }
  /** Settings → Sound volume, 0..1 (1 is the level the game always had). */
  get soundVolume(): number { return this.soundVolume_; }
  set soundVolume(v: number) { this.soundVolume_ = Math.max(0, Math.min(1, v)); this.applySound(); }
  private applySound() {
    if (!this.ctx || !this.soundBus || !this.soundRev) return;
    const g = this.soundOn_ ? this.soundVolume_ : 0, t = this.ctx.currentTime;
    this.soundBus.gain.setTargetAtTime(g, t, 0.04);
    this.soundRev.gain.setTargetAtTime(g, t, 0.04);
  }
  /** What the audio graph is doing now, for tests: the gains the player's settings set and whether the street voices are asleep. */
  debugState() {
    return {
      started: !!this.ctx, running: this.ctx?.state === 'running', master: this.master?.gain.value ?? null, sound: this.soundBus?.gain.value ?? null,
      soundRev: this.soundRev?.gain.value ?? null, soundOn: this.soundOn_, soundVolume: this.soundVolume_, musicOn: this.musicOn, musicVolume: this.musicVolume,
      streetAwake: this.streetVoices?.awake ?? null, streetVoices: this.streetVoices?.stats.voices ?? null,
    };
  }

  update(dt: number, mix: SoundMix) {
    if (!this.ctx || !this.amb || !this.master) return;
    if (this.muted !== this.wasMuted) this.setMuted(this.muted);
    if (this.muted || this.ctx.state !== 'running') return;
    this.amb.mapId = this.mapId;
    if (this.soundOn_) this.amb.update(Math.min(dt, 0.1), mix);   // (sound off: the ambience is silent, so it is not even run)
    this.rainNow = (RAIN[mix.weather] ?? 0) * mix.weatherIntensity;
    this.hushNow = mix.weather === 'snow' || mix.weather === 'blizzard' ? 0.5 * mix.weatherIntensity : 0;
    if (this.piano) {
      this.piano.enabled = this.musicOn;
      this.piano.volume = this.musicVolume;
      this.piano.update(mix.night);
    }
  }

  /**
   * Street sound from the real cars (streetAudio.ts). Call once a frame with the traffic model's cars and the
   * camera; it re-picks voices a few times a second. Silent while muted, paused or before the first gesture.
   * `cam`: the RTS camera (target point, distance, yaw); `wet`: how wet the roads are (0..1); `speed`: game speed.
   */
  street(dt: number, cars: readonly StreetCar[], cam: { target: { x: number; y: number; z: number }; distance: number; yaw: number }, wet: number, speed: number) {
    const st = this.streetVoices;
    if (!st || !this.ctx || !this.amb) return;
    this.amb.randomTraffic = false; // real cars now: no random honks or pass-bys
    st.limit(this.quality);
    const V = this.streetView, E = this.streetEnv;
    V.x = cam.target.x; V.z = cam.target.z; V.y = cam.target.y + Math.min(55, Math.max(3, cam.distance * 0.3));
    V.rx = Math.cos(cam.yaw); V.rz = -Math.sin(cam.yaw); V.dist = cam.distance;
    E.rain = this.rainNow; E.wet = wet; E.hush = this.hushNow;
    E.speed = this.muted || !this.soundOn_ || this.ctx.state !== 'running' ? 0 : speed; // muted, sound off or suspended = paused: the voices are released, then disconnected
    st.update(Math.min(dt, 0.1), cars, V, E);
  }

  play(kind: SfxKind, volume = 1) {
    if (!this.ctx || !this.synth || !this.sfxBus || !this.soundRev || this.muted || !this.soundOn_) return;
    if (this.ctx.state !== 'running') return;
    // don't machine-gun the same sound (e.g. 40 zone cells in one frame)
    const now = this.ctx.currentTime;
    const minGap = kind === 'thunder' || kind === 'siren' ? 0.25 : 0.035;
    if (now - (this.lastPlay[kind] ?? -1) < minGap) return;
    this.lastPlay[kind] = now;
    SFX[kind]?.(this.synth, this.sfxBus, this.soundRev, Math.max(0, Math.min(1.5, volume)));
  }
}
