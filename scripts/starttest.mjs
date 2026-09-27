// A new county starts somewhere sensible, and not always the same place: the
// town site is flat, dry and roomy; Old County Road comes in from the map's
// entry edge along the land (one bridge at most, no zig-zags across the
// river) and reaches the site; #start=<n> picks among several good sites far
// apart; a saved city keeps its site, and a save from before sites were saved
// gets the old one back. Trees: no disc of detailed trees following the
// camera when zoomed out, detailed trees up close, no gaps. SHOTS=prefix saves
// pictures. Exits nonzero on failure.
import { chromium } from 'playwright-core';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra)); if (!ok) bad++; };
const page = await browser.newPage({ viewport: { width: 700, height: 700 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => { try { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); } catch { /* */ } });
const boot = async (hash) => {
  // a new hash alone doesn't reload the page
  await page.goto('about:blank');
  await page.goto(`${base}/#${hash}`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__game && window.__dbg && window.__startSite, null, { timeout: 180000 });
};

/** the site and the county road, as the game built them */
const survey = () => {
  const g = window.__game, S = g.startView(), T = g.terrain;
  const segs = [...g.net.segs.values()];
  let len = 0, wet = 0, worst = 0;
  for (const s of segs) {
    len += s.length;
    const P = s.samp.pts;
    for (let i = 1; i < P.length; i++) if (T.h(P[i].x, P[i].z) < 0) wet += Math.hypot(P[i].x - P[i - 1].x, P[i].z - P[i - 1].z);
  }
  // the sharpest bend where one piece of road meets the next
  for (const n of g.net.nodes.values()) {
    if (n.segs.length !== 2) continue;
    const dir = (s, atA) => { const P = s.samp.pts, a = atA ? P[0] : P[P.length - 1], b = atA ? P[Math.min(2, P.length - 1)] : P[Math.max(0, P.length - 3)]; const l = Math.hypot(b.x - a.x, b.z - a.z) || 1; return { x: (b.x - a.x) / l, z: (b.z - a.z) / l }; };
    const [s1, s2] = n.segs.map((id) => g.net.segs.get(id));
    const d1 = dir(s1, s1.a === n.id), d2 = dir(s2, s2.a === n.id);
    worst = Math.max(worst, 180 - (Math.acos(Math.max(-1, Math.min(1, d1.x * d2.x + d1.z * d2.z))) * 180) / Math.PI);
  }
  const nodes = [...g.net.nodes.values()];
  const near = (x, z) => Math.min(...nodes.map((n) => Math.hypot(n.x - x, n.z - z)));
  const half = Math.max(...nodes.map((n) => Math.max(Math.abs(n.x), Math.abs(n.z))));
  let flat = 0;
  for (let k = 0; k < 48; k++) { const a = k * 2.399, r = 40 + (k / 48) * 300, x = S.x + Math.cos(a) * r, z = S.z + Math.sin(a) * r; if (T.h(x, z) > 1.4 && T.slope(x, z) < 0.12) flat++; }
  return { x: Math.round(S.x), z: Math.round(S.z), h: +T.h(S.x, S.z).toFixed(1), slope: +T.slope(S.x, S.z).toFixed(3), flat, len: Math.round(len), wet: Math.round(wet), bend: Math.round(worst), toSite: Math.round(near(S.x, S.z)), toEdge: Math.round(near(S.edge.x, S.edge.z)), half: Math.round(half), route: S.route?.length ?? 0 };
};

const sites = {};
for (const map of ['florida', 'norcal', 'appalachia']) {
  await boot(`skip&map=${map}&mode=sandbox`);
  const s = await page.evaluate(survey);
  console.log(map, JSON.stringify(s));
  sites[map] = s;
  check(`${map}: the town site is dry, level and roomy (height ${s.h}, slope ${s.slope}, ${s.flat}/48 buildable around it)`, s.h > 1.2 && s.slope < 0.1 && s.flat >= 30, s);
  check(`${map}: Old County Road runs from the edge to the site (${s.len} m, ends ${s.toSite} m from it, starts ${s.toEdge} m from the edge)`, s.toSite < 5 && s.toEdge < 60 && s.route > 1, s);
  check(`${map}: it follows the land: ${s.wet} m over water, sharpest bend ${s.bend}°`, s.wet < 160 && s.bend < 60, s);
  if (process.env.SHOTS) {
    await page.evaluate(() => { const g = window.__game, S = g.startView(); cancelAnimationFrame(g.raf); document.querySelector('.hud').style.visibility = 'hidden'; g.rts.setView(S.x, S.z, 1400, S.yaw, 1.1, true); for (let i = 0; i < 20; i++) g.frame(0.05, false); g.frame(0.016, true); });
    await page.screenshot({ path: `${process.env.SHOTS}-${map}.png`, timeout: 240000 });
  }
}

// other good sites, far apart
await boot('skip&map=florida&mode=sandbox&start=1');
const s1 = await page.evaluate(survey);
await boot('skip&map=florida&mode=sandbox&start=2');
const s2 = await page.evaluate(survey);
const n = await page.evaluate(() => window.__startSite.candidates(window.__game.terrain));
const apart = (a, b) => Math.round(Math.hypot(a.x - b.x, a.z - b.z));
console.log(JSON.stringify({ s1, s2, n }));
check(`there's a choice of good sites (${n}), and the picks are far apart (${apart(sites.florida, s1)} m, ${apart(s1, s2)} m)`, n >= 3 && apart(sites.florida, s1) >= 700 && apart(s1, s2) >= 700, { s1, s2, n });
check('every pick is a good one', [s1, s2].every((s) => s.h > 1.2 && s.slope < 0.1 && s.flat >= 30 && s.toSite < 5 && s.wet < 160), { s1, s2 });

// a saved city keeps its site (and its communes stay put)
const saved = await page.evaluate(() => {
  const g = window.__game;
  window.__dbg.save();
  return { site: { x: Math.round(g.startView().x), z: Math.round(g.startView().z) }, communes: g.communes.list.map((c) => [c.id, Math.round(c.x), Math.round(c.z)]) };
});
await page.goto(`${base}/`, { waitUntil: 'load' });
await page.waitForSelector('#continue', { timeout: 120000 });
await page.click('#continue');
await page.waitForFunction(() => window.__game && window.__startSite, null, { timeout: 180000 });
const reloaded = await page.evaluate(() => { const g = window.__game; return { site: { x: Math.round(g.startView().x), z: Math.round(g.startView().z) }, communes: g.communes.list.map((c) => [c.id, Math.round(c.x), Math.round(c.z)]) }; });
check(`a saved city keeps its site (${JSON.stringify(saved.site)} → ${JSON.stringify(reloaded.site)}) and its communes`, JSON.stringify(saved) === JSON.stringify(reloaded), { saved, reloaded });

// a save from before sites were saved gets the old site back (edited at the
// title screen: leaving a running game saves it again)
await page.goto(`${base}/`, { waitUntil: 'load' });
await page.waitForSelector('#continue', { timeout: 120000 });
await page.evaluate(() => { for (const k of ['slopmerica.save.v1', 'slopmerica.save.v1.checkpoint']) { const raw = localStorage.getItem(k); if (!raw) continue; const d = JSON.parse(raw); delete d.start; localStorage.setItem(k, JSON.stringify(d)); } });
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('#continue', { timeout: 120000 });
await page.click('#continue');
await page.waitForFunction(() => window.__game && window.__startSite, null, { timeout: 180000 });
const legacy = await page.evaluate(() => { const g = window.__game, S = g.startView(), L = window.__startSite.legacyStart(g.terrain, g.map.def.entry); return { S: [Math.round(S.x), Math.round(S.z)], L: [Math.round(L.x), Math.round(L.z)] }; });
check(`an older save gets the old site back (${legacy.S} = ${legacy.L})`, legacy.S.join() === legacy.L.join(), legacy);

// trees: no disc of detailed trees following the camera when zoomed out
await boot('skip&map=appalachia&mode=sandbox');
const tr = await page.evaluate(() => {
  const g = window.__game, S = g.startView(), T = g.trees;
  cancelAnimationFrame(g.raf);
  // the densest woods near the site
  let spot = { x: S.x, z: S.z }, most = -1;
  for (let r = 200; r <= 1400; r += 200) for (let a = 0; a < 12; a++) {
    const x = S.x + Math.cos(a * 0.52) * r, z = S.z + Math.sin(a * 0.52) * r, n = T.countIn(x, z, 80);
    if (n > most) { most = n; spot = { x, z }; }
  }
  const at = (dist) => {
    g.rts.setView(spot.x, spot.z, dist, g.rts.yaw, 0.85, true);
    for (let i = 0; i < 6; i++) g.frame(0.05, false);
    // every tree within 200 m that this preset draws is drawn, as a model or a sprite
    let want = 0, drawn = 0;
    for (let i = 0; i < T.n; i++) {
      if (!T.A[i] || T.W[i] > T.renderDensity || Math.hypot(T.X[i] - spot.x, T.Z[i] - spot.z) > 200) continue;
      want++;
      if (T.slotOf[i] >= 0) drawn++;
    }
    return { dist, near: T.near.reduce((a, m) => a + m.count, 0), want, drawn };
  };
  return { most, at: [at(200), at(380), at(700), at(1100)] };
});
console.log(JSON.stringify(tr));
const A = tr.at;
check(`zoomed in, the trees around you are detailed (${A[0].near} at ${A[0].dist} m in woods of ${tr.most})`, A[0].near > 100, tr);
check(`zoomed out, no disc of detailed trees follows the camera (${A[2].near} at ${A[2].dist} m, ${A[3].near} at ${A[3].dist} m)`, A[2].near === 0 && A[3].near === 0, tr);
check(`swapping detail for sprites leaves no gaps (${A.map((a) => `${a.drawn}/${a.want}`).join(', ')} trees within 200 m drawn)`, A.every((a) => a.want > 0 && a.drawn === a.want), tr);
// far tree pictures keep their silhouette at every mip level (playtest 5:
// distant trees drew as "opaque rectangular cards on thin dark stems": the old
// per-mip alpha boost let a small picture's whole card pass the alpha test)
const mips = await page.evaluate(() => {
  const T = window.__game.trees, far = T.far?.[0] ?? T.group.children.find((m) => !T.near.includes(m));
  const tex = far?.material?.map;
  if (!tex?.mipmaps?.length) return null;
  const kinds = 8, rows = 2, thr = 0.3 * 255;
  const fill = (lv) => {
    const { data, width: w, height: h } = tex.mipmaps[lv], tw = w / kinds, th = h / rows, out = [];
    for (let k = 0; k < kinds; k++) { let n = 0, c = 0; for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) { n++; if (data[((Math.floor(y)) * w + Math.floor(k * tw + x)) * 4 + 3] >= thr) c++; } out.push(c / n); }
    return out;
  };
  const base = fill(0), worst = [];
  for (let lv = 2; lv <= 6; lv++) { const f = fill(lv); worst.push(Math.max(...f.map((v, i) => Math.abs(v - base[i])))); }
  return { base: base.map((v) => +v.toFixed(2)), worst: worst.map((v) => +v.toFixed(2)), full: fill(4).map((v) => +v.toFixed(2)) };
});
console.log(JSON.stringify(mips));
check(`distant tree pictures keep their shape, not a filled card (coverage drift by mip level ${mips?.worst?.join(', ')}; at 1/16 size ${mips?.full?.join(', ')})`, !!mips && mips.worst.every((v) => v <= 0.12) && mips.full.every((v, i) => v < 0.85 && v <= mips.base[i] + 0.12), mips);
check('no page errors', errs.length === 0, errs.slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
