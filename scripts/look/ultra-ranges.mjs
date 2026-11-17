// BASE_URL and optional NEXT_URL select matching frozen builds for range comparisons.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { launch } from '../lib/browser.mjs';
import { SAVE } from '../refblock.mjs';
import { readSave } from '../lib/fixtures.mjs';
import { capture, shots } from './golden-scenes.mjs';

const urls=[process.env.BASE_URL||'http://127.0.0.1:5173'];
if(process.env.NEXT_URL)urls.push(process.env.NEXT_URL);
const out=process.env.OUT||'shots/ultra-ranges';
mkdirSync(out,{recursive:true});
const rows=[];
const browser=await launch();
try {
  const scenes=(process.env.SCENES||'appalachia,norcal,florida,block').split(',');
  assert.ok(scenes.every(scene=>['appalachia','norcal','florida','block'].includes(scene)));
  for(const [index,base] of urls.entries())for(const scene of scenes)for(const quality of scene==='block'?['low','high','ultra']:['ultra']) {
    const label=index===urls.length-1?'after':'before';
    const source=shots.find(shot=>shot.id===`${scene}-high-${scene==='block'?'junction':'forest'}-noon`);
    const shot={...source,quality};
    await capture(browser,shot,base,false,async(page,initial)=>{
      const errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      page.on('console',message=>{if(/Shader Error|GL_INVALID|VALIDATE_STATUS/.test(message.text()))errors.push(message.text());});
      const distances=scene==='block'?[110,320,1050]:[180,950,1250];
      for(const distance of distances) {
        const {png,...report}=await page.evaluate(async ({distance,camera,timing})=>{
          const g=window.__game,t=g.trees;
          const fingerprint=JSON.stringify(window.__dbg.fingerprint());
          g.rts.setView(camera[0],camera[1],distance,camera[3],camera[4],true);
          t.dirty=true;
          for(let i=0;i<4;i++)g.frame(0);
          if(fingerprint!==JSON.stringify(window.__dbg.fingerprint()))throw Error('Range update changed simulation');
          const hash=arrays=>{let value=2166136261;for(const array of arrays)for(const byte of new Uint8Array(array.buffer,array.byteOffset,array.byteLength))value=Math.imul(value^byte,16777619)>>>0;return value.toString(16);};
          const treeHash=hash(['X','Y','Z','S','Rt','K','Vr','W','alive'].map(key=>t[key]).filter(value=>ArrayBuffer.isView(value)));
          const instanceBytes=meshes=>meshes.reduce((sum,mesh)=>sum+mesh.instanceMatrix.array.byteLength+(mesh.instanceColor?.array.byteLength??0),0);
          const civic=[...g.civic.batches.values()];
          const placed=civic.flatMap(batch=>batch.items.map(item=>[batch.id,item.x,item.y,item.z,item.yaw]));
          const civicNear=civic.reduce((sum,batch)=>sum+(batch.firstLod===1?batch.meshes[0]?.[0]?.count??0:0),0);
          const civicFar=civic.reduce((sum,batch)=>sum+(batch.meshes[batch.firstLod===1?1:0]?.[0]?.count??0),0);
          const canvas=document.createElement('canvas');canvas.width=g.renderer.domElement.width;canvas.height=g.renderer.domElement.height;
          canvas.getContext('2d',{alpha:false}).drawImage(g.renderer.domElement,0,0);
          const gpuMs=[];
          if(timing) {
            const gl=g.renderer.getContext(),extension=gl.getExtension('EXT_disjoint_timer_query_webgl2');
            if(!extension)throw Error('GPU timing extension unavailable');
            const queries=[];
            for(let i=0;i<6;i++) {
              const query=gl.createQuery();queries.push(query);
              gl.beginQuery(extension.TIME_ELAPSED_EXT,query);g.frame(0);gl.endQuery(extension.TIME_ELAPSED_EXT);
            }
            gl.flush();let attempts=0;
            while(!gl.getQueryParameter(queries.at(-1),gl.QUERY_RESULT_AVAILABLE)) {
              if(++attempts>1000||gl.isContextLost())throw Error('Range GPU timer timed out');
              await new Promise(resolve=>setTimeout(resolve,10));
            }
            if(gl.getParameter(extension.GPU_DISJOINT_EXT))throw Error('Range GPU timer was disjoint');
            for(const query of queries){gpuMs.push(gl.getQueryParameter(query,gl.QUERY_RESULT)/1e6);gl.deleteQuery(query);}
          }
          return {png:canvas.toDataURL().split(',')[1],treeHash,trees:t.n,nature:t.naturePct,
            treeNear:t.q.treeNear,treeNearCap:t.q.treeNearCap,
            near:t.near.reduce((sum,mesh)=>sum+mesh.count,0),far:t.far.reduce((sum,mesh)=>sum+mesh.count,0),
            nearBytes:instanceBytes(t.near),farBytes:instanceBytes(t.far),
            civicNear,civicFar,civicPlaced:placed.length,civicPlacement:JSON.stringify(placed),
            population:g.sim.population,buildings:g.buildings.list.size,
            calls:g.perf.calls,triangles:g.perf.triangles,gpuMs,simulationUnchanged:true};
        },{distance,camera:initial.camera,timing:process.env.GPU_TIMING==='1'});
        writeFileSync(`${out}/${label}-${scene}-${quality}-${distance}.png`,Buffer.from(png,'base64'));
        const row={label,scene,quality,distance,...report};rows.push(row);
        writeFileSync(`${out}/results.json`,JSON.stringify({fixtureHash:createHash('sha256').update(readSave(SAVE)).digest('hex'),rows},null,2)+'\n');
        const before=rows.find(other=>other.label==='before'&&other.scene===scene&&other.quality===quality&&other.distance===distance);
        if(label==='after'&&before) {
          for(const key of ['treeHash','trees','nature','farBytes','civicPlaced','civicPlacement','population','buildings'])assert.deepEqual(row[key],before[key],key+' must retain exact logical/placement state');
          if(quality!=='ultra')for(const key of ['treeNear','treeNearCap','near','far','nearBytes','civicNear','civicFar','calls','triangles'])assert.equal(row[key],before[key],key+' changed outside Ultra');
          else {assert.ok(row.near>=before.near);assert.ok(row.civicNear>=before.civicNear);assert.ok(row.civicNear+row.civicFar>=before.civicNear+before.civicFar);assert.ok(row.nearBytes>before.nearBytes);}
        }
        if(label==='after'&&quality==='ultra'){assert.equal(row.treeNear,1000);assert.equal(row.treeNearCap,48000);}
        const {civicPlacement,...brief}=row;
        console.log(JSON.stringify(brief));
      }
      if(label==='after'&&scene==='block'&&quality==='ultra') {
        const transition=await page.evaluate(()=>{
          const g=window.__game,pose=g.camera.position.clone();
          const counts=()=>[...g.civic.batches.values()].map(batch=>[batch.id,...batch.meshes.map(lod=>lod[0]?.count??0)]);
          g.requestQuality('high');g.civic.update(0);const high=counts();
          g.requestQuality('ultra');g.civic.update(0);const ultra=counts();
          return {stationary:pose.equals(g.camera.position),high,ultra,refreshed:JSON.stringify(high)!==JSON.stringify(ultra)};
        });
        assert.ok(transition.stationary&&transition.refreshed,'stationary High to Ultra must refresh civic LODs');
        writeFileSync(`${out}/transition.json`,JSON.stringify(transition,null,2)+'\n');
      }
      assert.deepEqual(errors,[]);
    },process.env.GPU==='1'?'hardware':'swiftshader');
  }
} finally {await browser.close();}
console.log('PASS Ultra tree/civic detail ranges, exact placement/simulation and stationary preset refresh');
