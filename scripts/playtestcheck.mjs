// Playtest plumbing on a phone: title stamp, onboarding note, bug report
// sheet (copy + contents), crash toast, WebGL context loss banner, and the
// boot rescue screen for a save that won't load.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
mkdirSync('shots/playtest', { recursive: true });
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, permissions: ['clipboard-read', 'clipboard-write'] });
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
await page.addInitScript(() => { try { localStorage.setItem('slopmerica.quality', 'low'); } catch { /* */ } });
let failures = 0;
// screenshots are for a human to look at; a slow software GPU must not fail the check
const shot = (path) => page.screenshot({ path, timeout: 60000 }).catch((e) => console.log('(screenshot skipped:', path, e.message.split('\n')[0] + ')'));
const ok = (label, cond, extra = '') => { if (!cond) failures++; console.log(`${cond ? 'OK  ' : 'FAIL'} ${label}${extra ? ' · ' + extra : ''}`); };

// 1. title: stamp + build
await page.goto(`${base}/`, { waitUntil: 'load' });
await page.waitForSelector('.aaa-foot', { timeout: 60000 });
const badge = await page.textContent('.aaa-badge');
const build = await page.textContent('.aaa-build');
ok('title shows the playtest badge and build', /Playtest/.test(badge ?? '') && /Build \S+/.test(build ?? ''), build ?? '');
await shot('shots/playtest/title-stamp.png');

// 2. start a game: onboarding mentions reporting
await page.tap('#new');
await page.waitForSelector('#go', { state: 'visible', timeout: 10000 });
await page.tap('#go');
await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 180000 });
await page.waitForSelector('.onboard', { timeout: 30000 });
ok('onboarding tells testers how to report', (await page.textContent('.onboard')).includes('Report bug'));
await shot('shots/playtest/onboarding.png');
await page.tap('#ob-go');
await page.waitForTimeout(500);
await page.evaluate(() => { const d = window.__dbg, g = window.__game; const S = g.startView(); d.road(S.x - 100, S.z + 40, S.x + 100, S.z + 40, 'twoLane'); });

// 3. report sheet from More
await page.tap('button.tbtn[data-t="more"]');
await page.waitForTimeout(300);
const firstMore = await page.evaluate(() => document.querySelector('[data-more]')?.dataset.more);
ok('Report bug leads the More grid', firstMore === 'bug', firstMore);
await page.tap('[data-more="bug"]');
await page.waitForSelector('.bug-sheet', { timeout: 10000 });
await page.tap('#bug-copy');
await page.waitForTimeout(300);
ok('empty report asks for a description first', (await page.textContent('.bug-status')).includes('Add a few words'));
await page.fill('#bug-what', 'Test: the road vanished when I tapped Build');
await page.tap('[data-kind="Looks wrong"]');
await page.tap('#bug-copy');
await page.waitForTimeout(500);
const status = await page.textContent('.bug-status');
const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
ok('copy report', /Copied|copy it from there/.test(status), status);
const report = clip || (await page.inputValue('#bug-preview'));
for (const [label, re] of [['kind', /Looks wrong/], ['description', /road vanished/], ['build', /Build: \S+/], ['device', /Device: .*touch/], ['GPU', /GPU: /], ['city', /City: .*day \d+ · pop/], ['actions', /Recent actions:[\s\S]*(built|tool|opened)/]])
  ok(`report has ${label}`, re.test(report));
await page.evaluate(() => { const p = document.querySelector('.bug-peek'); p.open = true; });
await shot('shots/playtest/report-sheet.png');
console.log('---- report ----\n' + report.split('\n').slice(0, 16).join('\n') + '\n----');
await page.tap('.bug-x');

// 4. a thrown error pops the crash toast, which opens a prefilled report
await page.evaluate(() => setTimeout(() => { throw new Error('playtest boom'); }, 0));
await page.waitForSelector('.crash-toast', { timeout: 10000 }).catch(() => {});
ok('crash toast appears after an error', await page.isVisible('.crash-toast'));
await shot('shots/playtest/crash-toast.png');
if (await page.isVisible('.crash-toast')) {
  await page.tap('.crash-toast .bug-primary');
  await page.waitForSelector('.bug-sheet', { timeout: 10000 });
  const pre = await page.inputValue('#bug-preview');
  ok('crash report is prefilled and lists the error', (await page.inputValue('#bug-what')).includes('playtest boom') && /Errors \(1\)[\s\S]*playtest boom/.test(pre));
  await page.tap('.bug-x');
}

// 5. WebGL context loss: banner + save
await page.evaluate(() => { localStorage.removeItem('slopmerica.save.v1'); window.__game.renderer.getContext().getExtension('WEBGL_lose_context')?.loseContext(); });
await page.waitForSelector('.ctx-lost', { timeout: 10000 }).catch(() => {});
ok('context loss shows the reload banner', await page.isVisible('.ctx-lost'));
ok('context loss saved the city', await page.evaluate(() => !!localStorage.getItem('slopmerica.save.v1')));
await shot('shots/playtest/context-lost.png');

// 6. a save that breaks loading lands on the rescue screen, not a frozen loader.
// Corrupt it from the title screen: leaving the game autosaves over it.
await page.goto(`${base}/`, { waitUntil: 'load' });
await page.waitForSelector('#continue', { timeout: 60000 });
await page.evaluate(() => {
  const d = JSON.parse(localStorage.getItem('slopmerica.save.v1'));
  d.communes = 42; // not a list: loading throws
  localStorage.setItem('slopmerica.save.v1', JSON.stringify(d));
});
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('#continue', { timeout: 60000 });
await page.tap('#continue');
await page.waitForSelector('.boot-fail', { timeout: 120000 }).catch(() => {});
ok('broken save shows the rescue screen', await page.isVisible('.boot-fail'));
await shot('shots/playtest/rescue.png');
if (await page.isVisible('#bf-fresh')) {
  await page.tap('#bf-fresh');
  await page.waitForSelector('.aaa-home', { timeout: 60000 });
  const st = await page.evaluate(() => ({ save: !!localStorage.getItem('slopmerica.save.v1'), shelved: !!localStorage.getItem('slopmerica.save.v1.broken'), ticket: !!document.querySelector('#continue') }));
  ok('Start a new city shelves the broken save and returns to the title', !st.save && st.shelved && !st.ticket, JSON.stringify(st));
}
const unexpected = pageErrors.filter((m) => !m.includes('playtest boom'));
ok('no unexpected page errors', unexpected.length === 0, unexpected.slice(0, 3).join(' | '));
await browser.close();
process.exit(failures ? 1 : 0);
