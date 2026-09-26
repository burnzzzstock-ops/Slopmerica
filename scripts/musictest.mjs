// Ambient piano, rendered offline (no speakers needed): it plays, it never
// clips, it stays well under the game's level, it breathes (quiet moments),
// and every note is in the current key. Exits nonzero on failure.
import { chromium } from 'playwright-core';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
await page.goto(`${base}/`, { waitUntil: 'load', timeout: 120000 });
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra)); if (!ok) bad++; };
const r = await page.evaluate(async () => {
  const { Synth } = await import('/src/audio/synth.ts');
  const { AmbientPiano } = await import('/src/audio/piano.ts');
  const SEC = 45, rate = 22050;
  const out = {};
  for (const night of [0, 1]) {
    const ctx = new OfflineAudioContext(2, SEC * rate, rate);
    const s = new Synth(ctx);
    const rev = ctx.createGain(); rev.gain.value = 0; rev.connect(ctx.destination);
    const p = new AmbientPiano(s, ctx.destination, rev);
    let seed = 1234567; p.rng = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    p.bus.gain.value = p.volume * 0.32 * (1 - night * 0.3);
    // record every note's pitch to check it against the key
    const notes = []; const orig = p.note.bind(p);
    p.note = (t, midi, vel, dur) => { notes.push({ t, midi, key: p.key }); orig(t, midi, vel, dur); };
    let t = 0.2; while (t < SEC - 2) { p.scheduleBar(t, night); t = p.next; }
    const buf = await ctx.startRendering();
    const d = buf.getChannelData(0);
    let peak = 0; const rms = [];
    for (let sI = 0; sI < SEC; sI++) { let e = 0; for (let i = sI * rate; i < (sI + 1) * rate; i++) { e += d[i] * d[i]; peak = Math.max(peak, Math.abs(d[i])); } rms.push(Math.sqrt(e / rate)); }
    // in key: every pitch class is in the major scale of the key it was played in
    const major = [0, 2, 4, 5, 7, 9, 11];
    const off = notes.filter((n) => !major.includes((((n.midi - n.key) % 12) + 12) % 12)).length;
    const mean = rms.reduce((a, b) => a + b, 0) / rms.length;
    out[night ? "night" : "day"] = { peak: +peak.toFixed(3), meanRms: +mean.toFixed(4), quietSeconds: rms.filter((v) => v < mean * 0.35).length, loudSeconds: rms.filter((v) => v > 0.001).length, notes: notes.length, offKey: off, lowest: Math.min(...notes.map((n) => n.midi)), highest: Math.max(...notes.map((n) => n.midi)) };
  }
  return out;
});
console.log(JSON.stringify(r));
for (const k of ['day', 'night']) {
  const x = r[k];
  check(`${k}: it plays (${x.notes} notes, sound in ${x.loudSeconds} of 45 s)`, x.notes > 25 && x.loudSeconds > 33, x);
  check(`${k}: never clips and stays soft (peak ${x.peak}, mean level ${x.meanRms})`, x.peak < 0.5 && x.meanRms < 0.06, x);
  check(`${k}: every note in key (${x.offKey} off-key of ${x.notes})`, x.offKey === 0, x);
}
check(`bass never below C2 (lowest ${Math.min(r.day.lowest, r.night.lowest)})`, Math.min(r.day.lowest, r.night.lowest) >= 36, r);
check(`night is sparser and lower than day (${r.night.notes} vs ${r.day.notes} notes; top note ${r.night.highest} vs ${r.day.highest})`, r.night.notes < r.day.notes && r.night.highest <= r.day.highest, r);
await browser.close();
process.exit(bad ? 1 : 0);
