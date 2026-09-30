// Tile images into one contact sheet, so a set of captures can be judged side by side (and attached to a report).
// usage: node scripts/sheet.mjs <out.jpg> <columns> <cellWidth> img1 img2 ...   (each image labelled with its file name; LABELS=0 hides that)
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve, basename } from 'node:path';
import { ARGS, EXE } from './refblock.mjs';
const [out, cols = '3', cellW = '520', ...imgs] = process.argv.slice(2);
mkdirSync(dirname(resolve(out)), { recursive: true });
const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#15181a;font:11px system-ui;color:#ccc}main{display:grid;grid-template-columns:repeat(${cols},${cellW}px);gap:4px;padding:4px;width:max-content}
figure{margin:0}img{width:${cellW}px;display:block}figcaption{padding:1px 3px}</style><main>${imgs.map((f) => `<figure><img src="file://${resolve(f)}">${process.env.LABELS === '0' ? '' : `<figcaption>${basename(f).replace(/\.\w+$/, '')}</figcaption>`}</figure>`).join('')}</main>`;
const tmp = resolve(dirname(out), '.sheet.html');
writeFileSync(tmp, html);
const browser = await chromium.launch({ executablePath: EXE, args: ARGS });
const page = await browser.newPage({ viewport: { width: Number(cols) * (Number(cellW) + 4) + 8, height: 400 } });
await page.goto(`file://${tmp}`, { waitUntil: 'load' });
await page.waitForFunction(() => [...document.images].every((i) => i.complete), null, { timeout: 60000 });
await page.screenshot({ path: out, type: out.endsWith('.png') ? 'png' : 'jpeg', quality: 86, fullPage: true });
await browser.close();
console.log('sheet', out);
