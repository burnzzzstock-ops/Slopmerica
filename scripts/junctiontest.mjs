// Junctions read as junctions: a new road that runs over the end of another
// road joins it (the playtest had a capped dead end sitting unconnected on a
// through road), roads can't meet nearly parallel (a long sliver of crossed
// lane lines), and street junctions get crosswalks. Exits nonzero on failure.
import { chromium } from 'playwright-core';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); });
await page.goto(`${base}/#skip&map=appalachia&mode=sandbox`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 180000 });
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra)); if (!ok) bad++; };
const r = await page.evaluate(() => {
  const g = window.__game, d = window.__dbg, S = g.startView();
  cancelAnimationFrame(g.raf);
  const at = (x, z) => [...g.net.nodes.values()].filter((n) => Math.hypot(n.x - x, n.z - z) < 2);
  // the starting county road ends at S: a road straight through that point
  const before = at(S.x, S.z).map((n) => n.segs.length);
  d.road(S.x, S.z - 320, S.x, S.z + 320, 'stroad4');
  const through = at(S.x, S.z).map((n) => n.segs.length);
  // a street ending at x+60 (a dead end)
  d.road(S.x + 200, S.z - 150, S.x + 200, S.z + 150, 'twoLane');
  d.road(S.x + 60, S.z + 40, S.x + 197, S.z + 40, 'twoLane');
  // a new road over that dead end's far end joins it
  d.road(S.x + 60, S.z - 60, S.x + 60, S.z + 140, 'twoLane');
  const over = at(S.x + 60, S.z + 40).map((n) => n.segs.length);
  // nearly parallel: 10 degrees off an existing road, from its end
  const a = (10 * Math.PI) / 180;
  const sharpBack = d.road(S.x + 200, S.z - 150, S.x + 200 + Math.sin(a) * 160, S.z - 150 + Math.cos(a) * 160, 'gravel');
  g.roads.update();
  const cw = g.roads.crosswalkMesh.geometry.getAttribute('position')?.count ?? 0;
  return { before, through, over, sharpBack, cw };
});
check(`a road through the county road's dead end joins it (${JSON.stringify(r.before)} -> ${JSON.stringify(r.through)} roads at that point)`, r.through.length === 1 && r.through[0] === 3, r);
check(`a road over another road's dead end joins it (${JSON.stringify(r.over)})`, r.over.length === 1 && r.over[0] >= 3, r);
check(`roads meeting 10° apart are refused, and say why ("${r.sharpBack}")`, typeof r.sharpBack === 'string' && /Too sharp a junction \(\d+°\)/.test(r.sharpBack), r);
check(`street junctions get crosswalks (${r.cw} vertices)`, r.cw >= 8, r);
check('no page errors', errs.length === 0, errs.slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
