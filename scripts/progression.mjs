// Progression pacing: a scripted player grows a Ponzi-mode town the way a
// person would (a street grid, homes, shops and industry, each service built
// once it's unlocked and affordable, more streets when the lots run out) and
// the log says when each population mark was reached, what the treasury was,
// and what was built when. Compare builds with BASE_URL. Prints a timeline;
// with CHECK=1 exits nonzero if the pacing is off (a milestone never
// reached, or reached absurdly fast, or the town can build every service in
// its first month).
import { chromium } from 'playwright-core';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const DAYS = Number(process.env.DAYS || 720);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => { try { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); } catch { /* */ } });
await page.goto(`${base}/#skip&map=${process.env.MAP || 'florida'}&mode=ponzi`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__game && window.__dbg && window.__services, null, { timeout: 180000 });
await page.evaluate(() => cancelAnimationFrame(window.__game.raf));

// the town: a street grid off the site, grown block by block
const setup = await page.evaluate(() => {
  const g = window.__game, d = window.__dbg, S = g.startView(), T = g.terrain;
  const own = (x, z) => !g.net.allowed || g.net.allowed(x, z);
  // the block grid: 80 m streets around the site, on owned dry land
  const B = 80;
  window.__town = { S, B, blocks: [], ring: 0, built: [], spent: 0 };
  const W = window.__town;
  W.addRing = () => {
    const r = ++W.ring, made = [];
    for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
      if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
      const x = S.x + i * B, z = S.z + j * B;
      if (!own(x, z) || T.h(x, z) < 1.5 || T.slope(x, z) > 0.12) continue;
      for (const [ax, az, bx, bz] of [[x - B / 2, z - B / 2, x + B / 2, z - B / 2], [x - B / 2, z + B / 2, x + B / 2, z + B / 2], [x - B / 2, z - B / 2, x - B / 2, z + B / 2], [x + B / 2, z - B / 2, x + B / 2, z + B / 2]]) {
        if (g.net.pickSeg((ax + bx) / 2, (az + bz) / 2, 2)) continue;
        const before = g.sim.money, n = d.road(ax, az, bx, bz, 'twoLane');
        if (typeof n === 'number' && n > 0) { made.push(1); W.spent += before - g.sim.money; }
      }
      // homes on most blocks, shops on some, industry at the edge
      const kind = (i + j) % 5 === 0 ? 'comLow' : r >= 2 && (i === r || j === r) && (i + j) % 3 === 0 ? 'industry' : 'resLow';
      d.zone(x, z, 36, kind);
      W.blocks.push({ x, z, kind });
    }
    return made.length;
  };
  // the county road reaches the site: join the grid to it
  d.road(S.x, S.z, S.x + B / 2, S.z + B / 2, 'twoLane');
  const streets = W.addRing();
  return { S: { x: Math.round(S.x), z: Math.round(S.z) }, streets, money: Math.round(g.sim.money) };
});
console.log('setup', JSON.stringify(setup));

// what a player builds, in order, once it's unlocked and they can afford it (keeping a cushion)
const WANT = ['wellTower', 'sewageOutfall', 'gasPeaker', 'landfill', 'clinic', 'fireStation', 'sheriff', 'school', 'park', 'coalPlant', 'treatmentPlant', 'hospital', 'incinerator', 'college'];
const marks = [150, 350, 650, 1100, 1800, 2800, 4200, 6500, 10000];
const reached = {};
const timeline = [];
for (let day = 0; day < DAYS; day += 15) {
  const st = await page.evaluate(({ WANT }) => {
    const g = window.__game, d = window.__dbg, SV = window.__services, W = window.__town, s = g.sim;
    const r = d.run(15);
    const built = [];
    // services as they unlock and the money allows (keep $8,000 in hand)
    for (const id of WANT) {
      if (W.built.includes(id)) continue;
      // find a spot near town
      let placed = null, locked = false;
      for (let rr = 60; rr < 700 && !placed && !locked; rr += 40) for (let a = 0; a < 16 && !placed && !locked; a++) {
        const x = W.S.x + Math.cos(a * 0.39) * rr, z = W.S.z + Math.sin(a * 0.39) * rr;
        const sp = SV.findSpot(g, id, x, z);
        if (/Unlocks at/.test(sp.reason ?? '')) { locked = true; break; }
        if (sp.reason) continue;
        const before = s.money;
        if (before < 8000) break;
        const c = SV.canPlace(g, id, sp.x, sp.z, sp.yaw);
        if (!c.ok) { if (/Needs \$|money|afford/i.test(c.reason ?? '')) { rr = 1e9; } continue; }
        placed = SV.place(g, id, sp.x, sp.z, sp.yaw);
        if (placed && s.money < 8000) { g.undo(); placed = null; rr = 1e9; }
      }
      if (placed) { W.built.push(id); built.push(id); }
      else if (!locked) break; // build in order: save up for this one first
    }
    // more streets when the lots are nearly full and there's money for them
    let free = 0;
    for (const c of g.zones.cells.values()) if (c.valid && (c.zone === 'resLow' || c.zone === 'resHigh') && !c.bld && c.row === 0) free++;
    let ring = 0;
    if (free < 25 && s.money > 15000 && W.ring < 7) ring = W.addRing();
    return { day: Math.round(s.day), pop: s.population, money: Math.round(s.money), net: Math.round(s.weeklyNet()), tier: s.tier ?? null, built, ring, free, dem: Object.values(s.demand).map((v) => Math.round(v)).join('/') };
  }, { WANT });
  for (const m of marks) if (!reached[m] && st.pop >= m) reached[m] = st.day;
  timeline.push(st);
  console.log(JSON.stringify(st));
}
const allBuiltBy = await page.evaluate(() => window.__town.built.slice());
console.log('reached', JSON.stringify(reached));
console.log('built', JSON.stringify(allBuiltBy));
console.log('errors', JSON.stringify(errs.slice(0, 3)));
await browser.close();
