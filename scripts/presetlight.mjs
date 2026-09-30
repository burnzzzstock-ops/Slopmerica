// Do the presets light the same town alike? (docs/GRAPHICS_HANDOFF.md, item 7.) High and Ultra bake the sky into an
// environment map (ambient from the whole sky) and Medium and Low do not, so the same street at dusk came out darker and
// less blue there. This opens the reference block (scripts/refblock.mjs) on each preset, shoots the same four cameras at
// noon, dusk and on a moonless night, reads the finished frame back (readPixels straight after the render, so it is what
// reaches the screen) and prints the mean luma and the blue-to-red ratio of each, and the difference from High.
//
// usage: BASE_URL=http://127.0.0.1:5200 node scripts/presetlight.mjs [presets, default high,medium,low]
//   SWEEP=1 (one preset besides high): also tries HEMI (the no-IBL hemisphere scale) and NIGHT (its night-sun boost) values
//   given as HEMI=1,1.2,1.4 NIGHT=1,1.5,2 on the street and overview cameras, to pick the constants.
//   Exits nonzero if a preset's mean luma is more than TOL (default 0.03) from High's on any camera and hour.
import { chromium } from 'playwright-core';
import { ARGS, EXE, openBlock, shoot } from './refblock.mjs';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const presets = (process.argv[2] || 'high,medium,low').split(',');
const TOL = +(process.env.TOL ?? 0.03);
const ALL_TIMES = [['noon', 12.5, 0.5], ['dusk', 19.9, 0.5], ['moonless', 23, 0]];
// ONLY=noon,moonless / VIEWS=overview,street keep just those times / cameras; EVAL='js' runs in each page after it opens (to flip a look switch)
const TIMES = process.env.ONLY ? ALL_TIMES.filter(([n]) => process.env.ONLY.split(',').includes(n)) : ALL_TIMES;
const VIEWS = { overview: [0, 0, 320, 0.7, 0.6], street: [-40, -30, 110, 2.4, 0.38], houses: [-170, -130, 120, 4.0, 0.42], shore: null };
const browser = await chromium.launch({ executablePath: EXE, args: ARGS });
const measure = (page) => page.evaluate(() => {
  const g = window.__game, gl = g.renderer.getContext();
  g.frame(0.016);
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, px = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  let l = 0, r = 0, b = 0, crushed = 0;
  const n = w * h;
  for (let i = 0; i < px.length; i += 4) {
    const R = px[i] / 255, G = px[i + 1] / 255, B = px[i + 2] / 255, y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
    l += y; r += R; b += B; if (y < 0.02) crushed++;
  }
  return { luma: l / n, br: b / Math.max(1e-6, r), crushed: crushed / n };
});
const results = {};
let bad = 0;
for (const q of presets) {
  const { page, center } = await openBlock(browser, { base, quality: q });
  VIEWS.shore ??= await page.evaluate(({ x, z }) => {
    const T = window.__game.terrain;
    for (let r = 60; r < 1500; r += 20) for (let a = 0; a < 64; a++) {
      const px = x + Math.cos((a / 64) * 6.283) * r, pz = z + Math.sin((a / 64) * 6.283) * r;
      if (T.h(px, pz) < -0.5) return [px - x, pz - z, 90, (a / 64) * 6.283 + 1.2, 0.42];
    }
    return [0, 0, 320, 0.7, 0.6];
  }, center);
  if (process.env.EVAL) await page.evaluate(process.env.EVAL);
  for (const [t, hour, moon] of TIMES) for (const [v, view] of Object.entries(VIEWS)) {
    if (process.env.VIEWS && !process.env.VIEWS.split(',').includes(v)) continue;
    await shoot(page, center, { hour, moon, view });
    results[`${q} ${t} ${v}`] = await measure(page);
    console.log('measured', q, t, v, JSON.stringify(results[`${q} ${t} ${v}`]));
  }
  if (process.env.SWEEP && q !== 'high') {
    // (HEMI also sets the dusk value, so a sweep moves the whole day)

    const hemis = (process.env.HEMI || '1').split(',').map(Number), nights = (process.env.NIGHT || '1').split(',').map(Number);
    for (const h of hemis) {
      await page.evaluate((h) => { window.__game.env.hemiScale = h; if ('hemiDusk' in window.__game.env) window.__game.env.hemiDusk = h; }, h);
      for (const [t, hour, moon] of TIMES.slice(0, 2)) for (const v of ['street', 'overview']) {
        await shoot(page, center, { hour, moon, view: VIEWS[v] });
        const m = await measure(page);
        console.log(`sweep ${q} hemi ${h} ${t} ${v}: luma ${m.luma.toFixed(3)} b/r ${m.br.toFixed(3)}`);
      }
    }
    for (const nb of nights) {
      await page.evaluate((nb) => { window.__game.env.nightBoost = nb; }, nb);
      for (const v of ['street', 'overview']) {
        await shoot(page, center, { hour: 23, moon: 0, view: VIEWS[v] });
        const m = await measure(page);
        console.log(`sweep ${q} nightBoost ${nb} moonless ${v}: luma ${m.luma.toFixed(3)} b/r ${m.br.toFixed(3)}`);
      }
    }
  }
  await page.close();
}
await browser.close();
const hi = presets.includes('high') ? 'high' : presets[0];
console.log('preset  time      view      luma   b/r   crushed | luma vs ' + hi);
for (const [k, m] of Object.entries(results)) {
  const [q, t, v] = k.split(' ');
  const ref = results[`${hi} ${t} ${v}`];
  const d = m.luma - ref.luma;
  console.log(`${q.padEnd(7)} ${t.padEnd(9)} ${v.padEnd(9)} ${m.luma.toFixed(3)}  ${m.br.toFixed(3)}  ${m.crushed.toFixed(3)}   | ${q === hi ? '' : (d >= 0 ? '+' : '') + d.toFixed(3) + (Math.abs(d) > TOL ? '  OUT OF TOLERANCE' : '')}`);
  if (q !== hi && Math.abs(d) > TOL) bad++;
}
console.log(bad ? `FAIL ${bad} camera/hour pairs are more than ${TOL} luma from ${hi}` : `OK   every preset within ${TOL} luma of ${hi} on every camera and hour`);
process.exit(bad ? 1 : 0);
