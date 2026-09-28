// Water reflections without the first-look hitch (playtest 5: "the recorded
// worst frame was 134 ms, with water reflection at 124.1 ms"). The mirror pass
// used to clip with the renderer's clipping planes, which made every material
// compile a second, clipped program the first time water came into view, and
// switch programs twice a frame after that. It now clips with an oblique near
// plane. On High, over the Redwood Coast's water, from freshly released shader
// programs: the first mirror frame compiles next to nothing and costs a
// fraction of the old one; materials stop holding a second program; the
// mirror image matches the old clipping-plane image; nothing under the surface
// shows in it. Prints the old and new first-frame times for the record.
// Exits nonzero on failure.
import { chromium } from 'playwright-core';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra).slice(0, 500)); if (!ok) bad++; };
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });

// one fresh page per mode: 'now' (oblique near plane) or 'old' (the renderer's clipping planes, as before)
async function run(mode) {
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(() => { try { localStorage.setItem('slopmerica.quality', 'high'); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.firstSteps', '1'); } catch { /* */ } });
  await page.goto(`${base}/#skip&map=norcal&mode=sandbox`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 300000 });
  const r = await page.evaluate((mode) => {
    const g = window.__game, d = window.__dbg, R = g.renderer, refl = g.water.reflection;
    cancelAnimationFrame(g.raf);
    if (!refl) return { none: true };
    const Plane = refl.plane.constructor, V3 = g.camera.position.constructor;
    const render = refl.render.bind(refl);
    let ms = 0, n = 0;
    const oldClip = [new Plane(new V3(0, 1, 0), 0)];
    const legacy = (on) => {
      refl.render = (renderer, scene, camera, hide) => {
        const t0 = performance.now();
        // the old way: the renderer's clipping planes on top (the oblique plane clips the same place)
        const prev = renderer.clippingPlanes;
        if (on) { oldClip[0].constant = -(hide[0]?.position.y ?? 0) + 0.25; renderer.clippingPlanes = oldClip; }
        const out = render(renderer, scene, camera, hide);
        renderer.clippingPlanes = prev;
        if (out) { ms = performance.now() - t0; n++; }
        return out;
      };
    };
    legacy(mode === 'old');
    // a view over a good stretch of water
    const boxes = refl.waterBounds;
    const big = boxes.map((b) => ({ b, c: b.getCenter(new V3()) })).find(({ c }) => boxes.filter((o) => o.distanceToPoint(c) < 200).length >= 6) ?? { c: boxes[0].getCenter(new V3()) };
    const wet = { x: big.c.x, z: big.c.z };
    d.hour(15);
    // loading already looked at water, so start over: no mirror pass, every shader program
    // released, then a few frames away from the water to compile what the main view needs
    refl.enabled = false;
    n = 0;
    d.view(wet.x, wet.z, 260, 0.8, 0.42);
    for (let i = 0; i < 3; i++) g.frame(0.016);
    const seen = new Set();
    g.scene.traverse((o) => { if (o.material) for (const m of Array.isArray(o.material) ? o.material : [o.material]) seen.add(m); });
    for (const m of seen) m.dispose();
    for (let i = 0; i < 4; i++) g.frame(0.016);
    const noReflBefore = n === 0;
    const progs0 = R.info.programs.length;
    const mats = new Set();
    // the mirror pass switches on: its first frame
    refl.enabled = true;
    ms = 0; n = 0;
    g.frame(0.016);
    const first = ms, firstN = n;
    const progs1 = R.info.programs.length;
    for (let i = 0; i < 4; i++) g.frame(0.016);
    g.scene.traverse((o) => { if (o.material) for (const m of Array.isArray(o.material) ? o.material : [o.material]) mats.add(m); });
    let twoProg = 0;
    for (const m of mats) { const p = R.properties.get(m).programs; if (p && p.size > 1) twoProg++; }
    // steady frames
    let steady = 0;
    for (let i = 0; i < 6; i++) { g.frame(0.016); steady += ms; }
    // the mirror image, both ways, from this view: half-float target read back as 16-bit halves
    const rt = refl.rt, w = rt.width, h = rt.height;
    const grab = () => { const a = new Uint16Array(w * h * 4); R.readRenderTargetPixels(rt, 0, 0, w, h, a); return a; };
    const half = (v) => { const s = v & 0x8000 ? -1 : 1, e = (v >> 10) & 31, f = v & 1023; return e === 0 ? s * f * 2 ** -24 : e === 31 ? 0 : s * (1 + f / 1024) * 2 ** (e - 15); };
    legacy(false); g.frame(0.016); const a = grab();
    legacy(true); g.frame(0.016); const b = grab();
    legacy(mode === 'old');
    let diff = 0, lum = 0, cnt = 0, lit = 0;
    for (let i = 0; i < a.length; i += 16) {
      const la = half(a[i]) + half(a[i + 1]) + half(a[i + 2]), lb = half(b[i]) + half(b[i + 1]) + half(b[i + 2]);
      diff += Math.abs(la - lb); lum += lb; cnt++; if (la > 0.01) lit++;
    }
    // under the surface: a mirrored point below the water can't land in the image. Put a
    // bright marker 3 m under the surface right below the view and see that it doesn't show
    const Mesh = g.tools.grade.mesh.constructor, MBM = g.tools.grade.mesh.material.constructor, BoxG = g.tools.grade.mesh.geometry.constructor;
    const marker = new Mesh(new BoxG(60, 1, 60), new MBM({ color: 0xff00ff, toneMapped: false, fog: false }));
    marker.position.set(wet.x, g.water.mesh.position.y - 3, wet.z);
    g.scene.add(marker);
    legacy(false); g.frame(0.016);
    const m = grab();
    let magenta = 0;
    for (let i = 0; i < m.length; i += 4) { const r0 = half(m[i]), g0 = half(m[i + 1]), b0 = half(m[i + 2]); if (r0 > 0.5 && b0 > 0.5 && g0 < 0.15) magenta++; }
    g.scene.remove(marker);
    return { mode, noReflBefore, first, firstN, steady: steady / 6, newPrograms: progs1 - progs0, mats: mats.size, twoProg, diff: diff / Math.max(1e-6, lum), lit: lit / cnt, magenta, size: `${w}×${h}` };
  }, mode);
  await page.close();
  return { ...r, errs };
}

const old = await run('old');
const now = await run('now');
console.log(JSON.stringify({ old, now }));
if (now.none) { check('High quality has water reflections', false, now); process.exit(1); }
console.log(`first reflection frame: ${old.first.toFixed(1)} ms before (${old.newPrograms} programs compiled), ${now.first.toFixed(1)} ms now (${now.newPrograms}); steady ${old.steady.toFixed(1)} → ${now.steady.toFixed(1)} ms`);
check(`the first mirror frame compiles nothing of its own (${now.newPrograms} new programs; ${old.newPrograms} with clipping planes)`, now.noReflBefore && now.firstN === 1 && old.newPrograms >= 5 && now.newPrograms * 5 <= old.newPrograms, { now, old });
check(`and costs a fraction of what it did (${now.first.toFixed(1)} ms vs ${old.first.toFixed(1)} ms)`, now.first * 2 < old.first, { now: now.first, old: old.first });
check(`materials stop keeping a second program for the mirror pass (${now.twoProg} of ${now.mats}, from other causes; ${old.twoProg} before)`, now.twoProg * 3 <= old.twoProg, { now: now.twoProg, old: old.twoProg });
check(`the mirror image matches the clipping-plane image (${(now.diff * 100).toFixed(2)}% difference, ${(now.lit * 100).toFixed(0)}% lit)`, now.diff < 0.03 && now.lit > 0.5, now);
check(`nothing under the surface shows in the reflection (${now.magenta} marker pixels)`, now.magenta === 0, now);
check('no page errors', now.errs.length === 0 && old.errs.length === 0, [...now.errs, ...old.errs].slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
