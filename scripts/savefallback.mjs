// Saving where the owner plays (docs/HANDOFF_ROUND8_SONNET.md, item 1). Inside the claude.ai artifact viewer a download is blocked: the
// frame is sandboxed without `allow-downloads`, so an <a download> click does nothing and says nothing. The game must then copy the save
// to the clipboard and say so on screen; outside a frame the normal download must still happen (and leave the clipboard alone); and a
// copied city must load again from the title screen ("Paste a copied city").
//
// It hosts the BUILT single-file game (dist-single) from a small static server of its own and drives real Chromium:
//   1. a host page with <iframe sandbox="allow-scripts allow-same-origin allow-forms allow-popups"> (no allow-downloads): the bug sheet's
//      "Save city file" and Settings' "Save city file" -> the clipboard holds a valid city file, a message on screen says "copied", no download;
//   2. the game as the top page: the same button -> a real download of slopmerica-*.json, the clipboard untouched, the message says "saved";
//   3. the title screen, empty storage: "Paste a copied city" with the text from (1) -> the game starts on that city.
//
// usage: node scripts/savefallback.mjs                      builds dist-single first (npm run build:single), then tests it
//   DIST=/path/to/dist-single  test another build (e.g. the old code's: it fails 1, which is the point)   BUILD=0  do not build
//   The browser opens through the slot lock when you run it as scripts/withslot.sh node scripts/savefallback.mjs
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { execSync } from 'node:child_process';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { ARGS, EXE } from './refblock.mjs';

const dist = process.env.DIST || 'dist-single';
if (!process.env.DIST && process.env.BUILD !== '0') execSync('npm run build:single', { stdio: 'inherit' });
if (!existsSync(join(dist, 'index.html'))) { console.log('FAIL no built game in', dist); process.exit(1); }

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.txt': 'text/plain', '.png': 'image/png', '.css': 'text/css' };
const HOST = `<!doctype html><meta charset="utf-8"><title>host</title><body style="margin:0">
<iframe id="game" style="width:1100px;height:700px;border:0" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" allow="clipboard-write; clipboard-read" src="/index.html#skip&map=appalachia&mode=sandbox"></iframe>`;
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/host.html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(HOST); return; }
  const f = normalize(join(dist, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname)));
  if (!f.startsWith(normalize(dist)) || !existsSync(f) || !statSync(f).isFile()) { res.writeHead(404); res.end('no'); return; }
  res.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream' });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra).slice(0, 400)); if (!ok) bad++; };
const browser = await chromium.launch({ executablePath: EXE, args: ARGS });
const newCtx = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 700 }, acceptDownloads: true });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
  await ctx.addInitScript(() => { try { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); } catch { /* */ } });
  return ctx;
};
const errs = [];
const ready = async (frame) => { await frame.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 420000 }); await frame.waitForTimeout(1500); };
const clip = (page) => page.evaluate(() => navigator.clipboard.readText().catch((e) => 'ERR ' + e.message));

// ---- 1. inside a sandboxed frame (no allow-downloads)
{
  const ctx = await newCtx();
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(e.message));
  let downloads = 0;
  page.on('download', () => downloads++);
  await page.goto(`${base}/host.html`, { waitUntil: 'load' });
  const frame = page.frames().find((f) => f.url().includes('/index.html')) ?? (await (await page.waitForSelector('#game')).contentFrame());
  await ready(frame);
  const framed = await frame.evaluate(() => window.top !== window.self);
  check('the game runs inside the sandboxed frame', framed);
  await page.evaluate(() => navigator.clipboard.writeText('SENTINEL')).catch(() => {});
  // the bug sheet's "Save city file" (it exists in every build, so this check also runs against the old code)
  await frame.click('button.tbtn[data-t="bug"]', { timeout: 120000, force: true }).catch(async () => { await frame.click('button.tbtn[data-t="more"]'); await frame.click('[data-t="bug"]'); });
  await frame.waitForSelector('#bug-city', { timeout: 30000 });
  await frame.click('#bug-city', { force: true, timeout: 120000 });
  await frame.waitForTimeout(1500);
  const text = await clip(page);
  let city = null; try { city = JSON.parse(text); } catch { /* not JSON */ }
  const msg = await frame.evaluate(() => document.querySelector('.bug-status')?.textContent ?? '');
  check('bug sheet, in a frame: the city file is on the clipboard (a valid save: v 1, map, buildings)', !!city && city.v === 1 && city.map === 'appalachia', { head: String(text).slice(0, 60) });
  check('... and the screen says it was copied', /copied/i.test(msg), { msg });
  check('... a download was never reported (the frame blocks it)', downloads === 0);
  // Settings' own button
  await page.keyboard.press('Escape');
  await page.evaluate(() => navigator.clipboard.writeText('SENTINEL2')).catch(() => {});
  await frame.click('button.tbtn[data-t="help"]', { timeout: 120000, force: true }).catch(async () => { await frame.click('button.tbtn[data-t="more"]'); await frame.click('[data-t="help"]'); });
  const has = await frame.$('#save-file');
  check('Settings has a "Save city file" button', !!has);
  if (has) {
    await frame.click('#save-file', { force: true, timeout: 120000 });
    await frame.waitForTimeout(1500);
    const t2 = await clip(page);
    let c2 = null; try { c2 = JSON.parse(t2); } catch { /* */ }
    const toast = await frame.evaluate(() => [...document.querySelectorAll('.toast')].map((e) => e.textContent).join(' | '));
    check('Settings, in a frame: the city file is on the clipboard', !!c2 && c2.v === 1, { head: String(t2).slice(0, 60) });
    check('... and a toast says "copied"', /copied/i.test(toast), { toast });
    globalThis.__copied = t2;
  }
  await ctx.close();
}

// ---- 2. as the top page: the normal download still happens
{
  const ctx = await newCtx();
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(`${base}/index.html#skip&map=appalachia&mode=sandbox`, { waitUntil: 'load' });
  await ready(page);
  await page.evaluate(() => navigator.clipboard.writeText('SENTINEL3')).catch(() => {});
  await page.click('button.tbtn[data-t="help"]', { timeout: 120000, force: true }).catch(async () => { await page.click('button.tbtn[data-t="more"]'); await page.click('[data-t="help"]'); });
  if (await page.$('#save-file')) {
    const dl = page.waitForEvent('download', { timeout: 15000 }).catch(() => null);
    await page.click('#save-file', { force: true, timeout: 120000 });
    const d = await dl;
    check('outside a frame, Save city file downloads a file', !!d && /^slopmerica-.*\.json$/.test(d.suggestedFilename()), { name: d?.suggestedFilename() });
    await page.waitForTimeout(800);
    check('... and leaves the clipboard alone', (await clip(page)) === 'SENTINEL3');
    const toast = await page.evaluate(() => [...document.querySelectorAll('.toast')].map((e) => e.textContent).join(' | '));
    check('... and the toast says saved, not copied', /saved/i.test(toast) && !/copied/i.test(toast), { toast });
  } else check('outside a frame, Save city file downloads a file', false, 'no #save-file button');
  await ctx.close();
}

// ---- 3. load it back from the title screen
{
  const copied = globalThis.__copied;
  if (!copied) check('Paste a copied city loads the copied save', false, 'nothing was copied above');
  else {
    const ctx = await newCtx();
    await ctx.addInitScript(() => { try { localStorage.removeItem('slopmerica.save.v1'); } catch { /* */ } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(`${base}/index.html`, { waitUntil: 'load' });
    await page.waitForSelector('.title .aaa-nav', { timeout: 180000 });
    const open = await page.$('#paste-open');
    check('the title has a "Paste a copied city" link', !!open);
    if (open) {
      await page.fill('#paste-box', 'not a city').catch(async () => { await page.click('#paste-open'); await page.fill('#paste-box', 'not a city'); });
      await page.click('#paste-go', { force: true, timeout: 120000 });
      const bad1 = await page.evaluate(() => document.querySelector('.aaa-import-msg')?.textContent ?? '');
      check('pasting rubbish says so and stays on the title', /isn't a Slopmerica city/.test(bad1) && !!(await page.$('.title')), { bad1 });
      await page.fill('#paste-box', copied);
      await page.click('#paste-go', { force: true, timeout: 120000 });
      await ready(page);
      const name = await page.evaluate(() => ({ city: window.__game.cityName, segs: window.__game.net.segs.size }));
      check('pasting the copied city starts the game on it', !!name.city, name);
    }
    await ctx.close();
  }
}
check('no page errors', errs.length === 0, errs.slice(0, 3));
await browser.close();
server.close();
process.exit(bad ? 1 : 0);
