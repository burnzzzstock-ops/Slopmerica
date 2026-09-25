// Screenshots: service buildings, problem icons, info views, and the panel UI.
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';
const [map = 'florida', prefix = 'shots/svc'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(`http://127.0.0.1:5173/#skip&map=${map}&mode=sandbox`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 120000 });
await page.evaluate(() => document.querySelector('.onboard button, .onboarding button')?.click());
await page.evaluate(() => cancelAnimationFrame(window.__game.raf));
const info = await page.evaluate(() => {
  const d = window.__dbg, g = window.__game, SV = window.__services;
  const S0 = g.startView();
  const cx = Math.round(S0.x), cz = Math.round(S0.z);
  for (const c of g.communes.list) { c.state = 'gone'; g.communes.group.remove(c.group); }
  g.syncBlockers();
  for (let k = -3; k <= 3; k++) { d.road(cx - 300, cz + k * 90, cx + 300, cz + k * 90, k === 0 ? 'stroad4' : 'twoLane'); d.road(cx + k * 90, cz - 300, cx + k * 90, cz + 300, k === 0 ? 'stroad4' : 'twoLane'); }
  d.zone(cx - 150, cz - 150, 130, 'resLow'); d.zone(cx + 150, cz + 150, 130, 'resLow'); d.zone(cx, cz, 70, 'comLow'); d.zone(cx + 170, cz - 170, 110, 'industry'); d.zone(cx - 170, cz + 170, 110, 'resHigh');
  d.run(36);
  const tryPlace = (id, R) => { for (const r of R) for (let a = 0; a < 48; a++) { const ang = (a / 48) * Math.PI * 2; const x = cx + Math.cos(ang) * r, z = cz + Math.sin(ang) * r; if (SV.canPlace(g, id, x, z).ok) { const b = SV.place(g, id, x, z); if (b) return b; } } return null; };
  const P = {};
  for (const id of ['gasPeaker', 'fireStation', 'sheriff', 'clinic', 'school', 'park']) { const b = tryPlace(id, [60, 120, 200]); P[id] = b && [Math.round(b.x), Math.round(b.z)]; }
  const lf = tryPlace('landfill', [320, 500, 800]); P.landfill = lf && [Math.round(lf.x), Math.round(lf.z)];
  const coal = tryPlace('coalPlant', [420, 600, 800]); P.coal = coal && [Math.round(coal.x), Math.round(coal.z)];
  d.run(12);
  window.__P = P; window.__C = [cx, cz];
  return P;
});
console.log(JSON.stringify(info));
const shots = [
  ['icons', `d.hour(11); const [cx,cz]=window.__C; d.view(cx-150, cz-150, 380, 0.7, 0.75)`],
  ['fire', `const P=window.__P; d.view(P.fireStation[0], P.fireStation[1], 70, 0.5, 0.45)`],
  ['school', `const P=window.__P; d.view(P.school[0], P.school[1], 80, 2.2, 0.45)`],
  ['clinic', `const P=window.__P; d.view(P.clinic[0], P.clinic[1], 60, -0.6, 0.4)`],
  ['landfill', `const P=window.__P; d.view(P.landfill[0], P.landfill[1], 110, 0.9, 0.5)`],
  ['coal', `const P=window.__P; P.coal && d.view(P.coal[0], P.coal[1], 170, 1.2, 0.35)`],
  ['vpower', `const [cx,cz]=window.__C; const v = window.__ext.views.find(x=>x.id==='svc:power'); g.overlays.setExt(v); d.view(cx, cz, 900, 0.7, 0.95)`],
  ['vfire', `const [cx,cz]=window.__C; const v = window.__ext.views.find(x=>x.id==='svc:fire'); g.overlays.setExt(v); d.view(cx, cz, 900, 0.7, 0.95)`],
  ['vpollution', `const [cx,cz]=window.__C; const v = window.__ext.views.find(x=>x.id==='svc:pollution'); g.overlays.setExt(v); d.view(cx, cz, 1300, 0.7, 1.0)`],
  ['vnoise', `const [cx,cz]=window.__C; const v = window.__ext.views.find(x=>x.id==='svc:noise'); g.overlays.setExt(v); d.view(cx, cz, 1100, 0.7, 1.0)`],
  ['night', `g.overlays.setExt(null); const [cx,cz]=window.__C; d.hour(22); d.view(cx, cz, 420, 0.7, 0.6)`],
];
for (const [name, js] of shots) {
  const r = await page.evaluate(`(async () => { const g = window.__game, d = window.__dbg; ${js}; for (let i = 0; i < 4; i++) g.frame(0.016); return 'ok'; })()`).catch((e) => 'ERR ' + e.message);
  if (r !== 'ok') console.log(name, r);
  const url = await page.evaluate(() => { const g = window.__game; g.frame(0.016); return g.renderer.domElement.toDataURL('image/png'); });
  writeFileSync(`${prefix}-${name}.png`, Buffer.from(url.split(',')[1], 'base64'));
}
// UI: services panel + fire view legend
await page.evaluate(() => { const g = window.__game; window.__dbg.hour(11); g.frame(0.016); });
await page.click('button.tbtn[data-t="ext:services"]');
await page.waitForTimeout(400);
await page.click('[data-cat="fire"]');
await page.evaluate(() => { const g = window.__game; for (let i = 0; i < 3; i++) g.frame(0.016); });
await page.waitForTimeout(800);
await page.screenshot({ path: `${prefix}-ui-panel.png`, timeout: 120000 });
await page.click('button.tbtn[data-t="views"]');
await page.waitForTimeout(400);
await page.click('[data-extview="svc:garbage"]');
await page.evaluate(() => { const g = window.__game; for (let i = 0; i < 3; i++) g.frame(0.016); });
await page.waitForTimeout(800);
await page.screenshot({ path: `${prefix}-ui-views.png`, timeout: 120000 });
// inspector on a residential building
await page.evaluate(() => { const g = window.__game; g.overlays.setExt(null); const b = [...g.buildings.list.values()].find((b) => b.zone === 'resLow' && b.state === 'active'); g.select({ kind: 'building', b }); window.__dbg.view(b.x, b.z, 120, 0.7, 0.6); });
await page.waitForTimeout(800);
await page.screenshot({ path: `${prefix}-ui-inspector.png`, timeout: 120000 });
console.log(errs.slice(0, 5).join('\n'));
await browser.close();
