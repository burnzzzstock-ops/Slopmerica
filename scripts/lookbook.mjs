// Fixed-camera captures of the reference block (docs/ART_DIRECTION.md), for
// judging a look change before and after: noon, dusk, a moonless night, a
// full-moon night and a rainy night, from an overview, a street corner and
// the houses, on each quality preset asked for. Writes
// shots/lookbook/<quality>-<time>-<view>.png and a contact sheet,
// shots/lookbook/index.html. The block is grown once (scripts/refblock.mjs).
// usage: node scripts/lookbook.mjs [qualities, default high] e.g. low,high,ultra
//   ONLY=noon,dusk keeps just those times; PHONE=1 shoots a 390x780 @3x touch context (files are prefixed phone-)
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { ARGS, EXE, openBlock, shoot } from './refblock.mjs';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const qualities = (process.argv[2] || 'high').split(',');
const ALL_TIMES = [['noon', 12.5, 0.5, 'clear'], ['dusk', 19.9, 0.5, 'clear'], ['moonless', 23, 0, 'clear'], ['fullmoon', 23, 0.5, 'clear'], ['rain', 22.5, 0.25, 'rain']];
const TIMES = process.env.ONLY ? ALL_TIMES.filter(([n]) => process.env.ONLY.split(',').includes(n)) : ALL_TIMES;
const phone = !!process.env.PHONE;
const pre = phone ? 'phone-' : '';
const VIEWS = { overview: [0, 0, 320, 0.7, 0.6], street: [-40, -30, 110, 2.4, 0.38], houses: [-170, -130, 120, 4.0, 0.42], shore: null };
mkdirSync('shots/lookbook', { recursive: true });
const browser = await chromium.launch({ executablePath: EXE, args: ARGS });
const shots = [];
for (const q of qualities) {
  const { page, errs, center } = await openBlock(browser, phone ? { base, quality: q, width: 390, height: 780, phone: true } : { base, quality: q });
  // the nearest bank to the block, looking along it
  VIEWS.shore ??= await page.evaluate(({ x, z }) => {
    const T = window.__game.terrain;
    for (let r = 60; r < 1500; r += 20) for (let a = 0; a < 64; a++) {
      const px = x + Math.cos((a / 64) * 6.283) * r, pz = z + Math.sin((a / 64) * 6.283) * r;
      if (T.h(px, pz) < -0.5) return [px - x, pz - z, 90, (a / 64) * 6.283 + 1.2, 0.42];
    }
    return [0, 0, 320, 0.7, 0.6];
  }, center);
  for (const [time, hour, moon, weather] of TIMES) for (const [view, v] of Object.entries(VIEWS)) {
    await shoot(page, center, { hour, moon, weather, view: v });
    const file = `${pre}${q}-${time}-${view}.png`;
    // a software-GPU frame can take minutes when the box is busy: wait longer, and try once more before giving up
    for (let attempt = 0; attempt < 2; attempt++) {
      try { await page.screenshot({ path: `shots/lookbook/${file}`, timeout: 420000 }); break; } catch (e) { console.log('shot failed', file, attempt, String(e.message).split('\n')[0]); if (attempt) throw e; }
    }
    shots.push({ q, time, view, file });
    console.log('shot', file);
  }
  if (errs.length) console.log('page errors:', errs.slice(0, 3));
  await page.close();
}
await browser.close();
const cell = (s) => `<figure><img src="${s.file}" loading="lazy"><figcaption>${s.q} · ${s.time} · ${s.view}</figcaption></figure>`;
writeFileSync('shots/lookbook/index.html', `<!doctype html><meta charset="utf-8"><title>Lookbook</title>
<style>body{font:13px system-ui;background:#111;color:#ddd;margin:16px}section{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:24px}img{width:100%;display:block}figure{margin:0}h2{margin:8px 0}</style>
${qualities.map((q) => TIMES.map(([t]) => `<h2>${q} · ${t}</h2><section>${shots.filter((s) => s.q === q && s.time === t).map(cell).join('')}</section>`).join('')).join('')}`);
console.log(`${shots.length} shots; contact sheet: shots/lookbook/index.html`);
