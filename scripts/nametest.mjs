// Names fit the map (src/roads/nameTags.ts, from scripts/nametags.mjs): no
// Sequoia or Golden Hills streets in the Florida swamp, no Bayou or Sawgrass in
// the hollers, "Holler Rd" only in Appalachia, Texas bluebonnets nowhere, and
// every list still has names to pick. Checked on 4,000 generated names per map
// and on roads actually built in the running game (Florida and Appalachia).
// Lists with nothing tagged for a map come back as the same array, so their
// draws are exactly as before. Exits nonzero on failure.
import { chromium } from 'playwright-core';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra).slice(0, 600)); if (!ok) bad++; };
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const errs = [];
const WRONG = { florida: /Sequoia|Golden Hills|Trout Run|Hickory Hollow|Holler Rd|Bluebonnet|Prairie Wind/, appalachia: /Bayou|Sawgrass|Sequoia|Golden Hills|Bluebonnet|Prairie Wind/, norcal: /Bayou|Sawgrass|Trout Run|Hickory Hollow|Holler Rd|Bluebonnet|Prairie Wind/ };

for (const map of ['florida', 'appalachia']) {
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
  page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(() => { try { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); } catch { /* */ } });
  await page.goto(`${base}/#skip&map=${map}&mode=sandbox`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 180000 });
  const r = await page.evaluate(async (map) => {
    const g = window.__game, d = window.__dbg, N = await import('/src/roads/names.ts'), T = g.terrain;
    cancelAnimationFrame(g.raf);
    const S = g.startView();
    // generated: every map id, road types, random spots (water, forest, open)
    const gen = {};
    for (const m of ['appalachia', 'norcal', 'florida']) {
      const out = [];
      for (let i = 0; i < 4000; i++) {
        const type = ['gravel', 'twoLane', 'oneWay1', 'stroad4', 'stroad6'][i % 5];
        const p = { x: S.x + (Math.random() - 0.5) * 3000, z: S.z + (Math.random() - 0.5) * 3000 };
        out.push(N.roadName(type, T, p, { id: m }));
      }
      gen[m] = out;
    }
    // built: real roads in this game
    const before = new Set([...g.net.segs.values()].map((s) => s.name));
    for (let i = 0; i < 40; i++) { const a = (i / 40) * Math.PI * 2, r0 = 150 + (i % 5) * 60; d.road(S.x + Math.cos(a) * r0, S.z + Math.sin(a) * r0, S.x + Math.cos(a) * (r0 + 45), S.z + Math.sin(a) * (r0 + 45), i % 3 ? 'twoLane' : 'gravel'); }
    const built = [...new Set([...g.net.segs.values()].map((s) => s.name))].filter((n) => !before.has(n));
    // untagged lists come back as the same array (same draws as before)
    const same = N.namesFor(['Dr', 'Ln', 'Ct'], 'suffix', map);
    const probe = ['Dr', 'Ln', 'Ct'];
    return { gen, built, identity: N.namesFor(probe, 'suffix', map) === probe, communes: g.communes.list.map((c) => c.name), sameLen: same.length };
  }, map);
  for (const [m, names] of Object.entries(r.gen)) {
    const wrong = names.filter((n) => WRONG[m].test(n));
    const distinct = new Set(names).size;
    check(`${m} (generated, from the ${map} game): no names from another region in 4,000 (${distinct} distinct)`, wrong.length === 0 && distinct > 500, { wrong: [...new Set(wrong)].slice(0, 5), distinct });
  }
  check(`Florida gets its own names (Bayou, Sawgrass) and Appalachia "Holler Rd"`, r.gen.florida.some((n) => /Bayou|Sawgrass/.test(n)) && r.gen.appalachia.some((n) => /Holler Rd/.test(n)) && !r.gen.florida.some((n) => /Holler Rd/.test(n)), {});
  const wrongBuilt = r.built.filter((n) => WRONG[map].test(n));
  check(`${map}: ${r.built.length} roads built in the game, none named for another region (${r.built.slice(0, 4).join(', ')}…)`, r.built.length >= 20 && wrongBuilt.length === 0, { wrongBuilt, built: r.built.slice(0, 10) });
  check(`${map}: communes are named (${r.communes.slice(0, 3).join(', ')})`, r.communes.length > 0 && r.communes.every(Boolean), r.communes);
  check(`${map}: a list with nothing tagged comes back as the same array`, r.identity, r);
  await page.close();
}
check('no page errors', errs.length === 0, errs.slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
