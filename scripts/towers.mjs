// Tower facades on the reference block: a class-masked luminance / contrast number for the walls of tall buildings (glass
// towers, offices, high-rises), plus a JPEG of each view, so "the towers read as black monoliths on Low" is a number that can
// be checked before and after a change (docs/HANDOFF_CARS_LOOK.md item 6).
//
// The mask pass draws every building with a flat colour: walls of anything taller than TALL metres above its own pad red
// ("tower facade"), every other building surface blue, road surfaces green, all else black, and reads it back. The captures
// then split by that mask (display luma 0..255): mean, std-dev (window rhythm, floor lines = contrast), share below luma 20
// (black), and the 10th / 50th / 90th percentiles. Borrowed from nighttest.mjs.
//
// usage: node scripts/towers.mjs [quality, default low]      e.g. BASE_URL=http://127.0.0.1:5175 scripts/withslot.sh node scripts/towers.mjs low
//   PHONE=1        390x780 @3x touch context (what the owner plays on; Low there also runs at pixel ratio 1.5 with MSAA)
//   HOURS=12.5,23  hours to shoot (default 12.5), moon 0.5 at night, clear weather. NIGHT moon override: MOON=0
//   VIEWS=over,tall,street   which cameras (default all): over = the lookbook overview, tall = the tallest tower from ~3.4x its
//                  height, street = the lookbook street corner
//   OUT=dir        save dir/<prefix><quality>-<hour>-<view>.jpg (JPEG q85; phone shots at CSS size)
//   TALL=22        metres above the pad from which a wall counts as a tower facade
// Exits 0; prints one JSON line per capture and a summary table.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { ARGS, EXE, openBlock, shoot } from './refblock.mjs';
import { classStats, maskPass } from './lib/towermask.mjs';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const quality = process.argv[2] || 'low';
const phone = !!process.env.PHONE;
const TALL = Number(process.env.TALL || 22);
const hours = (process.env.HOURS || '12.5').split(',').map(Number);
const wantViews = (process.env.VIEWS || 'over,tall,street').split(',');
const OUT = process.env.OUT;
const pre = phone ? 'phone-' : '';
if (OUT) mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: EXE, args: ARGS });
const { page, errs, center } = await openBlock(browser, phone ? { base, quality, width: 390, height: 780, phone: true } : { base, quality });

// the tallest building of the block and a list of the tall ones
const towers = await page.evaluate(() => {
  const g = window.__game;
  return [...g.buildings.list.values()].filter((b) => b.state === 'active' && b.model?.height > 20).map((b) => ({ id: b.id, zone: b.zone, level: b.level, label: b.label, x: b.x, z: b.z, h: Math.round(b.model.height), w: b.w, d: b.d })).sort((a, b) => b.h - a.h);
});
page.on('console', (m) => { if (m.type() === 'error' || /WebGLProgram|shader/i.test(m.text())) console.log('console:', m.text().slice(0, 600)); });
console.log('towers', JSON.stringify(towers.slice(0, 12)));
const top = towers[0];
const VIEWS = {
  over: [0, 0, 320, 0.7, 0.6],
  tall: top ? [top.x - center.x, top.z - center.z, Math.max(120, top.h * 3.4), 0.7, 0.3] : [0, 0, 200, 0.7, 0.4],
  street: [-40, -30, 110, 2.4, 0.38],
};

const rows = [];
for (const hour of hours) {
  const night = hour > 20 || hour < 5;
  for (const view of wantViews) {
    const v = VIEWS[view];
    if (!v) continue;
    await shoot(page, center, { hour, moon: night ? Number(process.env.MOON ?? 0) : 0.5, weather: 'clear', view: v });
    await maskPass(page, TALL);
    const buf = await page.screenshot({ timeout: 420000, ...(phone ? { scale: 'css' } : {}) });
    const s = await classStats(page, buf.toString('base64'));
    rows.push({ hour, view, ...s });
    console.log(JSON.stringify({ q: quality, phone, hour, view, tower: s.tower, otherBldg: s.otherBldg }));
    if (OUT) {
      // a JPEG for the report (the mask pass is over: this is the normal picture)
      await page.evaluate(() => { for (let i = 0; i < 2; i++) window.__game.frame(0.016); });
      const jpg = await page.screenshot({ timeout: 420000, type: 'jpeg', quality: 85, ...(phone ? { scale: 'css' } : {}) });
      writeFileSync(`${OUT}/${pre}${quality}-h${String(hour).replace('.', '_')}-${view}.jpg`, jpg);
    }
  }
}
if (errs.length) console.log('page errors:', errs.slice(0, 3));
writeFileSync(`${OUT || '.'}/${pre}towers-${quality}.json`, JSON.stringify({ quality, phone, TALL, towers: towers.slice(0, 12), rows }, null, 1));
console.log('\nview        hour   tower: mean  sd   <20%  <40%  p10  p50  p90   (n)');
for (const r of rows) console.log(`${r.view.padEnd(10)} ${String(r.hour).padEnd(6)} ${String(r.tower.mean).padStart(11)} ${String(r.tower.sd).padStart(4)} ${String(r.tower.dark20).padStart(5)} ${String(r.tower.dark40).padStart(5)} ${String(r.tower.p10).padStart(4)} ${String(r.tower.p50).padStart(4)} ${String(r.tower.p90).padStart(4)}   (${r.tower.n})`);
await browser.close();
