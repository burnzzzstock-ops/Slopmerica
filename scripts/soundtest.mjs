// Settings has a Sound control (docs/HANDOFF_ROUND8_SONNET.md, item 7): Sound on/off and a Sound volume, remembered like the music's, for the
// effects, the ambience and the street sound (the music keeps its own pair). On the phone (390x844, touch, the Low preset) this opens Settings, finds
// the controls, and reads the audio graph through AudioEngine.debugState():
//   - Sound off: the sound bus and its reverb send go to 0, the master and the music are untouched, and the street voices go to sleep;
//   - Sound on again: back to the level it had, the street voices wake;
//   - the slider sets the level (and is remembered); a reload keeps both settings;
//   - the Settings panel still fits at 390 px (nothing off the sides) and the new controls are 44 px tall or more.
// usage: scripts/withslot.sh env BASE_URL=http://127.0.0.1:5173 node scripts/soundtest.mjs      exits 1 on failure
import { chromium } from 'playwright-core';
import { ARGS, EXE } from './refblock.mjs';

const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra).slice(0, 400)); if (!ok) bad++; };
const browser = await chromium.launch({ executablePath: EXE, args: [...ARGS, '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => { try { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); } catch { /* */ } });
const start = async () => {
  await page.goto(`${base}/#skip&map=appalachia&mode=sandbox`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 420000 });
  await page.waitForTimeout(1500);
};
const state = () => page.evaluate(() => window.__game.audio.debugState());
const settle = (ms = 700) => page.waitForTimeout(ms);
const frames = (n, dt = 0.1) => page.evaluate(async ({ n, dt }) => { for (let i = 0; i < n; i++) { window.__game.frame(dt, false); await new Promise((r) => setTimeout(r, 5)); } }, { n, dt });
const openSettings = async () => {
  if (await page.isVisible('#sound-toggle')) return;
  // (on the phone Settings is an item under More)
  if (!(await page.$('button.more-btn[data-more="help"]'))) { await page.tap('button.tbtn[data-t="more"]', { force: true, timeout: 120000 }); await settle(500); }
  await page.tap('button.more-btn[data-more="help"]', { force: true, timeout: 120000 });
  await settle(600);
};

await start();
await openSettings();
const has = { toggle: !!(await page.$('#sound-toggle')), range: !!(await page.$('#sound-range')) };
check('Settings has a Sound on/off button and a Sound volume slider', has.toggle && has.range, has);
if (!has.toggle || !has.range) { await browser.close(); process.exit(1); }

// start the audio (a tap is the user gesture the browser wants) and read the starting levels
await page.tap('#sound-toggle', { force: true, timeout: 120000 }); await settle();   // off
await page.tap('#sound-toggle', { force: true, timeout: 120000 }); await settle();   // on again: the audio engine now exists
await frames(10);
let s = await state();
check('the audio engine is running', s.started && s.running, s);
check('Sound starts on at the level the game always had (bus 1, master untouched)', s.soundOn && Math.abs(s.sound - 1) < 0.01 && s.master > 0.5, s);
const master0 = s.master;

// ---- Sound off
await page.tap('#sound-toggle', { force: true, timeout: 120000 }); await settle(900);
s = await state();
check('Sound off: the sound bus and its reverb send are at 0', s.soundOn === false && s.sound < 0.002 && s.soundRev < 0.002, s);
check('... the master and the music setting are untouched', Math.abs(s.master - master0) < 0.01 && s.musicOn === true, s);
await frames(30, 0.1);   // 3 s of game time with the sound off
s = await state();
check('... the street voices sleep (awake false, none live)', s.streetAwake === false && s.streetVoices === 0, s);
const label = await page.evaluate(() => document.querySelector('#sound-toggle')?.textContent);
check('... the button says so', /off/i.test(label ?? ''), { label });
check('... and it is remembered', (await page.evaluate(() => localStorage.getItem('slopmerica.sound'))) === '0');

// ---- on again
await page.tap('#sound-toggle', { force: true, timeout: 120000 }); await settle(900);
await frames(10, 0.1);
s = await state();
check('Sound on again: back to the level it had, the street voices awake', s.soundOn && Math.abs(s.sound - 1) < 0.02 && s.streetAwake === true, s);

// ---- the slider
await page.evaluate(() => { const r = document.querySelector('#sound-range'); r.value = '40'; r.dispatchEvent(new Event('input', { bubbles: true })); });
await settle(900);
s = await state();
check('the slider at 40% sets the sound level to 0.4 (master untouched)', Math.abs(s.sound - 0.4) < 0.02 && Math.abs(s.soundRev - 0.4) < 0.02 && Math.abs(s.master - master0) < 0.01, s);
check('... and remembers it', (await page.evaluate(() => localStorage.getItem('slopmerica.soundVol'))) === '0.4');
// the music's own controls still do their own thing
await page.tap('#music-toggle', { force: true, timeout: 120000 }); await settle(500);
s = await state();
check('the music toggle changes the music only (sound bus stays at 0.4)', s.musicOn === false && Math.abs(s.sound - 0.4) < 0.02, s);
await page.tap('#music-toggle', { force: true, timeout: 120000 }); await settle(300);

// ---- the panel still fits on the phone, and the new controls are big enough for a finger
const fit = await page.evaluate(() => {
  const W = innerWidth, out = { spill: [], small: [] };
  for (const sel of ['#sound-toggle', '#sound-range', '#music-toggle', '#music-range', '#fov-range', '#save-file']) {
    const el = document.querySelector(sel); if (!el) { out.small.push(sel + ' missing'); continue; }
    const r = el.getBoundingClientRect(), box = (el.closest('label') ?? el).getBoundingClientRect();
    if (r.right > W + 1 || r.left < -1 || box.right > W + 1) out.spill.push(`${sel} [${Math.round(box.left)}..${Math.round(box.right)}] of ${W}`);
    if (Math.max(r.height, box.height) < 44) out.small.push(`${sel} ${Math.round(r.width)}x${Math.round(Math.max(r.height, box.height))}`);
  }
  const sp = document.querySelector('.subpanel');
  out.panelScrollW = sp ? sp.scrollWidth : 0; out.panelClientW = sp ? sp.clientWidth : 0;
  return out;
});
check('the phone Settings panel fits (nothing past the sides)', fit.spill.length === 0 && fit.panelScrollW <= fit.panelClientW + 1, fit);
check('the Sound controls and the other sliders are at least 44 px tall', fit.small.length === 0, fit);
await page.screenshot({ path: 'shots/r8/sound-settings-phone.png', timeout: 420000 });

// ---- a reload keeps both settings
await page.evaluate(() => { const r = document.querySelector('#sound-range'); r.value = '65'; r.dispatchEvent(new Event('input', { bubbles: true })); });
await page.tap('#sound-toggle', { force: true, timeout: 120000 }); await settle(400);   // off
await start();
s = await state().catch(() => null);
const afterReload = await page.evaluate(() => ({ on: window.__game.audio.soundOn, vol: window.__game.audio.soundVolume }));
check('after a reload Sound is still off at 65%', afterReload.on === false && Math.abs(afterReload.vol - 0.65) < 0.001, afterReload);
await openSettings();
const label2 = await page.evaluate(() => ({ t: document.querySelector('#sound-toggle')?.textContent, v: document.querySelector('#sound-range')?.value }));
check('... and Settings shows it', /off/i.test(label2.t ?? '') && label2.v === '65', label2);
check('no page errors', errs.length === 0, errs.slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
