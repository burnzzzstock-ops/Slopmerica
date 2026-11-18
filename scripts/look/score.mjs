// BASE_URL serves the current source. Render each original procedural stem and
// a population/stress sweep, checking pitch, tempo, transitions and local RNG.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { launch } from '../lib/browser.mjs';
import { saveReport } from './measure.mjs';

const output = 'shots/audio/score';
mkdirSync(output, { recursive: true });
const cases = [
  { name: 'piano', seconds: 50, population: 0 },
  { name: 'porch', seconds: 50, population: 350, isolate: 'porch' },
  { name: 'muzak', seconds: 50, population: 1800, isolate: 'muzak' },
  { name: 'country', seconds: 50, population: 6500, isolate: 'country' },
  { name: 'tension', seconds: 50, population: 6500, moneyTrouble: 1, flowEma: 0, disaster: 1, isolate: 'tension' },
  { name: 'jingle', seconds: 50, population: 6500, isolate: 'jingle' },
  { name: 'winter-night', seconds: 50, population: 350, night: 1, season: 'winter', isolate: 'porch' },
  { name: 'mute', seconds: 45, population: 6500, mute: true },
  { name: 'sweep', seconds: 120, sweep: true },
  { name: 'country-repeat', seconds: 50, population: 6500, isolate: 'country' },
];
const browser = await launch({ gl: false });
const report = { seed: 1776, compositionSeed: 0x5c0a3, rate: 24000, cases: [] };
let countryPcm;
try {
  const page = await browser.newPage();
  await page.goto((process.env.BASE_URL ?? 'http://127.0.0.1:5173') + '/package.json');
  for (const fixture of cases) {
    const result = await page.evaluate(async fixture => {
      const { Synth } = await import('/src/audio/synth.ts');
      const { AdaptiveScore } = await import('/src/audio/score.ts');
      const { mulberry32 } = await import('/src/core/rng.ts');
      const rate = 24000, context = new OfflineAudioContext(2, rate * fixture.seconds, rate);
      const oldRandom = Math.random;
      let globalDraws = 0;
      Math.random = () => { globalDraws++; return 0.5; };
      try {
        let nodes = 0;
        for (const key of ['createOscillator', 'createGain', 'createBiquadFilter', 'createBufferSource', 'createStereoPanner']) {
          const create = context[key].bind(context);
          context[key] = (...args) => { nodes++; return create(...args); };
        }
        const synth = new Synth(context, mulberry32(1776));
        const out = context.createGain(); out.gain.value = 0.8; out.connect(context.destination);
        const reverb = context.createConvolver(); reverb.buffer = synth.impulse(2.6, 2.4);
        const wet = context.createGain(); wet.gain.value = 0.352; reverb.connect(wet).connect(context.destination);
        const score = new AdaptiveScore(synth, out, reverb);
        if (fixture.isolate) {
          score.piano.bus.disconnect();
          for (const stem of ['porch', 'muzak', 'country', 'tension', 'jingle']) if (stem !== fixture.isolate) score[stem].disconnect();
        }
        const notes = [], bars = [], ads = [], weights = [];
        score.onNote = (stem, midi, key, time) => notes.push({ stem, midi, key, time });
        const pianoNote = score.piano.note.bind(score.piano);
        score.piano.note = (time, midi, velocity, duration) => {
          notes.push({ stem: 'piano', midi, key: score.piano.key, time });
          pianoNote(time, midi, velocity, duration);
        };
        const schedule = score.piano.onBar;
        score.piano.onBar = bar => { bars.push({ time: bar.time, bpm: 60 / bar.beat, key: bar.key }); schedule(bar); };
        score.onRadioAd = text => ads.push({ time: context.currentTime, text });
        let offBarNodes = 0, index = 0;
        const sweep = [
          { population: 0 }, { population: 350 }, { population: 1800 }, { population: 6500 },
          { population: 6500, moneyTrouble: 1, flowEma: 0.1, disaster: 0.8 },
          { population: 6500, night: 1, season: 'winter' },
        ];
        const tick = () => {
          const time = context.currentTime, state = fixture.sweep ? sweep[Math.min(5, Math.floor(time / 20))] : fixture;
          score.piano.enabled = !(fixture.mute && time >= 15 && time < 30);
          const before = nodes, beforeBars = bars.length;
          score.update(0.1, state.night ?? 0, state);
          if (beforeBars === bars.length) offBarNodes += nodes - before;
          if (index++ % 10 === 0) weights.push({ time, ...score.weights, bpm: score.tempo,
            gains: { piano: score.piano.bus.gain.value / (score.piano.volume * 0.32), porch: score.porch.gain.value,
              muzak: score.muzak.gain.value, country: score.country.gain.value, tension: score.tension.gain.value } });
        };
        tick();
        for (let time = 0.1; time < fixture.seconds - 0.05; time += 0.1) context.suspend(time).then(() => { tick(); context.resume(); });
        const sample = await context.startRendering(), left = sample.getChannelData(0), right = sample.getChannelData(1);
        const pcm = new Uint8Array(left.length * 4), view = new DataView(pcm.buffer), rms = [];
        let peak = 0, step = 0, sum = 0;
        for (let i = 0; i < left.length; i++) {
          peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
          if (i) step = Math.max(step, Math.abs(left[i] - left[i - 1]), Math.abs(right[i] - right[i - 1]));
          sum += (left[i] ** 2 + right[i] ** 2) / 2;
          if ((i + 1) % rate === 0) { rms.push(Math.sqrt(sum / rate)); sum = 0; }
          view.setInt16(i * 4, Math.round(Math.max(-1, Math.min(1, left[i])) * 32767), true);
          view.setInt16(i * 4 + 2, Math.round(Math.max(-1, Math.min(1, right[i])) * 32767), true);
        }
        let binary = '';
        for (let i = 0; i < pcm.length; i += 8192) binary += String.fromCharCode(...pcm.subarray(i, i + 8192));
        const counts = {};
        for (const note of notes) counts[note.stem] = (counts[note.stem] ?? 0) + 1;
        const major = [0, 2, 4, 5, 7, 9, 11];
        const offKey = notes.filter(n => !major.includes(((n.midi - n.key) % 12 + 12) % 12));
        return { seconds: fixture.seconds, pcm: btoa(binary), peak, maxSampleStep: step, rms, weights, bars, ads, notes: counts,
          offKey, noteSequence: JSON.stringify(notes), lowest: Math.min(...notes.map(n => n.midi)), offBarNodes, globalDraws, nodes };
      } finally { Math.random = oldRandom; }
    }, fixture);
    const pcm = Buffer.from(result.pcm, 'base64'); delete result.pcm;
    result.sha256 = createHash('sha256').update(pcm).digest('hex');
    result.noteSequenceSha256 = createHash('sha256').update(result.noteSequence).digest('hex'); delete result.noteSequence;
    if (fixture.name === 'country') countryPcm = pcm;
    if (fixture.name === 'country-repeat') {
      let changedSamples = 0, maxPcmDelta = 0;
      for (let i = 0; i < pcm.length; i += 2) {
        const delta = Math.abs(pcm.readInt16LE(i) - countryPcm.readInt16LE(i));
        if (delta) changedSamples++;
        maxPcmDelta = Math.max(maxPcmDelta, delta);
      }
      report.repeat = { changedSamples, totalSamples: pcm.length / 2, maxPcmDelta };
    }
    if (fixture.name !== 'country-repeat') {
      const header = Buffer.alloc(44);
      header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVEfmt ', 8);
      header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(2, 22);
      header.writeUInt32LE(24000, 24); header.writeUInt32LE(96000, 28); header.writeUInt16LE(4, 32); header.writeUInt16LE(16, 34);
      header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
      const file = `${output}/${fixture.name}.wav`;
      writeFileSync(file, Buffer.concat([header, pcm]));
      const scan = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=peak=true:framelog=quiet', '-f', 'null', '-'], { encoding: 'utf8', windowsHide: true });
      if (!scan.error && scan.status === 0) {
        const summary = scan.stderr.slice(scan.stderr.lastIndexOf('Summary:'));
        result.lufs = Number(summary.match(/I:\s*(-?[\d.]+) LUFS/)?.[1]);
        result.truePeakDbfs = Number(summary.match(/True peak:\s*Peak:\s*(-?[\d.]+) dBFS/)?.[1]);
      }
    }
    report.cases.push({ name: fixture.name, ...result });
    console.log(fixture.name, JSON.stringify({ peak: result.peak, step: result.maxSampleStep, lufs: result.lufs, notes: result.notes,
      offKey: result.offKey.length, nodesOffBar: result.offBarNodes, globalDraws: result.globalDraws, ads: result.ads.length }));
  }
  const byName = Object.fromEntries(report.cases.map(c => [c.name, c]));
  const casesPass = report.cases.every(c => c.peak > 0.001 && c.peak < 0.5 && c.maxSampleStep < 0.04 && !c.offKey.length && c.lowest >= 36 &&
    c.offBarNodes === 0 && c.globalDraws === 0 && c.bars.every(b => b.bpm >= 48 && b.bpm <= 100));
  report.repeat.sameNoteSequence = byName.country.noteSequenceSha256 === byName['country-repeat'].noteSequenceSha256;
  report.passed = casesPass && report.repeat.sameNoteSequence && report.repeat.maxPcmDelta <= 1 && byName.jingle.ads.length > 0 &&
    byName['winter-night'].notes.banjo < byName.porch.notes.banjo && byName.mute.rms.slice(25, 30).every(r => r < 0.00001) &&
    byName.sweep.weights.some(w => w.porch === 1) && byName.sweep.weights.some(w => w.muzak === 1) && byName.sweep.weights.some(w => w.country === 1) &&
    byName.sweep.weights.some(w => w.tension >= 0.8);
  const figure = await page.evaluate(sweep => {
    const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 650;
    const ctx = canvas.getContext('2d'), left = 70, width = 1080;
    ctx.fillStyle = '#111722'; ctx.fillRect(0, 0, 1200, 650);
    ctx.fillStyle = '#edf0f7'; ctx.font = '23px sans-serif'; ctx.fillText('Procedural score / population and stress sweep', left, 38);
    const labels = ['Empty valley', '350 people', '1,800 people', '6,500 people', 'Money / jam / disaster', 'Winter night'];
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = i % 2 ? '#1b2533' : '#151d29'; ctx.fillRect(left + i * width / 6, 74, width / 6, 480);
      ctx.fillStyle = '#c8d1e2'; ctx.font = '12px sans-serif'; ctx.fillText(labels[i], left + i * width / 6 + 7, 94);
    }
    const colors = { piano: '#e9d4a6', porch: '#77d8a4', muzak: '#6cb8ff', country: '#f5ad70', tension: '#e97eaa' };
    let legend = left;
    for (const [name, color] of Object.entries(colors)) {
      ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.beginPath();
      sweep.weights.forEach((sample, i) => {
        const x = left + sample.time / 120 * width, y = 330 - sample.gains[name] * 200;
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }); ctx.stroke();
      ctx.fillStyle = color; ctx.font = '15px sans-serif'; ctx.fillText(name, legend, 380); legend += 150;
    }
    ctx.fillStyle = '#aeb9cb'; ctx.font = '12px sans-serif';
    ctx.fillText('1.0', 35, 134); ctx.fillText('0.0', 35, 334); ctx.fillText('Smoothed layer gain', left, 116);
    ctx.fillText('RMS per second / linear amplitude', left, 420);
    ctx.strokeStyle = '#c7d7ee'; ctx.lineWidth = 2; ctx.beginPath();
    const max = Math.max(...sweep.rms) * 1.1;
    ctx.fillText(max.toFixed(4), 18, 444); ctx.fillText('0', 45, 554);
    sweep.rms.forEach((rms, i) => {
      const x = left + i / 120 * width, y = 550 - rms / max * 110;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }); ctx.stroke();
    for (let t = 0; t <= 120; t += 20) { ctx.fillStyle = '#c8d1e2'; ctx.fillText(`${t}s`, left + t / 120 * width - 7, 579); }
    ctx.fillStyle = '#aeb9cb'; ctx.fillText('Original synthesis / common bar clock / seeded note choices / pre-master-compressor render', left, 620);
    return canvas.toDataURL('image/png').split(',')[1];
  }, byName.sweep);
  writeFileSync(`${output}/sweep.png`, Buffer.from(figure, 'base64'));
  saveReport(`${output}/report.json`, report);
  console.log('acceptance', JSON.stringify({ passed: report.passed, repeat: report.repeat }));
  if (!report.passed) process.exitCode = 1;
} finally { await browser.close(); }
