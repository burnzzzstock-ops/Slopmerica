// Special buildings and the road network (playtest: "the stadium or the data
// center doesn't need to be on a road for placement, which is fine, but we
// need a clear alert that it needs to be connected to the road network to
// work"). A landmark can go down before its road, but the placing tip, the
// toast after, a red "no road" bubble over it, its inspector and the alert
// log all say it does nothing until a road links it; it lifts no land values
// meanwhile. A road to it clears all of that; bulldozing that road says so
// at once. A service on a road island is warned about too. And the social
// feed posts like a timeline, not a firehose. Exits nonzero on failure.
import { chromium } from 'playwright-core';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra)); if (!ok) bad++; };
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.addInitScript(() => { try { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); } catch { /* */ } });
await page.goto(`${base}/#skip&map=florida&mode=ponzi`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__game && window.__dbg && window.__services, null, { timeout: 180000 });
// (not about milestones: every unlock in hand)
await page.evaluate(() => window.__dbg.unlockAll());

const r = await page.evaluate(() => {
  const g = window.__game, d = window.__dbg, SV = window.__services, T = g.terrain, t = g.tools, V = g.camera.position.constructor;
  cancelAnimationFrame(g.raf);
  g.sim.earn(2e6 - g.sim.money, 'other', 'Test funds');
  g.net.allowed = null; g.zones.allowed = null;
  const S = g.startView();
  const toasts = [];
  const orig = g.toast.bind(g); g.toast = (m, b) => { toasts.push(m); return orig(m, b); };
  const tick = () => { for (let i = 0; i < 3; i++) g.frame(0.7, false); };
  const lastToast = () => toasts[toasts.length - 1] ?? '';
  // a dry level spot 150-400 m from the town site with no road near
  let P = null;
  for (let r0 = 200; r0 < 700 && !P; r0 += 25) for (let a = 0; a < 24 && !P; a++) {
    const x = S.x + Math.cos(a * 0.26) * r0, z = S.z + Math.sin(a * 0.26) * r0;
    if (g.net.pickSeg(x, z, 140)) continue;
    let ok = true;
    for (let i = -2; i <= 2 && ok; i++) for (let j = -2; j <= 2 && ok; j++) if (T.h(x + i * 25, z + j * 25) < 1.5 || T.slope(x + i * 25, z + j * 25) > 0.12) ok = false;
    const dx = S.x - x, dz = S.z - z, L = Math.hypot(dx, dz);
    for (let k = 0; k <= 10 && ok; k++) { const px = x + (dx * k) / 10, pz = z + (dz * k) / 10; if (T.h(px, pz) < 1.5) ok = false; }
    if (ok && L > 150) P = { x, z };
  }
  if (!P) return { err: 'no spot' };
  // placing: the tip warns before the click
  t.landmark = 'slop69Field'; t.set('landmark');
  t.hover = new V(P.x, T.h(P.x, P.z), P.z); t.update();
  const tipBefore = { text: t.tip?.text ?? '', bad: !!t.tip?.bad };
  const n0 = g.buildings.list.size;
  g.placeLandmark('slop69Field', new V(P.x, T.h(P.x, P.z), P.z));
  const lm = [...g.buildings.list.values()].find((b) => b.landmark === 'slop69Field');
  const placedToast = lastToast();
  t.set('inspect');
  tick();
  const flag0 = lm?.offNet ?? null;
  const bubble0 = SV.problemText(g, lm.id);
  const alerts0 = g.sim.alerts.map((a) => a.text).filter((x) => /Slop 69 Field/.test(x));
  // the inspector says so and offers the road tool
  g.select({ kind: 'building', b: lm }); g.ui.update(0.3);
  const insp0 = document.querySelector('.inspector')?.textContent ?? '';
  const btn = document.querySelector('#in-road');
  btn?.click();
  const afterBtn = { tool: t.active, mode: t.roadMode, panel: !document.querySelector('.subpanel')?.hidden && !!document.querySelector('[data-road]') };
  t.set('inspect'); g.select(null);
  // a road from the town to its front: connected
  const hd = Math.max(lm.hw, lm.hd), dx = S.x - lm.x, dz = S.z - lm.z, L = Math.hypot(dx, dz);
  const end = { x: lm.x + (dx / L) * (hd + 8), z: lm.z + (dz / L) * (hd + 8) };
  const built = d.road(S.x, S.z, end.x, end.z, 'twoLane');
  tick();
  const flag1 = lm.offNet ?? null;
  const bubble1 = SV.problemText(g, lm.id);
  g.select({ kind: 'building', b: lm }); g.ui.update(0.3);
  const insp1 = document.querySelector('.inspector')?.textContent ?? '';
  g.select(null);
  const alerts1 = g.sim.alerts.map((a) => a.text).filter((x) => /Slop 69 Field/.test(x));
  // bulldozing that road cuts it off again, and says so right away
  const nT = toasts.length;
  const seg = g.net.pickSeg(end.x, end.z, 4)?.seg;
  if (seg) g.bulldozeRoad(seg);
  tick();
  const flag2 = lm.offNet ?? null;
  const cutToast = toasts.slice(nT).find((m) => /Slop 69 Field.* isn't connected/.test(m)) ?? '';
  // a service on a road island: the tip and the toast say it only serves that road
  const I = { x: P.x + (P.x > S.x ? 250 : -250), z: P.z };
  const island = d.road(I.x - 80, I.z, I.x + 80, I.z, 'twoLane');
  const sp = SV.findSpot(g, 'fireStation', I.x, I.z + 30);
  let svcTip = '', svcToast = '', svc = null;
  if (!sp.reason) {
    t.set('ext'); t.extTool = 'services';
    const nT2 = toasts.length;
    svc = SV.place(g, 'fireStation', sp.x, sp.z, sp.yaw);
    svcToast = toasts.slice(nT2).join(' | ');
    tick();
    svcTip = SV.problemText(g, svc?.id) ?? '';
    t.set('inspect');
  }
  g.toast = orig;
  return { P, tipBefore, placed: g.buildings.list.size - n0, placedToast, flag0, bubble0, alerts0, insp0, afterBtn, built, flag1, bubble1, insp1, alerts1, flag2, cutToast, island, spot: sp.reason ?? 'ok', svcFlag: svc?.offNet ?? null, svcToast, svcTip };
});
console.log(JSON.stringify(r).slice(0, 3000));
if (r.err) { check('found a spot', false, r); await browser.close(); process.exit(1); }
check(`placing it off the road network: the tip warns first ("${r.tipBefore.text.slice(0, 100)}")`, /🚧 no road here: it does nothing until a road connects it/.test(r.tipBefore.text) && r.tipBefore.bad, r.tipBefore);
check(`it can still go down, and the toast says it does nothing until connected ("${r.placedToast.slice(0, 110)}…")`, r.placed >= 1 && /is built, but no road reaches it\. It does nothing until it's connected to the road network/.test(r.placedToast), r.placedToast);
check(`a red "no road" bubble stands over it, and says why ("${(r.bubble0 ?? '').slice(0, 110)}…")`, r.flag0 === 'noRoad' && /Not connected to the road network: no road reaches Slop 69 Field[^,]*, so it does nothing/.test(r.bubble0 ?? ''), { flag: r.flag0, bubble: r.bubble0 });
check(`the alert log has it (${r.alerts0.length})`, r.alerts0.some((a) => /isn't connected to the road network: it does nothing/.test(a)), r.alerts0);
check('its inspector says Not connected, with what to do', /Not connected/.test(r.insp0) && /Road\s*None/.test(r.insp0) && /Draw a road/.test(r.insp0), r.insp0.slice(0, 300));
check(`"Draw a road" opens the road tool (${JSON.stringify(r.afterBtn)})`, r.afterBtn.tool === 'road' && r.afterBtn.panel, r.afterBtn);
check(`a road to its front connects it: flag, bubble and inspector clear (${r.built} pieces)`, typeof r.built === 'number' && r.built > 0 && r.flag1 === null && !r.bubble1 && /Connected/.test(r.insp1) && !/Not connected/.test(r.insp1), { built: r.built, flag: r.flag1, bubble: r.bubble1, insp: r.insp1.slice(0, 200) });
check('the log records it connected', r.alerts1.some((a) => /is connected to the road network/.test(a)), r.alerts1);
check(`bulldozing that road cuts it off, and a toast says so at once ("${r.cutToast.slice(0, 90)}")`, r.flag2 === 'noRoad' && /isn't connected to the road network: it does nothing/.test(r.cutToast), { flag: r.flag2, toast: r.cutToast });
check(`a fire station on a road that joins nothing is flagged too ("${r.svcToast.slice(0, 100)}")`, r.spot === 'ok' && r.svcFlag === 'noLink' && /only serves the buildings on that road/.test(r.svcToast) && /doesn't join the rest of your roads/.test(r.svcTip), r);

// land value: a cut-off landmark lifts nobody; connected, it does (a probe
// lot beside it, scored by the sim both ways)
const lv = await page.evaluate(() => {
  const g = window.__game, lm = [...g.buildings.list.values()].find((b) => b.landmark === 'slop69Field');
  const fake = { id: 1e9, zone: 'resLow', level: 1, w: 2, d: 2, x: lm.x + Math.max(lm.hw, lm.hd) + 40, z: lm.z, y: 0, yaw: 0, hw: 8, hd: 8, cells: [], seg: -1, label: 'probe', model: { height: 5 }, state: 'building', progress: 0, buildDays: 5, cap: 4, occ: 0, lv: 0, levelProgress: 0, born: 0, inst: -1, buildInst: -1, buildH: 1, emitT: 0 };
  g.buildings.list.set(fake.id, fake);
  const run = () => { g.sim.landValueAndLevels(0); return Math.round(fake.lv); };
  const was = lm.offNet;
  lm.offNet = 'noRoad'; const cut = run();
  lm.offNet = undefined; const linked = run();
  lm.offNet = was;
  g.buildings.list.delete(fake.id);
  return { cut, linked };
});
check(`land values count it only when connected (land value beside it: ${lv.cut} cut off, ${lv.linked} connected)`, lv.linked - lv.cut >= 15, lv);

// the feed: a burst of news makes a few posts, not a firehose
const feed = await page.evaluate(() => {
  const g = window.__game, f = g.feed;
  const n0 = document.querySelectorAll('.xfeed .xpost').length;
  const kinds = ['roadBuilt', 'buildingOpened', 'crash', 'zoned', 'treesCut', 'communeProtest', 'buildingLeveled', 'trafficJam', 'serviceBuilt', 'drunkCrash', 'populationMilestone', 'roadBuilt', 'crash'];
  for (const k of kinds) f.push(k, {});
  let t = 0;
  const at = [];
  while (t < 60) { f.update(0.5); t += 0.5; const n = document.querySelectorAll('.xfeed .xpost').length - n0; if (at.length < n) at.push(t); }
  const first = document.querySelector('.xfeed .xpost .xtext')?.textContent ?? '';
  return { posts: at.length, at, pushed: kinds.length };
});
console.log(JSON.stringify(feed));
check(`the feed paces itself: ${feed.pushed} news items in a burst make ${feed.posts} posts in a minute, ${feed.at.join(', ')} s apart-ish`, feed.posts >= 1 && feed.posts <= 5 && feed.at.every((x, i) => i === 0 || x - feed.at[i - 1] >= 13.5), feed);
check('no page errors', errs.length === 0, errs.slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
