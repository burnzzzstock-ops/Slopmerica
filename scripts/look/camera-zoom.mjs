// A wheel notch on the Holler County golden overview, at 60 fixed simulation
// steps. Save every camera sample and a filmstrip. --frames saves all 60 images.
import { launch } from '../lib/browser.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { seededInit, seededRandom } from '../refblock.mjs';

const [quality = 'low', label = 'current'] = process.argv.slice(2);
if (!['low', 'high'].includes(quality) || !/^[\w-]+$/.test(label)) throw Error('Expected low|high and a capture label');
const phone = quality === 'low', allFrames = process.argv.includes('--frames');
const out = join('shots/look/camera', label, quality);
mkdirSync(out, { recursive: true });
const browser = await launch();
const base = process.env.BASE_URL || 'http://127.0.0.1:5195';
const marks = [0, 1, 6, 15, 30, 60];
try {
  const page = await browser.newPage({ viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 720 },
    deviceScaleFactor: phone ? 3 : 1, hasTouch: phone, isMobile: phone });
  page.on('pageerror', err => { console.error(err); process.exitCode = 1; });
  await page.addInitScript(seededInit, { seed: 1776, rng: seededRandom.toString() });
  await page.addInitScript(q => {
    localStorage.setItem('slopmerica.quality', q);
    localStorage.setItem('slopmerica.onboarded', '1');
    localStorage.setItem('slopmerica.resolution', 'full');
    localStorage.setItem('slopmerica.edgeScroll', '0');
  }, quality);
  await page.goto(`${base}/#skip&map=appalachia&mode=sandbox`, { timeout: 180000 });
  await page.waitForFunction(() => window.__game && window.__dbg && window.__game.civic.status !== 'loading', null, { timeout: 300000 });
  await page.evaluate(() => {
    const g = window.__game;
    g.stop(); g.sim.speed = 0;
    g.sim.day = g.sim.lastWhole = 120;
    window.__reseed(1776); window.__dbg.hour(12.5);
    g.weather.force('clear', 30); g.weather.settle();
    g.rts.setView(10, -170, 1440, 0.48, 0.53, true);
    g.frame(0, true);
  });
  const summary = {};
  for (const direction of ['in', 'out']) {
    await page.evaluate(dir => {
      const g = window.__game, c = g.renderer.domElement;
      const rect = c.getBoundingClientRect(), x = rect.left + rect.width * 0.71, y = rect.top + rect.height * 0.65;
      const point = g.rts.groundAt(x, y);
      if (!point) throw Error('Fixed camera missed the terrain');
      window.__zoomProbe = { point, x, y, initial: g.rts.distance, startPitch: g.rts.pitch };
      c.dispatchEvent(new WheelEvent('wheel', { clientX: x, clientY: y, deltaY: dir === 'in' ? -120 : 120, cancelable: true }));
    }, direction);
    const rows = [], tiles = [];
    for (let frame = 0; frame <= 60; frame++) {
      const capture = direction === 'in' && (allFrames || marks.includes(frame));
      const { image, ...row } = await page.evaluate(({ frame, capture }) => {
        const g = window.__game, rts = g.rts, p = window.__zoomProbe;
        if (frame) rts.update(1 / 60);
        g.camera.updateMatrixWorld();
        const ndc = p.point.clone().project(g.camera), c = g.renderer.domElement, r = c.getBoundingClientRect();
        let image;
        if (capture) {
          g.frame(0, true);
          const tile = document.createElement('canvas');
          tile.width = 360; tile.height = Math.round(360 * r.height / r.width);
          tile.getContext('2d').drawImage(c, 0, 0, tile.width, tile.height);
          image = tile.toDataURL('image/jpeg', 0.88);
        }
        return { frame, distance: rts.distance, pitch: rts.pitch, goal: rts.goal.distance, position: g.camera.position.toArray(),
          calls: capture ? g.perf.calls : undefined, triangles: capture ? g.perf.triangles : undefined,
          pixels: Math.hypot(r.left + (1 + ndc.x) * r.width / 2 - p.x, r.top + (1 - ndc.y) * r.height / 2 - p.y), image };
      }, { frame, capture });
      rows.push(row);
      if (image) {
        writeFileSync(join(out, `frame-${String(frame).padStart(2, '0')}.jpg`), Buffer.from(image.split(',')[1], 'base64'));
        if (marks.includes(frame)) tiles.push({ frame, image });
      }
    }
    const last = rows.at(-1);
    const peakStep = Math.max(...rows.slice(1).map((r, i) => Math.abs(r.distance / rows[i].distance - 1)));
    const peakTravel = Math.max(...rows.slice(1).map((r, i) => Math.hypot(...r.position.map((v, axis) => v - rows[i].position[axis])) / rows[i].distance));
    const drift = Math.max(...rows.map(r => r.pixels));
    const settleError = Math.abs(last.distance / last.goal - 1), pitchDelta = last.pitch - rows[0].pitch;
    summary[direction] = { peakStep, peakTravel, drift, settleError, pitchDelta };
    writeFileSync(join(out, `${direction}.json`), JSON.stringify({ ...summary[direction], seed: 1776, rows }, null, 2));
    if (peakStep > 0.02 || peakTravel > 0.02 || drift > 2 || settleError > 0.001 || (direction === 'in' ? -pitchDelta : pitchDelta) < 0.02) process.exitCode = 1;
    if (tiles.length) {
      const sheet = await browser.newPage({ viewport: { width: 1080, height: 550 } });
      await sheet.setContent(`<style>*{box-sizing:border-box}body{margin:0;background:#16181a;color:#eee;font:16px system-ui}main{display:grid;grid-template-columns:repeat(3,360px);width:max-content}figure{margin:0}img{width:360px;display:block}figcaption{padding:4px 8px}</style><main>${tiles.map(t => `<figure><img src="${t.image}"><figcaption>${quality} · frame ${t.frame}</figcaption></figure>`).join('')}</main>`);
      await sheet.locator('main').screenshot({ path: join(out, 'sequence.jpg'), type: 'jpeg', quality: 90 });
      await sheet.close();
    }
  }
  console.log(quality, JSON.stringify(summary));
} finally { await browser.close(); }
