// The follow camera has a button. On the reference town: select a moving car, press Follow in its inspector, and check that
// the camera rides with it (the look lane's rig, g.rts.follow), a pill names who is being followed, the button turns into
// Stop following, and a tap on the pill lets go. The same for a person on foot. On a phone the inspector sheet goes away when
// Follow is pressed, and the pill is a finger tall. Exits nonzero on failure.
//
//   BASE_URL=http://127.0.0.1:5173 node scripts/followtest.mjs
import { launch } from './lib/browser.mjs';
import { openBlock, testSeed } from './refblock.mjs';

const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const SEED = testSeed();
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra).slice(0, 500)); if (!ok) bad++; };
const browser = await launch();

for (const phone of [false, true]) {
  const who = phone ? 'phone' : 'desktop';
  const { page, errs, center } = await openBlock(browser, phone ? { base, seed: SEED, quality: 'low', phone: true, width: 390, height: 844 } : { base, seed: SEED, quality: 'low' });
  // (openBlock hides the HUD for captures: this test is about the HUD)
  // (and midday: the town is saved late in the evening, when nobody is out on foot)
  await page.evaluate((c) => { for (const e of document.querySelectorAll('.hud')) e.style.display = ''; const g = window.__game; window.__dbg.hour(12); g.sim.speed = 1; g.rts.setView(c.x, c.z, 260, 0.6, 0.9, true); }, center);
  const frames = (n) => page.evaluate(async (n) => { const g = window.__game; for (let i = 0; i < n; i++) { g.frame(1 / 30); if (i % 10 === 9) await new Promise((r) => setTimeout(r, 0)); } }, n);
  await frames(240);
  const state = () => page.evaluate(() => {
    const g = window.__game, f = g.rts.following, pill = document.querySelector('.follow-pill'), btn = document.querySelector('#in-follow');
    const pose = f ? g.fields.poseOf(f) : null;
    const pr = pill && !pill.hidden ? pill.getBoundingClientRect() : null;
    return { following: f ? `${f.kind}:${f.id}` : null, pill: pr ? { text: pill.textContent.replace(/\s+/g, ' ').trim(), h: Math.round(pr.height), w: Math.round(pr.width) } : null, button: btn ? btn.textContent.trim() : null,
      away: pose ? Math.round(Math.hypot(g.rts.target.x - pose.x, g.rts.target.z - pose.z)) : null, selected: g.selection?.kind ?? null };
  });

  for (const kind of ['car', 'person']) {
    // back over the block's middle (the ride with the car ended wherever the car was, and people on foot are only near the camera)
    await page.evaluate((c) => window.__game.rts.setView(c.x, c.z, 260, 0.6, 0.9, true), center);
    await frames(kind === 'person' ? 150 : 6);
    const id = await page.evaluate((kind) => {
      const g = window.__game;
      if (kind === 'car') { const c = g.traffic.cars.filter((c) => !c.parked && !c.thru && c.crashed === 0 && c.v > 3 && c.path.length - c.pi > 3).sort((a, b) => a.id - b.id)[0]; if (!c) return null; g.select({ kind: 'car', c }); return c.id; }
      const p = [...g.peds.peds].sort((a, b) => a.id - b.id)[0]; if (!p) return null; g.select({ kind: 'ped', p }); return p.id;
    }, kind);
    if (id === null) { check(`${who}: there is a ${kind} to follow`, false); continue; }
    await frames(12);
    const before = await state();
    check(`${who}: a ${kind}'s inspector has a Follow button ("${before.button}")`, /Follow$/.test(before.button ?? '') && before.following === null && before.pill === null, before);
    // (a phone's inspector ignores a tap in the first 350 ms after it opens, so the tap that opened it cannot press a button)
    if (phone) await page.waitForTimeout(450);
    await (phone ? page.tap('#in-follow') : page.click('#in-follow'));
    await frames(75);
    const on = await state();
    check(`${who}: pressing it makes the camera ride with the ${kind} (following ${on.following}, ${on.away} m from the camera's aim)`, on.following === `${kind}:${id}` && on.away !== null && on.away < 30, on);
    check(`${who}: a pill names who is followed ("${on.pill?.text}", ${on.pill?.h} px tall)`, !!on.pill && /Following /.test(on.pill.text) && on.pill.h >= (phone ? 44 : 30) && on.pill.w <= (phone ? 390 : 1280), on);
    if (phone) check(`${who}: the inspector sheet is out of the way`, on.selected === null, on);
    else check(`${who}: the button now says Stop following ("${on.button}")`, /Stop following/.test(on.button ?? ''), on);
    await (phone ? page.tap('.follow-pill') : page.click('.follow-pill'));
    await frames(12);
    const off = await state();
    check(`${who}: a tap on the pill lets go (following ${off.following})`, off.following === null && off.pill === null && (phone || /Follow$/.test(off.button ?? '')), off);
    await page.evaluate(() => window.__game.select(null));
    await frames(6);
  }
  // A bus in service. Transit sends each leg of a line out as a cityBus whose purpose is "running <line>" and whose
  // destination is the next stop: its card is headed by the line, not by whoever is at the wheel, and so is the pill.
  const bus = await page.evaluate(() => {
    const g = window.__game, seg = [...g.net.segs.values()].sort((a, b) => b.length - a.length)[0];
    const c = g.traffic.launch({ seg, s: seg.length * 0.1 }, { seg, s: seg.length * 0.9 }, null, null, 'cityBus', 'running The 69 Express', 'Stop 3', true, 12, true);
    if (!c) return null;
    g.select({ kind: 'car', c });
    return c.id;
  });
  await frames(12);
  const card = await page.evaluate(() => { const i = document.querySelector('.inspector'); return { head: i.querySelector('h3')?.textContent ?? '', rows: [...i.querySelectorAll('.in-stats div')].map((d) => `${d.querySelector('span')?.textContent}: ${d.querySelector('b')?.textContent}`), bio: !!i.querySelector('.in-blurb') }; });
  check(`${who}: a bus's card is headed by its line ("${card.head}"), with its next stop and its driver`, bus !== null && card.head === 'The 69 Express' && card.rows.includes('Next stop: Stop 3') && card.rows.some((r) => r.startsWith('Driver: ')) && !card.bio, card);
  if (phone) await page.waitForTimeout(450);
  await (phone ? page.tap('#in-follow') : page.click('#in-follow'));
  await frames(30);
  const riding = await state();
  check(`${who}: followed, the pill names the line ("${riding.pill?.text}")`, riding.following === `car:${bus}` && /Following The 69 Express/.test(riding.pill?.text ?? ''), riding);
  await (phone ? page.tap('.follow-pill') : page.click('.follow-pill'));
  await page.evaluate(() => window.__game.select(null));
  await frames(6);
  check(`${who}: no page errors`, errs.length === 0, errs.slice(0, 3));
  await page.close();
}
await browser.close();
process.exit(bad ? 1 : 0);
