// Hovering a need bubble says what it stands for. A merged bubble (several buildings: an id below zero, a count and a mix
// of problems) says how many buildings and what is wrong with them. The bubbles' own filter for the open info view can
// leave a merged bubble standing for one building; it is still not a building to look up, and it said nothing. Here a
// merged bubble of three (two without water, one without power) is given to the icons as the simulation gives them, laid
// out with no view and then with the Power view, and hovered through the game's own g.problemAt: three buildings and their
// two problems, then one building without power. A bubble for one real building still says that building's own line.
// Exits nonzero on failure.
//
//   BASE_URL=http://127.0.0.1:5173 node scripts/needhover.mjs
import { launch } from './lib/browser.mjs';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra).slice(0, 500)); if (!ok) bad++; };
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => { try { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.firstSteps', '1'); } catch { /* */ } });
await page.goto(`${base}/#skip&map=norcal&mode=sandbox`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__game && window.__dbg && window.__services, null, { timeout: 180000 });
const r = await page.evaluate(() => {
  const g = window.__game, S = window.__services.S, icons = S.icons;
  cancelAnimationFrame(g.raf);
  g.sim.speed = 0;
  const c = g.startView();
  g.rts.setView(c.x, c.z, 500, 0.6, 0.85, true);
  for (let i = 0; i < 3; i++) g.frame(0);
  const rect = g.renderer.domElement.getBoundingClientRect();
  const at = { x: g.rts.target.x, z: g.rts.target.z };
  const y = g.terrain.h(at.x, at.z) + 20;
  // hover the first bubble the layout shows, where it is on the screen
  const hover = (view) => {
    icons.layout(g.camera, rect.width, rect.height, view);
    const it = (icons.shown ?? icons.items ?? [])[0];
    if (!it) return { shown: 0 };
    const p = g.camera.position.clone().set(it.x, it.y, it.z).project(g.camera);
    const hit = g.problemAt(rect.left + (p.x + 1) * rect.width / 2, rect.top + (1 - p.y) * rect.height / 2);
    return { shown: 1, n: it.n ?? 1, id: it.id, hit };
  };
  const out = {};
  icons.set([{ x: at.x, y, z: at.z, p: 'water', id: -1, n: 3, mix: { power: 1, water: 2 } }]);
  out.all = hover('none');
  out.power = hover('power');
  // one real building's own bubble (a few homes grown on a new street first)
  const d = window.__dbg;
  for (const dz of [200, -200, 320, -320, 440]) if (typeof d.road(c.x - 150, c.z + dz, c.x + 150, c.z + dz, 'twoLane') === 'number') { d.zone(c.x, c.z + dz + 40, 60, 'resLow'); break; }
  d.run(25);
  const b = [...g.buildings.list.values()][0];
  if (b) {
    icons.set([{ x: b.x, y: b.y + b.model.height + 5, z: b.z, p: 'power', id: b.id }]);
    g.rts.setView(b.x, b.z, 300, 0.6, 0.85, true);
    for (let i = 0; i < 2; i++) g.rts.update?.(0.016);
    g.camera.updateMatrixWorld(true);
    const one = hover('none');
    out.one = { ...one, own: window.__services.problemText(g, b.id) };
  }
  return out;
});
check(`a merged bubble of three says how many and what ("${r.all?.hit?.text}")`, r.all?.shown === 1 && r.all.n === 3 && r.all.hit?.id === -1 && r.all.hit.text === '3 buildings with problems here: 2 without water, 1 without power. Zoom in to see each one.', r.all);
check(`left with one building by the Power view, it says so ("${r.power?.hit?.text}")`, r.power?.shown === 1 && r.power.n === 1 && r.power.hit?.id === -1 && r.power.hit.text === '1 building with problems here: 1 without power. Zoom in to see each one.', r.power);
if (r.one) check(`a bubble for one real building is looked up as that building (id ${r.one.hit?.id}; its own line: ${JSON.stringify(r.one.own)})`, r.one.shown === 1 && !!r.one.hit && r.one.hit.id === r.one.id && r.one.hit.id >= 0 && r.one.hit.text === r.one.own, r.one);
else console.log('(no building on this map to hover: that check is skipped)');
check('no page errors', errs.length === 0, errs.slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
