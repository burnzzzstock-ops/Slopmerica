// BASE_URL serves the audio modules. Fixed camera/field fixtures render through
// the actual Ambience class. FFmpeg, when installed, measures EBU R128 loudness.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { launch } from '../lib/browser.mjs';
import { installLab } from '../lib/streetlab.mjs';
import { saveReport } from './measure.mjs';
const tag = process.env.TAG ?? 'current';
const output = `shots/audio/${tag}`;
mkdirSync(output, { recursive: true });
const browser = await launch({ gl: false });
const captured = process.env.MIX_FILE ? JSON.parse(readFileSync(process.env.MIX_FILE, 'utf8')) : null;
const cases = captured ? captured.cases.map(c => ({ name: c.name, ...c.mix })) : [
  { name: 'pristine', nature: 1, pollution: 0, water: 1, traffic: 0, people: 0, construction: 0 },
  { name: 'paved', nature: 0.08, pollution: 0.9, water: 0.2, traffic: 0.9, people: 0.8, construction: 0.4 },
  { name: 'polluted', nature: 1, pollution: 1, water: 1, traffic: 0, people: 0, construction: 0 },
  { name: 'coast', map: 'norcal', nature: 0.9, pollution: 0, water: 1, surf: 1, traffic: 0, people: 0, construction: 0,
    sources: [{ kind: 'seagull', level: 0.8, pan: -0.6, speed: 0 }, { kind: 'seaLion', level: 0.8, pan: 0.6, speed: 0 }, { kind: 'fishingBoat', level: 0.7, pan: 0.3, speed: 5 }] },
  { name: 'boat', seconds: 5, actorsOnly: true, sources: [{ kind: 'bassBoat', level: 1, pan: 0.7, speed: 8 }] },
  { name: 'boat-paused', seconds: 5, actorsOnly: true, speed: 0, sources: [{ kind: 'bassBoat', level: 1, pan: 0.7, speed: 8 }] },
  { name: 'actor-caps', seconds: 5, actorsOnly: true, forceCalls: true, sources: Array.from({ length: 8 }, (_, i) => ({ kind: ['alligator', 'seaLion', 'seagull'][i % 3], level: 1, pan: i / 7 - 0.5, speed: 0 })) },
  { name: 'clearing', seconds: 8, actorsOnly: true, nature: 0, clearing: 1 },
];
const report = { tag, seed: 1776, camera: captured?.cases[0].camera ?? { target: [0, 0, 0], distance: 120, yaw: 0 }, source: captured ? process.env.MIX_FILE : 'controlled field fixtures', cases: [] };
try {
  const page = await browser.newPage();
  await page.goto((process.env.BASE_URL ?? 'http://127.0.0.1:5173') + '/package.json');
  await page.evaluate(installLab);
  for (const fixture of cases) {
    const result = await page.evaluate(async fixture => {
      const { Synth, Ambience, A, mulberry32 } = window.__lab;
      const rate = 24000, seconds = fixture.seconds ?? 30;
      const random = mulberry32(1776), oldRandom = Math.random;
      let globalDraws = 0;
      Math.random = () => { globalDraws++; return random(); };
      try {
        const context = new OfflineAudioContext(2, rate * seconds, rate);
        let nodes = 0;
        for (const key of ['createOscillator', 'createGain', 'createBiquadFilter', 'createBufferSource', 'createStereoPanner']) {
          const create = context[key].bind(context);
          context[key] = (...args) => { nodes++; return create(...args); };
        }
        const synth = new Synth(context, random);
        const out = context.createGain(); out.gain.value = 0.64; out.connect(context.destination);
        const reverb = context.createConvolver(); reverb.buffer = synth.impulse(2.6, 2.4);
        const reverbGain = context.createGain(); reverbGain.gain.value = 0.352;
        reverb.connect(reverbGain).connect(context.destination);
        const ambience = new Ambience(synth, out, reverb);
        ambience.randomTraffic = false;
        ambience.mapId = fixture.map ?? 'appalachia';
        const events = {};
        for (const key of Object.keys(ambience.voices)) {
          const voice = ambience.voices[key];
          ambience.voices[key] = (...args) => { events[key] = (events[key] ?? 0) + 1; return voice(...args); };
        }
        if (fixture.actorsOnly) for (const key of ['wind', 'windHi', 'rainHiss', 'rainDrum', 'creek', 'traffic', 'cicada', 'crowd', 'surf']) ambience[key]?.disconnect();
        if (fixture.forceCalls) ambience.chance = rate => rate > 0;
        const mix = { zoom: 0.08, nature: 0, water: 0, traffic: 0, construction: 0, people: 0, night: 0, weather: 'clear', weatherIntensity: 0, season: 'summer', speed: 1, ...fixture };
        const nodesBuilt = nodes;
        let maxPhrases = 0;
        const tick = () => {
          ambience.update(0.1, mix);
          maxPhrases = Math.max(maxPhrases, Array.from(ambience.callEnds ?? []).filter(t => t > context.currentTime).length);
        };
        tick();
        for (let t = 0.1; t < seconds - 0.05; t += 0.1) context.suspend(t).then(() => { tick(); context.resume(); });
        const sample = await context.startRendering();
        const left = sample.getChannelData(0), right = sample.getChannelData(1), mono = new Float32Array(left.length);
        let peak = 0, squares = 0, leftPower = 0, rightPower = 0;
        const pcm = new Uint8Array(left.length * 4), view = new DataView(pcm.buffer);
        for (let i = 0; i < left.length; i++) {
          mono[i] = (left[i] + right[i]) * 0.5;
          peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
          squares += left[i] ** 2 + right[i] ** 2;
          leftPower += left[i] ** 2; rightPower += right[i] ** 2;
          view.setInt16(i * 4, Math.round(Math.max(-1, Math.min(1, left[i])) * 32767), true);
          view.setInt16(i * 4 + 2, Math.round(Math.max(-1, Math.min(1, right[i])) * 32767), true);
        }
        const spectrum = A.psd(mono.subarray(rate * 2));
        if (fixture.name === 'pristine' || fixture.name === 'paved') {
          window.__soundscapePanels ??= [];
          window.__soundscapePanels.push({ name: fixture.name, image: A.spectrogram(mono, rate, 1024, 512, 8000) });
        }
        let binary = '';
        for (let i = 0; i < pcm.length; i += 8192) binary += String.fromCharCode(...pcm.subarray(i, i + 8192));
        const birds = ['sparrow', 'cardinal', 'robin', 'thrush', 'chickadee', 'crow', 'gull'].reduce((sum, name) => sum + (events[name] ?? 0), 0);
        return { seconds, rate, pcm: btoa(binary), peak, rms: Math.sqrt(squares / (left.length * 2)), centroidHz: A.centroid(spectrum, rate, 40, 10000),
          low250Share: A.lowShare(spectrum, rate, 250), high2000Share: peak > 0 ? 1 - A.lowShare(spectrum, rate, 2000) : 0, events, birds,
          eventsPerMinute: Object.values(events).reduce((sum, n) => sum + n, 0) * 60 / seconds, nodesBuilt, nodesAfter: nodes, maxPhrases, globalDraws,
          rightShare: rightPower / Math.max(1e-30, leftPower + rightPower) };
      } finally { Math.random = oldRandom; }
    }, fixture);
    const pcm = Buffer.from(result.pcm, 'base64');
    delete result.pcm;
    const header = Buffer.alloc(44);
    header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVEfmt ', 8);
    header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(2, 22);
    header.writeUInt32LE(result.rate, 24); header.writeUInt32LE(result.rate * 4, 28); header.writeUInt16LE(4, 32); header.writeUInt16LE(16, 34);
    header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
    const file = `${output}/${fixture.name}.wav`;
    writeFileSync(file, Buffer.concat([header, pcm]));
    const scan = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=peak=true:framelog=quiet', '-f', 'null', '-'], { encoding: 'utf8', windowsHide: true });
    if (!scan.error && scan.status === 0) {
      const summary = scan.stderr.slice(scan.stderr.lastIndexOf('Summary:'));
      writeFileSync(`${output}/${fixture.name}-loudness.txt`, summary);
      result.lufs = Number(summary.match(/I:\s*(-?[\d.]+) LUFS/)?.[1]);
      result.truePeakDbfs = Number(summary.match(/True peak:\s*Peak:\s*(-?[\d.]+) dBFS/)?.[1]);
    }
    report.cases.push({ name: fixture.name, ...result });
    console.log(fixture.name, JSON.stringify(result));
  }
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 1100; canvas.height = 650;
    const context = canvas.getContext('2d');
    context.fillStyle = '#12151c'; context.fillRect(0, 0, 1100, 650);
    context.fillStyle = '#eee'; context.font = '20px sans-serif'; context.fillText('Same camera and seed / 30-second soundscape', 40, 32);
    const stops = [[10, 12, 40], [70, 30, 120], [200, 70, 60], [250, 170, 40], [255, 250, 200]];
    for (let row = 0; row < 2; row++) {
      const panel = window.__soundscapePanels[row], image = panel.image;
      const width = 1000, height = 235, x = 60, y = 85 + row * 285, pixels = context.createImageData(width, height);
      for (let py = 0; py < height; py++) for (let px = 0; px < width; px++) {
        const c = Math.min(image.cols - 1, Math.floor(px / width * image.cols));
        const r = Math.min(image.rows - 1, Math.floor((1 - py / height) * image.rows));
        const value = Math.max(0, Math.min(3.999, (image.data[c * image.rows + r] + 45) / 65 * 4));
        const k = Math.floor(value), fraction = value - k, at = (py * width + px) * 4;
        for (let channel = 0; channel < 3; channel++) pixels.data[at + channel] = stops[k][channel] * (1 - fraction) + stops[k + 1][channel] * fraction;
        pixels.data[at + 3] = 255;
      }
      context.putImageData(pixels, x, y);
      context.fillStyle = '#eee'; context.font = '17px sans-serif'; context.fillText(panel.name, x, y - 15);
      context.font = '12px sans-serif';
      for (const frequency of [0, 2, 4, 6, 8]) context.fillText(`${frequency}k`, 25, y + height - frequency / 8 * height + 4);
      for (const second of [0, 10, 20, 30]) context.fillText(`${second}s`, x + second / 30 * width - 7, y + height + 18);
    }
    context.fillStyle = '#b9c0ce'; context.font = '12px sans-serif';
    context.fillText('Identical FFT colour scale in both panels / blue is quieter, yellow is louder', 60, 637);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  writeFileSync(`${output}/spectrum.png`, Buffer.from(png, 'base64'));
  const [pristine, paved, polluted, coast, boat, paused, caps, clearing] = report.cases;
  const bounded = report.cases.every(c => Number.isFinite(c.peak) && c.peak < 0.98 && c.maxPhrases <= 8 && c.globalDraws === 0);
  report.passed = captured
    ? bounded && captured.passed && paved.low250Share > pristine.low250Share + 0.15 && paved.birds < pristine.birds
    : bounded && pristine.birds >= polluted.birds * 2 + 3 && pristine.birds >= paved.birds * 2 + 3 && paved.low250Share > pristine.low250Share + 0.15 &&
      (coast.events.seaLion ?? 0) > 0 && boat.rms > 0.001 && boat.rightShare > 0.75 && boat.nodesBuilt === boat.nodesAfter && paused.rms === 0 && caps.maxPhrases === 8 && (clearing.events.chainsaw ?? 0) > 0;
  saveReport(`${output}/report.json`, report);
  if (!report.passed) process.exitCode = 1;
} finally { await browser.close(); }
