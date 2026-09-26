// One bad pixel must not black out the frame. Some GPUs (Direct3D on
// Windows especially) turn edge-case shader math into NaN/Inf; bloom's blur
// then smears it over the whole screen. This drops a tiny NaN-emitting quad
// into the scene on the High preset (post-processing + AO + bloom) and
// checks the picture still has its sky and ground. Also checks the
// black-frame watchdog turns post effects off when the whole frame is dark.
// Exits nonzero on failure.
import { chromium } from 'playwright-core';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => { try { localStorage.setItem('slopmerica.quality', 'high'); localStorage.setItem('slopmerica.onboarded', '1'); } catch { /* */ } });
await page.goto(`${base}/#skip&map=appalachia&mode=sandbox`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__game, null, { timeout: 180000 });
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, extra === undefined ? '' : JSON.stringify(extra)); if (!ok) bad++; };

// average brightness of a 5x5 grid over the final picture, read right after a render
const frame = () => page.evaluate(() => {
  const g = window.__game, r = g.renderer, gl = r.getContext();
  cancelAnimationFrame(g.raf);
  g.hour = 12;
  g.post.render(0);
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, px = new Uint8Array(4);
  let sum = 0, lit = 0;
  for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) {
    gl.readPixels(Math.floor(w * (i + 0.5) / 5), Math.floor(h * (j + 0.5) / 5), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const v = px[0] + px[1] + px[2];
    sum += v;
    if (v > 30) lit++;
  }
  return { avg: Math.round(sum / 25), lit, post: g.post.active };
});
await page.waitForTimeout(3000);
const clean = await frame();
check(`High preset draws a picture (${clean.lit}/25 samples lit, avg ${clean.avg})`, clean.post && clean.lit >= 20, clean);

// a 60 m patch in the middle of the view that writes NaN, then one that writes
// Inf (before the fix either one blacked out the whole frame, sky included)
for (const [kind, expr] of [['NaN', 'uZero / uZero'], ['Inf', '1.0 / uZero']]) {
  await page.evaluate(async ({ expr }) => {
    // the exact three.js module the game loaded (same instance, same renderer)
    const url = performance.getEntriesByType('resource').map((e) => e.name).find((n) => /\/deps\/three\.js/.test(n));
    const T = await import(url);
    const g = window.__game;
    g.scene.getObjectByName('bad-probe')?.removeFromParent();
    const m = new T.Mesh(new T.PlaneGeometry(60, 60), new T.ShaderMaterial({
      uniforms: { uZero: { value: 0 } },
      vertexShader: 'void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform float uZero; void main(){ float n = ${expr}; gl_FragColor = vec4(n, n, n, 1.0); }`,
      side: T.DoubleSide,
      depthTest: false,
    }));
    const t = g.rts.target;
    m.position.set(t.x, g.terrain.h(t.x, t.z) + 3, t.z);
    m.rotation.x = -Math.PI / 2;
    m.renderOrder = 999;
    m.name = 'bad-probe';
    g.scene.add(m);
  }, { expr });
  const poisoned = await frame();
  check(`a patch of ${kind} pixels doesn't black out the frame (${poisoned.lit}/25 lit, avg ${poisoned.avg})`, poisoned.lit >= 20 && poisoned.post, poisoned);
}

// the watchdog: a frame that comes out black turns post effects off
const dog = await page.evaluate(() => {
  const g = window.__game;
  const before = g.post.active;
  g.post.render = function () { const r = g.renderer; r.setRenderTarget(null); r.setClearColor(0x000000, 1); r.clear(); };
  const verdict = g.checkBlackFrame();
  return { before, verdict, after: g.post.active };
});
check(`a black frame turns post effects off (${dog.verdict})`, dog.before && !dog.after && /post/.test(dog.verdict), dog);
check('no page errors', errs.length === 0, errs.slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
