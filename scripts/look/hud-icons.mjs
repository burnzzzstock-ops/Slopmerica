// node scripts/look/hud-icons.mjs [--svg-only]. No game server or network required.
// The contact sheet uses the actual renderer exported to the HUD. Its seven status
// signs are also rasterized at 16, 24 and 32 px on both backgrounds under four
// colour-vision transforms, including a tint-free shape test.
import assert from 'node:assert/strict';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from '../lib/browser.mjs';
import { HUD_CONTROLS, HUD_ICON_NAMES, hudIcon } from '../../src/art/hudIcons.ts';

const sizes = [16, 24, 32], themes = ['#252923', '#f3efe0'];
const states = Object.values(HUD_CONTROLS.status);
// Machado, Oliveira & Fernandes (2009), DOI 10.1109/TVCG.2009.113,
// supplementary linear-RGB matrices at severity 100. Shape-only collapses the
// lime, red and cream to the same fill and retains the ink and outer contour.
const modes = {
  Standard: null,
  Protanopia: [[.152286, 1.052583, -.204868], [.114503, .786281, .099216], [-.003882, -.048116, 1.051998]],
  Deuteranopia: [[.367322, .860646, -.227968], [.280085, .672501, .047413], [-.011820, .042940, .968881]],
  Tritanopia: [[1.255528, -.076749, -.178779], [-.078411, .930809, .147602], [.004733, .691367, .303900]],
  'Shape only': null,
};
function simulate(hex, mode, background = false) {
  if (mode === 'Shape only' && !background) return hex === '#111111' ? '#111111' : '#d2d2d2';
  const matrix = modes[mode];
  if (!matrix) return hex;
  const rgb = hex.slice(1).match(/../g).map(pair => parseInt(pair, 16) / 255)
    .map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return '#' + matrix.map(row => {
    const v = Math.max(0, Math.min(1, row.reduce((s, k, i) => s + k * rgb[i], 0)));
    return Math.round(255 * (v <= .0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - .055)).toString(16).padStart(2, '0');
  }).join('');
}
const svg = (width, height, contents) => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Arial,sans-serif">${contents}</svg>`;
const rect = (x,y,w,h,fill) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;
const label = (x,y,value,fill='#111111',size=12) => `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}">${value}</text>`;
function place(name, px, x, y, mode='Standard') {
  let icon = hudIcon(name,px);
  if (mode === 'Shape only') {
    // The knockout check/X can be cream on red. Ink every interior mark
    // alike, then flatten the plate fills: compare geometry alone.
    icon = icon.replace(/<path[^>]*fill="none"[^>]*>/g, path => path.replace(/stroke="#[\da-f]{6}"/i, 'stroke="#111111"'));
  }
  return `<g transform="translate(${x} ${y})">${icon.replace(/#[\da-f]{6}/gi, colour => simulate(colour,mode))}</g>`;
}

function contactSheet() {
  const width = 1056, tileWidth = 352, rowHeight = 41, top = 63;
  const rows = Math.ceil(HUD_ICON_NAMES.length / 3), height = top + rows * rowHeight;
  let body = rect(0,0,width,height,'#efe6cf') + label(9,23,'HUD icon proofs', '#111111', 20);
  for (let i=0; i<3; i++) {
    const x = i * tileWidth;
    body += label(x+9,49,'Control');
    body += label(x+99,49,'Dark   16 / 24 / 32');
    body += label(x+226,49,'Light   16 / 24 / 32');
  }
  HUD_ICON_NAMES.forEach((name, i) => {
    const x = Math.floor(i / rows) * tileWidth, y = top + (i % rows) * rowHeight;
    body += label(x+9,y+25,name);
    themes.forEach((bg, theme) => {
      const left = x + 96 + 126 * theme;
      body += rect(left,y,122,rowHeight-1,bg);
      sizes.forEach((s,k) => { body += place(name,s,left+18+36*k-s/2,y+(rowHeight-s)/2); });
    });
  });
  return svg(width,height,body);
}

// Every status sample occupies the same 36px cell within a labelled sheet.
const pitch = 36, left = 220, top = 58, column = 79;
const layout = [];
let statusBody = '';
for (const mode of Object.keys(modes)) for (const size of sizes) for (const theme of themes) {
  const y = top + pitch * layout.length, bg = simulate(theme,mode,true);
  statusBody += label(8,y+23,mode+' · '+size+' px · '+(theme===themes[0]?'dark':'light'));
  statusBody += rect(left,y,states.length*column,pitch-1,bg);
  states.forEach((name, i) => {
    statusBody += place(name,size,left+i*column+6,y+Math.floor((pitch-size)/2),mode);
  });
  layout.push({ mode, size, theme, y });
}
export const statusWidth = left + column*states.length, statusHeight = top + layout.length*pitch;
export const statusSvg = svg(statusWidth,statusHeight,rect(0,0,statusWidth,statusHeight,'#efe6cf')
  +label(8,23,'Inspector status proofs','#111111',20)
  +states.map((s,i)=>label(left+i*column+2,48,s)).join('')+statusBody);

/** Percentage of a cell whose appearance changes by >=32 in at least one sRGB channel.
 * In the shape-only row every foreground fill is identical, so only the mark and
 * outline can distinguish a pair. We test every pair at every size and background. */
export function checkStatuses(rgba) {
  assert.equal(rgba.length,statusWidth*statusHeight*4);
  let worst = { fraction: 1 }, pairs = 0;
  for (const row of layout) {
    for (let a=0; a<states.length; a++) for (let b=a+1; b<states.length; b++) {
      let different=0;
      for (let y=0; y<row.size; y++) for (let x=0; x<row.size; x++) {
        const p = ((row.y+Math.floor((pitch-row.size)/2)+y)*statusWidth+left+6+x)*4;
        const i=p+a*column*4, j=p+b*column*4;
        if (Math.max(Math.abs(rgba[i]-rgba[j]), Math.abs(rgba[i+1]-rgba[j+1]), Math.abs(rgba[i+2]-rgba[j+2])) >= 32) different++;
      }
      const fraction=different/(row.size*row.size);
      if (fraction<worst.fraction) worst={ fraction, mode:row.mode,size:row.size,theme:row.theme,a:states[a],b:states[b] };
      assert.ok(fraction>=0.20, `${row.mode} at ${row.size}px: ${states[a]} and ${states[b]} differ in only ${(fraction*100).toFixed(1)}% of the cell`);
      pairs++;
    }
  }
  return { pairs, minimumPercent: +(100*worst.fraction).toFixed(2), worst };
}
function checkManifest() {
  const read = path => readFileSync(path,'utf8');
  const match = (file,re) => [...read(file).matchAll(re)].map(m=>m[1]);
  const extensionDirs = ['src/sim', 'src/tools', 'src/transit'];
  const extensionSources = extensionDirs.flatMap(dir => readdirSync(dir)
    .filter(file => file.endsWith('.ts')).map(file => read(join(dir,file))));
  const extensionIds = method => extensionSources.flatMap(src =>
    [...src.matchAll(new RegExp(method + "\\(\\{\\s*id: '([^']+)'",'g'))].map(m=>m[1]));
  const serviceViews = read('src/sim/services.ts').split('const VIEWS:')[1].split('];')[0];
  const controls = {
    road: match('src/roads/roadTypes.ts',/id: '(\w+)', name:/g),
    policy: match('src/sim/policies.ts',/id: '(\w+)', icon:/g),
    facility: [...match('src/sim/services.ts',/id: '(\w+)', cat: '/g),
      ...match('src/vault/families.ts',/id: "([^"]+)"[^\n]*park: \{ icon:/g).map(id=>'va:'+id)],
    landmark: match('src/game.ts',/id: '(\w+)', name: '[^']+', icon:/g),
    toolbar: [...read('src/ui/hud.ts').split('const items: [string, string, string][] = [')[1].split('];')[0].matchAll(/\['([^']+)'/g)]
      .map(m=>m[1]).concat(extensionIds('registerPanel').map(id=>'ext:'+id)),
    view: extensionIds('registerView').concat([...serviceViews.matchAll(/id: '(\w+)', icon:/g)].map(m=>'svc:'+m[1])),
  };
  for (const [category,keys] of Object.entries(controls)) {
    assert.ok(keys.length>0, 'Empty source inventory for '+category);
    for (const key of keys) assert.ok(HUD_CONTROLS[category][key], 'Missing '+category+' icon: '+key);
  }
  assert.deepEqual(new Set(Object.values(HUD_CONTROLS).flatMap(Object.values)),new Set(HUD_ICON_NAMES));
}
async function main() {
  checkManifest();
  const out=resolve('shots/hud-icons');
  mkdirSync(out,{recursive:true});
  const contact=contactSheet();
  writeFileSync(join(out,'contact.svg'),contact);
  writeFileSync(join(out,'statuses.svg'),statusSvg);
  console.log(HUD_ICON_NAMES.length+' icons, 16/24/32 px on two backgrounds: '+out);
  if (process.argv.includes('--svg-only')) return;
  const browser=await launch({gl:false});
  try {
    const page=await browser.newPage();
    const proof=await page.evaluate(async source => {
      async function rasterize(svg) {
        const img=new Image();
        img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
        await img.decode();
        const canvas=document.createElement('canvas');
        canvas.width=img.width;
        canvas.height=img.height;
        const ctx=canvas.getContext('2d',{willReadFrequently:true});
        ctx.drawImage(img,0,0);
        return ctx;
      }
      const contact=await rasterize(source.contact);
      const status=await rasterize(source.status);
      const bytes=status.getImageData(0,0,status.canvas.width,status.canvas.height).data;
      const chunks=[];
      for (let i=0;i<bytes.length;i+=16384) chunks.push(String.fromCharCode(...bytes.subarray(i,i+16384)));
      return { rgba:btoa(chunks.join('')), contact: contact.canvas.toDataURL().split(',')[1], status: status.canvas.toDataURL().split(',')[1] };
    }, { contact, status:statusSvg });
    const pixels=Buffer.from(proof.rgba,'base64');
    const report=checkStatuses(pixels);
    // Prove a missing status accidentally drawn as the healthy check is caught.
    for (let y=0;y<16;y++) {
      const first=((top+10+y)*statusWidth+left+6)*4;
      pixels.copy(pixels,first+column*4,first,first+16*4);
    }
    assert.throws(()=>checkStatuses(pixels), /ok and missing/);
    writeFileSync(join(out,'contact.png'),Buffer.from(proof.contact,'base64'));
    writeFileSync(join(out,'statuses.png'),Buffer.from(proof.status,'base64'));
    writeFileSync(join(out,'status-check.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report));
  } finally { await browser.close(); }
}
if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) await main();
