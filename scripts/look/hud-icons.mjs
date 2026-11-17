// node scripts/look/hud-icons.mjs [--svg-only]. No game server or network required.
// The contact sheet uses the actual renderer exported to the HUD. Its seven status
// signs are also rasterized at 16, 18, 24 and 32 px on both backgrounds under four
// colour-vision transforms, including a tint-free shape test.
import assert from 'node:assert/strict';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launch } from '../lib/browser.mjs';
import { HUD_CONTROLS, HUD_ICON_NAMES, HUD_ICON_ACCENTS, hudIcon, hudIconFor } from '../../src/art/hudIcons.ts';

const sizes = [16, 18, 24, 32], themes = ['#252923', '#f3efe0'];
const simplified = ['stroad4','stroad6','stroad8','grid','resHigh','comHigh','server','treatment','music','building'];
const states = Object.values(HUD_CONTROLS.status);
const categories = ['resLow','comLow','industry','office','power','water','sewage','garbage'];
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
  const width = 1248, tileWidth = 416, rowHeight = 41, top = 63;
  const rows = Math.ceil(HUD_ICON_NAMES.length / 3), height = top + rows * rowHeight;
  let body = rect(0,0,width,height,'#efe6cf') + label(9,23,'HUD icon proofs', '#111111', 20);
  for (let i=0; i<3; i++) {
    const x = i * tileWidth;
    body += label(x+9,49,'Control');
    body += label(x+99,49,'Dark   16 / 18 / 24 / 32');
    body += label(x+257,49,'Light   16 / 18 / 24 / 32');
  }
  HUD_ICON_NAMES.forEach((name, i) => {
    const x = Math.floor(i / rows) * tileWidth, y = top + (i % rows) * rowHeight;
    body += label(x+9,y+25,name);
    themes.forEach((bg, theme) => {
      const left = x + 96 + 158 * theme;
      body += rect(left,y,154,rowHeight-1,bg);
      sizes.forEach((s,k) => { body += place(name,s,left+18+36*k-s/2,y+(rowHeight-s)/2); });
    });
  });
  return svg(width,height,body);
}

function smallComparison(before) {
  const width=760,rowHeight=46,top=64;
  let body=rect(0,0,width,top+simplified.length*rowHeight,'#efe6cf')+label(9,23,'Small icon revisions · actual 16 and 18 px','#111111',19);
  ['Before dark','After dark','Before light','After light'].forEach((text,i)=>{body+=label(116+i*160,49,text);});
  simplified.forEach((name,row)=>{
    const y=top+row*rowHeight;
    body+=label(8,y+27,name);
    for(let group=0;group<4;group++) {
      const x=112+group*160,background=themes[Math.floor(group/2)],render=group%2?hudIcon:before;
      body+=rect(x,y,156,rowHeight-2,background);
      for(const [i,size] of [16,18].entries())body+=`<g transform="translate(${x+34+i*65} ${y+(rowHeight-size)/2})">${render(name,size)}</g>`;
    }
  });
  return svg(width,top+simplified.length*rowHeight,body);
}

// Every status sample occupies the same 36px cell within a labelled sheet.
const pitch = 36, left = 220, top = 58, column = 79;
const layout = [];
for (const mode of Object.keys(modes)) for (const size of sizes) for (const theme of themes) {
  layout.push({ mode, size, theme, y:top + pitch * layout.length });
}
export const statusWidth = left + column*states.length, statusHeight = top + layout.length*pitch;
function distinctionSheet(names, title) {
  const width=left+column*names.length;
  let body=rect(0,0,width,statusHeight,'#efe6cf')+label(8,23,title,'#111111',20)
    +names.map((name,i)=>label(left+i*column+2,48,name)).join('');
  for(const {mode,size,theme,y} of layout) {
    body+=label(8,y+23,mode+' · '+size+' px · '+(theme===themes[0]?'dark':'light'));
    body+=rect(left,y,names.length*column,pitch-1,simulate(theme,mode,true));
    names.forEach((name,i)=>{body+=place(name,size,left+i*column+6,y+Math.floor((pitch-size)/2),mode);});
  }
  return svg(width,statusHeight,body);
}
export const statusSvg = distinctionSheet(states,'Inspector status proofs');
const categorySvg = distinctionSheet(categories,'Zone and utility category proofs');

/** Percentage of a cell whose appearance changes by >=32 in at least one sRGB channel.
 * In the shape-only row every foreground fill is identical, so only the mark and
 * outline can distinguish a pair. We test every pair at every size and background. */
function checkDistinction(rgba,names) {
  const width=left+column*names.length;
  assert.equal(rgba.length,width*statusHeight*4);
  let worst = { fraction: 1 }, pairs = 0;
  for (const row of layout) {
    for (let a=0; a<names.length; a++) for (let b=a+1; b<names.length; b++) {
      let different=0;
      for (let y=0; y<row.size; y++) for (let x=0; x<row.size; x++) {
        const p = ((row.y+Math.floor((pitch-row.size)/2)+y)*width+left+6+x)*4;
        const i=p+a*column*4, j=p+b*column*4;
        if (Math.max(Math.abs(rgba[i]-rgba[j]), Math.abs(rgba[i+1]-rgba[j+1]), Math.abs(rgba[i+2]-rgba[j+2])) >= 32) different++;
      }
      const fraction=different/(row.size*row.size);
      if (fraction<worst.fraction) worst={ fraction, mode:row.mode,size:row.size,theme:row.theme,a:names[a],b:names[b] };
      assert.ok(fraction>=0.20, `${row.mode} at ${row.size}px: ${names[a]} and ${names[b]} differ in only ${(fraction*100).toFixed(1)}% of the cell`);
      pairs++;
    }
  }
  return { pairs, minimumPercent: +(100*worst.fraction).toFixed(2), worst };
}
export function checkStatuses(rgba) { return checkDistinction(rgba,states); }
function checkManifest() {
  const shape = svg => svg.replace(/width="[\d.]+" height="[\d.]+"/,'');
  for(const name of simplified) {
    assert.equal(shape(hudIcon(name,16)),shape(hudIcon(name,18)),'small variant covers the full requested size range');
    assert.notEqual(shape(hudIcon(name,18)),shape(hudIcon(name,24)),'small variant must reduce interior detail');
    assert.equal(shape(hudIcon(name,19)),shape(hudIcon(name,24)),'large variant retains its original detail');
  }
  for(const [name,accent] of Object.entries({power:'power',water:'water',sewage:'waste',garbage:'waste',resLow:'residential',comLow:'commercial',industry:'industry',office:'office',bulldoze:'danger'})) {
    assert.ok(hudIcon(name,16).includes(`fill="${HUD_ICON_ACCENTS[accent]}"`),name+' semantic accent');
  }
  assert.ok(hudIconFor('facility','gasPeaker',16).includes('fill="#ffd84a"'));
  assert.ok(hudIconFor('facility','incinerator',16).includes('fill="#c89d54"'));
  assert.ok(hudIconFor('landmark','slopCannon',16).includes('fill="#b3202a"'));
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
  const before=process.env.HUD_BASE ? (await import(pathToFileURL(resolve(process.env.HUD_BASE)).href)).hudIcon : null;
  const comparison=before ? smallComparison(before) : null;
  writeFileSync(join(out,'contact.svg'),contact);
  writeFileSync(join(out,'statuses.svg'),statusSvg);
  writeFileSync(join(out,'categories.svg'),categorySvg);
  if(comparison)writeFileSync(join(out,'small-before-after.svg'),comparison);
  console.log(HUD_ICON_NAMES.length+' icons, 16/18/24/32 px on two backgrounds: '+out);
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
      const categories=await rasterize(source.categories);
      const comparison=source.comparison ? await rasterize(source.comparison) : null;
      const encode = context => {
        const bytes=context.getImageData(0,0,context.canvas.width,context.canvas.height).data,chunks=[];
        for (let i=0;i<bytes.length;i+=16384) chunks.push(String.fromCharCode(...bytes.subarray(i,i+16384)));
        return btoa(chunks.join(''));
      };
      return { rgba:encode(status), categoryRgba:encode(categories), contact: contact.canvas.toDataURL().split(',')[1], status: status.canvas.toDataURL().split(',')[1], categories:categories.canvas.toDataURL().split(',')[1], comparison:comparison?.canvas.toDataURL().split(',')[1] };
    }, { contact, status:statusSvg, categories:categorySvg, comparison });
    const pixels=Buffer.from(proof.rgba,'base64');
    const report=checkStatuses(pixels);
    const categoryReport=checkDistinction(Buffer.from(proof.categoryRgba,'base64'),categories);
    // Prove a missing status accidentally drawn as the healthy check is caught.
    for (let y=0;y<16;y++) {
      const first=((top+10+y)*statusWidth+left+6)*4;
      pixels.copy(pixels,first+column*4,first,first+16*4);
    }
    assert.throws(()=>checkStatuses(pixels), /ok and missing/);
    writeFileSync(join(out,'contact.png'),Buffer.from(proof.contact,'base64'));
    writeFileSync(join(out,'statuses.png'),Buffer.from(proof.status,'base64'));
    writeFileSync(join(out,'categories.png'),Buffer.from(proof.categories,'base64'));
    if(proof.comparison)writeFileSync(join(out,'small-before-after.png'),Buffer.from(proof.comparison,'base64'));
    writeFileSync(join(out,'status-check.json'),JSON.stringify(report,null,2)+'\n');
    writeFileSync(join(out,'category-check.json'),JSON.stringify(categoryReport,null,2)+'\n');
    console.log(JSON.stringify(report));
    console.log(JSON.stringify(categoryReport));
  } finally { await browser.close(); }
}
if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) await main();
