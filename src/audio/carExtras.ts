import type { Synth } from './synth';
import type { VehicleKind } from '../contracts';

const COUNTRY = [196, 246.94, 293.66, 246.94, 220, 261.63, 329.63, 261.63];

/** Persistent oscillators inside an existing car voice: no new sources while driving. */
export class CarExtras {
  private radio: OscillatorNode;
  private filter: BiquadFilterNode;
  private radioGain: GainNode;
  private beep: OscillatorNode;
  private beepGain: GainNode;
  radioLevel = 0;
  reversing = false;

  constructor(synth: Synth, out: AudioNode) {
    const context = synth.ctx;
    this.radio = context.createOscillator(); this.radio.type = 'triangle';
    this.filter = context.createBiquadFilter(); this.filter.type = 'bandpass'; this.filter.Q.value = 1.5;
    this.radioGain = context.createGain(); this.radioGain.gain.value = 0;
    this.radio.connect(this.filter).connect(this.radioGain).connect(out); this.radio.start();
    this.beep = context.createOscillator(); this.beep.frequency.value = 1050;
    this.beepGain = context.createGain(); this.beepGain.gain.value = 0;
    this.beep.connect(this.beepGain).connect(out); this.beep.start();
  }

  update(now: number, kind: VehicleKind, id: number, speed: number, reversing: boolean, ratio: number) {
    const clock = now + (id % 17) * 0.37;
    const truck = kind === 'liftedTruck', podcast = kind === 'cyberslop';
    const step = Math.floor(clock * (truck ? 3.2 : 5));
    const phase = (clock * (truck ? 3.2 : 5)) % 1;
    // Original eight-note country figure; the other voice is wordless formant
    // murmur. Neither contains recorded music or intelligible speech.
    this.radio.frequency.setTargetAtTime((truck ? COUNTRY[step % COUNTRY.length] : 100 + (step * 37 % 75)) * ratio, now, 0.018);
    this.filter.frequency.setTargetAtTime(truck ? 1100 : 420 + (step * 191 % 950), now, 0.025);
    this.radioLevel = speed > 1 && (truck || podcast) ? (truck ? 0.27 * Math.exp(-phase * 4) : 0.3 * Math.sin(phase * Math.PI) ** 2) : 0;
    this.radioGain.gain.setTargetAtTime(this.radioLevel, now, 0.018);
    this.reversing = reversing;
    this.beep.frequency.setTargetAtTime(1050 * ratio, now, 0.025);
    this.beepGain.gain.setTargetAtTime(reversing && clock % 0.9 < 0.35 ? 0.6 : 0, now, 0.012);
  }
}
