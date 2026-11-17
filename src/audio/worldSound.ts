import type { Synth } from './synth';
import type { StreetView } from './streetAudio';
import type { WorldSoundSource } from './worldSources';

const CHORDS = [[130.81, 164.81, 196], [174.61, 220, 261.63], [196, 246.94, 293.66], [130.81, 164.81, 196]];

class WorldVoice {
  source: WorldSoundSource | null = null;
  private tones: OscillatorNode[] = [];
  private gains: GainNode[] = [];
  private noiseGain: GainNode;
  private formant: BiquadFilterNode;
  private level: GainNode;
  private pan: StereoPannerNode | PannerNode;
  private connected = false;
  private releaseAt = 0;

  constructor(synth: Synth, private out: AudioNode, hrtf: boolean) {
    const c = synth.ctx;
    this.formant = c.createBiquadFilter(); this.formant.type = 'bandpass'; this.formant.frequency.value = 900; this.formant.Q.value = 0.8;
    this.noiseGain = c.createGain(); this.noiseGain.gain.value = 0;
    synth.loop('pink').connect(this.noiseGain).connect(this.formant);
    for (let i = 0; i < 5; i++) {
      const tone = c.createOscillator(), gain = c.createGain();
      tone.type = i === 0 ? 'sawtooth' : 'sine'; gain.gain.value = 0;
      tone.connect(gain).connect(this.formant); tone.start();
      this.tones.push(tone); this.gains.push(gain);
    }
    this.level = c.createGain(); this.level.gain.value = 0;
    this.formant.connect(this.level);
    if (hrtf) {
      const p = c.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.rolloffFactor = 0;
      this.pan = p;
    } else this.pan = c.createStereoPanner();
    this.level.connect(this.pan);
  }

  update(source: WorldSoundSource | null, view: StreetView, now: number, zoom: number) {
    this.source = source;
    if (!source) {
      if (this.connected && !this.releaseAt) { this.level.gain.setTargetAtTime(0, now, 0.045); this.releaseAt = now + 0.4; }
      if (this.connected && this.releaseAt && now >= this.releaseAt) { this.pan.disconnect(); this.connected = false; }
      return;
    }
    if (!this.connected) { this.pan.connect(this.out); this.connected = true; }
    this.releaseAt = 0;
    const dx = source.x - view.x, dz = source.z - view.z, dy = source.y - view.y;
    const distance = Math.sqrt(dx * dx + dz * dz + dy * dy), clock = now + (source.id % 13) * 0.41;
    const intercom = source.kind === 'intercom', stadium = source.kind === 'stadium';
    const phase = clock % 12, syllable = Math.floor(clock * 6), mouth = Math.sin(clock * 6 * Math.PI) ** 2;
    this.formant.frequency.setTargetAtTime(intercom ? 500 + syllable * 211 % 1500 : stadium ? 850 : 1300, now, 0.03);
    this.formant.Q.setTargetAtTime(intercom ? 3 : 0.65, now, 0.03);
    this.noiseGain.gain.setTargetAtTime(intercom ? (phase < 5 ? mouth * 0.014 : 0) : stadium ? 0.16 + 0.2 * Math.exp(-((phase - 4) ** 2) / 2) : 0, now, 0.05);
    const chord = CHORDS[Math.floor(clock / 4) % CHORDS.length];
    for (let i = 0; i < this.tones.length; i++) {
      const frequency = intercom ? 105 + (syllable * 43 % 90) + i * 12 : stadium ? 110 + i * 47 : i < 3 ? chord[i] : i === 3 ? 783.99 : 1571.8;
      const gain = intercom ? (i === 0 && phase < 5 ? mouth * 0.035 : 0) : stadium ? (i > 0 ? 0.003 : 0) : i < 3 ? 0.012 : 0.035 * Math.exp(-(clock % 8) * 2.3) / (i - 2);
      this.tones[i].frequency.setTargetAtTime(frequency, now, 0.02);
      this.gains[i].gain.setTargetAtTime(gain, now, 0.025);
    }
    const fade = Math.max(0, 1 - distance / 330);
    this.level.gain.setTargetAtTime(zoom * fade * fade, now, 0.07);
    const right = dx * view.rx + dz * view.rz;
    if ('pan' in this.pan) this.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, right / (distance + 10))), now, 0.05);
    else {
      this.pan.positionX.setTargetAtTime(right, now, 0.05);
      this.pan.positionY.setTargetAtTime(dy, now, 0.05);
      this.pan.positionZ.setTargetAtTime(dx * view.rz - dz * view.rx, now, 0.05);
    }
  }
}

/** Four persistent source voices (two active on Low), disconnected while asleep. */
export class WorldSound {
  private voices: WorldVoice[] = [];
  private elapsed = 0;
  readonly stats = { voices: 0, cap: 4, hrtf: false, updates: 0 };

  constructor(private synth: Synth, out: AudioNode, hrtf = false) {
    this.stats.hrtf = hrtf;
    for (let i = 0; i < 4; i++) this.voices.push(new WorldVoice(synth, out, hrtf));
  }

  update(dt: number, sources: readonly WorldSoundSource[], view: StreetView, active: boolean, quality: string) {
    this.elapsed += dt;
    if (this.elapsed < 0.0625) return;
    this.elapsed = 0; this.stats.updates++; this.stats.voices = 0;
    this.stats.cap = quality === 'low' ? 2 : 4;
    const zoom = Math.max(0, Math.min(1, (900 - view.dist) / 650));
    for (let i = 0; i < this.voices.length; i++) {
      const source = active && zoom > 0 && i < this.stats.cap && sources[i]?.active ? sources[i] : null;
      this.voices[i].update(source, view, this.synth.ctx.currentTime, zoom);
      if (source) this.stats.voices++;
    }
  }

  debug() { return this.voices.filter(voice => voice.source).map(voice => ({ ...voice.source })); }
}
