// Graphics presets change what is drawn, never the simulation: the same map
// on Low and High counts the same trees (land value, nature), budgets the
// same traffic, and launches trips even when the drawable vehicle pool is
// full. Exits nonzero on failure.
import { chromium } from 'playwright-core';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const map = process.argv[2] || 'appalachia';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const probe = async (quality) => {
  const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript((q) => { localStorage.setItem('slopmerica.quality', q); localStorage.setItem('slopmerica.onboarded', '1'); }, quality);
  await page.goto(`${base}/#skip&map=${map}&mode=sandbox`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 180000 });
  const r = await page.evaluate(() => {
    const g = window.__game, t = g.traffic;
    cancelAnimationFrame(g.raf);
    const samples = [];
    for (let i = -5; i <= 5; i++) for (let j = -5; j <= 5; j++) samples.push(g.trees.countIn(i * 480, j * 480, 70));
    const S = g.startView();
    window.__dbg.road(S.x - 150, S.z + 40, S.x + 150, S.z + 40, 'twoLane');
    t.update(0.1, 1, 8, 20000, 5000, g.rts.target);
    const budget = t.targetCars;
    // fill every drawable vehicle slot, then ask for one more trip
    const R = t.renderer;
    let filled = 0;
    while (R.add('sedan', 0xffffff) >= 0 && filled < 5000) filled++;
    const segs = [...g.net.segs.values()];
    const from = { seg: segs[0], s: segs[0].length * 0.3 }, to = { seg: segs[segs.length - 1], s: segs[segs.length - 1].length * 0.6 };
    const launched = t.launch(from, to, null, null, 'sedan', 'test trip', 'test', true, 8) !== null;
    return { quality: g.q.name, trees: g.trees.total, samples, budget, filled, launched, drawnCap: g.q.maxCars };
  });
  await page.close();
  return { ...r, errs };
};
const low = await probe('low'), high = await probe('high');
const diff = low.samples.filter((v, i) => v !== high.samples[i]).length;
const checks = [
  [`reference tree count equal (low ${low.trees}, high ${high.trees})`, low.trees === high.trees],
  [`land-value tree samples equal at ${low.samples.length} spots (${diff} differ)`, diff === 0],
  [`traffic budget equal (low ${low.budget}, high ${high.budget})`, low.budget === high.budget],
  [`trip launches with the drawable pool full (low: ${low.filled} drawn)`, low.launched],
  ['no page errors', !low.errs.length && !high.errs.length],
];
let bad = 0;
for (const [label, ok] of checks) { console.log(ok ? 'OK  ' : 'FAIL', label); if (!ok) bad++; }
await browser.close();
process.exit(bad ? 1 : 0);
