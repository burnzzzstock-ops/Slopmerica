// Need bubbles at a wide field of view (docs/AUDIT_ROUND8_UI.md S1): src/sim/serviceIcons.ts sizes a bubble in the world,
// a share of its distance, so on the screen it shrank with the angle: a third of its 50° size at 110° (9 CSS px on a 390×844
// phone), hard to see and hard to tap. On the reference block, one bubble 200 m straight ahead of the camera, drawn alone
// into the canvas and read back, at 35, 50, 75 and 110°:
//  - the bubble drawn on the screen is within 80-125% of its width at 50°;
//  - so is how far from its middle a tap still picks it (pick(), which sizes it by the same rule).
// usage: node scripts/bubblefov.mjs   (BASE_URL, default http://127.0.0.1:5173; SEED=n replays a run). Exits 1 on failure.
import { chromium } from 'playwright-core';
import { ARGS, EXE, openBlock, testSeed } from './refblock.mjs';

const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const SEED = testSeed();
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra).slice(0, 600)); if (!ok) bad++; };
const browser = await chromium.launch({ executablePath: EXE, args: ARGS });
const { page, errs } = await openBlock(browser, { base, seed: SEED, quality: 'low', width: 390, height: 844, phone: true });
const r = await page.evaluate(() => {
  const g = window.__game, I = window.__services.S.icons, cam = g.camera, R = g.renderer;
  if (!I) return { err: 'no need bubbles in this build' };
  // the bubble alone: the camera level, looking down -z at it, 200 m away
  const alone = new g.scene.constructor();
  alone.add(I.mesh);
  I.mesh.visible = true;
  cam.position.set(0, 300, 0);
  cam.lookAt(0, 300, -200);
  I.set([{ id: 1, x: 0, y: 300, z: -200, p: 'power' }]);
  const gl = R.getContext(), rect = R.domElement.getBoundingClientRect(), dpr = R.getPixelRatio();
  const out = {};
  for (const fov of [35, 50, 75, 110]) {
    cam.fov = fov;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    R.setRenderTarget(null);
    R.setClearColor(0x000000, 1);
    R.clear();
    R.render(alone, cam);
    // (read back in the same task, before the canvas is shown and its buffer cleared)
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let x0 = Infinity, x1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const k = (y * w + x) * 4; if (px[k] + px[k + 1] + px[k + 2] > 40) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); } }
    // how far right of its middle a tap still picks it
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    let reach = 0;
    while (reach < rect.width / 2 && I.pick(cam, rect, cx + reach + 1, cy)) reach++;
    out[fov] = { drawn: x1 >= 0 ? (x1 - x0 + 1) / dpr : 0, reach, picked: !!I.pick(cam, rect, cx, cy) };
  }
  return { out };
});
if (r.err) { check(r.err, false); process.exit(1); }
for (const f of [35, 50, 75, 110]) console.log(`  ${f}°: the bubble is ${r.out[f].drawn.toFixed(1)} CSS px across on the screen; a tap picks it up to ${r.out[f].reach} px from its middle`);
for (const f of [35, 75, 110]) {
  const d = r.out[f].drawn / r.out[50].drawn, p = r.out[f].reach / r.out[50].reach;
  check(`${f}°: the bubble is about its 50° size on the screen (${(d * 100).toFixed(0)}%)`, d >= 0.8 && d <= 1.25, r.out);
  check(`${f}°: and a tap reaches about as far (${(p * 100).toFixed(0)}%)`, r.out[f].picked && p >= 0.8 && p <= 1.25, r.out);
}
check('no page errors', errs.length === 0, errs.slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
