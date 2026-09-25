// Find draw calls that raise GL errors: wraps WebGL2 draw functions, checks
// getError after each, and records the active program's three.js name + stack.
import { chromium } from 'playwright-core';
const map = process.argv[2] || 'appalachia';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
await page.addInitScript(() => {
  const P = WebGL2RenderingContext.prototype;
  const hits = (window.__glHits = []);
  const progOf = new WeakMap();
  const origUse = P.useProgram;
  P.useProgram = function (p) { this.__cur = p; return origUse.call(this, p); };
  for (const fn of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) {
    const o = P[fn];
    P[fn] = function (...a) {
      const r = o.apply(this, a);
      const e = this.getError();
      if (e && hits.length < 40) {
        // list sampler uniforms + bound textures for the active program
        const prog = this.__cur;
        const n = prog ? this.getProgramParameter(prog, this.ACTIVE_UNIFORMS) : 0;
        const samplers = [];
        for (let i = 0; i < n; i++) {
          const u = this.getActiveUniform(prog, i);
          if (/SAMPLER/.test(Object.keys(WebGL2RenderingContext).find((k) => WebGL2RenderingContext[k] === u.type) || '')) {
            const unit = this.getUniform(prog, this.getUniformLocation(prog, u.name));
            samplers.push(u.name + '@' + unit + ':' + Object.keys(WebGL2RenderingContext).find((k) => WebGL2RenderingContext[k] === u.type));
          }
        }
        hits.push({ fn, e, samplers: samplers.join(' '), stack: new Error().stack.split('\n').slice(2, 9).map((s) => s.trim().replace(/https?:\/\/[^/]+\//, '')).join(' < ') });
      }
      return r;
    };
  }
});
await page.goto(`http://127.0.0.1:5173/#skip&map=${map}&mode=sandbox`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game, null, { timeout: 120000 });
await page.waitForTimeout(6000);
// optional: GL_JS='...' runs in the page (g = game) before the error sample, e.g. to enable an info view
if (process.env.GL_JS) {
  await page.evaluate(`(() => { const g = window.__game; window.__glHits.length = 0; ${process.env.GL_JS}; for (let i = 0; i < 3; i++) g.frame(0.016); })()`);
  await page.waitForTimeout(2000);
}
const hits = await page.evaluate(() => window.__glHits);
const seen = new Set();
for (const h of hits) {
  const k = h.samplers + h.fn;
  if (seen.has(k)) continue;
  seen.add(k);
  console.log(`${h.fn} err=${h.e}\n  samplers: ${h.samplers}\n  at: ${h.stack}\n`);
}
console.log('total hits', hits.length);
await browser.close();
