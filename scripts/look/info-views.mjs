// Actual reference-town fields and needs. NEXT_URL optionally records a frozen A/B.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch } from '../lib/browser.mjs';
import { capture, shots } from './golden-scenes.mjs';

const urls = [process.env.BASE_URL || 'http://127.0.0.1:5173'];
if (process.env.NEXT_URL) urls.push(process.env.NEXT_URL);
const out = process.env.OUT || 'shots/info-views';
const qualities=(process.env.PRESETS||'low,high').split(',');
const views=(process.env.VIEWS||'none,traffic,landValue,svc:power,svc:water,svc:sewage,svc:garbage,svc:fire,svc:police,svc:health,svc:education,svc:pollution,svc:noise,goods,landValue-colorblind,none-restored').split(',');
mkdirSync(out, {recursive:true});
const browser = await launch();
const results = [];
try {
  for (const [index, base] of urls.entries()) {
    const label = index === urls.length - 1 ? 'after' : 'before';
    for (const quality of qualities) {
      const shot = {...shots.find(s=>s.id===`block-${quality}-overview-noon`),camera:[0,0,quality==='low'?900:800,.7,.72]};
      await capture(browser,shot,base,false,async page=>{
        const errors=[];
        page.on('pageerror',error=>errors.push(error.message));
        page.on('console',message=>{if(/Shader Error|GL_INVALID|VALIDATE_STATUS/.test(message.text()))errors.push(message.text());});
        for (const view of views) {
          const {png,...data}=await page.evaluate(async view=>{
            const g=window.__game;
            const {EXT}=await import('/src/ext/registry.ts');
            const {INFO_OVERLAY}=await import('/src/world/terrain.ts');
            const {HALF}=await import('/src/config.ts');
            const id=view.replace('-colorblind','').replace('-restored','');
            g.overlays.setExt(null);g.overlays.set('none');
            g.overlays.setPalette?.(view.endsWith('-colorblind')?'colorblind':'standard');
            if(id==='landValue'||id==='traffic')g.overlays.set(id);
            else if(id!=='none') {
              const ext=EXT.views.find(v=>v.id===id);
              if(!ext)throw Error('Unknown info view '+id);
              g.overlays.setExt(ext);
            }
            const services=window.__services.S;
            services.iconT=0;services.overlayT=0;
            for(let frame=0;frame<3;frame++)g.frame(0);
            const icons=services.icons, items=icons.shown;
            const point=g.camera.position.clone(),time=icons.mat.uniforms.uTime.value;
            const visible=items.filter(item=>{
              const phase=Math.abs(item.id)*1.7%6.28;
              point.set(item.x,item.y+Math.sin(time*2.4+phase)*.6,item.z).applyMatrix4(g.camera.matrixWorldInverse);
              if(-point.z<=g.camera.near||-point.z>=((item.n??1)>1?4400:1900))return false;
              point.applyMatrix4(g.camera.projectionMatrix);
              return Math.abs(point.x)<=1&&Math.abs(point.y)<=1;
            });
            const field=g.fields.fieldFor(id.replace('svc:',''));
            const valid=field?.data.findIndex(Number.isFinite)??-1;
            let sample=null;
            if(valid>=0&&g.overlays.sample){
              const x=-HALF+(valid%field.w+.5)*field.cellM,z=-HALF+(Math.floor(valid/field.w)+.5)*field.cellM;
              sample={expected:field.data[valid],actual:g.overlays.sample(x,z)};
            }
            const canvas=document.createElement('canvas');
            canvas.width=innerWidth*devicePixelRatio;canvas.height=innerHeight*devicePixelRatio;
            canvas.getContext('2d',{alpha:false}).drawImage(g.renderer.domElement,0,0,canvas.width,canvas.height);
            return {
              png:canvas.toDataURL().split(',')[1],population:g.sim.population,
              visible:visible.length,represented:visible.reduce((n,item)=>n+(item.n??1),0),problems:visible.map(item=>item.p),
              field:field?{view:field.view,min:field.min,max:field.max,version:field.version,finite:[...field.data].filter(Number.isFinite).length}:null,
              legend:g.overlays.legend??null,sample,legacyTerrain:INFO_OVERLAY.on.value,
              calls:g.perf.calls,triangles:g.perf.triangles,programs:g.renderer.info.programs.length,
            };
          },view);
          writeFileSync(join(out,`${label}-${quality}-${view.replace(':','-')}.png`),Buffer.from(png,'base64'));
          results.push({label,quality,view,...data});
          writeFileSync(join(out,'results.json'),JSON.stringify(results,null,2)+'\n');
          console.log(label,quality,view,JSON.stringify({...data,problems:undefined}));
          if(label==='after') {
            assert.ok(data.visible<=25,'too many visible bubbles');
            if(view==='goods')assert.equal(data.visible,0,'unrelated service bubbles in Goods');
            if(view==='svc:power')assert.ok(data.problems.every(problem=>problem==='power'));
            if(data.field){
              assert.equal(data.legend.view,data.field.view);
              assert.equal(data.legend.min,data.field.min);
              assert.equal(data.legend.max,data.field.max);
              assert.equal(data.legacyTerrain,0);
              if(data.sample)assert.ok(Math.abs(data.sample.actual-data.sample.expected)<1e-6);
            }
            if(view==='svc:power')assert.equal(data.legacyTerrain,1,'null field must retain the existing service view');
            if(view==='none-restored')assert.equal(data.legend,null);
          }
          assert.deepEqual(errors,[],'info-view rendering errors');
        }
      },process.env.GPU==='1'?'hardware':'swiftshader');
    }
  }
} finally {await browser.close();}
console.log('PASS real reference-town needs, available fields, fallback views and legend/sample contracts');
