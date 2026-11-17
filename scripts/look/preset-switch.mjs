// Deterministic frame intervals drive the game's first-run sampler on a touch
// viewport. Settings changes exercise the same running scene and WebGL context.
import { chromium } from 'playwright-core';
import { ARGS, EXE } from '../refblock.mjs';

const base = process.env.BASE_URL || 'http://127.0.0.1:5195';
const browser = await chromium.launch({ executablePath: process.env.CHROME || EXE, args: ARGS });
const check = (label, observed, expected) => {
  const pass = observed === expected;
  console.log(`${pass ? 'OK' : 'FAIL'} ${label}: ${observed} (expected ${expected})`);
  if (!pass) process.exitCode = 1;
};

async function phone() {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  page.on('pageerror', error => { console.error(error); process.exitCode = 1; });
  await page.addInitScript(() => {
    localStorage.setItem('slopmerica.onboarded', '1');
    localStorage.setItem('slopmerica.resolution', 'full');
    // Hold the game's scheduled frame. Chrome and the HUD keep their rAFs.
    const raf = requestAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => {
      const id = raf(time => { if (window.__game?.raf !== id) callback(time); });
      return id;
    };
  });
  await page.goto(`${base}/#skip&map=appalachia&mode=sandbox`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 300000, polling: 100 });
  return page;
}

async function sample(page, ms, count) {
  return page.evaluate(([interval, frames]) => {
    const g = window.__game;
    for (let i = 0; i < frames; i++) g.sampleFrame(interval, interval / 2);
    return localStorage.getItem('slopmerica.quality');
  }, [ms, count]);
}

async function openSettings(page) {
  await page.locator('[data-t="more"]').dispatchEvent('click');
  await page.locator('[data-more="help"]').dispatchEvent('click');
}

try {
  for (const [ms, target] of [[12, 'medium'], [30, 'low']]) {
    const page = await phone();
    check(`${ms} ms phone starts on Low`, await page.evaluate(() => window.__game.q.name), 'low');
    if (target === 'medium') {
      check('suspended interval cannot finish the benchmark', await sample(page, 3500, 1), null);
      check('shader warm-up cannot choose a preset', await sample(page, 125, 8), null);
    } else {
      check('slow warm-up cannot choose a preset', await sample(page, ms, Math.ceil(1000 / ms)), null);
    }
    check(`${ms} ms steady-state choice`, await sample(page, ms, Math.ceil(2000 / ms) + 1), target);
    check('automatic choice configures live effects', await page.evaluate(() => window.__game.post.active), target === 'medium');
    await page.close();
  }

  const page = await phone();
  await page.evaluate(() => { window.__originalGame = window.__game; });
  await openSettings(page);
  for (const [preset, effects] of [['medium', true], ['low', false], ['medium', true]]) {
    await page.locator(`[data-quality="${preset}"]`).dispatchEvent('click');
    const rendered = await page.evaluate(() => {
      const g = window.__game;
      g.frame(1 / 60, true);
      return { enabled: g.post.enabled, active: g.post.active, same: window.__originalGame === g,
        draws: g.renderer.info.render.calls, contextLost: g.renderer.getContext().isContextLost() };
    });
    check(`${preset} enables expected post pipeline`, rendered.enabled, effects);
    check(`${preset} renders with expected post pipeline`, rendered.active, effects);
    check(`${preset} draws the original city without reload`, rendered.same && rendered.draws > 0 && !rendered.contextLost, true);
  }
  check('manual choice survives a later slow sample', await sample(page, 60, 100), 'medium');
  await page.close();
} finally {
  await browser.close();
}
