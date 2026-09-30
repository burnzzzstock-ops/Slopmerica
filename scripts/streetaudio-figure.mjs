// Spectrogram figure for docs/cars-look/audio.md: what the street sounds like, drawn from the same offline renders that
// scripts/streetaudio.mjs measures. New code: a Doppler pass, three engines side by side, a siren pass, rain hiss, and a
// jam with its honks. Old code (BASE_URL=http://127.0.0.1:5175): the same panels from the only thing the old ambience can
// do, one aggregate traffic level (a bed plus random honks and pass-bys), so every "scene" comes out the same.
// usage: scripts/withslot.sh env BASE_URL=... node scripts/streetaudio-figure.mjs docs/screenshots/cars-look/audio-spectrograms-after.jpg
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';
import { installLab } from './lib/streetlab.mjs';

const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const out = process.argv[2] || 'shots/tmp/streetaudio-spectrograms.jpg';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(`${base}/package.json`, { waitUntil: 'load' });
const mode = await page.evaluate(installLab);

const jpeg = await page.evaluate(async (mode) => {
  const A = __lab.A;
  const W = 1280, H = mode === 'new' ? 1170 : 600;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = '#12151c'; g.fillRect(0, 0, W, H);
  // colour map: dark blue -> purple -> orange -> pale yellow
  const stops = [[0, [10, 12, 40]], [0.35, [70, 30, 120]], [0.65, [200, 70, 60]], [0.85, [250, 170, 40]], [1, [255, 250, 200]]];
  const color = (t) => { t = Math.max(0, Math.min(1, t)); for (let i = 1; i < stops.length; i++) if (t <= stops[i][0]) { const a = stops[i - 1], b = stops[i], f = (t - a[0]) / (b[0] - a[0]); return a[1].map((v, k) => Math.round(v + f * (b[1][k] - v))); } return stops[stops.length - 1][1]; };
  const LO = -35, HI = 30;
  const label = (s, x, y, size = 15, col = '#e8e6df') => { g.fillStyle = col; g.font = `${size}px sans-serif`; g.fillText(s, x, y); };
  const panel = (x, y, w, h, x0, secs, fmax, title, note, ch = 'M', rate = 22050, N = 1024, hop = 256) => {
    const sig = A.seg(ch, x0, x0 + secs), img = A.spectrogram(sig, rate, N, hop, fmax);
    const id = g.createImageData(w, h);
    for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
      const c = Math.min(img.cols - 1, Math.floor((px / w) * img.cols)), r = Math.min(img.rows - 1, Math.floor((1 - py / h) * img.rows));
      const col = color((img.data[c * img.rows + r] - LO) / (HI - LO));
      const o = (py * w + px) * 4; id.data[o] = col[0]; id.data[o + 1] = col[1]; id.data[o + 2] = col[2]; id.data[o + 3] = 255;
    }
    g.putImageData(id, x, y);
    g.strokeStyle = '#3a4050'; g.strokeRect(x + 0.5, y + 0.5, w, h);
    label(title, x, y - 18, 15); label(note, x, y - 3, 12, '#a9b0bf');
    // axes: kHz on the left, seconds below
    for (let k = 1; k * 1000 < fmax; k++) { const yy = y + h - (k * 1000 / fmax) * h; g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(x, yy, 6, 1); if (w > 300 || k % 2 === 0) label(`${k}k`, x + 8, yy + 4, 10, '#c9ccd6'); }
    for (let s = 0; s <= secs + 1e-6; s += secs > 10 ? 10 : secs > 4 ? 2 : 1) { const xx = x + (s / secs) * w; g.fillStyle = 'rgba(255,255,255,0.3)'; g.fillRect(xx, y + h - 5, 1, 5); label(`${+s.toFixed(1)}s`, Math.min(xx + 2, x + w - 22), y + h + 12, 10, '#a9b0bf'); }
  };
  label(mode === 'new' ? 'Street sound after: voices follow the real cars (spectrograms, dB, same colour scale in every panel)' : 'Street sound before: one traffic bed scaled by the car count, random honks and pass-bys (same scale)', 20, 26, 18, '#ffffff');
  const view = { x: 0, y: 2, z: 0, rx: 1, rz: 0, dist: 60 };
  void view;
  if (mode === 'new') {
    // A. Doppler pass
    await __lab.render({ dur: 6, rate: 22050, seed: 3, only: 'engine', cars: [{ id: 1, kind: 'cyberslop', x: 10, z: -90, yaw: 0, vs: [[0, 30]] }] });
    panel(50, 90, 1180, 170, 0, 6, 5000, 'Doppler: a Cyberslop passing at 30 m/s, 10 m off the ears', 'the motor whine slides down as the car goes by (2.9 kHz approaching, 2.5 kHz receding); the road roar swells and fades with distance');
    // B. engines side by side
    const kinds = [['semi', 'Semi'], ['motorcycle', 'Motorcycle'], ['cyberslop', 'Cyberslop'], ['liftedTruck', 'Lifted truck']];
    for (let i = 0; i < kinds.length; i++) {
      await __lab.render({ dur: 2.2, rate: 22050, seed: 5, only: 'engine', cars: [{ id: 1, kind: kinds[i][0], x: 15, z: -14, yaw: 0, vs: [[0, 13]] }] });
      panel(50 + i * 300, 320, 280, 150, 0.1, 2, 5000, kinds[i][1], '13 m/s, 15 m away');
    }
    // C. siren pass
    await __lab.render({ dur: 8.5, rate: 44100, seed: 4, sirenPhase: 0.5, only: 'siren', cars: [{ id: 50, kind: 'ambulance', x: -125, z: 15, yaw: Math.PI / 2, vs: [[0, 30]] }] });
    panel(50, 530, 1180, 150, 0, 8.5, 2500, 'Ambulance siren, hi-lo, passing at 30 m/s', 'two tones, both shifted up approaching and down receding; level peaks at the closest point', 'M', 44100, 2048, 512);
    // pan trace: right minus left over time
    {
      const L = A.last.L, R = A.last.R, r = A.last.rate, x0 = 50, w = 1180, y0 = 700, h = 26;
      g.fillStyle = '#1b2029'; g.fillRect(x0, y0, w, h);
      for (let px = 0; px < w; px += 2) { const t0 = (px / w) * 8.5, i0 = Math.floor(t0 * r), n = Math.floor(0.05 * r); let el = 0, er = 0; for (let i = 0; i < n; i++) { el += L[i0 + i] ** 2; er += R[i0 + i] ** 2; } const pan = (Math.sqrt(er) - Math.sqrt(el)) / (Math.sqrt(er) + Math.sqrt(el) + 1e-9); g.fillStyle = pan < 0 ? '#5aa2ff' : '#ff9a4a'; g.fillRect(x0 + px, y0 + h / 2, 2, -pan * (h / 2)); }
      label('pan (blue = left, orange = right)', x0 + 6, y0 + h + 13, 10, '#a9b0bf');
    }
    // D. rain
    for (let i = 0; i < 2; i++) {
      await __lab.render({ dur: 2.2, rate: 22050, seed: 8, only: 'engine', env: i ? { wet: 1, rain: 1 } : { wet: 0, rain: 0 }, cars: [{ id: 1, kind: 'sedan', x: 12, z: -14, yaw: 0, vs: [[0, 13]] }] });
      panel(50 + i * 610, 780, 570, 130, 0.1, 2, 10000, i ? 'Sedan on a wet road in rain' : 'Sedan on a dry road', '13 m/s, 12 m away; 3.5-9 kHz is the tyre hiss');
    }
    // E. honks: a queue vs free flow, horn bus only (60 s each)
    const jam = []; let zq = -40;
    const jk = ['sedan', 'suv', 'pickup', 'semi', 'sedan', 'minivan', 'hatchback', 'liftedTruck', 'sedan', 'cityBus'], jl = { semi: 16, cityBus: 12, pickup: 5.8, liftedTruck: 6, minivan: 5.1, suv: 4.9, sedan: 4.6, hatchback: 4 };
    for (let i = 0; i < 10; i++) { const kind = jk[i], len = jl[kind]; if (i) zq += 0.5 * (jl[jk[i - 1]] + len) + 2; jam.push({ id: 100 + i, kind, x: 10, z: zq, yaw: 0, vs: [[0, 0]], len }); }
    const flow = Array.from({ length: 14 }, (_, i) => ({ id: 1 + i, kind: ['sedan', 'suv', 'pickup', 'hatchback', 'semi', 'motorcycle'][i % 6], x: i % 2 ? -10 : 10, z: -190 + (380 / 14) * i, yaw: i % 2 ? 0 : Math.PI, vs: [[0, 13]], wrap: [-200, 200] }));
    for (let i = 0; i < 2; i++) {
      const o = await __lab.render({ dur: 60, rate: 22050, seed: 7, only: 'horn', cars: i ? flow : [...jam, ...flow.slice(0, 6)] });
      panel(50 + i * 610, 1010, 570, 110, 0, 60, 1500, i ? '14 free-flowing cars: no honks' : `10 cars waiting in a queue: ${o.stats.honks} honks in 60 s`, 'horn bus only; each horn is a pair of lines near 415 and 523 Hz (a semi and a truck use lower chords)', 'M', 22050, 2048, 1024);
    }
    label('Nobody honks in the first 6 s of waiting; two cars at a light never do; the rate climbs with the size of the queue (scripts/streetaudio.mjs).', 50, 1150, 12, '#c9ccd6');
  } else {
    // old: the ambience takes only SoundMix. Same "scene" twice, and 60 s of random honks.
    const oldRender = async (seed, secs) => {
      const rate = 22050, ctx = new OfflineAudioContext(1, rate * secs, rate);
      const horns = [], co = ctx.createOscillator.bind(ctx);
      ctx.createOscillator = () => { const o = co(); const sf = o.frequency.setValueAtTime.bind(o.frequency); o.frequency.setValueAtTime = (f, t) => { if (o.type === 'sawtooth' && f > 330 && f < 650) horns.push(t); return sf(f, t); }; return o; };
      const s = new __lab.Synth(ctx), bus = ctx.createGain(); bus.connect(ctx.destination);
      const amb = new __lab.Ambience(s, bus, bus);
      const mix = { zoom: 0.1, nature: 0, water: 0, traffic: 0.6, construction: 0, people: 0, night: 0, weather: 'clear', weatherIntensity: 0, season: 'summer' };
      for (let t = 0; t < secs; t += 0.05) amb.update(0.05, mix);
      const buf = await ctx.startRendering();
      A.last = { L: buf.getChannelData(0), R: buf.getChannelData(0), rate };
      return horns;
    };
    let horns = await oldRender(1, 60);
    panel(50, 90, 1180, 170, 0, 60, 5000, 'Old: 60 s of "traffic 0.6" (what a jam and free flow both look like to the old code)', 'a brown-noise bed under 240 Hz, random band-passed pass-by sweeps, and random horn blasts (yellow ticks)', 'M', 22050, 2048, 1024);
    g.fillStyle = '#ffd84a';
    const uniq = []; for (const t of horns.sort((a, b) => a - b)) if (!uniq.length || t - uniq[uniq.length - 1] > 0.5) uniq.push(t);
    for (const t of uniq) { const xx = 50 + (t / 60) * 1180; g.fillRect(xx, 264, 2, 12); }
    label(`${uniq.length} random honks in 60 s, jam or no jam`, 50, 292, 12, '#ffd84a');
    for (const [i, name] of [[0, 'Old: "semi passes"'], [1, 'Old: "motorcycle passes"']]) {
      await oldRender(10 + i, 4);
      panel(50 + i * 610, 350, 570, 150, 0, 4, 5000, name, 'the ambience takes no vehicle kind: the same bed either way');
    }
    label('No Doppler, no engines by kind, no queue-driven honks, no siren on the fire truck, no wet-road hiss.', 50, 540, 15, '#c9ccd6');
  }
  return cv.toDataURL('image/jpeg', 0.85);
}, mode);
writeFileSync(out, Buffer.from(jpeg.split(',')[1], 'base64'));
console.log(`wrote ${out} (${mode} code)`);
if (errs.length) console.log('page errors', errs.slice(0, 3));
await browser.close();
process.exit(errs.length ? 1 : 0);
