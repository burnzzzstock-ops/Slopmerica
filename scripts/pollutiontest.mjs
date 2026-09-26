// Pollution field mass balance: transfers move pollution, only decay and the
// map edge remove it. Exits nonzero on failure.
import { chromium } from 'playwright-core';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
const r = await page.evaluate(async () => {
  const { Fields, FIELD_N } = await import('/src/sim/pollution.ts');
  const out = [];
  const sum = (f) => f.pol.reduce((a, b) => a + b, 0);
  const min = (f) => f.pol.reduce((a, b) => Math.min(a, b), Infinity);
  for (const [days, wx, wz] of [[1, 0, 0], [2, 0.7, 0.7], [2, 1, 1], [3, -1, 0.4], [0.5, 0.3, -0.9]]) {
    const f = new Fields();
    const mid = Math.floor(FIELD_N / 2) * FIELD_N + Math.floor(FIELD_N / 2);
    f.pol[mid] = 100;
    f.stepPollution(days, wx, wz);
    const expected = 100 * Math.pow(0.93, days);
    out.push({ days, wx, wz, total: +sum(f).toFixed(4), expected: +expected.toFixed(4), min: +min(f).toFixed(6), ok: Math.abs(sum(f) - expected) < 1e-3 && min(f) >= 0 });
  }
  // at the edge mass may leave the county, never appear
  const e = new Fields();
  e.pol[0] = 100;
  e.stepPollution(2, -1, -1);
  out.push({ edge: true, total: +sum(e).toFixed(4), max: +(100 * Math.pow(0.93, 2)).toFixed(4), ok: sum(e) <= 100 * Math.pow(0.93, 2) + 1e-6 && min(e) >= 0 });
  return out;
});
let bad = 0;
for (const row of r) { console.log(row.ok ? 'OK  ' : 'FAIL', JSON.stringify(row)); if (!row.ok) bad++; }
await browser.close();
process.exit(bad ? 1 : 0);
