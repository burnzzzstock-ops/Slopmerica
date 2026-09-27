// Ambience without the chug: "it constantly sounds like a train chugging".
// The noise loops were 3 s long with a seam that jumped (a thump every 3 s
// in the low traffic rumble), and the creek and crowd beds were noise pulsed
// by steady sine waves (3.7 Hz, 1.3 Hz). Renders the ambience offline and
// checks the loop seams, and that the loudness has no steady rhythm.
// Exits nonzero on failure.
import { chromium } from 'playwright-core';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(`${base}/`, { waitUntil: 'load' });
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra)); if (!ok) bad++; };

const r = await page.evaluate(async () => {
  const { Synth } = await import('/src/audio/synth.ts');
  const { Ambience } = await import('/src/audio/ambience.ts');
  const out = {};
  // 1. loop seams: the wrap-around step against the typical step
  const ctx0 = new OfflineAudioContext(1, 44100, 44100);
  const s0 = new Synth(ctx0);
  for (const color of ['white', 'pink', 'brown']) {
    const d = s0.noise(color).getChannelData(0);
    const steps = [];
    for (let i = 1; i < d.length; i += 97) steps.push(Math.abs(d[i] - d[i - 1]));
    steps.sort((a, b) => a - b);
    const typical = steps[Math.floor(steps.length * 0.99)];
    let mean = 0; for (let i = 0; i < d.length; i++) mean += d[i];
    out[color] = { seconds: +(d.length / 44100).toFixed(1), seam: +(Math.abs(d[0] - d[d.length - 1]) / typical).toFixed(2), mean: +(mean / d.length).toFixed(4) };
  }
  // 2. the beds a town hears most (no water here, a busy town, near zoom), 16 s
  const rate = 22050, secs = 16;
  const ctx = new OfflineAudioContext(1, rate * secs, rate);
  const s = new Synth(ctx);
  const bus = ctx.createGain(); bus.connect(ctx.destination);
  const amb = new Ambience(s, bus, bus);
  // beds only: no random one-shots (birds, honks) in the measurement
  amb.chance = () => false;
  const mix = { zoom: 0.15, nature: 1, water: 0, traffic: 0.6, construction: 0.5, people: 0.8, night: 0, weather: 'clear', weatherIntensity: 0, season: 'summer' };
  amb.update(0.1, mix);
  const buf = await ctx.startRendering();
  const x = buf.getChannelData(0);
  // loudness in 25 ms frames after the beds settle, then how strongly it repeats
  const win = Math.floor(rate * 0.025), env = [];
  for (let i = rate * 2; i + win < x.length; i += win) { let e = 0; for (let k = 0; k < win; k++) e += x[i + k] * x[i + k]; env.push(Math.sqrt(e / win)); }
  const m = env.reduce((a, b) => a + b, 0) / env.length;
  const v = env.map((e) => e - m);
  const den = v.reduce((a, b) => a + b * b, 0);
  let peak = 0, at = 0;
  for (let lag = 6; lag < 160; lag++) { let c = 0; for (let i = 0; i + lag < v.length; i++) c += v[i] * v[i + lag]; c /= den; if (c > peak) { peak = c; at = lag; } }
  out.rhythm = { peak: +peak.toFixed(3), atSeconds: +(at * 0.025).toFixed(2), level: +m.toFixed(4) };
  return out;
});
console.log(JSON.stringify(r));
for (const c of ['white', 'pink', 'brown']) {
  check(`${c} noise loops every ${r[c].seconds} s, not 3`, r[c].seconds >= 8, r[c]);
  check(`${c} noise wraps around without a jump (${r[c].seam}x a typical step)`, r[c].seam < 1.5, r[c]);
}
check(`brown noise has no offset to thump at the seam (${r.brown.mean})`, Math.abs(r.brown.mean) < 0.01, r.brown);
check(`a busy town's ambience has no steady beat (strongest repeat ${r.rhythm.peak} at ${r.rhythm.atSeconds} s)`, r.rhythm.peak < 0.35, r.rhythm);
check('no page errors', errs.length === 0, errs.slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
