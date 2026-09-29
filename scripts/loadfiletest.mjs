// Loading a city from the title screen, and continuing after damage. A file
// that is really a city loads; a file that is JSON but not a whole city must
// be turned away ON the title screen, in words, with the player's own city
// untouched, not accepted and then die halfway into "Loading…" (the rescue
// screen, or, on older builds, a loading screen that never ends).
// A damaged own save falls back to the checkpoint at once instead.
//   playtest 6 / triage r03 "load froze": roads: {} got past the title check.
//
//   BASE_URL=http://127.0.0.1:5173 node scripts/loadfiletest.mjs
import { chromium } from 'playwright-core';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const fails = [];
const check = (ok, msg) => { console.log(ok ? '  ok ' : '  ✗  ', msg); if (!ok) fails.push(msg); };
const dir = mkdtempSync(join(tmpdir(), 'slop-cities-'));
const init = () => { try { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.firstSteps', '1'); } catch { /* */ } };
const errs = [];

// a real save: a few streets, some homes, forty days
const p0 = await browser.newPage({ viewport: { width: 1000, height: 600 } });
await p0.addInitScript(init);
await p0.goto(`${base}/#skip&map=appalachia&mode=ponzi`, { waitUntil: 'load', timeout: 300000 });
await p0.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 300000 });
const raw = await p0.evaluate(() => { const g = window.__game, d = window.__dbg, S = g.startView(); cancelAnimationFrame(g.raf); d.road(S.x - 60, S.z + 110, S.x - 60, S.z - 110, 'twoLane'); d.zone(S.x - 60, S.z, 60, 'resLow'); d.run(40); d.save(); return localStorage.getItem('slopmerica.save.v1'); });
const shape = await p0.evaluate(async (g) => { const m = await import('/src/sim/save.ts'); return [m.saveProblem(g), m.saveProblem({ ...g, money: null }), m.saveProblem({ ...g, money: 'lots' })]; }, JSON.parse(raw));
await p0.close();
const good = JSON.parse(raw);
check(shape[0] === null && shape[1] === null && shape[2] !== null, `the shape check accepts a real save and a sandbox save (money: null), and refuses money: "lots" (${JSON.stringify(shape)})`);
check(good.roads.segs.length > 0 && good.buildings.length > 0, `a real save to work from (${good.roads.segs.length} road pieces, ${good.buildings.length} buildings, ${raw.length.toLocaleString()} characters)`);

const open = async (extra) => {
  const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
  page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(init);
  if (extra) await page.addInitScript(extra.fn, extra.arg);
  await page.goto(`${base}/`, { waitUntil: 'load', timeout: 300000 });
  return page;
};
// what the player sees a few seconds after picking a file
const outcome = async (page, ms) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    await page.waitForTimeout(1000);
    const s = await page.evaluate(() => ({
      game: !!window.__game,
      msg: (() => { const m = document.querySelector('.aaa-import-msg'); return m && !m.hidden ? m.textContent : ''; })(),
      rescue: /couldn.t start/i.test(document.body.innerText),
    }));
    if (s.game) return { kind: 'game' };
    if (s.msg) return { kind: 'title', msg: s.msg };
    if (s.rescue) return { kind: 'rescue' };
  }
  return { kind: 'stuck' };
};
const file = (name, text) => { const f = join(dir, `city-${name}.json`); writeFileSync(f, text); return f; };

console.log('\na damaged or partial file is turned away on the title screen');
const bad = {
  'cut in half (not JSON)': raw.slice(0, raw.length >> 1),
  'JSON, but not a city': JSON.stringify({ hello: 'world' }),
  'roads: {}': JSON.stringify({ ...good, roads: {} }),
  'roads without pieces': JSON.stringify({ ...good, roads: { nodes: good.roads.nodes, next: good.roads.next } }),
  'zones: {}': JSON.stringify({ ...good, zones: {} }),
  'a null building': JSON.stringify({ ...good, buildings: [null] }),
  'no clock': JSON.stringify({ ...good, day: undefined }),
};
for (const [name, text] of Object.entries(bad)) {
  const page = await open();
  await page.waitForSelector('#import', { timeout: 300000 });
  await page.setInputFiles('#import-file', file(name.replace(/\W+/g, '-'), text));
  const o = await outcome(page, 20000);
  check(o.kind === 'title' && /city/i.test(o.msg), `${name}: says so on the title screen (${o.kind}${o.msg ? `: "${o.msg.slice(0, 70)}"` : ''})`);
  if (o.kind === 'title') { const still = await page.evaluate(() => !!document.querySelector('#import') && !document.querySelector('.loading')); check(still, `${name}: the title is still there to pick another file`); }
  await page.close();
}

console.log('\na whole city file loads');
{
  const page = await open();
  await page.waitForSelector('#import', { timeout: 300000 });
  await page.setInputFiles('#import-file', file('good', raw));
  const o = await outcome(page, 240000);
  check(o.kind === 'game', `a real city file loads (${o.kind})`);
  if (o.kind === 'game') {
    const s = await page.evaluate(() => { const g = window.__game; cancelAnimationFrame(g.raf); return { segs: g.net.segs.size, blds: g.buildings.list.size, day: Math.round(g.sim.day) }; });
    check(s.segs === good.roads.segs.length && s.blds > 0 && s.day === Math.round(good.day), `and it is the same city (${s.segs} pieces, ${s.blds} buildings, day ${s.day})`);
  }
  await page.close();
}

console.log('\na damaged own save falls back to the checkpoint');
{
  const page = await open({ fn: ([main, cp]) => { try { localStorage.setItem('slopmerica.save.v1', main); localStorage.setItem('slopmerica.save.v1.checkpoint', cp); } catch { /* */ } }, arg: [JSON.stringify({ ...good, roads: {} }), raw] });
  await page.waitForSelector('#continue', { timeout: 300000 });
  check(true, 'Continue is offered (the checkpoint is a whole city)');
  await page.click('#continue');
  const o = await outcome(page, 240000);
  check(o.kind === 'game', `Continue starts the checkpoint city instead of a rescue screen (${o.kind})`);
  await page.close();
}

await browser.close();
if (errs.length) console.log('page errors:', JSON.stringify(errs.slice(0, 3)));
if (fails.length) { console.log(`\nFAIL: ${fails.length} problems`); process.exit(1); }
console.log('\nOK: partial files are turned away on the title, whole cities load, a damaged save falls back');
