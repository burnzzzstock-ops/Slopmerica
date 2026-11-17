// BASE_URL serves the audio graph. Render real AudioEngine routes offline,
// including the compressor, fixed paint voice and notification ducking.
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { launch } from '../lib/browser.mjs';
import { saveReport } from './measure.mjs';
const output = 'shots/audio/actions';
mkdirSync(output, { recursive: true });
const browser = await launch({ gl: false });
const report = { rate: 24000, cases: [] };
try {
  const page = await browser.newPage();
  await page.goto((process.env.BASE_URL ?? 'http://127.0.0.1:5173') + '/package.json');
  for (const name of ['montage', 'recipes', 'stress', 'left', 'right', 'far', 'zone', 'muted-zone', 'route-load', 'pos-level']) {
    const result = await page.evaluate(async name => {
      const { AudioEngine } = await import('/src/audio/audio.ts');
      const { SFX } = await import('/src/audio/sfx.ts');
      const seconds = name === 'montage' ? 22 : name === 'recipes' ? 80 : 6, rate = 24000;
      const context = new OfflineAudioContext(2, seconds * rate, rate);
      // Offline rendering advances on startRendering. The production graph's
      // running-state guard can then be exercised at each suspended quantum.
      Object.defineProperty(context, 'state', { get: () => 'running' });
      const oldContext = window.AudioContext, oldRandom = Math.random;
      let globalDraws = 0, nodes = 0, panners = 0;
      Math.random = () => { globalDraws++; return 0.5; };
      window.AudioContext = function () { return context; };
      try {
        for (const key of ['createOscillator', 'createGain', 'createBiquadFilter', 'createBufferSource', 'createStereoPanner']) {
          const create = context[key].bind(context);
          context[key] = (...args) => { nodes++; if (key === 'createStereoPanner') panners++; return create(...args); };
        }
        const audio = new AudioEngine(); audio.unlock();
        audio.amb.update = () => {};
        audio.score.update = () => {};
        audio.street(0, [], { target: { x: 0, y: 0, z: 0 }, distance: 120, yaw: 0 }, 0, 1);
        if (name === 'muted-zone') audio.soundOn = false;
        const schedule = name === 'montage' ? [
          { at: 1, kind: 'build', x: -72 }, { at: 3, kind: 'bulldoze', x: 72 }, { at: 5, kind: 'error' },
          { at: 6.5, kind: 'cash' }, { at: 8, kind: 'levelUp' }, { at: 10, kind: 'crash', x: 72 }, { at: 17, kind: 'notify' },
        ] : name === 'recipes' ? Object.keys(SFX).map((kind, i) => ({ at: 0.5 + i * 6, kind }))
          : name === 'stress' ? Object.keys(SFX).map(kind => ({ at: 1, kind }))
          : name === 'route-load' ? Array.from({ length: 20 }, (_, i) => ({ at: 0.5 + i * 0.2, kind: 'build', x: (i % 17 - 8) * 9 }))
          : name === 'pos-level' ? [{ at: 1, kind: 'levelUp', x: 72 }]
          : ['left', 'right', 'far'].includes(name) ? [{ at: 1, kind: 'build', x: name === 'left' ? -72 : name === 'right' ? 72 : 20000 }] : [];
        const mix = { zoom: 0, nature: 0, traffic: 0, construction: 0, people: 0, night: 0, weather: 'clear', weatherIntensity: 0, season: 'summer' };
        const gains = [], counts = {}, eventNodes = [];
        let next = 0, idleNodes = 0, paintNodes = 0, paints = 0;
        const tick = () => {
          const time = context.currentTime;
          while (next < schedule.length && time >= schedule[next].at) {
            const cue = schedule[next++]; counts[cue.kind] = (counts[cue.kind] ?? 0) + 1;
            const beforeNodes = nodes, beforePanners = panners;
            if (cue.x !== undefined) audio.playAt(cue.kind, cue.x, 0, 0.65); else audio.play(cue.kind, name === 'stress' ? 1.5 : 0.65);
            eventNodes.push({ kind: cue.kind, nodes: nodes - beforeNodes, panners: panners - beforePanners });
          }
          if ((name === 'montage' && time >= 13 && time < 15) || ((name === 'zone' || name === 'muted-zone') && time >= 0.5 && time < 2.5)) {
            const before = nodes;
            audio.zonePaint(36, 0, 12);
            paintNodes += nodes - before; paints++;
          }
          const before = nodes;
          audio.update(0.1, mix);
          idleNodes += nodes - before;
          gains.push({ time, music: audio.musicBus.gain.value, zone: audio.zoneGain.gain.value, ducked: audio.ducked });
        };
        tick();
        for (let t = 0.1; t < seconds - 0.05; t += 0.1) context.suspend(t).then(() => { tick(); context.resume(); });
        const buffer = await context.startRendering(), left = buffer.getChannelData(0), right = buffer.getChannelData(1);
        const pcm = new Uint8Array(left.length * 4), view = new DataView(pcm.buffer), rms = [];
        let peak = 0, power = 0, leftPower = 0, rightPower = 0, step = 0;
        for (let i = 0; i < left.length; i++) {
          peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
          if (i) step = Math.max(step, Math.abs(left[i] - left[i - 1]), Math.abs(right[i] - right[i - 1]));
          leftPower += left[i] ** 2; rightPower += right[i] ** 2;
          power += (left[i] ** 2 + right[i] ** 2) / 2;
          if ((i + 1) % rate === 0) { rms.push(Math.sqrt(power / rate)); power = 0; }
          view.setInt16(i * 4, Math.round(Math.max(-1, Math.min(1, left[i])) * 32767), true);
          view.setInt16(i * 4 + 2, Math.round(Math.max(-1, Math.min(1, right[i])) * 32767), true);
        }
        let binary = '';
        for (let i = 0; i < pcm.length; i += 8192) binary += String.fromCharCode(...pcm.subarray(i, i + 8192));
        return { seconds, pcm: btoa(binary), peak, maxSampleStep: step, rms, rightShare: rightPower / Math.max(1e-30, leftPower + rightPower),
          idleNodes, paintNodes, paints, globalDraws, gains, cues: counts, schedule, eventNodes, spatialRoutes: audio.debugState().spatialRoutes };
      } finally { window.AudioContext = oldContext; Math.random = oldRandom; }
    }, name);
    const pcm = Buffer.from(result.pcm, 'base64'); delete result.pcm;
    const header = Buffer.alloc(44);
    header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVEfmt ', 8);
    header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(2, 22);
    header.writeUInt32LE(24000, 24); header.writeUInt32LE(96000, 28); header.writeUInt16LE(4, 32); header.writeUInt16LE(16, 34);
    header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
    const file = `${output}/${name}.wav`;
    writeFileSync(file, Buffer.concat([header, pcm]));
    const scan = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=peak=true:framelog=quiet', '-f', 'null', '-'], { encoding: 'utf8', windowsHide: true });
    if (!scan.error && scan.status === 0) {
      const summary = scan.stderr.slice(scan.stderr.lastIndexOf('Summary:'));
      result.lufs = Number(summary.match(/I:\s*(-?[\d.]+) LUFS/)?.[1]);
      result.truePeakDbfs = Number(summary.match(/True peak:\s*Peak:\s*(-?[\d.]+) dBFS/)?.[1]);
    }
    report.cases.push({ name, ...result });
    console.log(name, JSON.stringify({ peak: result.peak, lufs: result.lufs, truePeak: result.truePeakDbfs, rightShare: result.rightShare,
      idleNodes: result.idleNodes, paintNodes: result.paintNodes, globalDraws: result.globalDraws }));
  }
  const byName = Object.fromEntries(report.cases.map(c => [c.name, c]));
  report.passed = report.cases.every(c => c.peak < 0.98 && !(Number.isFinite(c.truePeakDbfs) && c.truePeakDbfs >= 0) && c.idleNodes === 0 && c.paintNodes === 0 && c.globalDraws === 0) &&
    byName.montage.peak > 0.01 && byName.left.rightShare < 0.2 && byName.right.rightShare > 0.8 && byName.far.peak === 0 &&
    byName['muted-zone'].peak === 0 && byName.zone.peak > 0.001 && byName.zone.rms.slice(4).every(r => r < 0.00001) &&
    byName['route-load'].eventNodes.length === 20 && byName['route-load'].eventNodes.every(e => e.nodes > 0 && e.panners === 0) &&
    byName['route-load'].spatialRoutes === 17 && byName['pos-level'].gains.some(g => g.time > 1.4 && g.time < 2 && g.music < 0.46) &&
    byName.montage.gains.some(g => g.time > 17.4 && g.time < 18 && g.music < 0.46) &&
    byName.montage.gains.some(g => g.time > 20 && g.music > 0.97);
  saveReport(`${output}/report.json`, report);
  console.log('acceptance', report.passed);
  if (!report.passed) process.exitCode = 1;
} finally { await browser.close(); }
