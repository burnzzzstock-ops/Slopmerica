// Export every fictional county through the live photo session. Check native
// pixels, the cream postcard trim, the street camera and the city's saved state.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch } from '../lib/browser.mjs';
import { seededInit, seededRandom } from '../refblock.mjs';

const quality = process.argv[2] || 'low';
if (!['low','high'].includes(quality)) throw Error('Expected low or high');
const phone = quality === 'low', out = join('shots/look/postcards', quality);
mkdirSync(out, { recursive: true });
const browser = await launch(), base = process.env.BASE_URL || 'http://127.0.0.1:5195';
const maps = { appalachia: [10,-170,1440,0.48,0.53], norcal: [-1672,550,560,1.19,0.46], florida: [300,950,1440,-2.45,0.57] };
try {
  for (const [map, view] of Object.entries(maps)) {
    const page = await browser.newPage({ viewport: phone ? {width:390,height:844} : {width:1280,height:720},
      deviceScaleFactor: phone ? 3 : 1, isMobile: phone, hasTouch: phone });
    await page.addInitScript(seededInit, { seed: 1776, rng: seededRandom.toString() });
    await page.addInitScript(q => {
      localStorage.setItem('slopmerica.quality', q); localStorage.setItem('slopmerica.onboarded', '1');
      localStorage.setItem('slopmerica.resolution', 'full');
    }, quality);
    page.on('pageerror', e => { console.error(e); process.exitCode = 1; });
    await page.goto(`${base}/#skip&map=${map}&mode=sandbox`, { timeout: 180000 });
    await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 300000 });
    const { png, ...result } = await page.evaluate(async pose => {
      const g = window.__game; g.stop();
      if (!g.photo) throw Error('Game has no photo session');
      g.rts.setView(...pose, true); g.frame(0, true);
      const state = () => JSON.stringify([g.hour, g.sim.day, g.sim.money, g.weather.kind, g.rts.distance, g.camera.fov, g.camera.position.toArray()]);
      const original = state(), hud = document.querySelector('.hud'), visibility = hud.style.visibility;
      const p = g.photo; p.enter(); p.hour = 18.5; p.weather = 'clear'; p.tilt = 0;
      const hidden = hud.style.visibility === 'hidden';
      const card = await p.capture(), bitmap = await createImageBitmap(card);
      const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap,0,0); bitmap.close();
      const { data } = ctx.getImageData(0,0,canvas.width,canvas.height), pixel = (x,y) => (y*canvas.width+x)*4;
      const corner = [...data.slice(0,3)]; let min = 255, max = 0;
      for(let y=0.15; y<0.72; y+=0.025) for(let x=0.1; x<0.9; x+=0.025) {
        const i = pixel(Math.floor(canvas.width*x),Math.floor(canvas.height*y));
        const light = data[i]*0.21 + data[i+1]*0.72 + data[i+2]*0.07; min=Math.min(min,light); max=Math.max(max,light);
      }
      const png = await new Promise(resolve => { const reader=new FileReader(); reader.onload=()=>resolve(reader.result.split(',')[1]); reader.readAsDataURL(card); });
      const dims = [canvas.width,canvas.height], native = dims[0]===g.renderer.domElement.width && dims[1]===g.renderer.domElement.height;
      const expected = await p.capture(false); const clean = await createImageBitmap(expected);
      ctx.drawImage(clean,0,0); clean.close(); const plain = [...ctx.getImageData(0,0,1,1).data.slice(0,3)];
      p.street(); p.move(2,0,3); p.fov=70; p.hour=23; p.weather='rain'; g.frame(0.1,true);
      const lens = p.lens, height = lens.position.y-Math.max(0,g.terrain.h(lens.position.x,lens.position.z));
      const controls = Math.abs(lens.fov-70)<0.001 && height>=1.49 && g.env.night>0.2 && g.water.mat.uniforms.uRain.value>0;
      p.exit(); const restored = state()===original && hud.style.visibility===visibility && g.rts.enabled;
      return { png, dims, native, corner, plain, contrast:max-min, hidden, controls, height, restored, mime:card.type };
    }, view);
    writeFileSync(join(out,map+'.png'),Buffer.from(png,'base64'));
    writeFileSync(join(out,map+'.json'),JSON.stringify(result,null,2));
    const pass = result.native && result.corner.join()==='239,230,207' && result.corner.join()!==result.plain.join()
      && result.contrast>25 && result.hidden && result.controls && result.restored && result.mime==='image/png';
    console.log(pass?'OK':'FAIL',map,JSON.stringify(result)); if(!pass)process.exitCode=1;
    await page.close();
  }
} finally { await browser.close(); }
