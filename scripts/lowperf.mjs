// Frame time of the same town on two builds, measured side by side so the box's load hits both alike (docs/HANDOFF_CARS_LOOK.md
// item 6: "Low frame time within 5% of before"). perfTown.mjs grows a different town every run and drifts with whatever else is
// on the software GPU; this opens the saved reference block (scripts/refblock.mjs) in TWO pages at once, the old build and the
// new one, and for each lookbook camera times K frames alternately (old, new, new, old, old, new ...): the render plus a 1x1 readPixels, which
// waits for the frame and, on the software GPU, is dominated by shader work, so a costlier fragment shader shows up here. Prints the median of each, the
// new/old ratio per camera and overall, and the draw calls and triangles of each.
//
// usage: A_URL=http://127.0.0.1:5175 B_URL=http://127.0.0.1:5183 node scripts/lowperf.mjs [quality, default low]
//   K=9 frames per camera and build   PHONE=1 a 390x780 @3x touch context   HOUR=12.5 (noon; 23 = night)
import { chromium } from 'playwright-core';
import { ARGS, EXE, openBlock, shoot } from './refblock.mjs';
const A = process.env.A_URL || 'http://127.0.0.1:5175', B = process.env.B_URL || 'http://127.0.0.1:5183';
const quality = process.argv[2] || 'low';
const K = Number(process.env.K || 9);
const hour = Number(process.env.HOUR || 12.5);
const phone = !!process.env.PHONE;
const VIEWS = { overview: [0, 0, 320, 0.7, 0.6], street: [-40, -30, 110, 2.4, 0.38], houses: [-170, -130, 120, 4.0, 0.42] };
const browser = await chromium.launch({ executablePath: EXE, args: ARGS });
const open = (base) => openBlock(browser, phone ? { base, quality, width: 390, height: 780, phone: true } : { base, quality });
const [a, b] = [await open(A), await open(B)];
const timeFrame = (page) => page.evaluate(() => {
  const g = window.__game, gl = g.renderer.getContext();
  const t0 = performance.now();
  g.frame(0.016);
  // (gl.finish() alone returned before the software GPU had drawn: reading a pixel back is what waits for the frame)
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  return performance.now() - t0;
});
const info = (page) => page.evaluate(() => ({ calls: window.__game.renderer.info.render.calls, tris: window.__game.renderer.info.render.triangles }));
const med = (x) => [...x].sort((p, q) => p - q)[Math.floor(x.length / 2)];
const rows = [];
for (const [name, view] of Object.entries(VIEWS)) {
  await shoot(a.page, a.center, { hour, moon: 0.5, view });
  await shoot(b.page, b.center, { hour, moon: 0.5, view });
  const ta = [], tb = [];
  for (let i = 0; i < K; i++) { // (the order flips each round so neither build always goes first)
    if (i % 2) { tb.push(await timeFrame(b.page)); ta.push(await timeFrame(a.page)); } else { ta.push(await timeFrame(a.page)); tb.push(await timeFrame(b.page)); }
  }
  const ia = await info(a.page), ib = await info(b.page);
  rows.push({ name, a: med(ta), b: med(tb), ia, ib });
  console.log(name.padEnd(9), `old ${med(ta).toFixed(0)} ms  new ${med(tb).toFixed(0)} ms  ratio ${(med(tb) / med(ta)).toFixed(3)}  | calls ${ia.calls} -> ${ib.calls}  tris ${ia.tris} -> ${ib.tris}`, JSON.stringify({ old: ta.map((v) => Math.round(v)), new: tb.map((v) => Math.round(v)) }));
}
const gm = Math.exp(rows.reduce((s, r) => s + Math.log(r.b / r.a), 0) / rows.length);
console.log(`${quality}${phone ? ' phone' : ''} ${hour}h: geometric-mean new/old frame-time ratio ${gm.toFixed(3)} (${((gm - 1) * 100).toFixed(1)}%)`);
await browser.close();
