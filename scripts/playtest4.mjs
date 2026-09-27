// Fourth playtest report (Gator Gulch, Growth Ponzi: a 5,141-person city
// emptied to 9 when its landfill filled at top speed). A landfill warns at
// 75% and 90% with the days it has left and says what "full" does; the
// Services line says why trucks are idle and why each building's trash is
// piling up; a city-wide failure raises an emergency card with the cause,
// the clock and the worst neighbourhoods, slows the game to normal speed
// (Settings can make it pause), and turns into "Recovering" once fixed;
// departures are booked to their root cause; population unlocks stay earned;
// a successful placement says "Built", not "already here"; the blocking
// building is outlined; road previews give the budget effect; zoomed out,
// problem icons merge per neighbourhood with a count. Exits nonzero on failure.
import { chromium } from 'playwright-core';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.addInitScript(() => { try { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.edgeScroll', '0'); localStorage.removeItem('slopmerica.emergencySpeed'); } catch { /* */ } });
await page.goto(`${base}/#skip&map=florida&mode=ponzi`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__game && window.__dbg && window.__services, null, { timeout: 180000 });
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra)); if (!ok) bad++; };

// a small town with a landfill: a street off the county road, homes, shops and a factory
const town = await page.evaluate(() => {
  const g = window.__game, d = window.__dbg, SV = window.__services;
  cancelAnimationFrame(g.raf);
  g.sim.earn(400000 - g.sim.money, 'other', 'Test funds'); // through the ledger, so weeks still reconcile
  g.sim.peakPop = 400; // a town that has had 400 people: landfills, fire and police are unlocked (milestones)
  const S = g.startView();
  // the first cross street that builds (Gator Gulch is wet), joined to the
  // town site where the county road ends
  let street = null;
  for (const dz of [-100, 100, -160, 160, -60, 60]) {
    if (street) break;
    const lane = g.net.pickSeg(S.x, S.z + dz / 2, 2) ? 1 : d.road(S.x, S.z, S.x, S.z + dz, 'twoLane');
    if (!(typeof lane === 'number' && lane > 0)) continue;
    for (const len of [220, 180, 140]) {
      if (street) break;
      const a = d.road(S.x, S.z + dz, S.x - len, S.z + dz, 'twoLane'), b = d.road(S.x, S.z + dz, S.x + len, S.z + dz, 'twoLane');
      if (typeof a === 'number' && a > 0 && typeof b === 'number' && b > 0) street = { dz, len };
    }
  }
  if (!street) return { err: 'no street' };
  const z = S.z + street.dz, side = street.dz < 0 ? -1 : 1;
  let lf = null;
  for (let r = 60; r < 700 && !lf; r += 20) for (let k = 0; k < 24 && !lf; k++) {
    const x = S.x + Math.cos(k * 0.26) * r, zz = z + Math.sin(k * 0.26) * r;
    const sp = SV.findSpot(g, 'landfill', x, zz);
    if (!sp.reason) lf = SV.place(g, 'landfill', sp.x, sp.z, sp.yaw);
  }
  if (!lf) return { err: 'no landfill spot' };
  d.zone(S.x - street.len / 2, z - side * 30, 60, 'resLow');
  d.zone(S.x + street.len / 2, z - side * 30, 60, 'resLow');
  d.zone(S.x - street.len / 2, z + side * 30, 50, 'comLow');
  d.zone(S.x + street.len / 2, z + side * 30, 50, 'industry');
  d.run(45);
  return { street, landfill: lf.id, pop: g.sim.population, blds: [...g.buildings.list.values()].filter((b) => b.zone !== 'service').length, day: Math.floor(g.sim.day) };
});
console.log(JSON.stringify(town));
check(`a town grows around a landfill (${town.pop} people, ${town.blds} buildings)`, !town.err && town.pop > 40 && town.blds > 12, town);

// ---- population unlocks stay earned
const unlock = await page.evaluate(() => {
  const g = window.__game, SV = window.__services, s = g.sim, S = g.startView();
  const reasonAt = () => { for (let r = 60; r < 900; r += 30) for (let k = 0; k < 16; k++) { const c = SV.canPlace(g, 'incinerator', S.x + Math.cos(k * 0.4) * r, S.z + Math.sin(k * 0.4) * r); if (c.ok || /Unlocks/.test(c.reason ?? '')) return c.ok ? 'ok' : c.reason; } return 'no spot'; };
  const before = reasonAt();
  const peak0 = s.peakPop;
  s.peakPop = 1850; // the city once had 1,850 people; it has far fewer now
  const after = reasonAt();
  g.ui.refreshNow();
  document.querySelector('button.tbtn[data-t="ext:services"]').click();
  document.querySelector('[data-cat="garbage"]').click();
  const card = document.querySelector('[data-svc="incinerator"]');
  const res = { before, after, peak0, pop: s.population, disabled: card?.disabled, title: card?.title ?? '' };
  // saves keep it, and older saves recover it from their history
  const x = JSON.parse(JSON.stringify(s.serializeExtra()));
  s.peakPop = 0; s.restoreExtra(x);
  res.restored = s.peakPop;
  const old = JSON.parse(JSON.stringify(s.serializeExtra()));
  delete old.peakPop; old.history = [...old.history, { day: 1, pop: 1400, money: 0, nature: 1, sprawl: 0 }];
  s.peakPop = 0; s.restoreExtra(old);
  res.fromHistory = s.peakPop;
  s.peakPop = Math.max(peak0, s.population);
  document.querySelector('button.tbtn[data-t="ext:services"]').click();
  return res;
});
check(`the incinerator is locked below its milestone, 1,800 people ("${unlock.before}")`, /Unlocks at 1,800 people \(Exurb\)/.test(unlock.before), unlock);
check(`once the city has had 1,850 people it stays available at ${unlock.pop} (${unlock.after})`, unlock.after === 'ok' && unlock.disabled === false && /Earned at 1,800 people \(Exurb\)/.test(unlock.title), unlock);
check(`the earned peak survives a save (${unlock.restored}) and old saves find it in their history (${unlock.fromHistory})`, unlock.restored === 1850 && unlock.fromHistory === 1400, unlock);

// ---- a landfill filling up: 75%, 90%, full
const fill = await page.evaluate(() => {
  const g = window.__game, d = window.__dbg, SV = window.__services, s = g.sim;
  const lf = [...g.buildings.list.values()].find((b) => b.kind === 'landfill');
  const fs = SV.S.f.get(lf.id);
  const toasts = () => [...document.querySelectorAll('.toasts .toast')].map((t) => t.textContent);
  const out = { made: SV.S.garbage.made, collected: SV.S.garbage.collected };
  fs.stored = 6750 - 0.05; d.run(2); g.ui.update(0.3);
  out.t75 = toasts().find((t) => /75% full/.test(t)) ?? null;
  document.querySelector('button.tbtn[data-t="ext:services"]').click();
  document.querySelector('[data-cat="garbage"]').click();
  g.ui.refreshNow();
  out.line75 = document.querySelector('.svc-live')?.textContent ?? '';
  fs.stored = 8100 - 0.05; d.run(2); g.ui.update(0.3);
  out.t90 = toasts().find((t) => /90% full/.test(t)) ?? null;
  fs.stored = 9000 - 0.05; d.run(2); g.ui.update(0.3);
  out.tFull = toasts().find((t) => /is full/.test(t)) ?? null;
  g.ui.refreshNow();
  out.lineFull = document.querySelector('.svc-live')?.textContent ?? '';
  out.alerts = s.alerts.map((a) => a.text);
  out.inspector = (() => { g.select({ kind: 'building', b: lf }); g.ui.update(0.3); const t = document.querySelector('.inspector')?.textContent ?? ''; g.select(null); return t; })();
  return out;
});
check(`at 75% the landfill says how long it has ("${fill.t75}")`, !!fill.t75 && /about \d+ (days?|months|years) left at [\d.]+ t\/day/.test(fill.t75), fill);
check(`the Garbage line forecasts when the landfills fill`, /Landfills full in about \d+ (days?|months|years) at [\d.]+ t\/day/.test(fill.line75), fill.line75);
check(`at 90% it warns again ("${fill.t90}")`, !!fill.t90 && /90% full: about \d+ (days?|months|years) left/.test(fill.t90), fill.t90);
check(`full: it says the trucks stopped and what that does ("${(fill.tFull ?? '').slice(0, 90)}…")`, !!fill.tFull && /trucks stopped/.test(fill.tFull) && /will pile up trash/.test(fill.tFull), fill.tFull);
check(`the Garbage line says why trucks are idle`, /Trucks idle: .*is full/.test(fill.lineFull), fill.lineFull);
check(`the landfill's inspector says when it's full`, /Full inFull: trucks idle/.test(fill.inspector.replace(/\s+/g, '')) || /Full in\s*Full: trucks idle/.test(fill.inspector), fill.inspector.slice(0, 200));
check(`all three are in the alert history`, fill.alerts.some((t) => /75% full/.test(t)) && fill.alerts.some((t) => /90% full/.test(t)) && fill.alerts.some((t) => /full \(9,000 t\)/.test(t)), fill.alerts);

// ---- the emergency: at top speed, the game slows down and keeps a card up
const em = await page.evaluate(() => {
  const g = window.__game, SV = window.__services, s = g.sim;
  s.speed = 3;
  let frames = 0;
  while (SV.S.crisis.level !== 'crit' && frames++ < 3000) g.frame(0.1, false);
  g.ui.refreshNow();
  const card = document.querySelector('.emergency');
  const e = g.emergency();
  return {
    frames, level: e?.level, speed: s.speed, visible: !!card && !card.hidden, crit: card?.classList.contains('em-crit'), text: card?.textContent ?? '',
    needs: e?.needs.map((n) => `${n.need}:${n.buildings}`), atRisk: e?.atRisk, residents: e?.residents, hot: e?.hot.length ?? 0,
    why: SV.S.garbage.why, trash: SV.S.counts.trash, fixBtn: !!card?.querySelector('[data-em="fix:garbage"]'),
  };
});
console.log(JSON.stringify({ ...em, text: em.text.slice(0, 240) }));
check(`a city-wide garbage failure becomes an emergency (${em.atRisk} buildings, ${em.residents} residents at risk)`, em.level === 'crit' && em.needs?.[0]?.startsWith('garbage'), em);
check(`it slowed the game from ▶▶▶ to ▶ (speed ${em.speed})`, em.speed === 1, em.speed);
check(`the card says what, why and how long ("${em.text.slice(0, 120)}…")`, em.visible && em.crit && /Garbage emergency/.test(em.text) && /on the clock/.test(em.text) && /abandoned in/.test(em.text) && /Why: .*full/.test(em.text), em.text);
check(`and offers the fix and the place (${em.hot} neighbourhoods)`, em.fixBtn && em.hot > 0 && /Worst area/.test(em.text), em);
check(`every piling-up building is explained: ${JSON.stringify(em.why)}`, em.why.full > 0 && em.why.full >= em.trash - em.why.reach - em.why.capacity - em.why.clearing - em.why.queued, em);
const acts = await page.evaluate(() => {
  const g = window.__game;
  const out = {};
  document.querySelector('.emergency [data-em="fix:garbage"]').click();
  out.panel = document.querySelector('.svc-cats .chip.on')?.dataset.cat ?? null;
  out.view = g.overlays.ext?.id ?? null;
  out.line = document.querySelector('.svc-live')?.textContent ?? '';
  const t0 = { x: g.rts.target.x, z: g.rts.target.z };
  document.querySelector('.emergency [data-em="show"]').click();
  for (let i = 0; i < 40; i++) g.frame(0.05, false);
  const e = g.emergency(), h = e.hot[0];
  out.moved = Math.hypot(g.rts.goal.target.x - h.x, g.rts.goal.target.z - h.z) < 5 && Math.hypot(g.rts.target.x - t0.x, g.rts.target.z - t0.z) > 1;
  out.selected = g.selection?.kind === 'building' ? g.selection.b.id === h.id : false;
  g.ui.update(0.3);
  out.inspector = document.querySelector('.inspector')?.textContent ?? '';
  out.t0 = t0;
  document.querySelector('.emergency [data-em="pause"]')?.click();
  out.paused = g.sim.speed === 0;
  g.sim.speed = 1;
  g.select(null);
  return out;
});
check(`"Fix garbage" opens Services → Garbage with its info view on`, acts.panel === 'garbage' && acts.view === 'svc:garbage', acts);
check(`the Garbage line breaks the piles down by why`, /Why: .*served by a full landfill/.test(acts.line), acts.line);
check(`"Worst area" flies there and selects the building that empties first`, acts.moved && acts.selected && /🗑️\s*\d+d/.test(acts.inspector), { moved: acts.moved, selected: acts.selected, insp: acts.inspector.slice(0, 200) });
check('the card can pause the clock', acts.paused, acts);

// ---- icons: merged when zoomed out, one service at a time in its view
const icons = await page.evaluate(() => {
  const g = window.__game, SV = window.__services;
  const e = g.emergency(), h = e.hot[0];
  const refresh = () => { SV.S.iconT = 0; g.frame(0.016, false); return SV.S.icons.shown; };
  g.rts.setView(h.x, h.z, 1300, undefined, undefined, true);
  const far = refresh().map((i) => ({ n: i.n ?? 1, p: i.p, x: i.x, y: i.y, z: i.z }));
  const merged = far.filter((i) => i.n > 1);
  // hovering a merged bubble says what's in it
  let hover = null;
  if (merged[0]) {
    const V = g.camera.position.constructor, v = new V(merged[0].x, merged[0].y, merged[0].z);
    g.frame(0.016, false);
    v.project(g.camera);
    const r = g.renderer.domElement.getBoundingClientRect();
    hover = g.problemAt(r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height)?.text ?? null;
  }
  g.rts.setView(h.x, h.z, 300, undefined, undefined, true);
  const near = refresh();
  // the Garbage view (still on from "Fix garbage") shows garbage bubbles only
  const only = near.every((i) => i.p === 'garbage');
  g.overlays.setExt(null);
  const all = refresh().length;
  return { far: far.length, merged: merged.length, biggest: Math.max(0, ...merged.map((m) => m.n)), hover, near: near.length, nearMerged: near.filter((i) => (i.n ?? 1) > 1).length, only, all, problems: SV.S.counts.trash };
});
check(`zoomed out, neighbourhood bubbles merge (${icons.far} bubbles for ${icons.problems} piles; biggest ${icons.biggest})`, icons.merged > 0 && icons.far < icons.problems, icons);
check(`hovering a merged bubble counts what's in it ("${icons.hover}")`, /\d+ buildings with problems here: \d+ piling up trash/.test(icons.hover ?? ''), icons.hover);
check(`zoomed in, every building has its own bubble again (${icons.near}, ${icons.nearMerged} merged)`, icons.near > 0 && icons.nearMerged === 0, icons);
check('an info view isolates its own service', icons.only, icons);

// ---- losses are booked to their cause; then build a landfill and recover
const loss = await page.evaluate(() => {
  const g = window.__game, d = window.__dbg, SV = window.__services, s = g.sim;
  d.run(45);
  const flow = s.popFlow(60);
  g.ui.refreshNow();
  document.querySelector('#tb-popstat').click();
  g.ui.refreshNow();
  const card = document.querySelector('.pop-pop')?.textContent ?? '';
  const tip = document.querySelector('#tb-popstat')?.title ?? '';
  document.querySelector('#tb-popstat').click();
  const abandoned = SV.S.counts.abandoned;
  return { flow, card, tip, abandoned, pop: s.population, peak: s.peakPop, crisis: SV.S.crisis.level };
});
console.log(JSON.stringify({ ...loss, card: loss.card.slice(0, 200) }));
check(`departures are booked to garbage first (${loss.flow.causes.map((c) => `${c.cause} ${Math.round(c.n)}`).join(', ')})`, loss.flow.causes[0]?.cause === 'garbage' && loss.flow.out > 0, loss.flow);
check(`the population card breaks it down ("${loss.card.slice(0, 100)}…")`, /Residents/.test(loss.card) && /Moved in/.test(loss.card) && /Garbage/.test(loss.card) && /Most ever/.test(loss.card), loss.card);
check('hovering the population says who left and why', /Last 14 days: .*left/.test(loss.tip), loss.tip);
const rec = await page.evaluate(() => {
  const g = window.__game, d = window.__dbg, SV = window.__services, S = g.startView();
  let lf = null;
  for (let r = 80; r < 900 && !lf; r += 20) for (let k = 0; k < 24 && !lf; k++) {
    const sp = SV.findSpot(g, 'landfill', S.x + Math.cos(k * 0.26 + 0.1) * r, S.z + Math.sin(k * 0.26 + 0.1) * r);
    if (!sp.reason) lf = SV.place(g, 'landfill', sp.x, sp.z, sp.yaw);
  }
  if (!lf) return { err: 'no spot' };
  let days = 0;
  while (SV.S.crisis.level === 'crit' && days++ < 60) d.run(1);
  g.ui.refreshNow();
  const card = document.querySelector('.emergency');
  const out = { days, level: g.emergency()?.level, text: card && !card.hidden ? card.textContent : '', alerts: g.sim.alerts.map((a) => a.text).slice(-4) };
  // the empty lots regrow (abandoned buildings come down after 45 days): homes nearest the full
  // landfill go to the new one's trucks, not to the full one (which used to keep them)
  d.run(80);
  const occupied = [...g.buildings.list.values()].filter((b) => b.zone !== 'service' && b.zone !== 'landmark' && b.state === 'active' && b.abandoned === undefined);
  return { ...out, occupied: occupied.length, stillFull: occupied.filter((b) => SV.S.b.get(b.id)?.trash === 'full').length, piling: SV.S.counts.trash, level2: g.emergency()?.level, pop: g.sim.population };
});
check(`a new landfill ends it, and the card turns into "Recovering" (${rec.days} days; "${(rec.text ?? '').slice(0, 90)}…")`, rec.level === 'recovering' && /Recovering from the garbage emergency/.test(rec.text) && /Buildings at risk \d+ → \d+/.test(rec.text), rec);
check('the alert history records the recovery', rec.alerts?.some((t) => /Recovering from the garbage emergency/.test(t)), rec.alerts);
check(`the full landfill lets go: the town regrows (${rec.pop} people) and none of its ${rec.occupied} buildings waits on the full one`, rec.occupied > 5 && rec.stillFull === 0 && rec.piling === 0 && rec.level2 !== 'crit', rec);

// ---- Settings → Emergencies: pause instead of slowing down
const pause = await page.evaluate(() => {
  const g = window.__game, SV = window.__services;
  localStorage.setItem('slopmerica.emergencySpeed', 'pause');
  g.sim.speed = 3;
  g.ui.emergency(SV.S.emergency);
  const paused = g.sim.speed === 0;
  localStorage.removeItem('slopmerica.emergencySpeed');
  g.sim.speed = 1;
  document.querySelector('button.tbtn[data-t="help"]').click();
  const chip = document.querySelector('#emergency-toggle')?.textContent ?? '';
  document.querySelector('button.tbtn[data-t="help"]').click();
  return { paused, chip };
});
check(`Settings can make an emergency pause the game instead ("${pause.chip}")`, pause.paused && /Emergencies: slow to/.test(pause.chip), pause);

// ---- placing: "Built", not "already here"; what's in the way is outlined
const place = await page.evaluate(() => {
  const g = window.__game, SV = window.__services, t = g.tools, S = g.startView();
  const V = g.camera.position.constructor, P = (x, z) => new V(x, g.terrain.h(x, z), z);
  const ev = (type) => ({ button: 0, pointerType: 'mouse', timeStamp: performance.now(), type, shiftKey: false });
  let at = null;
  for (let r = 60; r < 900 && !at; r += 20) for (let k = 0; k < 24 && !at; k++) {
    const x = S.x + Math.cos(k * 0.26 + 0.2) * r, z = S.z + Math.sin(k * 0.26 + 0.2) * r;
    if (!SV.findSpot(g, 'fireStation', x, z).reason) at = { x, z };
  }
  if (!at) return { err: 'no spot' };
  document.querySelector('button.tbtn[data-t="ext:services"]').click();
  document.querySelector('[data-cat="fire"]').click();
  document.querySelector('[data-svc="fireStation"]').click();
  const n0 = [...g.buildings.list.values()].filter((b) => b.kind === 'fireStation').length, m0 = g.sim.money;
  t.move(P(at.x, at.z), ev('pointermove'), false); t.update();
  const before = t.tip?.text ?? '';
  t.down(P(at.x, at.z), ev('pointerdown')); t.up(P(at.x, at.z), ev('pointerup'), false); t.update();
  const built = [...g.buildings.list.values()].filter((b) => b.kind === 'fireStation');
  const b = built[built.length - 1];
  const after = { text: t.tip?.text ?? '', good: !!t.tip?.good, bad: !!t.tip?.bad, ghost: !!g.scene.getObjectByName('svc-ghost')?.visible };
  // a second click on it (a double-click) buys nothing and complains about nothing
  const toastsBefore = document.querySelectorAll('.toast.bad').length;
  t.down(P(b.x, b.z), ev('pointerdown')); t.up(P(b.x, b.z), ev('pointerup'), false); t.update();
  const again = { text: t.tip?.text ?? '', n: [...g.buildings.list.values()].filter((x) => x.kind === 'fireStation').length, badToasts: document.querySelectorAll('.toast.bad').length - toastsBefore };
  // moving off it: back to placing, and pointing at it now says it's there, outlined
  t.move(P(b.x + 300, b.z + 300), ev('pointermove'), false); t.update();
  const off = t.tip?.text ?? '';
  t.move(P(b.x, b.z), ev('pointermove'), false); t.update();
  const onIt = { text: t.tip?.text ?? '', blocker: !!g.scene.getObjectByName('svc-ghost-blocker')?.visible };
  t.set('inspect');
  document.querySelector('button.tbtn[data-t="ext:services"]').click();
  return { before, after, again, off, onIt, n0, n1: built.length, spent: m0 - g.sim.money, blockerHidden: !g.scene.getObjectByName('svc-ghost-blocker')?.visible };
});
check(`one click builds one fire station for $12,000 (${place.n0} → ${place.n1}, $${place.spent})`, !place.err && place.n1 === place.n0 + 1 && place.spent === 12000, place);
check(`right after, the tip confirms it in green ("${place.after.text}")`, /^✅ Built .*Volunteer Fire Dept/.test(place.after.text) && place.after.good && !place.after.bad && !/already here/.test(place.after.text) && !place.after.ghost, place.after);
check(`a second click on it buys nothing and raises no error (${place.again.n} stations, ${place.again.badToasts} warnings)`, place.again.n === place.n1 && place.again.badToasts === 0 && /✅ Built/.test(place.again.text), place.again);
check(`moving off it goes back to placing ("${place.off.slice(0, 60)}…")`, !/✅ Built/.test(place.off) && place.off.length > 0, place.off);
check(`pointing at it afterwards says it's there, with the blocking building outlined`, /already here/.test(place.onIt.text) && place.onIt.blocker, place.onIt);
check('putting the tool away hides the outline', place.blockerHidden, place);

// ---- road previews: the weekly balance before and after, and once roads age
const road = await page.evaluate(() => {
  const g = window.__game, t = g.tools, s = g.sim, net = g.net, S = g.startView();
  const V = g.camera.position.constructor, P = (x, z) => new V(x, g.terrain.h(x, z), z);
  let ts = 50000;
  const ev = (type) => ({ button: 0, pointerType: 'mouse', timeStamp: (ts += 1000), type, shiftKey: false });
  const end = [...net.nodes.values()].filter((n) => n.segs.length === 1).sort((a, b) => Math.hypot(a.x - S.x, a.z - S.z) - Math.hypot(b.x - S.x, b.z - S.z))[0];
  let aim = null;
  for (let a = 0; a < 16 && !aim; a++) {
    const x = end.x + Math.cos(a * 0.39) * 160, z = end.z + Math.sin(a * 0.39) * 160;
    if (net.plan(net.snap(end.x, end.z), { p0: { x: end.x, z: end.z }, p1: { x: end.x, z: end.z }, p2: { x, z }, p3: { x, z } }, 'stroad4').ok) aim = { x, z };
  }
  if (!aim) return { err: 'no road' };
  t.roadType = 'stroad4'; t.roadMode = 'straight'; t.set('road');
  t.move(P(end.x, end.z), ev('pointermove'), false);
  t.down(P(end.x, end.z), ev('pointerdown')); t.up(P(end.x, end.z), ev('pointerup'), false);
  t.move(P(aim.x, aim.z), ev('pointermove'), false); t.update();
  const tip = t.tip?.text ?? '';
  const upkeep = Number((tip.match(/\+\$(\d+)\/wk upkeep/) || [])[1]);
  // a town just in the black: the same road would tip it into the red, and says so
  const real = s.forecastWeek.bind(s), now = real().net, shift = -now + upkeep / 2;
  s.forecastWeek = () => { const f = real(); return { ...f, net: f.net + shift }; };
  t.move(P(aim.x + 0.5, aim.z), ev('pointermove'), false); t.update();
  const flip = { text: t.tip?.text ?? '', bad: !!t.tip?.bad };
  t.down(P(aim.x, aim.z), ev('pointerdown')); t.up(P(aim.x, aim.z), ev('pointerup'), false);
  const toast = [...document.querySelectorAll('.toasts .toast')].map((e) => e.textContent).find((x) => /put the weekly budget in the red/.test(x)) ?? null;
  s.forecastWeek = real;
  t.cancel(); t.set('inspect');
  return { tip, upkeep, flip, toast };
});
check(`a road preview gives the weekly balance before → after ("${road.tip}")`, /budget [+−]\$[\d,]+ → [+−]\$[\d,]+\/wk/.test(road.tip) && /\+\$\d+\/wk upkeep \(→ \$\d+\/wk as it ages\)/.test(road.tip), road);
check(`and where it lands once roads age`, /once roads age\)/.test(road.tip), road.tip);
check(`a road that would put the budget in the red is flagged ("${road.flip.text.slice(0, 80)}…")`, road.flip.bad && /⚠️ budget \+\$[\d,]+ → −\$[\d,]+\/wk/.test(road.flip.text), road.flip);
check(`building it says so right away ("${(road.toast ?? '').slice(0, 70)}…")`, !!road.toast && /growth stops/.test(road.toast), road.toast);

// ---- homes on a street with no way to the highway: one problem, not three
const cut = await page.evaluate(() => {
  const g = window.__game, d = window.__dbg, net = g.net, S = g.startView();
  let at = null;
  for (let k = 0; k < 400 && !at; k++) {
    const x = S.x + ((k % 20) - 10) * 40, z = S.z + (Math.floor(k / 20) - 10) * 40;
    if (net.segsNear(x - 120, z - 120, x + 320, z + 120).length) continue;
    if (net.plan({ kind: 'free', x, z }, { p0: { x, z }, p1: { x: x + 60, z }, p2: { x: x + 120, z }, p3: { x: x + 180, z } }, 'twoLane').ok) at = { x, z };
  }
  if (!at) return { err: 'no lonely spot' };
  d.road(at.x, at.z, at.x + 180, at.z, 'twoLane');
  d.zone(at.x + 90, at.z + 25, 45, 'resLow');
  d.zone(at.x + 90, at.z - 25, 45, 'resLow');
  // builders want homes whatever the town's demand is by now
  const boost = (dm) => { dm.res += 90; };
  g.sim.hooks.demand.push(boost);
  d.run(25);
  g.sim.hooks.demand.splice(g.sim.hooks.demand.indexOf(boost), 1);
  g.ui.refreshNow();
  const e = g.emergency();
  const card = document.querySelector('.emergency');
  return { needs: e?.needs.map((n) => `${n.label}: ${n.buildings} ${n.failing} (${n.why})`) ?? [], level: e?.level, text: card && !card.hidden ? card.textContent : '' };
});
check(`buildings with no route to the highway are one line, not three ("${cut.needs?.[0] ?? cut.err}")`, !cut.err && cut.needs.some((n) => /^Utilities: \d+ without power, water and sewage \(on roads with no plant, pump or outfall and no route to the highway\)$/.test(n)) && !cut.needs.some((n) => /^(Power|Water|Sewage):/.test(n)) && /without power, water and sewage/.test(cut.text), cut);

// ---- bug reports carry who left, what's failing and the alert history
const report = await page.evaluate(() => {
  window.__game.ui.reportBug();
  const t = document.querySelector('#bug-preview')?.value ?? '';
  document.querySelector('.bug-x')?.click();
  return t;
});
check('bug reports include departures by cause, the service state and alerts', /People \(14 d\): \+\d+ in, −\d+ out/.test(report) && /Alerts: d\d+ /.test(report), report.split('\n').filter((l) => /^(People|Services|Alerts)/.test(l)));
check('no page errors (or console errors: the ledger reconciles every week)', errs.length === 0, errs.slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
