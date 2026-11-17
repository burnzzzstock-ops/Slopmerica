// Photo mode has a way in and controls. On a desktop window and a 390 x 844 phone: Photo (in More) puts the game into the
// look lane's photo mode (g.photo), with the HUD hidden but for one bar; Street level, the hour, the weather, the postcard
// frame, Save and Save 4K reach the photo API with the right values; a real capture gives a PNG; Done and Esc bring the HUD
// back. Exits nonzero on failure.
//
//   BASE_URL=http://127.0.0.1:5173 node scripts/phototest.mjs
import { launch } from './lib/browser.mjs';

const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const browser = await launch();
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra).slice(0, 500)); if (!ok) bad++; };

for (const [who, opts] of [['desktop', { viewport: { width: 1280, height: 720 } }], ['phone', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }]]) {
  const phone = who === 'phone';
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(() => { try { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.firstSteps', '1'); } catch { /* */ } });
  await page.goto(`${base}/#skip&map=appalachia&mode=sandbox`, { waitUntil: 'load', timeout: 300000 });
  await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 300000 });
  await page.evaluate(() => {
    const g = window.__game;
    cancelAnimationFrame(g.raf);
    // record what Save asks for instead of handing the browser a file
    window.__saves = [];
    g.photo.download = async (framed, size) => { window.__saves.push({ framed, size: size ?? null }); };
  });
  const frames = (n = 8) => page.evaluate(async (n) => { const g = window.__game; for (let i = 0; i < n; i++) { g.frame(1 / 30); await new Promise((r) => setTimeout(r, 20)); } }, n);
  const press = async (sel) => { await (phone ? page.tap(sel) : page.click(sel)); await frames(); };
  const state = () => page.evaluate(() => {
    const g = window.__game, bar = document.querySelector('.photo-bar'), tb = document.querySelector('.toolbar');
    const r = bar && !bar.hidden ? bar.getBoundingClientRect() : null;
    const chips = r ? [...bar.querySelectorAll('.pb-row:last-of-type .chip, .pb-row .chip')].map((c) => Math.round(c.getBoundingClientRect().height)) : [];
    return { active: g.photo.active, bar: r ? { left: Math.round(r.left), right: Math.round(r.right), h: Math.round(r.height), vis: getComputedStyle(bar).visibility } : null, toolbar: getComputedStyle(tb).visibility,
      minChip: chips.length ? Math.min(...chips) : 0, hour: g.photo.hour, weather: g.photo.weather, focus: g.photo.focusDistance, tilt: g.photo.tilt, saves: window.__saves, toast: [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | '),
      saveLabel: bar?.querySelector('[data-pb="save"]')?.textContent ?? '' };
  });
  await frames();

  await press('.tbtn[data-t="more"]');
  await press('[data-more="photo"]');
  let s = await state();
  check(`${who}: Photo in More starts photo mode, with the HUD hidden but for its bar (toolbar ${s.toolbar}, bar ${s.bar?.vis})`, s.active && s.toolbar === 'hidden' && s.bar?.vis === 'visible', s);
  check(`${who}: the bar fits the screen (${s.bar?.left} to ${s.bar?.right} px, ${s.bar?.h} px tall${phone ? `, buttons ${s.minChip} px tall` : ''})`, !!s.bar && s.bar.left >= 0 && s.bar.right <= opts.viewport.width && s.bar.h <= 130 && (!phone || s.minChip >= 44), s);

  await press('[data-pb="street"]');
  s = await state();
  check(`${who}: Street level stands the lens in the street (focus ${s.focus} m)`, s.focus === 60, s);

  await press('[data-pb="adjust"]');
  await page.evaluate(() => { const i = document.querySelector('[data-pbr="hour"]'); i.value = '19.5'; i.dispatchEvent(new Event('input', { bubbles: true })); const t = document.querySelector('[data-pbr="tilt"]'); t.value = '0.6'; t.dispatchEvent(new Event('input', { bubbles: true })); });
  await press('[data-pb="wx:rain"]');
  s = await state();
  check(`${who}: Adjust sets the hour, the blur and the weather (hour ${s.hour}, blur ${s.tilt}, ${s.weather})`, s.hour === 19.5 && s.tilt === 0.6 && s.weather === 'rain', s);
  await press('[data-pb="adjust"]');

  await press('[data-pb="save"]');
  await press('[data-pb="save4k"]');
  await press('[data-pb="frame"]');
  await press('[data-pb="save"]');
  s = await state();
  const [a, b, c] = s.saves;
  const long = b?.size ? Math.max(b.size.width, b.size.height) : 0, upright = b?.size ? b.size.height > b.size.width : false;
  check(`${who}: Save asks for a postcard at the screen's size, 4K for 3840 on the long side (${b?.size?.width} x ${b?.size?.height}), and with the frame off, a plain photo`, s.saves.length === 3 && a.framed === true && a.size === null && b.framed === true && long === 3840 && b.size.width * b.size.height <= 3840 * 2160 && upright === phone && c.framed === false, s.saves);
  check(`${who}: it says so ("${s.toast.slice(-60)}") and the button follows the frame ("${s.saveLabel}")`, /saved/.test(s.toast) && /Save photo/.test(s.saveLabel), { toast: s.toast, label: s.saveLabel });

  // a real capture through the look lane's own path: a PNG of the screen, framed
  const png = await page.evaluate(async () => { const b = await window.__game.photo.capture(true); const head = new Uint8Array(await b.slice(0, 4).arrayBuffer()); return { size: b.size, type: b.type, png: head[0] === 0x89 && head[1] === 0x50 }; });
  check(`${who}: a capture is a PNG (${Math.round(png.size / 1024)} kB)`, png.png && png.type === 'image/png' && png.size > 20000, png);

  await press('[data-pb="exit"]');
  s = await state();
  check(`${who}: Done brings the HUD back (photo mode ${s.active ? 'on' : 'off'}, toolbar ${s.toolbar})`, !s.active && s.bar === null && s.toolbar === 'visible', s);

  if (!phone) {
    await press('.tbtn[data-t="more"]');
    await press('[data-more="photo"]');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await frames();
    s = await state();
    check(`${who}: Esc leaves photo mode and takes the bar with it`, !s.active && s.bar === null && s.toolbar === 'visible', s);
  }
  check(`${who}: no page errors`, errs.length === 0, errs.slice(0, 3));
  await ctx.close();
}
await browser.close();
process.exit(bad ? 1 : 0);
