// Fresh-city playtest (Holler County, 0 to 5,284): a new street joining a
// road with bus stops keeps the line running (it used to vanish); bulldozing
// a routed road names the line first; the Transit panel lists a line closed
// on the map; rides cost money to run; placing a service says "Built" in
// green instead of red "already here", with rings where it fits; leaving
// the page saves. Exits nonzero on failure.
import { chromium } from 'playwright-core';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.firstSteps', '1'); });
await page.goto(`${base}/#skip&map=florida&mode=sandbox`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__game?.transit && window.__dbg, null, { timeout: 180000 });
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra)); if (!ok) bad++; };

// ---- transit survives a junction
const tr = await page.evaluate(() => {
  const g = window.__game, d = window.__dbg, t = g.transit, V = g.camera.position.constructor;
  cancelAnimationFrame(g.raf);
  for (const c of g.communes.list) { c.state = 'gone'; c.group.removeFromParent(); }
  g.syncBlockers();
  const cx = 60, cz = 60;
  for (let k = -2; k <= 2; k++) {
    d.road(cx - 300, cz + k * 90, cx + 300, cz + k * 90, 'twoLane');
    d.road(cx + k * 120, cz - 200, cx + k * 120, cz + 200, 'twoLane');
  }
  g.sim.population = 400; g.sim.peakPop = Math.max(g.sim.peakPop ?? 0, 400); // transit unlocks at the most people ever
  t.placeDepot(cx + 330, cz + 25);
  for (const b of g.buildings.list.values()) if (b.kind === 'busDepot') { b.state = 'active'; b.progress = 1; }
  const pts = [[cx - 180, cz], [cx - 40, cz], [cx + 100, cz]]; // between the cross streets (cx + 120k), 140 m apart
  const added = pts.map(([x, z]) => t.addDraftPoint(x, z));
  const finished = t.finishDraft();
  const line = [...t.lines.values()][0];
  const stopSegs = line ? line.stopIds.map((id) => t.stops.get(id).seg) : [];
  // the first stop's segment: a dead-end street joins it halfway between that stop and the next crossing
  const first = line && t.stops.get(line.stopIds[0]);
  const joinX = first ? first.x + 25 : cx - 145;
  const built = d.road(joinX, cz + 55, joinX, cz, 'twoLane');
  for (let i = 0; i < 3; i++) g.frame(0.05, false);
  const after = [...t.lines.values()][0];
  const segsNow = after ? after.stopIds.map((id) => t.stops.get(id)?.seg) : [];
  const allOnRoads = segsNow.length > 0 && segsNow.every((s) => g.net.segs.has(s));
  const firstMoved = after && t.stops.get(after.stopIds[0])?.seg !== stopSegs[0];
  const toasts = [...document.querySelectorAll('.toasts .toast')].map((e) => e.textContent);
  // bulldoze hover over a routed road names the line
  const P = (x, z) => new V(x, g.terrain.h(x, z), z);
  g.tools.set('bulldoze');
  const s2 = after && t.stops.get(after.stopIds[1]);
  g.tools.hover = s2 ? P(s2.x, s2.z) : P(cx - 50, cz);
  // the stop sits at the curb: aim at the road centre next to it
  const seg = s2 && g.net.segs.get(s2.seg);
  if (seg) { const q = seg.samp.pts[Math.floor(seg.samp.pts.length / 2)]; g.tools.hover = P(q.x, q.z); }
  g.tools.update();
  const tip = g.tools.tip?.text ?? '';
  g.tools.set('inspect');
  return { added, finished, name: line?.name, stops: line?.stopIds.length, built, lines: t.lines.size, allOnRoads, firstMoved, vanished: toasts.some((x) => /vanished/.test(x)), tip };
});
console.log(JSON.stringify(tr));
check(`a bus line with three stops is running (${tr.name})`, tr.finished !== false && tr.stops === 3, tr);
check(`a street joining its road keeps the line (${tr.lines} line; split: ${tr.firstMoved}; built: ${tr.built})`, typeof tr.built === 'number' && tr.lines === 1 && tr.allOnRoads && !tr.vanished, tr);
check(`the stop moved onto the new half of the road`, tr.firstMoved === true, tr);
check(`bulldozing a routed road names the line first ("${tr.tip}")`, new RegExp(`ends ${/^the /i.test(tr.name) ? '' : 'the '}${tr.name} bus line`).test(tr.tip), tr.tip);

// ---- the Transit panel lists a line finished on the map without reopening; rides cost money to run
const tp = await page.evaluate(async () => {
  const g = window.__game, t = g.transit;
  g.sim.population = 400; g.sim.peakPop = Math.max(g.sim.peakPop ?? 0, 400); // transit opens at 300 (the empty sandbox recounts to 0 when time runs)
  g.ui.onTool('ext:transit');
  const listed = () => [...document.querySelectorAll('.subpanel input[data-name]')].map((i) => i.value).join('|'); // names are editable fields
  const before = listed();
  // a second line, finished from the map the way a player closes a loop
  const pts = [[60 - 180, 150], [60 - 40, 150], [60 + 100, 150]];
  pts.forEach(([x, z]) => t.addDraftPoint(x, z));
  t.addDraftPoint(60 - 180, 150); // clicking the first stop again closes it
  for (let i = 0; i < 4; i++) g.ui.update(0.3); // the HUD's few-times-a-second refresh, no reopening
  const after = listed();
  const names = [...t.lines.values()].map((l) => l.name);
  for (const l of t.lines.values()) l.lastWeekRiders = 1000;
  g.sim.fcCache = null; // the forecast is cached for an eighth of a day
  const lines = g.sim.forecastWeek().lines;
  const ops = -(lines.find((l) => l.label === 'SLOP Transit operations')?.amount ?? 0);
  const fares = lines.find((l) => l.label === 'Bus fares')?.amount ?? 0;
  g.ui.onTool('ext:transit');
  return { lines: t.lines.size, names, listed: names.filter((n) => after.includes(n)).length, beforeListed: names.filter((n) => before.includes(n)).length, ops, fares, riders: t.lines.size * 1000 };
});
console.log(JSON.stringify(tp));
check(`a line closed on the map shows in the open Transit panel at once (${tp.listed}/${tp.lines} listed)`, tp.lines === 2 && tp.listed === 2, tp);
check(`rides cost money to run: $${tp.ops}/wk operations vs $${tp.fares}/wk fares for ${tp.riders} rides`, tp.ops >= tp.riders * 1.4 && tp.fares > tp.ops && tp.fares - tp.ops < tp.riders * 0.6, tp);

// ---- placing a service: green "Built" over the new building, not red "already here"; rings where it fits
await page.evaluate(() => { const g = window.__game; g.ui.onTool('ext:services'); });
await page.click('[data-cat="fire"]');
await page.click('[data-svc="fireStation"]');
const pl = await page.evaluate(async () => {
  const g = window.__game, tool = window.__ext.tools.get('svcPlace'), V = g.camera.position.constructor;
  const ev = (type) => ({ button: 0, pointerType: 'mouse', timeStamp: performance.now(), type });
  g.rts.setView(60, 60, 500, 0.6, 0.9, true);
  for (let i = 0; i < 40; i++) g.frame(0.05, false); // the rings are checked a few a frame
  const rings = g.scene.getObjectByName('svc-sites');
  const ringCount = rings?.visible ? rings.count : 0;
  const P = new V(60 + 30, g.terrain.h(90, 60 + 40), 60 + 40);
  tool.move(g, P, ev('pointermove'), false);
  const before = g.buildings.list.size;
  tool.up(g, P, ev('pointerup'), false);
  const placed = g.buildings.list.size - before;
  // the pointer moves the tools' hover point and then the tool (as the HUD's pointer handler does)
  const at = (q) => { g.tools.hover = q; tool.move(g, q, ev('pointermove'), false); };
  at(P.clone().setX(P.x + 1));
  const tipOn = tool.tip(g);
  const ghostOn = !!g.scene.getObjectByName('svc-ghost')?.visible;
  at(P.clone().setX(P.x + 60));
  const tipAway = tool.tip(g);
  g.tools.cancel?.(); g.tools.set('inspect');
  for (let i = 0; i < 2; i++) g.frame(0.05, false);
  return { ringCount, placed, tipOn, ghostOn, tipAway, ringsAfter: !!g.scene.getObjectByName('svc-sites')?.visible };
});
console.log(JSON.stringify(pl));
check(`green rings mark spots where a fire station fits (${pl.ringCount})`, pl.ringCount > 3, pl);
check(`one click builds one (${pl.placed})`, pl.placed === 1, pl);
check(`over the new building the tip says it was built, in green ("${pl.tipOn?.text}")`, pl.tipOn?.good === true && !pl.tipOn?.bad && /Built/.test(pl.tipOn?.text ?? '') && !pl.ghostOn, pl);
check(`moving off it goes back to placing ("${pl.tipAway?.text}")`, !/Built/.test(pl.tipAway?.text ?? ''), pl);
check('the rings go away with the tool', pl.ringsAfter === false, pl);

// ---- the page going away saves (a new build replacing it rolled a city back)
const sv = await page.evaluate(async () => {
  const key = Object.keys(localStorage).find((k) => k.startsWith('slopmerica.save')) ?? 'slopmerica.save.v1';
  localStorage.removeItem(key);
  window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
  return { key, saved: !!localStorage.getItem('slopmerica.save.v1') };
});
check(`leaving the page saves the city (${sv.key})`, sv.saved, sv);

check('no page errors', errs.length === 0, errs.slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
