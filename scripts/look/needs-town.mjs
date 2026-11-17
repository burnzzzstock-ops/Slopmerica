// A saved town grown through real road, zoning, service placement and daily ticks.
// BASE_URL and optional NEXT_URL capture the same 1,056-person fixture on two builds.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch } from '../lib/browser.mjs';
import { fixture } from '../lib/fixtures.mjs';
import { seededInit, seededRandom } from '../refblock.mjs';

const save = readFileSync(fixture('needs-town.json'), 'utf8');
assert.ok(JSON.parse(save).pop >= 1000, 'acceptance fixture needs at least1,000 real residents');
const urls = [process.env.BASE_URL || 'http://127.0.0.1:5173'];
if (process.env.NEXT_URL) urls.push(process.env.NEXT_URL);
const out = process.env.OUT || 'shots/needs-town';
mkdirSync(out, { recursive: true });
const browser = await launch();
const results = [];
try {
  for (const [index, base] of urls.entries()) {
    const label = index === urls.length - 1 ? 'after' : 'before';
    for (const quality of ['low', 'high']) {
      const phone = quality === 'low';
      const page = await browser.newPage({
        viewport: phone ? { width:390, height:844 } : { width:1280, height:720 },
        deviceScaleFactor: phone ? 3 : 1, hasTouch:phone, isMobile:phone,
      });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (/Shader Error|GL_INVALID/.test(message.text())) errors.push(message.text()); });
      try {
        await page.addInitScript(seededInit, { seed:1776, rng:seededRandom.toString() });
        await page.addInitScript(({ save, quality }) => {
          localStorage.setItem('slopmerica.save.v1', save);
          localStorage.setItem('slopmerica.quality', quality);
          localStorage.setItem('slopmerica.firstSteps', '1');
          localStorage.setItem('slopmerica.onboarded', '1');
        }, { save, quality });
        await page.goto(base, { waitUntil:'load', timeout:180000 });
        await page.locator('#continue').click({ timeout:180000 });
        await page.waitForFunction(() => window.__game && window.__services && window.__vault.status() === 'ready' && window.__game.civic.status === 'ready', null, { timeout:300000 });
        await page.evaluate(() => {
          const g=window.__game;
          g.sim.speed=0;
          g.hour=12.5;
          g.weather.force('clear',30);g.weather.settle();
          if(g.post.aaMode==='taa')g.post.setAA('msaa4');
        });
        for (const distance of [450,700,1200]) {
          const { png, ...data } = await page.evaluate(distance => {
            const g=window.__game, service=window.__services.S;
            const center=g.startView();
            g.rts.setView(center.x,center.z,distance,.6,.85,true);
            service.iconT=0;
            for(let frame=0;frame<3;frame++)g.frame(0);
            const icons=service.icons, rect=g.renderer.domElement.getBoundingClientRect();
            const point=g.camera.position.clone(), time=icons.mat.uniforms.uTime.value;
            const bounds=item=>{
              const n=item.n??1, phase=Math.abs(item.id)*1.7%6.28;
              point.set(item.x,item.y+Math.sin(time*2.4+phase)*.6,item.z).applyMatrix4(g.camera.matrixWorldInverse);
              const depth=-point.z;
              const size=n>1?Math.min(140,Math.max(3.2,depth*.035))*Math.min(2,1.25+.12*Math.log2(n))
                :Math.min(22,Math.max(1,depth*.03))*(item.p==='road'?1.8:1);
              point.applyMatrix4(g.camera.projectionMatrix);
              return {x:rect.left+(point.x+1)*rect.width/2,y:rect.top+(1-point.y)*rect.height/2,
                half:size*rect.height/Math.tan(25*Math.PI/180)/4/depth+3,
                visible:depth>g.camera.near&&depth<(n>1?4400:1900)&&Math.abs(point.x)<=1&&Math.abs(point.y)<=1};
            };
            const items=icons.shown.filter(item=>bounds(item).visible);
            const boxes=items.map(bounds);
            let overlaps=0;
            for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
              const a=boxes[i],b=boxes[j],half=a.half+b.half;
              if(Math.abs(a.x-b.x)<half&&Math.abs(a.y-b.y)<half*1.4)overlaps++;
            }
            const picked=items.filter((item,i)=>icons.pick(g.camera,rect,boxes[i].x,boxes[i].y)?.id===item.id).length;
            const input=icons.source?.filter(item=>bounds(item).visible);
            const represented=items.reduce((sum,item)=>sum+(item.n??1),0);
            const inputCount=input?.reduce((sum,item)=>sum+(item.n??1),0)??null;
            const canvas=document.createElement('canvas');
            canvas.width=innerWidth*devicePixelRatio;canvas.height=innerHeight*devicePixelRatio;
            canvas.getContext('2d',{alpha:false}).drawImage(g.renderer.domElement,0,0,canvas.width,canvas.height);
            return {population:g.sim.population,visible:items.length,represented,inputCount,overlaps,picked,
              calls:g.perf.calls,triangles:g.perf.triangles,png:canvas.toDataURL().split(',')[1]};
          }, distance);
          if(distance===700)writeFileSync(join(out,`${label}-${quality}-default.png`),Buffer.from(png,'base64'));
          results.push({label,quality,distance,...data});
          writeFileSync(join(out,'results.json'),JSON.stringify(results,null,2)+'\n');
          console.log(label,quality,distance,JSON.stringify(data));
          assert.ok(data.population>=1000,'actual loaded population fell below1,000');
          if(label==='after') {
            assert.ok(data.visible<=25,'visible bubble budget');
            assert.equal(data.overlaps,0,'screen-space bubble collision');
            assert.equal(data.picked,data.visible,'every bubble centre picks its rendered item');
            assert.equal(data.represented,data.inputCount,'all in-view input counts survive clustering');
          }
          assert.deepEqual(errors,[],'rendering errors');
        }
      } finally { await page.close(); }
    }
  }
} finally { await browser.close(); }
console.log('PASS genuine1,000+ population, bubble cap, hit testing and count conservation');
