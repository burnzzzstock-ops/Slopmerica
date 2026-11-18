// The bulldozer can be undone on a building that grew: Undo puts it back as it stood, with its people.
// On a street of homes (Ponzi mode, so there is money and an Undo): a home is bulldozed with the game's own command and Undo
// brings back the same building (id, place, level, model, people, land value, age, lots), and the day's count of who left
// because of the bulldozer goes back to what it was; the ids given out next are not disturbed; a home whose lot was rezoned in
// between, and one whose lot something else was built on, do not come back and say why; a road laid through three homes
// bulldozes them, and undoing the road puts all three back; and a bought building (a clinic) is not put back by Undo, as
// before. Exits nonzero on failure.
//
//   BASE_URL=http://127.0.0.1:5173 node scripts/razeundo.mjs      (SEED=n for another county's dice)
import { launch } from './lib/browser.mjs';
import { seededInit, seededRandom, testSeed } from './refblock.mjs';

const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const SEED = testSeed();
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra).slice(0, 900)); if (!ok) bad++; };

const browser = await launch();
const errs = [];
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(seededInit, { seed: SEED, rng: seededRandom.toString() });
await page.addInitScript(() => { try { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.firstSteps', '1'); localStorage.setItem('slopmerica.emergencySpeed', 'off'); } catch { /* */ } });
await page.goto(`${base}/#skip&map=norcal&mode=ponzi&seed=${SEED}`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__game && window.__dbg && window.__services, null, { timeout: 180000 });

const out = await page.evaluate(async () => {
  const g = window.__game, d = window.__dbg, SV = window.__services, B = g.buildings;
  cancelAnimationFrame(g.raf);
  if (typeof g.bulldozeBuilding !== 'function') return { missing: true };
  const toasts = [];
  g.ui.toast = (m) => { toasts.push(String(m)); };
  for (const c of g.communes.list) { c.state = 'gone'; c.group?.removeFromParent(); }
  g.sim.money += 5e6;
  const S = g.startView();
  const roadsWere = new Set(g.net.segs.keys());
  d.road(S.x - 220, S.z, S.x + 220, S.z, 'twoLane');
  const street = new Set([...g.net.segs.keys()].filter((id) => !roadsWere.has(id)));   // the homes' own street
  d.zone(S.x, S.z + 40, 230, 'resLow');
  d.zone(S.x, S.z - 40, 230, 'resLow');
  d.run(60);
  const homes = () => [...B.list.values()].filter((b) => b.zone === 'resLow' && b.state === 'active' && b.occ > 0 && b.abandoned === undefined);
  const shape = (b) => (b ? { id: b.id, x: b.x, z: b.z, yaw: b.yaw, level: b.level, w: b.w, d: b.d, variant: b.variant, label: b.label, occ: b.occ, cap: b.cap, lv: b.lv, born: b.born, state: b.state, progress: b.progress,
    cells: b.cells.map((c) => c.id).sort((p, q) => p - q), cellsMine: b.cells.every((c) => c.bld === b.id), drawn: b.inst >= 0 } : null);
  const flow = () => { const f = g.sim.popFlow(1); return { moved: f.moved ?? null, bulldozed: (f.by ?? f.out ?? []).find?.((x) => (x.cause ?? x[0]) === 'bulldozed') ?? null, raw: JSON.stringify(f) }; };
  const R = { grown: homes().length, stackBefore: g.canUndo };

  // ---- one home, down and back
  const a = homes()[0];
  const before = shape(a), row = JSON.stringify(B.rowOf(a)), flow0 = flow(), n0 = B.list.size;
  R.did = g.bulldozeBuilding(a);
  R.gone = !B.list.has(before.id) && B.at(before.x, before.z) === null;
  R.label = g.undoLabel; R.can = g.canUndo; R.flowDown = flow();
  R.lotsFreed = a.cells.every((c) => c.bld === 0);
  R.undid = g.undo();
  const a2 = B.list.get(before.id);
  R.before = before; R.after = shape(a2); R.rowSame = !!a2 && JSON.stringify(B.rowOf(a2)) === row; R.rowWas = row; R.rowIs = a2 ? JSON.stringify(B.rowOf(a2)) : null;
  R.at = B.at(before.x, before.z)?.id ?? null; R.count = [n0, B.list.size]; R.flowBack = flow(); R.flow0 = flow0;
  R.toastBack = toasts.at(-1) ?? null;
  R.nothingLeft = g.undoLabel;
  // (the next building made gets an id nobody has had)
  const maxId = Math.max(...B.list.keys());
  d.run(3);
  R.idsAfter = { max: maxId, dup: new Set(B.list.keys()).size !== B.list.size };

  // ---- one sweep of the bulldozer over three homes is one Undo; the next sweep is its own
  {
    const three = homes().filter((h) => h.id !== before.id).slice(0, 3), was = three.map(shape), fourth = homes().find((h) => h.id !== before.id && !three.includes(h)), was4 = shape(fourth);
    for (const h of three) g.bulldozeBuilding(h, 7);
    const label3 = g.undoLabel;
    g.bulldozeBuilding(fourth, 8);
    const label4 = g.undoLabel;
    toasts.length = 0;
    g.undo();
    const after4 = { fourth: JSON.stringify(shape(B.list.get(was4.id))) === JSON.stringify(was4), three: three.filter((h) => B.list.has(h.id)).length, next: g.undoLabel };
    g.undo();
    R.sweep = { label3, label4, after4, back: was.filter((u) => JSON.stringify(shape(B.list.get(u.id))) === JSON.stringify(u)).length, toast: toasts.at(-1) ?? null, left: g.undoLabel };
  }

  // ---- a lot rezoned in between: it does not come back, and says why
  const b = homes().find((h) => h.id !== before.id);
  const bs = shape(b);
  g.bulldozeBuilding(b);
  for (const c of g.zones.cellsNear(bs.x, bs.z, 30)) if (bs.cells.includes(c.id)) c.zone = 'comLow';
  toasts.length = 0;
  g.undo();
  R.rezoned = { back: B.list.has(bs.id), toast: toasts.at(-1) ?? null, stack: g.canUndo };
  for (const c of g.zones.cellsNear(bs.x, bs.z, 30)) if (bs.cells.includes(c.id)) c.zone = 'resLow';

  // ---- something else built on the lot
  const c3 = homes().find((h) => h.id !== before.id && h.id !== bs.id);
  const cs = shape(c3), lot = c3.cells.slice();
  g.bulldozeBuilding(c3);
  let other = null;
  for (let k = 0; k < 20 && !other; k++) other = B.tryGrow('resLow', lot.filter((c) => c.row === 0));
  toasts.length = 0;
  g.undo();
  R.builtOver = { other: other ? other.id : null, back: B.list.has(cs.id), toast: toasts.at(-1) ?? null };

  // ---- a road through homes: undoing the road puts them back
  const { lineCubic } = await import('/src/core/math.ts');
  // (as the road tool lays one: plan, build, the game's own after-build step, then the undo for it)
  const lay = (x1, z1, x2, z2) => {
    const n0 = g.net.segs.size;
    const p0 = g.net.snap(x1, z1), p1 = g.net.snap(x2, z2);
    const curve = lineCubic({ x: p0.x, z: p0.z }, { x: p1.x, z: p1.z });
    const plan = g.net.plan(p0, curve, 'twoLane');
    const stood = [...B.list.values()].map(shape);
    const segs = plan.ok ? g.net.build(p0, p1, curve, 'twoLane') : [];
    const razed = segs.length ? g.onRoadBuilt(segs, plan) : 0;
    const under = stood.filter((u) => !B.list.has(u.id));   // (the ones the road took)
    if (segs.length) g.pushUndo({ kind: 'build', segIds: segs.map((x) => x.id), refund: plan.cost - plan.grant, label: 'Two-Lane Road' });
    const split = g.net.segs.size - n0 - segs.length;   // pieces the join added to the roads that were there
    toasts.length = 0;
    if (segs.length) g.undo();
    const now = under.map((u) => shape(B.list.get(u.id)));
    return { plan: plan.ok ? 'ok' : plan.reason, segs: segs.length, split, razed, under: under.length, roadGone: segs.every((x) => !g.net.segs.has(x.id)), toast: toasts.at(-1) ?? null,
      there: now.filter(Boolean).length,
      same: under.filter((u, i) => JSON.stringify(now[i]) === JSON.stringify(u)).length,
      // (as it stood, whatever its lots are now called)
      stood: under.filter((u, i) => !!now[i] && JSON.stringify({ ...now[i], cells: 0 }) === JSON.stringify({ ...u, cells: 0 }) && now[i].cells.length > 0).length };
  };
  // through the row of homes behind the street, not touching the street
  const rowN = homes().filter((h) => h.z > S.z + 10).sort((p, q) => p.x - q.x);
  // (a place for it the planner takes: along the row, not ending on another road)
  const tries = [];
  const rowB = homes().filter((h) => h.z < S.z - 10).sort((p, q) => p.x - q.x);
  for (const row of [rowN, rowB]) for (const len of [45, 35, 28, 22]) for (const k of [0, 1, -1, 2, -2, 3, -3]) { const h = row[Math.floor(row.length / 2) + k]; if (h) tries.push([h.x - len, h.z, h.x + len, h.z]); }
  const free = tries.find(([x1, z1, x2, z2]) => {
    const p0 = g.net.snap(x1, z1), p1 = g.net.snap(x2, z2);
    // (it may end on another road, not on the homes' street: that would cut the street, which is the next case)
    const onStreet = (p) => (p.kind === 'seg' && street.has(p.id)) || (p.kind === 'node' && (g.net.nodes.get(p.id)?.segs ?? []).some((id) => street.has(id)));
    return !onStreet(p0) && !onStreet(p1) && g.net.plan(p0, lineCubic({ x: p0.x, z: p0.z }, { x: p1.x, z: p1.z }), 'twoLane').ok;
  });
  R.through = free ? lay(...free) : { plan: 'no place for the test road', segs: 0, why: tries.slice(0, 8).map(([x1, z1, x2, z2]) => { const p0 = g.net.snap(x1, z1), p1 = g.net.snap(x2, z2); return p0.kind + '/' + p1.kind + ': ' + (g.net.plan(p0, lineCubic({ x: p0.x, z: p0.z }, { x: p1.x, z: p1.z }), 'twoLane').reason ?? 'ok'); }) };
  // off the street (which it joins, cutting it in two) and out through the homes behind
  const rowS = homes().filter((h) => h.z < S.z - 10).sort((p, q) => p.x - q.x);
  const offs = [0, 1, -1, 2, -2].map((k) => rowS[Math.floor(rowS.length / 2) + k]).filter(Boolean).map((h) => [h.x, S.z - 6, h.x, S.z - 150]);
  const off = offs.find(([x1, z1, x2, z2]) => { const p0 = g.net.snap(x1, z1), p1 = g.net.snap(x2, z2); return g.net.plan(p0, lineCubic({ x: p0.x, z: p0.z }, { x: p1.x, z: p1.z }), 'twoLane').ok; });
  R.off = off ? lay(...off) : { plan: 'no place for the test road', segs: 0 };
  // nothing claims a lot that is not there to claim it, and no lot is claimed twice over
  const cells = [...g.zones.cells.values()];
  R.sound = { orphans: cells.filter((c) => c.bld && !B.list.has(c.bld)).length, strays: [...B.list.values()].filter((h) => h.cells.some((c) => c.bld !== h.id)).length, buildings: B.list.size };

  // ---- a bought building is not put back by Undo (it was never a 'raze')
  d.unlockAll();
  let svc = null;
  for (let r = 60; r < 600 && !svc; r += 30) for (let k = 0; k < 16 && !svc; k++) { const sp = SV.findSpot(g, 'clinic', S.x + Math.cos(k * 0.39) * r, S.z + Math.sin(k * 0.39) * r); if (!sp.reason) svc = SV.place(g, 'clinic', sp.x, sp.z, sp.yaw); }
  if (svc) {
    const id = svc.id, lbl = g.undoLabel;
    g.undo();   // the purchase is taken back, as before
    const svc2 = (() => { for (let r = 60; r < 600; r += 30) for (let k = 0; k < 16; k++) { const sp = SV.findSpot(g, 'clinic', S.x + Math.cos(k * 0.39) * r, S.z + Math.sin(k * 0.39) * r); if (!sp.reason) return SV.place(g, 'clinic', sp.x, sp.z, sp.yaw); } return null; })();
    while (g.canUndo) { if (g.undoLabel?.startsWith('bulldozing')) break; g.undo(); if (!svc2 || !B.list.has(svc2.id)) break; }
    R.bought = { placed: true, purchaseLabel: lbl, purchaseUndone: !B.list.has(id) };
    const svc3 = (() => { for (let r = 60; r < 600; r += 30) for (let k = 0; k < 16; k++) { const sp = SV.findSpot(g, 'clinic', S.x + Math.cos(k * 0.39) * r, S.z + Math.sin(k * 0.39) * r); if (!sp.reason) return SV.place(g, 'clinic', sp.x, sp.z, sp.yaw); } return null; })();
    if (svc3) { const top = g.undoLabel; g.bulldozeBuilding(svc3); R.bought.gone = !B.list.has(svc3.id); R.bought.labelAfter = g.undoLabel; R.bought.labelWas = top; }
  } else R.bought = { placed: false };
  return R;
});

if (out.missing) { check('the game has a bulldozer command that Undo knows about (game.bulldozeBuilding)', false, out); await browser.close(); console.log('1 FAILED'); process.exit(1); }
check(`the street grew homes with people in them (${out.grown})`, out.grown >= 8, out.grown);
check(`a home is bulldozed by the game's command: it is gone, its lots are free, and Undo offers "${out.label}"`, out.did && out.gone && out.lotsFreed && out.can && /^bulldozing /.test(out.label ?? ''), { did: out.did, gone: out.gone, lotsFreed: out.lotsFreed, label: out.label });
check(`its ${out.before?.occ} people are counted as leaving because of the bulldozer (${out.flowDown?.raw})`, (out.flowDown?.raw ?? '').includes('bulldozed'), out.flowDown);
check(`Undo puts it back as it stood: the same id, place, level, model, people, land value, age and lots (${out.after ? Object.keys(out.before).filter((k) => JSON.stringify(out.before[k]) !== JSON.stringify(out.after[k])).join(', ') || 'nothing differs' : 'it is not there'})`,
  out.undid && !!out.after && JSON.stringify(out.after) === JSON.stringify(out.before), { before: out.before, after: out.after });
check(`its saved row is the row it had, lot for lot, and the lot answers to it again (building ${out.at} stands there; ${out.count?.[0]} buildings before, ${out.count?.[1]} after)`, out.rowSame && out.at === out.before?.id && out.count?.[0] === out.count?.[1], { was: out.rowWas, is: out.rowIs });
check(`its people are back in the day's count (who came and went today: ${out.flowBack?.raw}, as before the bulldozer: ${out.flow0?.raw})`, out.flowBack?.raw === out.flow0?.raw, { before: out.flow0, down: out.flowDown, back: out.flowBack });
check(`it says so ("${out.toastBack}"), and that Undo is used up (next: ${out.nothingLeft})`, /back as it stood/.test(out.toastBack ?? '') && !/^bulldozing /.test(out.nothingLeft ?? ''), out);
check(`the buildings made after it have ids of their own (no id twice)`, out.idsAfter && !out.idsAfter.dup, out.idsAfter);
check(`three homes bulldozed in one sweep are one Undo ("${out.sweep?.label3}"), a fourth in the next sweep is its own ("${out.sweep?.label4}"): undoing that puts back the fourth alone, undoing again puts back all three as they stood (${out.sweep?.back}; "${out.sweep?.toast}")`,
  out.sweep && out.sweep.label3 === 'bulldozing 3 buildings' && /^bulldozing (?!3 buildings)/.test(out.sweep.label4 ?? '') && out.sweep.after4.fourth && out.sweep.after4.three === 0 && out.sweep.after4.next === 'bulldozing 3 buildings' && out.sweep.back === 3 && /They are back as they stood/.test(out.sweep.toast ?? ''), out.sweep);
check(`a home whose lot was rezoned in between does not come back, and says why ("${out.rezoned?.toast}")`, out.rezoned && !out.rezoned.back && /no longer zoned/.test(out.rezoned.toast ?? ''), out.rezoned);
check(`a home whose lot something else was built on does not come back, and says why ("${out.builtOver?.toast}")`, out.builtOver && out.builtOver.other !== null && !out.builtOver.back && /something else has been built/.test(out.builtOver.toast ?? ''), out.builtOver);
const T = out.through, O = out.off;
// a road and its undo: every building it took is back as it stood, or counted as one that could not be; where the road cut no
// road that was there, back means lot for lot (the same lots under the same names)
const said = (r) => (r.there === r.under ? /put back/.test(r.toast ?? '') && !/could not/.test(r.toast ?? '') : r.there > 0 ? new RegExp(`${r.there} buildings? it bulldozed put back \(${r.under - r.there} could not be\)`).test(r.toast ?? '') : /could not be put back/.test(r.toast ?? ''));
const roadOk = (r) => !!r && r.segs > 0 && r.razed >= 1 && r.razed === r.under && r.roadGone && r.stood === r.there && (r.split > 0 || r.same === r.under) && said(r);
const how = (r) => (!r?.segs ? `not laid: ${r?.plan}` : `${r.razed} bulldozed, ${r.there} back${r.split ? ' (it cut a road that was there, so their lots have new names)' : `, ${r.same} of them lot for lot`}; "${r.toast}"`);
check(`a road laid through a row of homes bulldozes them, and undoing it takes the road away and puts them back as they stood (${how(T)})`, roadOk(T), T);
check(`a road laid off the homes' street and out through the homes behind, the same (${how(O)})`, roadOk(O), O);
check(`between the two roads buildings did come back (${(T?.there ?? 0) + (O?.there ?? 0)} of ${(T?.under ?? 0) + (O?.under ?? 0)})`, (T?.there ?? 0) + (O?.there ?? 0) >= 2, { T, O });
check(`after all of it no lot is claimed by a building that is not there, and every building's lots are its own (${out.sound?.orphans} and ${out.sound?.strays}, of ${out.sound?.buildings} buildings)`, out.sound && out.sound.orphans === 0 && out.sound.strays === 0, out.sound);
check(`a bought building is as before: undoing the purchase removes it, and bulldozing one leaves nothing new to undo (Undo offered "${out.bought?.labelWas}" before and "${out.bought?.labelAfter}" after)`,
  out.bought?.placed && out.bought.purchaseUndone && out.bought.gone && out.bought.labelAfter === out.bought.labelWas, out.bought);
check(`no errors on the page (${errs.length})`, errs.length === 0, errs.slice(0, 3));

await browser.close();
console.log(bad ? `${bad} FAILED` : 'all ok');
process.exit(bad ? 1 : 0);
