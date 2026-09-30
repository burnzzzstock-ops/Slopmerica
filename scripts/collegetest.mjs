// The College's first graduates (owner, 2026-09-30; docs/PLAYTEST_6.md: "nothing
// says what it did once built"). Homes need college grads for level 5, so the
// first home to reach it in the university's reach says so once, with how many
// homes there can now follow. On the reference block:
//  - a home reaching level 5 with no college in reach: no toast;
//  - with Prosperity Gospel University placed and a month for its grads to
//    count, the first home in its reach to reach level 5: one toast, naming the
//    university and a count;
//  - the next home to reach level 5, even with the first knocked back down: no
//    second toast.
// usage: node scripts/collegetest.mjs   (BASE_URL, default http://127.0.0.1:5173)
// Exits 1 on failure.
import { chromium } from 'playwright-core';
import { ARGS, EXE, openBlock } from './refblock.mjs';

const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra).slice(0, 600)); if (!ok) bad++; };
const browser = await chromium.launch({ executablePath: EXE, args: ARGS });
const { page, errs, center } = await openBlock(browser, { base, quality: 'low' });
const r = await page.evaluate((center) => {
  const g = window.__game, d = window.__dbg, SV = window.__services;
  const toasts = [];
  const toast = g.toast.bind(g);
  g.toast = (m, ...rest) => { toasts.push(String(m)); return toast(m, ...rest); };
  const grads = () => toasts.filter((t) => t.includes('First graduates'));
  const homes = () => [...g.buildings.list.values()].filter((b) => (b.zone === 'resLow' || b.zone === 'resHigh') && b.state === 'active' && b.level < 5);
  // (every home on the block below level 5: the first one to reach it is the one this test levels)
  for (const b of g.buildings.list.values()) if ((b.zone === 'resLow' || b.zone === 'resHigh') && b.level >= 5) b.level = 4;
  const lift = (b) => { b.level = 4; g.buildings.levelUp(b); return b.level; };
  // no college
  const far = homes()[0];
  const before = { level: lift(far), toasts: grads().length };
  far.level = 4; // (so the next one is still the first)
  // a university beside the block's homes, and a month for its coverage and grads
  let placed = null;
  for (const r of [160, 220, 280, 340]) {
    for (let a = 0; a < 24 && !placed; a++) {
      const x = center.x + Math.cos((a / 24) * 6.283) * r, z = center.z + Math.sin((a / 24) * 6.283) * r;
      const s = SV.findSpot?.(g, 'college', x, z);
      if (s && !s.reason) placed = SV.place(g, 'college', s.x, s.z);
      else if (SV.canPlace(g, 'college', x, z).ok) placed = SV.place(g, 'college', x, z);
    }
    if (placed) break;
  }
  const college = [...g.buildings.list.values()].find((b) => b.kind === 'college');
  if (!college) return { before, college: null };
  college.state = 'active'; college.progress = 1;
  // (the block sets the calendar back to mid-summer, day 120, from the day it was saved on:
  // count days from here, or no day ticks, and no coverage, until the old date comes round)
  g.sim.lastWhole = Math.floor(g.sim.day);
  for (let k = 0; k < 6; k++) d.run(5);
  const natural = grads().slice(); // (a home may get there on its own in the month)
  const cov = (b) => SV.S.b.get(b.id)?.cov.college ?? 0, edu = (b) => SV.S.b.get(b.id)?.edu ?? 0;
  const inReach = homes().filter((b) => cov(b) > 0);
  const first = natural.length ? null : inReach[0] ?? null;
  if (first) lift(first);
  const after = grads().slice();
  // the next home to reach level 5, even with every other level-5 home knocked back to 4
  for (const b of g.buildings.list.values()) if ((b.zone === 'resLow' || b.zone === 'resHigh') && b.level >= 5) b.level = 4;
  const next = homes().find((b) => b !== first && cov(b) > 0);
  if (next) lift(next);
  return { before, college: college.label, natural: natural.length, first: first?.label ?? null, toasts: after, second: grads().length - after.length, inReach: inReach.length, grads: inReach.filter((b) => edu(b) >= 0.7).length };
}, center);
check(`a home reaching level 5 with no college in reach: no toast (${r.before.toasts})`, r.before.level === 5 && r.before.toasts === 0, r.before);
if (!r.college) check('Prosperity Gospel University placed beside the block', false);
else {
  console.log(`  ${r.college}: ${r.inReach} homes in its reach below level 5, ${r.grads} of them with the grads for it; the first to level 5: ${r.natural ? 'one of its own, in the month' : r.first ?? 'none'}`);
  const t = r.toasts[0] ?? '';
  const m = t.match(/(\d+) homes? in its reach/);
  check(`the first home in its reach to reach level 5 says so once ("${t}")`, r.toasts.length === 1 && t.includes(r.college) && !!m && Number(m[1]) >= 1, r);
  check(`the next home to reach level 5: no second toast (${r.second})`, r.second === 0, r);
}
check('no page errors', errs.length === 0, errs.slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
