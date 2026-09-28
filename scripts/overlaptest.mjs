// HUD panels never cover each other (playtest 5: "Inspector, Next guidance,
// zoning controls, and emergency panels overlap… verify at 1707×1019 with an
// inspector and emergency open"). At several window sizes, with a service
// emergency on, a building inspected and each drawer open in turn (zoning,
// services, roads), measures the top bar, feed, emergency card, inspector,
// drawer, Next card, toolbar, tool badge, toasts and banner, and fails on any
// two that overlap. SHOT=prefix saves screenshots. Exits nonzero on failure.
import { chromium } from 'playwright-core';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const PANELS = (process.env.PANELS || 'zones,ext:services,roads').split(',');
const SIZES = (process.env.SIZES || '1707x1019,1280x800,1024x700,390x844').split(',').map((s) => s.split('x').map(Number));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
let total = 0;
for (const [w, h] of SIZES) {
  const touch = w < 600;
  const page = await browser.newPage({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch });
  await page.addInitScript(() => { try { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.firstSteps', '1'); localStorage.setItem('slopmerica.emergencySpeed', 'off'); } catch {} });
  await page.goto(`${base}/#skip&map=florida&mode=ponzi`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 180000 });
  for (const panel of PANELS) {
  const r = await page.evaluate(async (panel) => {
    const g = window.__game, d = window.__dbg, S = g.startView();
    cancelAnimationFrame(g.raf);
    if (!window.__otTown) { window.__otTown = 1;
    g.sim.earn(1e6 - g.sim.money, 'other', 'Test funds'); g.net.allowed = null; g.zones.allowed = null;
    for (let k = -2; k <= 2; k++) { d.road(S.x - 180, S.z + k * 80, S.x + 180, S.z + k * 80); d.road(S.x + k * 90, S.z - 170, S.x + k * 90, S.z + 170); }
    d.road(S.x, S.z, S.x + 10, S.z + 10);
    d.zone(S.x - 60, S.z, 150, 'resLow');
    d.run(30);
    }
    // an emergency, as the playtest had one
    const home = [...g.buildings.list.values()].find((b) => b.state === 'active') ?? [...g.buildings.list.values()][0];
    g.emergency = () => ({ level: 'crit', needs: [{ need: 'power', cat: 'power', icon: '⚡', label: 'Power', failing: 'without power', buildings: 14, residents: 65, eta: [6, 18], why: 'Demand 2.3 MW against a 2.2 MW import cap.' }], atRisk: 14, residents: 65, hot: [{ x: home.x, z: home.z, n: 14, residents: 65, id: home.id }], forecast: '🗑️ Landfills full in about 3 months', forecastDays: 90, crisis: { since: g.sim.day - 3, cause: 'power', peakAtRisk: 14, peakTrash: 0, lowPop: 0, popAtStart: 0, endedAt: -1 }, trash: 0, abandoned: 2, day: g.sim.day });
    // the zoning panel open, a building inspected, Next showing
    g.select(null); g.tools.set('inspect');
    document.querySelector(`button.tbtn[data-t="${panel}"]`)?.click();
    g.select({ kind: 'building', b: home });
    for (let i = 0; i < 4; i++) { g.ui.update(0.5); g.frame(0.05, true); }
    await new Promise((res) => setTimeout(res, 300));
    const pick = { topbar: '.topbar', feed: '.xfeed', inspector: '.inspector', emergency: '.emergency', crisis: '.crisis', panel: '.subpanel', next: '.nextbar, .next-bar, [class*="nextbar"]', toolbar: '.toolbar, .tbar, nav.tools', toast: '.toast', actions: '.tool-actions', banner: '.banner' };
    const rects = {};
    for (const [k, sel] of Object.entries(pick)) {
      const e = [...document.querySelectorAll(sel)].find((x) => { const s = getComputedStyle(x); const r = x.getBoundingClientRect(); return !x.hidden && s.display !== 'none' && s.visibility !== 'hidden' && r.width > 4 && r.height > 4; });
      if (e) { const q = e.getBoundingClientRect(); rects[k] = { x: Math.round(q.x), y: Math.round(q.y), w: Math.round(q.width), h: Math.round(q.height), cls: e.className.toString().slice(0, 40) }; }
    }
    const over = [];
    const ks = Object.keys(rects);
    for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) {
      const a = rects[ks[i]], b = rects[ks[j]];
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ox > 2 && oy > 2) over.push(`${ks[i]}×${ks[j]} ${ox}×${oy}px`);
    }
    return { rects, over };
  }, panel);
  total += r.over.length;
  console.log(`${r.over.length ? 'FAIL' : 'OK  '} ${w}×${h}, ${panel} drawer + inspector + emergency: ${r.over.length ? r.over.join(', ') : `no overlaps (${Object.keys(r.rects).join(', ')})`}`);
  if (process.env.RECTS) console.log(JSON.stringify(r.rects));
  if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}-${w}-${panel.replace(':', '')}.png` });
  }
  await page.close();
}
await browser.close();
process.exit(total ? 1 : 0);
