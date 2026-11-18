// BASE_URL selects the frozen actual-town build for live Game preset changes.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {launch} from '../lib/browser.mjs';
import {capture,shots} from './golden-scenes.mjs';

const browser=await launch();
try {
  const shot={...shots.find(shot=>shot.id==='block-high-junction-noon'),quality:'ultra'};
  const frame=await capture(browser,shot,process.env.BASE_URL||'http://127.0.0.1:5173',false,async page=>{
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('console',message=>{if(/Shader Error|GL_INVALID|VALIDATE_STATUS/.test(message.text()))errors.push(message.text());});
    const result=await page.evaluate(()=>{
      const g=window.__game,r=g.traffic.renderer;
      const fingerprint=JSON.stringify(window.__dbg.fingerprint()),handles=JSON.stringify(g.traffic.cars.map(car=>[car.id,car.h]));
      const active=r.stats().active,position=g.camera.position.clone();
      const storage=[...r.batches.values()].flatMap(batch=>Object.values(batch).filter(ArrayBuffer.isView));
      const rows=[];
      for(const quality of ['ultra','low','medium','high','ultra']) {
        g.requestQuality(quality);g.frame(0);
        const stats=r.presentationStats(),expected={low:450,medium:800,high:1400,ultra:2600}[quality];
        if(stats.capacity!==expected||stats.logicalCapacity!==1900)throw Error('Game did not apply live '+quality+' presentation cap ('+stats.capacity+')');
        if(r.stats().active!==active||JSON.stringify(g.traffic.cars.map(car=>[car.id,car.h]))!==handles)throw Error('Live quality changed logical handles');
        if(JSON.stringify(window.__dbg.fingerprint())!==fingerprint)throw Error('Live quality changed simulation');
        const after=[...r.batches.values()].flatMap(batch=>Object.values(batch).filter(ArrayBuffer.isView));
        if(after.length!==storage.length||after.some((array,i)=>array!==storage[i]))throw Error('Live quality replaced vehicle arrays');
        if(!position.equals(g.camera.position))throw Error('Quality refresh moved the camera');
        rows.push({quality,capacity:stats.capacity,logicalCapacity:stats.logicalCapacity,selected:stats.selected,
          active,drawn:stats.drawnCars.length,simulationUnchanged:true,handlesUnchanged:true,buffersUnchanged:true});
      }
      return {population:g.sim.population,buildings:g.buildings.list.size,rows};
    });
    assert.deepEqual(errors,[]);
    return result;
  },process.env.GPU==='1'?'hardware':'swiftshader');
  mkdirSync('shots/vehicle-ultra',{recursive:true});
  writeFileSync('shots/vehicle-ultra/game.json',JSON.stringify({renderer:frame.renderer,...frame.measurement},null,2)+'\n');
  assert.equal(frame.measurement.rows.length,5);
  console.log(JSON.stringify(frame.measurement));
} finally {await browser.close();}
console.log('PASS Game live Ultra/Low/Medium/High caps with stationary camera, fixed logical allocation/arrays and exact simulation');
