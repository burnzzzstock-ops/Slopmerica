// Procedural A4 stems and bounded graph checks. No downloaded audio.
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { launch } from '../lib/browser.mjs';
import { saveReport } from './measure.mjs';
const output = 'shots/audio/world';
mkdirSync(output, { recursive: true });
const browser = await launch({ gl: false });
const report = { cases: [], hrtf: [], sampleRate: 48000 };
try {
  const page = await browser.newPage();
  await page.goto((process.env.BASE_URL ?? 'http://127.0.0.1:5173') + '/package.json');
  for (const name of ['intercom', 'stadium', 'church', 'liftedTruck', 'cyberslop', 'reverse', 'wreck', 'siren', 'sleep', 'caps']) {
    const result = await page.evaluate(async name => {
      const { Synth } = await import('/src/audio/synth.ts');
      const { WorldSound } = await import('/src/audio/worldSound.ts');
      const { StreetAudio } = await import('/src/audio/streetAudio.ts');
      const { SFX } = await import('/src/audio/sfx.ts');
      const { mulberry32 } = await import('/src/core/rng.ts');
      const rate = 48000, seconds = 12, context = new OfflineAudioContext(2, seconds * rate, rate);
      let nodes = 0, globalDraws = 0;
      const random = Math.random; Math.random = () => { globalDraws++; return 0.5; };
      try {
        for (const key of ['createOscillator', 'createGain', 'createBiquadFilter', 'createBufferSource', 'createStereoPanner', 'createPanner']) {
          const create = context[key].bind(context); context[key] = (...args) => { nodes++; return create(...args); };
        }
        const synth = new Synth(context, mulberry32(1776)), out = context.createGain(); out.gain.value = 0.64; out.connect(context.destination);
        const world = new WorldSound(synth, out), street = new StreetAudio(synth, out, { voices: 4, sirens: 2, horns: 2, rng: mulberry32(51), sirenPhase: 0 });
        const view = { x: 0, y: 5, z: 0, rx: 1, rz: 0, dist: 60 }, env = { rain: 0, wet: 0, hush: 0, speed: 1, reversing: () => name === 'reverse' };
        const kind = name === 'caps' || name === 'sleep' ? 'stadium' : name;
        const sources = Array.from({ length: name === 'caps' ? 12 : 1 }, (_, id) => ({ id, kind, x: 15 + id, y: 2, z: 15, active: true, distance2: 450 }));
        const car = { id: 10, h: 0, dep: name === 'reverse' ? 2 : 0, kind: name === 'reverse' ? 'sedan' : name === 'siren' ? 'ambulance' : name, x: 12, y: 0, z: 12, v: name === 'reverse' ? 0.7 : 12, yaw: 0, crashed: 0 };
        const cars = [car], isWorld = ['intercom', 'stadium', 'church', 'sleep', 'caps'].includes(name);
        const built = nodes, trace = [];
        let idleNodes = 0, maxVoices = 0;
        if (name === 'wreck') SFX.crash(synth, out, out, 0.65);
        const tick = () => {
          const before = nodes, t = context.currentTime;
          if (isWorld) world.update(0.1, sources, view, name !== 'sleep' || t < 3, name === 'caps' ? 'low' : 'high');
          else if (name !== 'wreck') { car.x = name === 'reverse' ? 12 : 55 - t * 9; street.update(0.1, cars, view, env); }
          idleNodes += nodes - before; maxVoices = Math.max(maxVoices, world.stats.voices);
          trace.push({ t, world: world.stats.voices, street: street.stats.voices, sirens: street.stats.sirens });
        };
        tick();
        for (let t = 0.1; t < seconds - 0.05; t += 0.1) context.suspend(t).then(() => { tick(); context.resume(); });
        const buffer = await context.startRendering(), pcm = new Uint8Array(buffer.length * 4), data = new DataView(pcm.buffer), rms = [];
        let peak = 0, power = 0;
        const left = buffer.getChannelData(0), right = buffer.getChannelData(1);
        for (let i = 0; i < buffer.length; i++) {
          peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i])); power += (left[i] ** 2 + right[i] ** 2) / 2;
          if ((i + 1) % rate === 0) { rms.push(Math.sqrt(power / rate)); power = 0; }
          data.setInt16(i * 4, Math.round(Math.max(-1, Math.min(1, left[i])) * 32767), true);
          data.setInt16(i * 4 + 2, Math.round(Math.max(-1, Math.min(1, right[i])) * 32767), true);
        }
        let binary = ''; for (let i = 0; i < pcm.length; i += 8192) binary += String.fromCharCode(...pcm.subarray(i, i + 8192));
        return { peak, rms, pcm: btoa(binary), nodesBuilt: built, idleNodes, globalDraws, maxVoices, trace, finalVoices: world.debug(), street: street.debug() };
      } finally { Math.random = random; }
    }, name);
    const pcm = Buffer.from(result.pcm, 'base64'); delete result.pcm;
    const header = Buffer.alloc(44); header.write('RIFF'); header.writeUInt32LE(pcm.length + 36, 4); header.write('WAVEfmt ', 8);
    header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(2, 22); header.writeUInt32LE(48000, 24);
    header.writeUInt32LE(192000, 28); header.writeUInt16LE(4, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
    const file = `${output}/${name}.wav`; writeFileSync(file, Buffer.concat([header, pcm]));
    const scan = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=peak=true:framelog=quiet', '-f', 'null', '-'], { encoding: 'utf8', windowsHide: true });
    if (scan.status === 0) { const tail = scan.stderr.slice(scan.stderr.lastIndexOf('Summary:')); result.lufs = Number(tail.match(/I:\s*(-?[\d.]+) LUFS/)?.[1]); result.truePeakDbfs = Number(tail.match(/True peak:\s*Peak:\s*(-?[\d.]+) dBFS/)?.[1]); }
    report.cases.push({ name, ...result });
    console.log(name, JSON.stringify({ peak: result.peak, lufs: result.lufs, truePeakDbfs: result.truePeakDbfs, idleNodes: result.idleNodes, maxVoices: result.maxVoices }));
  }
  // Alternating warm/cold measurements include OfflineAudioContext's render work,
  // not GPU time. Suspension overhead is identical in both models.
  for (let repeat = 0; repeat < 5; repeat++) for (const hrtf of repeat % 2 ? [true, false] : [false, true]) {
    report.hrtf.push(await page.evaluate(async ({ hrtf, repeat }) => {
      const { Synth } = await import('/src/audio/synth.ts'), { WorldSound } = await import('/src/audio/worldSound.ts'), { mulberry32 } = await import('/src/core/rng.ts');
      const context = new OfflineAudioContext(2, 48000 * 12, 48000), world = new WorldSound(new Synth(context, mulberry32(1776)), context.destination, hrtf);
      const sources = Array.from({ length: 4 }, (_, id) => ({ id, kind: ['church', 'stadium', 'intercom'][id % 3], x: 20 + id * 5, y: 2, z: 30, active: true, distance2: 1000 }));
      const view = { x: 0, y: 5, z: 0, rx: 1, rz: 0, dist: 60 };
      const durations = []; const tick = () => { const start = performance.now(); world.update(0.1, sources, view, true, 'high'); durations.push(performance.now() - start); };
      tick(); for (let t = 0.1; t < 11.95; t += 0.1) context.suspend(t).then(() => { tick(); context.resume(); });
      const start = performance.now(); await context.startRendering();
      return { repeat, hrtf, renderMs: performance.now() - start, updateTotalMs: durations.reduce((a, b) => a + b, 0), updates: durations.length, userAgent: navigator.userAgent };
    }, { hrtf, repeat }));
  }
  const named = Object.fromEntries(report.cases.map(c => [c.name, c]));
  report.passed = report.cases.every(c => c.peak > 0.0001 && c.peak < 0.98 && c.idleNodes === 0 && c.globalDraws === 0) &&
    named.sleep.rms.slice(5).every(x => x === 0) && named.caps.maxVoices === 2 && named.siren.trace.some(t => t.sirens === 1) &&
    named.reverse.street.some(c => c.reversing) && named.liftedTruck.street.some(c => c.radio > 0) && named.cyberslop.street.some(c => c.radio > 0);
  saveReport(`${output}/report.json`, report); console.log('acceptance', report.passed); if (!report.passed) process.exitCode = 1;
} finally { await browser.close(); }
