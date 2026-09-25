// STUB — owned by the Atmosphere & People workstream (replace wholesale).
import type { SfxKind, SoundMix } from '../contracts';

export class AudioEngine {
  muted = false;
  /** Must be called from a user gesture (browsers block audio until then). */
  unlock() {}
  setVolume(v: number) {}
  update(dt: number, mix: SoundMix) {}
  play(kind: SfxKind, volume = 1) {}
}
