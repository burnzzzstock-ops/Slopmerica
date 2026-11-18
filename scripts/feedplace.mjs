// News that happened somewhere says where: feed.push is handed at { x, z } with a building's, a crash's, a road's, a commune's,
// a service's or a bought tile's place, and the post built from it keeps it (FeedPost.at), so the panel can take the camera there.
// On a small street: every kind of news below is pushed once, by the game's own handlers, and its place is the thing's own
// (a building's centre, the crash's point, a point on the road, the commune, the tile's middle), inside the county; news with
// no place (low money) has none; and postFor() carries a place onto the post and invents none. Exits nonzero on failure.
//
//   BASE_URL=http://127.0.0.1:5173 node scripts/feedplace.mjs      (SEED=n for another county's dice)
import { launch } from './lib/browser.mjs';
import { seededInit, seededRandom, testSeed } from './refblock.mjs';

const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const SEED = testSeed();
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra).slice(0, 700)); if (!ok) bad++; };

const browser = await launch();
const errs = [];
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(seededInit, { seed: SEED, rng: seededRandom.toString() });
await page.addInitScript(() => { try { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.firstSteps', '1'); localStorage.setItem('slopmerica.emergencySpeed', 'off'); } catch { /* */ } });
await page.goto(`${base}/#skip&map=norcal&mode=ponzi&seed=${SEED}`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__game && window.__dbg && window.__services && window.__land, null, { timeout: 180000 });

const out = await page.evaluate(async () => {
  const g = window.__game, d = window.__dbg, SV = window.__services, LD = window.__land;
  cancelAnimationFrame(g.raf);
  const { fx } = await import('/src/core/rng.ts');
  const { postFor } = await import('/src/content/feed.ts');
  const { WORLD } = await import('/src/config.ts');
  // what the feed is handed, and what the thing's own place was when it was
  const seen = [];
  g.feed = { push: (kind, extra = {}) => { seen.push({ kind, at: extra.at ? { x: extra.at.x, z: extra.at.z } : null }); } };
  const last = (kind) => seen.filter((s) => s.kind === kind).at(-1) ?? null;
  const want = [];   // { kind, got, where, tol }
  const note = (kind, where, tol = 0.01) => want.push({ kind, got: last(kind)?.at ?? null, pushed: !!last(kind), where, tol });
  // (the dice that decide whether everyday news is worth a post say yes while this runs)
  const float = fx.float; fx.float = () => 0;
  g.sim.money += 5e6;

  const S = g.startView();
  d.road(S.x - 150, S.z, S.x + 150, S.z, 'twoLane');
  d.zone(S.x - 60, S.z + 40, 60, 'resLow');
  d.zone(S.x + 60, S.z + 40, 50, 'comLow');
  d.run(40);
  const blds = [...g.buildings.list.values()];
  // two grown buildings: one to level up and to have a line out of its drive-through, one to go under a road
  const grown = blds.filter((b) => b.state === 'active' && (b.zone === 'resLow' || b.zone === 'comLow'));
  const shop = grown.find((b) => b.zone === 'comLow') ?? grown[0], home = grown.find((b) => b !== shop);
  const seg = [...g.net.segs.values()].sort((a, b) => Math.hypot(a.samp.pts[0].x - S.x, a.samp.pts[0].z - S.z) - Math.hypot(b.samp.pts[0].x - S.x, b.samp.pts[0].z - S.z))[0];
  const onSeg = (p) => (p ? Math.min(...seg.samp.pts.map((q) => Math.hypot(q.x - p.x, q.z - p.z))) : null);

  // a building levels up, and one is bulldozed for a road
  if (shop) { g.buildings.onLevel(shop); note('buildingLeveled', { x: shop.x, z: shop.z }); }
  // a crash, a jam, a drive-through line out onto the road, a lane added
  g.traffic.onCrash([], seg, false, 1, S.x + 5, S.z + 1); note('crash', { x: S.x + 5, z: S.z + 1 });
  g.traffic.onJam(seg); const jam = last('trafficJam')?.at ?? null;
  if (shop) { g.traffic.onDriveThruSpill(shop, seg); note('driveThruLine', { x: shop.x, z: shop.z }); }
  g.onLaneAdded([seg], 'stroad4'); const lane = last('laneAdded')?.at ?? null;
  // a landmark opened: a water tower beside the street
  let tower = null;
  for (const off of [30, 45, 60, 80, 110]) for (const side of [-1, 1]) for (const along of [0, -90, 90]) {
    if (tower) break;
    const sp = g.landmarkSpot('waterTower', S.x + along, S.z + side * off);
    if (sp.ok && g.placeLandmark('waterTower', { x: sp.x, z: sp.z })) tower = [...g.buildings.list.values()].find((b) => b.landmark === 'waterTower') ?? null;
  }
  if (tower) note('buildingOpened', { x: tower.x, z: tower.z });
  // a service built
  d.unlockAll();   // (a clinic unlocks at 150 people)
  let svc = null, svcWhy = null;
  for (let r = 60; r < 500 && !svc; r += 30) for (let a = 0; a < 16 && !svc; a++) {
    const sp = SV.findSpot(g, 'clinic', S.x + Math.cos(a * 0.39) * r, S.z + Math.sin(a * 0.39) * r);
    if (!sp.reason) svc = SV.place(g, 'clinic', sp.x, sp.z, sp.yaw); else svcWhy = sp.reason;
  }
  if (svc) note('serviceBuilt', { x: svc.x, z: svc.z });
  // a commune taken to court
  const c = g.communes.list.find((k) => k.state === 'active' && !k.forever) ?? null;
  if (c) { g.sue(c); note('communeSued', { x: c.x, z: c.z }); }
  // a tile of land bought: the tile's middle
  const N = Math.round(Math.sqrt(LD.L.owned.length));
  const t = [...LD.L.owned.keys()].find((i) => !LD.L.owned[i] && [1, -1, N, -N].some((o) => LD.L.owned[i + o] && Math.abs((i % N) - ((i + o) % N)) <= 1));
  const bought = t !== undefined && LD.buy(g, t);
  const tile = last('zoned')?.at ?? null;
  const tileIs = tile ? LD.tileOf(tile.x, tile.z) : null;
  // the home goes under a road
  if (home) { const at = { x: home.x, z: home.z }; g.buildings.demolish(home, 'road'); note('buildingDemolished', at); }
  // news with no place
  g.sim.events.emit('lowMoney');
  fx.float = float;

  // the post keeps the place it is given, and has none of its own
  const ctx = (extra) => g.ctx({ road: 'Main Street', ...extra });
  const withAt = postFor('crash', ctx({ at: { x: 12.5, z: -34.25 } }), Math.random);
  const without = postFor('crash', ctx({}), Math.random);
  const broken = postFor('crash', ctx({ at: { x: NaN, z: 3 } }), Math.random);
  return {
    shop: !!shop, home: !!home, tower: !!tower, svc: !!svc, svcWhy, commune: !!c, bought, grown: grown.length,
    half: WORLD / 2, kinds: [...new Set(seen.map((s) => s.kind))], all: seen, want,
    tile, tileIs, tileWas: t === undefined ? null : [t % N, Math.floor(t / N)],
    jam, jamOff: onSeg(jam), lane, laneOff: onSeg(lane), lowMoney: last('lowMoney'),
    withAt: withAt?.at ?? null, without: without ? 'at' in without : null, broken: broken ? 'at' in broken : null,
  };
});

check(`the street grew buildings (${out.grown}), a water tower and a clinic went up, a commune was there to sue and a tile was for sale`, out.shop && out.home && out.tower && out.svc && out.commune && out.bought, out);
check(`seven kinds of news were pushed to be checked against the thing they are about (${out.want.length}: ${out.want.map((w) => w.kind).join(', ')}); a jam, an added lane and a bought tile are checked below`, out.want.length === 7, out.want.map((w) => w.kind));
for (const w of out.want) {
  const off = w.got ? Math.hypot(w.got.x - w.where.x, w.got.z - w.where.z) : null;
  check(`${w.kind}: the news is where it happened (${!w.pushed ? 'not pushed' : off === null ? 'no place' : off.toFixed(2) + ' m off'})`, off !== null && off <= w.tol, w);
}
check(`a jam's place is a point on its road (${out.jamOff === null ? 'no place' : out.jamOff.toFixed(2) + ' m off it'}), and so is an added lane's (${out.laneOff === null ? 'no place' : out.laneOff.toFixed(2) + ' m'})`,
  out.jamOff !== null && out.jamOff < 0.01 && out.laneOff !== null && out.laneOff < 0.01, { jam: out.jam, lane: out.lane });
check(`a bought tile's news is in the middle of that tile (tile ${JSON.stringify(out.tileWas)}, the place is in ${JSON.stringify(out.tileIs)})`,
  !!out.tile && JSON.stringify(out.tileIs) === JSON.stringify(out.tileWas), out);
const placed = out.all.filter((s) => s.at);
check(`every place is a pair of numbers inside the county (${placed.length} of ${out.all.length} posts have one)`,
  placed.length >= 9 && placed.every((s) => Number.isFinite(s.at.x) && Number.isFinite(s.at.z) && Math.abs(s.at.x) <= out.half && Math.abs(s.at.z) <= out.half), placed.slice(0, 6));
check(`news that happened nowhere in particular has no place (low money: ${out.lowMoney ? JSON.stringify(out.lowMoney.at) : 'not pushed'})`, !!out.lowMoney && out.lowMoney.at === null, out.lowMoney);
check(`the post keeps the place it is given (${JSON.stringify(out.withAt)}), has none when given none, and none when given one that is not a number`,
  !!out.withAt && out.withAt.x === 12.5 && out.withAt.z === -34.25 && out.without === false && out.broken === false, out);
check(`no errors on the page (${errs.length})`, errs.length === 0, errs.slice(0, 3));

await browser.close();
console.log(bad ? `${bad} FAILED` : 'all ok');
process.exit(bad ? 1 : 0);
