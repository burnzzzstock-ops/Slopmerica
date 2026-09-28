// Grade you can see (playtest 5: "Road routes failed at 24% and later 21%
// grade; a gentler route worked. Add contours, slope shading, and a live grade
// preview that remain readable at night"). On Holler County: the road tool and
// building placement drape contours and slope shading around the cursor (and
// other tools don't); a road near the limit says its grade in the tip and draws
// amber; one past it is refused with the grade, the 15% rule and the way out.
// Exits nonzero on failure.
import { chromium } from 'playwright-core';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra).slice(0, 500)); if (!ok) bad++; };
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => { try { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.firstSteps', '1'); } catch { /* */ } });
await page.goto(`${base}/#skip&map=appalachia&mode=sandbox`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__game && window.__dbg && window.__services, null, { timeout: 180000 });
const r = await page.evaluate(() => {
  const g = window.__game, T = g.terrain, t = g.tools, V = g.camera.position.constructor, S = g.startView(), SV = window.__services;
  cancelAnimationFrame(g.raf);
  const ev = { pointerType: 'mouse', button: 0, timeStamp: 1e6 };
  // straight dry climbs of 120 m: one just under the limit, one well past it
  const find = (lo, hi) => {
    for (let r0 = 150; r0 < 1500; r0 += 40) for (let a = 0; a < 36; a++) {
      const x = S.x + Math.cos(a * 0.17) * r0, z = S.z + Math.sin(a * 0.17) * r0;
      for (let b = 0; b < 8; b++) {
        const dx = Math.cos(b * 0.785) * 120, dz = Math.sin(b * 0.785) * 120;
        let dry = true;
        for (let k = 0; k <= 12; k++) if (T.h(x + (dx * k) / 12, z + (dz * k) / 12) < 2) dry = false;
        const gr = (T.h(x + dx, z + dz) - T.h(x, z)) / 120;
        if (dry && gr > lo && gr < hi) return { x, z, dx, dz, gr };
      }
    }
    return null;
  };
  const draw = (p) => {
    t.roadType = 'twoLane'; t.roadMode = 'straight'; t.set('road');
    const a = new V(p.x, T.h(p.x, p.z), p.z), b = new V(p.x + p.dx, 0, p.z + p.dz);
    b.y = T.h(b.x, b.z);
    t.hover = a; t.up(a, ev, false);
    t.hover = b; t.update();
    const c = t.previewMat?.color ?? t.preview?.material?.color;
    return { tip: t.tip?.text ?? '', bad: !!t.tip?.bad, color: c ? c.getHexString() : null, overlay: t.grade.mesh.visible };
  };
  const near = find(0.12, 0.145), steep = find(0.2, 0.32);
  const out = { near: near && { gr: near.gr, ...draw(near) }, steep: steep && { gr: steep.gr, ...draw(steep) } };
  // the overlay's canvas has contours and shading painted
  const cv = t.grade.mesh.material.map.image, ctx = cv.getContext('2d'), px = ctx.getImageData(0, 0, cv.width, cv.height).data;
  let painted = 0, white = 0, red = 0;
  for (let i = 0; i < px.length; i += 4 * 7) if (px[i + 3] > 20) { painted++; if (px[i] > 200 && px[i + 1] > 200 && px[i + 2] > 200) white++; else if (px[i] > 200 && px[i + 1] < 120) red++; }
  out.canvas = { painted, white, red };
  // other tools don't show it; placing a building does
  t.set('zone'); t.hover = new V(S.x, T.h(S.x, S.z), S.z); t.update();
  out.zoneTool = t.grade.mesh.visible;
  t.set('inspect'); t.update();
  out.inspect = t.grade.mesh.visible;
  t.set('ext'); t.setExt?.('svcPlace'); t.extTool = 'svcPlace'; t.active = 'ext'; t.hover = new V(S.x, T.h(S.x, S.z), S.z); t.update();
  out.placing = t.grade.mesh.visible;
  t.set('inspect'); t.update();
  return out;
});
console.log(JSON.stringify(r).slice(0, 900));
check(`a road near the limit says its grade and draws amber ("${(r.near?.tip ?? '').match(/⚠️ grade[^·]*/)?.[0] ?? r.near?.tip}")`, !!r.near && /⚠️ grade 1[2-4]% \(roads climb at most 15%\)/.test(r.near.tip) && r.near.color === 'ffb62e', r.near);
check(`past the limit it's refused with the grade, the rule and the way out ("${r.steep?.tip}")`, !!r.steep && r.steep.bad && /Too steep \(\d+% grade; roads climb at most 15%\)\. Go around the red shading, or zig-zag up\./.test(r.steep.tip), r.steep);
check('the road tool drapes contours and slope shading around the cursor', r.near?.overlay && r.canvas.white > 200 && r.canvas.red > 200, r.canvas);
check('placing a building shows it too; zoning and inspecting don\'t', r.placing && !r.zoneTool && !r.inspect, { placing: r.placing, zone: r.zoneTool, inspect: r.inspect });
check('no page errors', errs.length === 0, errs.slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
