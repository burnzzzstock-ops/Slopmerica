// BASE_URL and NEXT_URL compare the same frozen town through ordinary tool entry points.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch } from '../lib/browser.mjs';
import { capture, shots } from './golden-scenes.mjs';

const urls=[process.env.BASE_URL||'http://127.0.0.1:5173'];
if(process.env.NEXT_URL)urls.push(process.env.NEXT_URL);
const out=process.env.OUT||'shots/zone-outlines';
mkdirSync(out,{recursive:true});
const results=[];
const browser=await launch();
try {
  for(const [index,base] of urls.entries()) for(const quality of ['low','high']) {
    const label=index===urls.length-1?'after':'before';
    const shot={...shots.find(shot=>shot.id===`block-${quality}-mid-noon`),camera:[0,0,260,.7,.83]};
    await capture(browser,shot,base,false,async page=>{
      const errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      page.on('console',message=>{if(/Shader Error|GL_INVALID|VALIDATE_STATUS/.test(message.text()))errors.push(message.text());});
      for(const view of ['idle','zone','dezone','landValue','restored']) {
        const {png,tilePng,...report}=await page.evaluate(async view=>{
          const g=window.__game,zones=g.zones;
          const {ZONE_TYPES}=await import('/src/contracts.ts');
          const hash=arrays=>{
            let value=2166136261;
            for(const array of arrays)for(const byte of new Uint8Array(array.buffer,array.byteOffset,array.byteLength))value=Math.imul(value^byte,16777619)>>>0;
            return value.toString(16);
          };
          g.overlays.setExt(null);g.overlays.set('none');
          g.tools.set(view==='zone'||view==='dezone'?view:'inspect');
          if(view==='landValue')g.overlays.set('landValue');
          g.env.envT=-Infinity;g.env.envKey='';
          for(let frame=0;frame<4;frame++)g.frame(0);
          const mesh=zones.overlayMesh,material=mesh.material,texture=material.map.image;
          const pixels=texture.getContext('2d').getImageData(0,0,64,64).data;
          const alpha=(x,y)=>pixels[(y*64+x)*4+3]/255;
          let rimPixels=0;
          for(let x=0;x<64;x++)if(alpha(x,32)>.9)rimPixels++;
          const cells=[...zones.cells.values()];
          const candidates=ZONE_TYPES.map(zone=>zones.candidates(zone).map(cell=>cell.id));
          const state=JSON.stringify({lots:zones.serializeExact(),candidates,counts:zones.counts()});
          let picked=0;
          for(const cell of cells.filter(cell=>cell.valid&&!cell.bld).slice(0,100)) {
            if(zones.cellsNear(cell.x,cell.z,.01).some(found=>found.id===cell.id))picked++;
          }
          const canvas=document.createElement('canvas');
          canvas.width=innerWidth*devicePixelRatio;canvas.height=innerHeight*devicePixelRatio;
          canvas.getContext('2d',{alpha:false}).drawImage(g.renderer.domElement,0,0,canvas.width,canvas.height);
          return {
            png:canvas.toDataURL().split(',')[1],tilePng:texture.toDataURL().split(',')[1],
            population:g.sim.population,buildings:g.buildings.list.size,stateHash:hash([new TextEncoder().encode(state)]),
            count:mesh.count,matrixHash:hash([mesh.instanceMatrix.array.subarray(0,mesh.count*16)]),
            tintHash:hash([mesh.instanceColor.array.subarray(0,mesh.count*3)]),picked,
            active:zones.overlayActive,opacity:material.opacity,fillAlpha:alpha(32,32)*material.opacity,rimPixels,
            calls:g.perf.calls,triangles:g.perf.triangles,legend:g.overlays.legend?.view??null,
          };
        },view);
        writeFileSync(join(out,`${label}-${quality}-${view}.png`),Buffer.from(png,'base64'));
        if(quality==='high'&&(view==='zone'||view==='idle'))writeFileSync(join(out,`${label}-${view}-tile.png`),Buffer.from(tilePng,'base64'));
        results.push({label,quality,view,...report});
        writeFileSync(join(out,'results.json'),JSON.stringify(results,null,2)+'\n');
        console.log(label,quality,view,JSON.stringify(report));
        assert.deepEqual(errors,[]);
        assert.equal(report.picked,100,'empty lots remain available to the ordinary spatial query');
        assert.equal(report.active,view==='zone'||view==='dezone');
        const idle=results.find(row=>row.label===label&&row.quality===quality&&row.view==='idle');
        assert.equal(report.stateHash,idle.stateHash,'tool and info-view transitions preserve exact lot state and growth candidates');
        if(label==='after') {
          assert.equal(report.rimPixels,4,'two texture pixels on each side form a thin outline');
          assert.ok(Math.abs(report.fillAlpha - (report.active ? .3 : .06)) < .002,'active fill is30%, idle fill is6%');
          const before=results.find(row=>row.label==='before'&&row.quality===quality&&row.view===view);
          if(before)for(const key of ['population','buildings','stateHash','count','matrixHash','tintHash','picked','calls','triangles'])assert.equal(report[key],before[key],key+' changed across the rendering pair');
        }
        if(view==='restored')for(const key of ['stateHash','count','matrixHash','tintHash','fillAlpha','calls','triangles'])assert.equal(report[key],idle[key],key+' did not restore');
      }
    },process.env.GPU==='1'?'hardware':'swiftshader');
  }
} finally {await browser.close();}
console.log('PASS thin30%-fill outlines, ordinary tool transitions, exact lots/candidates/picking and unchanged geometry budgets');
