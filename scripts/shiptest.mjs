// The game as it ships: a production build shows a player no debug hooks and no playtest tools, and gives #debug and #playtest
// back what they ask for (src/core/flags.ts decides).
//
// It builds the game (vite build -> dist/), serves dist/ from a small static server of its own and drives real Chromium with
// launch({ debug: false }), so no page gets the test launcher's init script that turns the hooks on:
//   1. no flag, desktop and phone, a new city started through the real title screen: window.__game, __dbg, __services and the other
//      hooks are undefined; no Playtest badge or build on the title, no onboarding playtest note, no bug button on the toolbar or in
//      More, no Show performance, no weather test chips; Report a bug is in Settings and opens the report sheet;
//   2. #debug: the hooks exist (and the playtest tools stay away: they are a separate switch);
//   3. #playtest: the tools are back, and stay on after the address loses the flag, until #playtest=0;
//   4. no API key or token in the built files (TYPESAFE, sk-, Bearer , api_key, apiKey=, .env).
//
// usage: node scripts/shiptest.mjs        builds dist/ first, then tests it
//   DIST=/path/to/dist  test another build (the code before this test fails on the hooks and the tools)   BUILD=0  do not build
//   PORT  the static server's port (default 5186; when it is taken, by the suite's own server say, the system picks one)
import { launch } from './lib/browser.mjs';
import { createServer } from 'node:http';
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, relative } from 'node:path';

const dist = process.env.DIST || 'dist';
if (!process.env.DIST && process.env.BUILD !== '0') execSync('node node_modules/vite/bin/vite.js build', { stdio: 'inherit' });
if (!existsSync(join(dist, 'index.html'))) { console.log('FAIL no built game in', dist); process.exit(1); }

let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra).slice(0, 400)); if (!ok) bad++; };

// ---- 4 first: it needs no browser
const PATTERNS = ['TYPESAFE', 'sk-', 'Bearer ', 'api_key', 'apiKey=', '.env'];
// Two patterns are also ordinary code. Each match is kept unless it is one of these, and every one left out is counted and shown:
//   sk-   inside a longer word: CSS "mask-image", "desk-..." (a key starts the string: "sk-" after a quote, space or symbol)
//   .env  a property read, not a file name: "this.env.night", "ctx.env", three.js "this.environment" (a file name comes after a quote,
//         a slash or a space, never straight after a name or a bracket)
const HARMLESS = {
  'sk-': (s, i) => /[A-Za-z0-9_]/.test(s[i - 1] ?? ''),
  '.env': (s, i) => /[A-Za-z0-9_$)\]]/.test(s[i - 1] ?? '') || /[A-Za-z0-9_$]/.test(s[i + 4] ?? ''),
};
const TEXT = new Set(['.js', '.mjs', '.html', '.css', '.json', '.txt', '.svg', '.map', '.webmanifest', '.xml']);
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
const found = [], excused = {};
let scanned = 0;
for (const f of walk(dist)) {
  if (!TEXT.has(extname(f).toLowerCase())) continue;
  scanned++;
  const s = readFileSync(f, 'utf8');
  for (const p of PATTERNS) {
    for (let i = s.indexOf(p); i >= 0; i = s.indexOf(p, i + 1)) {
      const at = `${relative(dist, f)}: ${JSON.stringify(s.slice(Math.max(0, i - 24), i + p.length + 24))}`;
      if (HARMLESS[p]?.(s, i)) { (excused[p] ??= { count: 0, example: at }).count++; continue; }
      found.push(`${JSON.stringify(p)} in ${at}`);
    }
  }
}
for (const [p, e] of Object.entries(excused)) console.log(`     (${e.count} harmless ${JSON.stringify(p)} matches left out, e.g. ${e.example})`);
check(`no API key or token in the ${scanned} text files of ${dist}`, scanned > 0 && found.length === 0, found.slice(0, 10));
for (const m of found) console.log('     match:', m);

// ---- the server
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.txt': 'text/plain', '.png': 'image/png', '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2', '.bin': 'application/octet-stream' };
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const f = normalize(join(dist, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname)));
  if (!f.startsWith(normalize(dist)) || !existsSync(f) || !statSync(f).isFile()) { res.writeHead(404); res.end('no'); return; }
  res.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream' });
  res.end(readFileSync(f));
});
const listen = (port) => new Promise((ok, no) => { server.once('error', no); server.listen(port, '127.0.0.1', () => { server.off('error', no); ok(); }); });
await listen(Number(process.env.PORT || 5186)).catch(async (e) => {
  if (e.code !== 'EADDRINUSE') throw e;
  console.log(`(port ${process.env.PORT || 5186} is taken: the system picks one)`);
  await listen(0);
});
const base = `http://127.0.0.1:${server.address().port}`;

// every hook a test drives; none may exist for a player
const HOOKS = ['__game', '__dbg', '__ext', '__services', '__land', '__startSite', '__vault', '__genMs'];
const browser = await launch({ debug: false });
const errs = [];
const DESK = { viewport: { width: 1280, height: 720 } };
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const touch = new WeakSet();
const newPage = async (opts, onboarded = false) => {
  const ctx = await browser.newContext(opts);
  // low graphics: this is about what the page offers, not how it draws (and no debug flag is set here)
  await ctx.addInitScript((ob) => { try { localStorage.setItem('slopmerica.quality', 'low'); if (ob) localStorage.setItem('slopmerica.onboarded', '1'); } catch { /* */ } }, onboarded);
  const page = await ctx.newPage();
  if (opts.hasTouch) touch.add(page);
  page.setDefaultTimeout(240000);
  page.on('pageerror', (e) => errs.push(e.message));
  return { ctx, page };
};
const press = (page, sel) => (touch.has(page) ? page.tap(sel) : page.click(sel));
const visible = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(s)].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).length, sel);
const present = (page, sel) => page.evaluate((s) => document.querySelectorAll(s).length, sel);
const hooks = (page) => page.evaluate((names) => Object.fromEntries(names.map((n) => [n, typeof window[n]])), HOOKS);
/** the title, then New city, then Start paving: the way a player starts */
const startFromTitle = async (page, hash = '') => {
  await page.goto(`${base}/${hash}`, { waitUntil: 'load' });
  await page.waitForSelector('#new', { state: 'visible', timeout: 120000 });
  const title = await page.evaluate(() => ({ foot: !!document.querySelector('.aaa-foot'), badge: !!document.querySelector('.aaa-badge'), build: !!document.querySelector('.aaa-build'), text: document.querySelector('.title')?.textContent ?? '' }));
  await press(page, '#new');
  await page.waitForSelector('#go', { state: 'visible', timeout: 30000 });
  await press(page, '#go');
  // the game is up when its toolbar is: nothing here may lean on window.__game
  await page.waitForSelector('nav.toolbar button.tbtn', { timeout: 420000 });
  await page.waitForFunction(() => !document.querySelector('.loading'), null, { timeout: 420000 });
  await page.waitForTimeout(1500);
  return title;
};
const dismissOnboarding = async (page) => {
  if (await page.isVisible('#ob-go')) { await press(page, '#ob-go'); await page.waitForTimeout(400); }
  await page.keyboard.press('Escape').catch(() => {});
};
const openTool = async (page, id) => {
  if (await present(page, `button.tbtn[data-t="${id}"]`)) await press(page, `button.tbtn[data-t="${id}"]`);
  else { await press(page, 'button.tbtn[data-t="more"]'); await page.waitForTimeout(300); await press(page, `[data-more="${id}"]`); }
  await page.waitForTimeout(400);
};

// ---- 1. a player, no flag
for (const [name, opts] of [['desktop', DESK], ['phone', PHONE]]) {
  const { ctx, page } = await newPage(opts);
  const title = await startFromTitle(page);
  check(`${name}, no flag: the title has no Playtest badge and no build`, !title.foot && !title.badge && !title.build && !/Playtest|Build /.test(title.text), title);
  const onboard = await page.evaluate(() => ({ shown: !!document.querySelector('.onboard'), note: !!document.querySelector('.ob-playtest') }));
  check(`${name}, no flag: the welcome card has no playtest note`, !onboard.note, onboard);
  await dismissOnboarding(page);
  const h = await hooks(page);
  check(`${name}, no flag: no debug hooks on window (${HOOKS.join(', ')})`, Object.values(h).every((t) => t === 'undefined'), h);
  check(`${name}, no flag: no bug button on the toolbar`, (await present(page, 'button.tbtn[data-t="bug"]')) === 0);
  await press(page, 'button.tbtn[data-t="more"]');
  await page.waitForTimeout(400);
  const more = await page.evaluate(() => [...document.querySelectorAll('[data-more]')].map((b) => b.dataset.more));
  check(`${name}, no flag: no bug button in More`, more.length > 0 && !more.includes('bug'), more);
  await page.keyboard.press('Escape').catch(() => {});
  await openTool(page, 'views');
  check(`${name}, no flag: no weather test chips in Info Views`, (await present(page, '[data-wx]')) === 0 && (await present(page, '[data-view]')) > 0);
  await openTool(page, 'help');
  check(`${name}, no flag: no Show performance in Settings`, (await present(page, '#perf-toggle')) === 0 && !/performance/i.test(await page.textContent('.subpanel')));
  await page.locator('#report-bug').scrollIntoViewIfNeeded();
  const rb = await page.evaluate(() => { const r = document.querySelector('#report-bug')?.getBoundingClientRect(); return r ? { w: Math.round(r.width), h: Math.round(r.height) } : null; });
  check(`${name}, no flag: Report a bug is in Settings${name === 'phone' ? ' (44 px for a finger)' : ''}`, !!rb && rb.w > 0 && (name !== 'phone' || rb.h >= 44), rb);
  await press(page, '#report-bug');
  check(`${name}, no flag: Report a bug opens the report sheet`, !!(await page.waitForSelector('.bug-sheet', { timeout: 15000 }).catch(() => null)));
  if (name === 'desktop') {
    await page.keyboard.press('Escape').catch(() => {});
    await page.keyboard.press('F3');
    await page.waitForTimeout(300);
    check('desktop, no flag: F3 does not show the performance readout', (await visible(page, '.perf-overlay')) === 0);
  }
  await ctx.close();
}

// ---- 2. #debug
{
  const { ctx, page } = await newPage(DESK, true);
  await page.goto(`${base}/#skip&map=appalachia&mode=sandbox&debug`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 420000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const h = await hooks(page);
  // __genMs is a timer the building generator adds to as it works: it exists once a building has been made, and is never sealed off
  const genOpen = await page.evaluate(() => !Object.getOwnPropertyDescriptor(window, '__genMs')?.get);
  check('#debug: the hooks exist', HOOKS.filter((n) => n !== '__genMs').every((n) => h[n] !== 'undefined') && genOpen, { ...h, genOpen });
  check('#debug: the playtest tools stay away (a separate switch)', (await present(page, 'button.tbtn[data-t="bug"]')) === 0);
  await ctx.close();
}

// ---- 3. #playtest, remembered, then #playtest=0
{
  const { ctx, page } = await newPage(DESK);
  const title = await startFromTitle(page, '#playtest');
  check('#playtest: the title shows the Playtest badge and the build', title.foot && title.badge && title.build, title);
  check('#playtest: the welcome card has the playtest note', (await present(page, '.ob-playtest')) === 1);
  await dismissOnboarding(page);
  const h = await hooks(page);
  check('#playtest: the hooks exist too', h.__game !== 'undefined' && h.__dbg !== 'undefined' && h.__services !== 'undefined', h);
  check('#playtest: the bug button is on the toolbar', (await present(page, 'button.tbtn[data-t="bug"]')) === 1);
  await openTool(page, 'views');
  check('#playtest: the weather test chips are in Info Views', (await present(page, '[data-wx]')) === 6);
  await openTool(page, 'help');
  check('#playtest: Show performance and Report a bug are in Settings', (await present(page, '#perf-toggle')) === 1 && (await present(page, '#report-bug')) === 1);
  // the address loses the flag (a bookmark, the home screen): the tools stay, the hooks do not
  await page.goto(`${base}/`, { waitUntil: 'load' });
  await page.waitForSelector('.aaa-nav, #new', { timeout: 120000 });
  check('#playtest is remembered: the badge is still on the title without it', (await present(page, '.aaa-badge')) === 1);
  check('... and without it in the address the hooks are off', (await hooks(page)).__services === 'undefined');
  // (only the hash differs from the page that is open: goto alone would not load it again)
  await page.goto(`${base}/#playtest=0`, { waitUntil: 'load' });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.aaa-nav, #new', { timeout: 120000 });
  const off = await present(page, '.aaa-badge');
  await page.goto(`${base}/`, { waitUntil: 'load' });
  await page.waitForSelector('.aaa-nav, #new', { timeout: 120000 });
  check('#playtest=0 turns the tools off, and that is remembered too', off === 0 && (await present(page, '.aaa-badge')) === 0, { off });
  await ctx.close();
}

check('no page errors', errs.length === 0, errs.slice(0, 3));
await browser.close();
server.close();
console.log(bad ? `shiptest: ${bad} failed` : 'shiptest: all pass');
process.exit(bad ? 1 : 0);
