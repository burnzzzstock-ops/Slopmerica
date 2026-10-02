// A scripted commissioner for the late game. It plays the way a person does:
// streets in rings around the county road, zones painted where the demand bars
// say builders want them, and services built when the game says something is
// failing (the emergency card's "Fix ..." button) or coverage runs short. It
// only uses what a player can do: roads, zoning and placing services. Every
// decision is logged so a run says what it did and what blocked it.
//
// Usage (in the page): page.evaluate(installLatePlayer, opts), then
// page.evaluate(() => window.__player.step(10)) as often as needed. The
// function is serialised into the page, so it must not reference anything
// outside itself.
export function installLatePlayer(opts = {}) {
  const g = window.__game, d = window.__dbg, SV = window.__services, s = g.sim, T = g.terrain;
  cancelAnimationFrame(g.raf); // step by hand, no drawing
  const O = { block: 80, maxRing: 16, cushion: 6000, proactive: true, ringCost: 4500, ...opts };
  const S0 = g.startView();
  const own = (x, z) => !g.net.allowed || g.net.allowed(x, z);
  const P = (window.__player = {
    O, S: S0, ring: 0, blocks: [], built: {}, marks: {}, tiers: {}, blockers: {}, notes: [], spent: 0, day0: s.day,
  });
  const note = (t) => { P.notes.push(`d${Math.round(s.day)} ${t}`); if (P.notes.length > 400) P.notes.shift(); };
  const bump = (k, n = 1) => { P.blockers[k] = (P.blockers[k] || 0) + n; };
  // everything the player is told (toasts, banners, the milestone card), with the day
  P.msgs = []; P.injected = 0;
  for (const k of ['toast', 'banner', 'milestone']) {
    const f = g.ui?.[k];
    if (typeof f !== 'function') continue;
    g.ui[k] = function (...a) { P.msgs.push({ day: Math.round(s.day), k, t: a.map((x) => (typeof x === 'string' ? x : typeof x === 'number' ? String(x) : '')).join(' | ').slice(0, 200) }); if (P.msgs.length > 400) P.msgs.shift(); return f.apply(this, a); };
  }

  // ---------------------------------------------------------------- streets
  const bId = (i, j) => `${i},${j}`;
  const have = new Set();
  P.addRing = () => {
    const B = O.block, r = ++P.ring;
    let made = 0;
    for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
      if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
      const x = P.S.x + i * B, z = P.S.z + j * B;
      if (!own(x, z) || T.h(x, z) < 1.5 || T.slope(x, z) > 0.12) continue;
      let any = false;
      for (const [ax, az, bx, bz] of [[x - B / 2, z - B / 2, x + B / 2, z - B / 2], [x - B / 2, z + B / 2, x + B / 2, z + B / 2], [x - B / 2, z - B / 2, x - B / 2, z + B / 2], [x + B / 2, z - B / 2, x + B / 2, z + B / 2]]) {
        if (g.net.pickSeg((ax + bx) / 2, (az + bz) / 2, 2)) { any = true; continue; }
        if (s.money < O.cushion) break;
        const before = s.money, n = d.road(ax, az, bx, bz, 'twoLane');
        if (typeof n === 'number' && n > 0) { made++; any = true; P.spent += before - s.money; }
      }
      if (any && !have.has(bId(i, j))) { have.add(bId(i, j)); P.blocks.push({ x, z, i, j, kind: null, dist: Math.hypot(i, j) }); }
    }
    return made;
  };
  // the county road reaches the site: join the first block to it
  d.road(P.S.x, P.S.z, P.S.x + O.block / 2, P.S.z + O.block / 2, 'twoLane');
  P.addRing();

  // ---------------------------------------------------------------- zoning
  const GROUP = { res: ['resLow', 'resHigh'], com: ['comLow', 'comHigh'], ind: ['industry'], off: ['office'] };
  const zoneFor = (k) => {
    const pop = s.population;
    if (k === 'res') return s.isUnlocked({ zone: 'resHigh' }) && pop > 1500 ? 'resHigh' : 'resLow';
    if (k === 'com') return s.isUnlocked({ zone: 'comHigh' }) && pop > 2000 ? 'comHigh' : 'comLow';
    if (k === 'ind') return 'industry';
    return s.isUnlocked({ zone: 'office' }) ? 'office' : null;
  };
  const openLots = (k) => { let n = 0; const cells = []; for (const z of GROUP[k]) n += g.zones.candidates(z, cells).length; return n; };
  const paintBlocks = () => {
    let painted = 0;
    for (const k of ['res', 'com', 'ind', 'off']) {
      // (a person zones what the guide says builders want, from its own threshold up: at
      // R +7 with every home lot built on, waiting for 12 stalled a town for 2,000 days)
      if (s.demand[k] < 5) continue;
      const zone = zoneFor(k);
      if (!zone) continue;
      if (openLots(k) >= 10 + s.population / 250) continue;
      // industry goes to the outskirts, everything else near the middle
      const free = P.blocks.filter((b) => !b.kind).sort((a, b) => (k === 'ind' ? b.dist - a.dist : a.dist - b.dist));
      const blk = free[0];
      if (!blk) { bump('no unzoned block left'); continue; }
      blk.kind = zone;
      d.zone(blk.x, blk.z, 36, zone);
      painted++;
      if (painted >= 3) break;
    }
    return painted;
  };

  // ---------------------------------------------------------------- services
  const covOf = (b, c) => { const bs = SV.S.b.get(b.id); return bs ? bs.cov[c] : 0; };
  const zonedActive = () => [...g.buildings.list.values()].filter((b) => b.zone && !['service', 'landmark'].includes(b.zone) && b.state === 'active' && b.abandoned === undefined);
  const placeNear = (id, tx, tz, maxR = 900) => {
    for (let rr = 0; rr <= maxR; rr += 45) {
      const steps = rr === 0 ? 1 : 16;
      for (let a = 0; a < steps; a++) {
        const x = tx + Math.cos(a * 0.39 + rr) * rr, z = tz + Math.sin(a * 0.39 + rr) * rr;
        const sp = SV.findSpot(g, id, x, z);
        if (/Unlocks at/.test(sp.reason ?? '')) return { locked: true };
        if (sp.reason) continue;
        const c = SV.canPlace(g, id, sp.x, sp.z, sp.yaw);
        if (!c.ok) { if (/Needs \$|afford|money/i.test(c.reason ?? '')) return { poor: c.reason }; continue; }
        if (s.money !== Infinity && s.money - 0 < O.cushion * 0.5) return { poor: 'cushion' };
        const b = SV.place(g, id, sp.x, sp.z, sp.yaw);
        if (b) return { ok: true, b };
      }
    }
    return { none: true };
  };
  const build = (id, tx, tz, why) => {
    const before = s.money;
    const r = placeNear(id, tx, tz);
    if (r.ok) { P.built[id] = (P.built[id] || 0) + 1; P.spent += before - s.money; note(`built ${id} (${why})`); return true; }
    if (r.locked) bump(`${id} still locked`);
    else if (r.poor) bump(`can't afford ${id}`);
    else bump(`no spot for ${id}`);
    return false;
  };
  const centre = () => { let x = 0, z = 0, n = 0; for (const b of zonedActive()) { x += b.x; z += b.z; n++; } return n ? { x: x / n, z: z / n } : { x: P.S.x, z: P.S.z }; };
  const water = () => {
    // a point on the shore near the town, for things that must touch water
    let best = null;
    for (let r = 60; r < 1400 && !best; r += 60) for (let a = 0; a < 24; a++) {
      const x = P.S.x + Math.cos(a * 0.26) * r, z = P.S.z + Math.sin(a * 0.26) * r;
      if (T.h(x, z) < -0.5 && own(x, z) === true) { best = { x, z }; break; }
    }
    return best;
  };
  const utilFix = () => {
    const u = SV.snapshot().util, c = centre();
    let did = 0;
    // water: a pump on the river when there is one, wells otherwise
    if (u.water.demand > u.water.supply * 0.9) {
      const w = water();
      if ((w && build('waterPump', w.x, w.z, `water ${Math.round(u.water.demand)} vs ${Math.round(u.water.supply)}`)) || build('wellTower', c.x, c.z, 'water')) did++;
    }
    if (u.sewage.demand > u.sewage.supply * 0.9) {
      const w = water();
      const id = s.peakPop >= 1000 && s.money > 40000 ? 'treatmentPlant' : 'sewageOutfall';
      if ((w && build(id, w.x, w.z, 'sewage')) || build('sewageOutfall', (w || c).x, (w || c).z, 'sewage')) did++;
    }
    if (u.power.demand > u.power.supply * 0.8) {
      const short = u.power.demand - u.power.supply;
      const id = short > 40 && s.peakPop >= 6500 && s.money > 260000 ? 'nuclearPlant' : short > 10 && s.money > 45000 ? 'coalPlant' : 'gasPeaker';
      if (build(id, c.x, c.z, `power ${u.power.demand.toFixed(1)} vs ${u.power.supply}`)) did++;
    }
    return did;
  };
  const COVERAGE = [
    { cov: 'fire', pick: () => 'fireStation', enough: 0.9 },
    { cov: 'police', pick: () => 'sheriff', enough: 0.85 },
    { cov: 'health', pick: () => (s.peakPop >= 2800 && s.money > 90000 ? 'hospital' : 'clinic'), enough: 0.85 },
    { cov: 'school', pick: () => 'school', enough: 0.8 },
    { cov: 'garbage', pick: () => (s.peakPop >= 1800 && s.money > 60000 ? 'incinerator' : 'landfill'), enough: 0.9 },
  ];
  const coverageFix = () => {
    let did = 0;
    const act = zonedActive();
    if (act.length < 8) return 0;
    for (const C of COVERAGE) {
      const un = act.filter((b) => covOf(b, C.cov) < 0.05);
      if (un.length / act.length <= 1 - C.enough) continue;
      let x = 0, z = 0; for (const b of un) { x += b.x; z += b.z; }
      x /= un.length; z /= un.length;
      if (build(C.pick(), x, z, `${C.cov} covers ${Math.round((1 - un.length / act.length) * 100)}%`)) did++;
    }
    // a university once the town is big enough for one
    if (s.peakPop >= 4200 && !P.built.college && s.money > 120000) { const c = centre(); if (build('college', c.x, c.z, 'university')) did++; }
    // a second landfill or more trucks when the first is nearly full
    const gs = SV.snapshot().garbage;
    if (gs.daysLeft < 150 && s.money > 20000) { const c = centre(); if (build(s.peakPop >= 1800 && s.money > 60000 ? 'incinerator' : 'landfill', c.x, c.z, `landfill full in ${Math.round(gs.daysLeft)}d`)) did++; }
    return did;
  };
  let seed = 12345;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  // the lot near an overloaded station that takes most of its load: each building is served by its nearest
  // station by drive time, so each lot is scored by the people the game would move from the overloaded one to
  // it (SV.takeFrom, the game's own drive times; as the crow flies when the game hasn't got it), and half the
  // people it would take from the others of its kind that are nearly full too (a town outgrowing all of them)
  const reliefSpot = (id, kinds, o) => {
    const site = [...g.buildings.list.values()].find((b) => b.zone === 'service' && kinds.includes(b.kind) && Math.hypot(b.x - o.x, b.z - o.z) < 1);
    if (!site) return null;
    const full = new Set([...g.buildings.list.values()].filter((b) => b !== site && b.zone === 'service' && kinds.includes(b.kind) && (SV.S.f.get(b.id)?.load ?? 0) >= o.capacity * 0.85).map((b) => b.id));
    const near = [];
    if (!SV.takeFrom) {
      const sites = [...g.buildings.list.values()].filter((b) => b.zone === 'service' && kinds.includes(b.kind));
      for (const b of zonedActive()) {
        let d = Infinity, f0 = null;
        for (const f of sites) { const df = Math.hypot(f.x - b.x, f.z - b.z); if (df < d) { d = df; f0 = f; } }
        if (f0 === site) near.push({ b, d });
      }
    }
    let best = null;
    for (const r of [60, 120, 200, 300, 420]) for (let a = 0; a < 12; a++) {
      const sp = SV.findSpot(g, id, o.x + Math.cos(a * 0.524 + r) * r, o.z + Math.sin(a * 0.524 + r) * r);
      if (sp.reason || !SV.canPlace(g, id, sp.x, sp.z, sp.yaw).ok) continue;
      let take = 0;
      if (SV.takeFrom) for (const [k, n] of Object.entries(SV.takeFrom(g, id, sp.x, sp.z))) take += Number(k) === site.id ? n : full.has(Number(k)) ? n / 2 : 0;
      else for (const h of near) if (Math.hypot(h.b.x - sp.x, h.b.z - sp.z) < h.d) take += Math.max(h.b.occ || 0, (h.b.cap || 0) * 0.3);
      if (!best || take > best.take) best = { ...sp, take };
    }
    return best;
  };
  const overloadFix = () => {
    let did = 0;
    for (const o of SV.overloadedServices(g)) {
      // next to the overloaded one, as a person would: each building is served by its nearest
      // station, so one built at the town's middle took none of its load (83 clinics in a
      // Florida run, the same one still overloaded)
      const c = Number.isFinite(o.x) ? { x: o.x, z: o.z } : centre();
      const why = `${o.name} overloaded ${o.load}/${o.capacity}`;
      if (o.cat === 'health') {
        // a clinic on the nearest free lot, at the built-up core's edge, took 19 to 960 people while the
        // overloaded one kept 1,600-1,750 (botclinics: 10 clinics by 2,805 people). A person builds a hospital
        // once they can (reach 200, room for 6,000), and before that a clinic where it takes the most load
        if (s.money > 60000 + O.cushion && build('hospital', c.x, c.z, why)) { did++; continue; }
        const sp = reliefSpot('clinic', ['clinic', 'hospital'], c);
        // (no lot that takes 150 of them: one beside it, as before, adds room at least)
        if (!sp || sp.take < 150) { bump('no lot would take an overloaded clinic\'s load'); if (build('clinic', c.x + (rnd() - 0.5) * 200, c.z + (rnd() - 0.5) * 200, why)) did++; continue; }
        if (s.money !== Infinity && s.money < O.cushion * 0.5) { bump("can't afford clinic"); continue; }
        const before = s.money;
        if (SV.place(g, 'clinic', sp.x, sp.z, sp.yaw)) { P.built.clinic = (P.built.clinic || 0) + 1; P.spent += before - s.money; note(`built clinic (${why}; it takes ~${Math.round(sp.take)} people)`); did++; }
        continue;
      }
      const id = { fire: 'fireStation', police: 'sheriff', education: 'school', garbage: 'landfill', parks: 'park' }[o.cat];
      if (id && build(id, c.x + (rnd() - 0.5) * 200, c.z + (rnd() - 0.5) * 200, why)) did++;
    }
    return did;
  };
  // ONE MORE LANE: a street with a queue on it gets the next road type
  const upgradeJams = (limit = 6) => {
    const per = new Map();
    for (const c of g.traffic.cars) { if (c.v > 0.5 || c.junction) continue; const id = c.path[c.pi]?.seg; if (id) per.set(id, (per.get(id) || 0) + 1); }
    let did = 0;
    for (const [id, n] of [...per].sort((a, b) => b[1] - a[1])) {
      if (n < 4 || did >= limit) break;
      const seg = g.net.segs.get(id);
      if (!seg || !['twoLane', 'stroad4', 'stroad6'].includes(seg.type)) continue;
      const next = { twoLane: 'stroad4', stroad4: 'stroad6', stroad6: 'stroad8' }[seg.type];
      if (!s.isUnlocked({ road: next })) continue;
      const q = g.quoteUpgrade([seg], next);
      if (!q || q.net > s.money - O.cushion * 2) { bump('cannot afford ONE MORE LANE'); continue; }
      const r = g.upgradeRoads([seg]);
      if (r.ok) { did++; P.upgrades = (P.upgrades || 0) + 1; P.spent += q.net; } else bump(`upgrade refused: ${r.reason}`);
    }
    if (did) note(`ONE MORE LANE on ${did} jammed streets`);
    return did;
  };
  const followGuide = () => {
    // what the Next bar says, as a person would follow it
    const e = g.emergency?.();
    let did = 0;
    if (e && e.level !== 'none' && e.level !== 'recovering') {
      for (const need of e.needs) {
        const hot = e.hot[0] ?? centre();
        const tx = hot.x, tz = hot.z;
        const ids = { power: ['gasPeaker'], water: ['wellTower'], sewage: ['sewageOutfall'], garbage: ['landfill'], health: ['clinic'], fire: ['fireStation'], police: ['sheriff'] }[need.cat] || [];
        const ok = ids.some((id) => (need.cat === 'water' || need.cat === 'sewage') && water() ? build(id === 'wellTower' ? 'waterPump' : id, (water() || { x: tx }).x, (water() || { z: tz }).z, `guide: ${need.cat}`) || build(id, tx, tz, `guide: ${need.cat}`) : build(id, tx, tz, `guide: ${need.cat}`));
        if (ok) did++;
        else bump(`guide could not fix ${need.cat}`);
      }
    }
    return did;
  };

  // ---------------------------------------------------------------- the loop
  const MARKS = [150, 350, 650, 1100, 1800, 2800, 4200, 6500, 10000];
  P.step = (days = 10) => {
    const r = d.run(days);
    if (O.fund && s.money !== Infinity && s.money < O.fund) { const add = O.fund - s.money; s.earn(add, 'other', 'test top-up'); P.injected += add; }
    for (const m of MARKS) if (!P.marks[m] && s.population >= m) P.marks[m] = { day: Math.round(s.day), money: Math.round(s.money), blds: g.buildings.list.size, injected: Math.round(P.injected), next: g.ui.nextAction?.()?.text ?? null, msgs: P.msgs.filter((x) => x.day >= Math.round(s.day) - days - 1).map((x) => `${x.k}: ${x.t}`).slice(-6) };
    const acts = [];
    let z = 0, sv = 0, rg = 0;
    const em = g.emergency?.();
    sv += followGuide();
    sv += overloadFix();
    if (O.proactive) { sv += utilFix(); sv += coverageFix(); }
    if (O.upgrades && Math.round(s.day) % 30 < days) upgradeJams();
    // taxes like a person: thin treasury and a losing week -> a point more (to 15%); flush again -> ease back toward 9%
    if (O.taxes !== false && s.money !== Infinity) {
      const net = s.weeklyNet(), cap = O.maxTax || 0.15;
      if (net < 0 && s.money < 20000 && s.taxRate < cap - 0.001) { s.taxRate = Math.round((s.taxRate + 0.01) * 100) / 100; P.taxMoves = (P.taxMoves || 0) + 1; note(`taxes up to ${Math.round(s.taxRate * 100)}%`); }
      else if (net > 2500 && s.money > 40000 && s.taxRate > 0.0901) { s.taxRate = Math.round((s.taxRate - 0.01) * 100) / 100; P.taxMoves = (P.taxMoves || 0) + 1; note(`taxes down to ${Math.round(s.taxRate * 100)}%`); }
      // and a person who reads the guide: taxes named as what holds homes back, and the money to spare -> a point less
      else if (/held back by taxes/.test(g.ui.nextAction?.()?.text ?? '') && net > 0 && s.money > 15000 && s.taxRate > 0.0901) { s.taxRate = Math.round((s.taxRate - 0.01) * 100) / 100; P.taxMoves = (P.taxMoves || 0) + 1; note(`taxes down to ${Math.round(s.taxRate * 100)}% (the guide)`); }
    }
    // the bankruptcy card: a person reads it and takes the sandbox bailout
    for (const b of document.querySelectorAll('.ending.bankrupt #end-go')) { b.click(); P.bankruptcies = (P.bankruptcies || 0) + 1; note(`bailout taken at day ${Math.round(s.day)}, pop ${s.population}`); }
    if (O.loans && s.money < 2000 && s.loans.length < 3 && s.weeklyNet() > 0) { s.takeLoan(10000); note('took a $10,000 loan'); }
    z = paintBlocks();
    // streets when every zoned lot has been spoken for and a block is needed
    const unz = P.blocks.filter((b) => !b.kind).length;
    if (unz < 3 && s.money > O.ringCost && P.ring < O.maxRing) rg = P.addRing();
    else if (unz < 3 && P.ring >= O.maxRing) bump('city limit (maxRing) reached');
    if (s.money !== Infinity && s.money < 0) bump('treasury in the red');
    const next = g.ui.nextAction?.();
    if (next) bump(`guide: ${next.text.replace(/[0-9,]+/g, 'N').slice(0, 70)}`);
    return { day: Math.round(s.day), pop: s.population, money: Math.round(s.money), net: Math.round(s.weeklyNet()), dem: ['res', 'com', 'ind', 'off'].map((k) => Math.round(s.demand[k])).join('/'), bld: g.buildings.list.size, svc: sv, zoned: z, streets: rg, em: em ? em.level : 'n/a', ring: P.ring, next: next ? next.text.slice(0, 90) : null };
  };
  return { ok: true, blocks: P.blocks.length };
}
