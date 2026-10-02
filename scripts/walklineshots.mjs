// Pictures of the reference block's sharp-cornered junctions from above, for judging the walk line (scripts/walklinetest.mjs):
// where the zebras are painted, and (as red dots) where people walked over the arms' lanes in a seeded run of cars and
// people at midday. The same seed and cameras on the old and the new code, so the pairs compare.
// usage: BASE_URL=http://127.0.0.1:5175 TAG=before node scripts/walklineshots.mjs [nodes, default 45,42,61,65]
//   OUT  file prefix (default docs/screenshots/round8/walkline) -> <OUT>-<node>-<TAG>.jpg (900x600, q82); SEED (default 1234);
//   SECONDS of cars and people before the shots (default 120)
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { chromium } from 'playwright-core';
import { ARGS, EXE, openBlock, testSeed } from './refblock.mjs';

const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const tag = process.env.TAG || 'shot';
const nodes = (process.argv[2] || '45,42,61,65').split(',').map(Number);
const out = process.env.OUT || 'docs/screenshots/round8/walkline';
const SECONDS = Number(process.env.SECONDS || 120);
process.env.SEED ??= '1234';
const SEED = testSeed();
mkdirSync(dirname(out), { recursive: true });
const browser = await chromium.launch({ executablePath: EXE, args: ARGS });
const { page, errs } = await openBlock(browser, { base, seed: SEED, quality: 'low', width: 900, height: 600 });
await page.evaluate(({ SECONDS, nodes }) => {
  const g = window.__game, tr = g.traffic, P = g.peds;
  let time = 0;
  const trails = (window.__trails = []);
  const want = new Set(nodes);
  for (let f = 0; f < (SECONDS + 60) * 20; f++) {
    time += 1 / 20;
    tr.update(1 / 20, 1, 12.5, g.sim.population, g.sim.jobsFilled, g.rts.target);
    P.population = 3000;
    P.update(1 / 20, 1, g.rts.target, g.rts.distance, time);
    if (f < 1200 || f % 4) continue;
    for (const p of P.peds) if (p.kind === 'walk' && p.crossing && want.has(p.crossing.node)) trails.push([p.x, p.z]);
  }
}, { SECONDS, nodes });
for (const id of nodes) {
  const file = `${out}-${id}-${tag}.jpg`;
  await page.evaluate((id) => {
    const g = window.__game, d = window.__dbg, n = g.net.nodes.get(id);
    d.view(n.x, n.z, 55, 0, 1.25);
    g.hour = 12.5;
    for (let i = 0; i < 3; i++) g.frame(0.016);
  }, id);
  // where people walked over the lanes, drawn over the frame
  await page.evaluate((id) => {
    const g = window.__game, cam = g.rts.camera ?? g.camera, n = g.net.nodes.get(id);
    const canvas = document.querySelector('canvas'), r = canvas.getBoundingClientRect();
    let svg = document.getElementById('walkdots');
    if (!svg) { svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.id = 'walkdots'; svg.setAttribute('style', `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;pointer-events:none;z-index:99999`); document.body.appendChild(svg); }
    svg.innerHTML = '';
    const V = cam.position.clone();
    for (const [x, z] of window.__trails) {
      if (Math.hypot(x - n.x, z - n.z) > 40) continue;
      V.set(x, g.terrain?.h?.(x, z) ?? n.y ?? 0, z).project(cam);
      const sx = ((V.x + 1) / 2) * r.width, sy = ((1 - V.y) / 2) * r.height;
      svg.insertAdjacentHTML('beforeend', `<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="1.6" fill="#ff2a2a" fill-opacity="0.7"/>`);
    }
  }, id);
  await page.screenshot({ path: file, type: 'jpeg', quality: 82, timeout: 420000 });
  console.log(`  ${file}`);
}
console.log(errs.length ? `page errors: ${errs.slice(0, 3).join(' | ')}` : 'no page errors');
await browser.close();
process.exit(errs.length ? 1 : 0);
