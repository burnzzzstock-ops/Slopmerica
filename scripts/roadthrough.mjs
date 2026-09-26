// A road drawn through buildings: homes and shops are bulldozed (the preview
// says how many first), services and landmarks refuse the road and say which
// is in the way. From a playtest bug report: "connected a road and it went
// through a house and didn't demo the house". Exits nonzero on failure.
import { chromium } from 'playwright-core';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); });
await page.goto(`${base}/#skip&map=norcal&mode=sandbox`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 180000 });
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra)); if (!ok) bad++; };
const r = await page.evaluate(async () => {
  const g = window.__game, d = window.__dbg, S = g.startView();
  cancelAnimationFrame(g.raf);
  d.road(S.x - 200, S.z + 60, S.x + 200, S.z + 60, 'twoLane');
  d.zone(S.x, S.z + 90, 120, 'resLow');
  g.sim.demand.res = 80;
  for (let i = 0; i < 30 && [...g.buildings.list.values()].filter((b) => b.state === 'active').length < 6; i++) d.run(2);
  const homes = [...g.buildings.list.values()].filter((b) => b.state === 'active' && b.zone === 'resLow').sort((a, b) => a.x - b.x);
  const h = homes[Math.floor(homes.length / 2)];
  if (!h) return { none: true };
  // a road from behind the homes, straight through one, stopping short of the street
  const back = { x: h.x + Math.sin(h.yaw) * -40, z: h.z + Math.cos(h.yaw) * -40 };
  const plan = g.net.plan(g.net.snap(back.x, back.z), { p0: back, p1: back, p2: { x: h.x, z: h.z }, p3: { x: h.x + Math.sin(h.yaw) * 2, z: h.z + Math.cos(h.yaw) * 2 } }, 'twoLane');
  // through the tool, as a player would
  const t = g.tools, V = g.camera.position.constructor;
  t.roadMode = 'straight'; t.roadType = 'twoLane'; t.set('road');
  const ev = (type) => ({ button: 0, pointerType: 'mouse', timeStamp: performance.now() + Math.random() * 1000, type, shiftKey: false });
  const P = (p) => new V(p.x, g.terrain.h(p.x, p.z), p.z);
  const end = { x: h.x + Math.sin(h.yaw) * 2, z: h.z + Math.cos(h.yaw) * 2 };
  t.move(P(end), ev('pointermove'), false);
  t.down(P(back), ev('pointerdown')); t.up(P(back), ev('pointerup'), false);
  t.move(P(end), ev('pointermove'), false); t.update();
  const tip = t.tip?.text ?? '';
  t.down(P(end), { ...ev('pointerdown'), timeStamp: performance.now() + 5000 }); t.up(P(end), { ...ev('pointerup'), timeStamp: performance.now() + 5000 }, false);
  const gone = !g.buildings.list.has(h.id);
  const stillOnRoad = [...g.buildings.list.values()].filter((b) => g.buildings.underPavement([...g.net.segs.values()].flatMap((s) => s.samp.pts), 3).includes(b)).length;
  t.cancel(); t.set('inspect');
  // a service building in the way
  const m = await import('/src/sim/services.ts');
  const svc = m.placeService(g, 'fireStation', S.x + 120, S.z + 30) || [...g.buildings.list.values()].find((b) => b.zone === 'service');
  const f = [...g.buildings.list.values()].find((b) => !['resLow', 'resHigh', 'comLow', 'comHigh', 'industry', 'office'].includes(b.zone));
  const through = f ? d.road(f.x - 60, f.z, f.x + 60, f.z, 'twoLane') : 'no service';
  return { plan: { ok: plan.ok, demolish: plan.demolish, reason: plan.reason }, tip, gone, stillOnRoad, through, svcStill: f ? g.buildings.list.has(f.id) : null, label: f?.label };
});
check(`the plan counts the home in the way (${JSON.stringify(r.plan)})`, r.plan.ok && r.plan.demolish >= 1, r);
check(`the preview says so ("${r.tip}")`, /bulldozes \d+ building/.test(r.tip), r);
check('building the road bulldozes the home', r.gone === true, r);
check(`no building is left under any road (${r.stillOnRoad})`, r.stillOnRoad === 0, r);
check(`a road through ${r.label} is refused and names it ("${r.through}")`, typeof r.through === 'string' && /is in the way/.test(r.through) && r.svcStill === true, r);
check('no page errors', errs.length === 0, errs.slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
