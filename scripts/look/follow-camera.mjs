// Follow simulated trips through the public pose contract, including the bus
// body and a rendered pedestrian. Samples preserve heading wrap and release.
import { mkdirSync, writeFileSync } from 'node:fs';
import { launch } from '../lib/browser.mjs';
import { seededInit, seededRandom } from '../refblock.mjs';
const browser=await launch(), out='shots/look/follow';mkdirSync(out,{recursive:true});
try {
  const page=await browser.newPage({viewport:{width:960,height:540}});
  await page.addInitScript(seededInit,{seed:1776,rng:seededRandom.toString()});
  await page.addInitScript(()=>{localStorage.setItem('slopmerica.quality','high');localStorage.setItem('slopmerica.onboarded','1');localStorage.setItem('slopmerica.resolution','full');});
  await page.goto(`${process.env.BASE_URL||'http://127.0.0.1:5195'}/#skip&map=appalachia&mode=sandbox`,{timeout:180000});
  await page.waitForFunction(()=>window.__game&&window.__dbg,null,{timeout:300000});
  const result=await page.evaluate(()=>{
    const g=window.__game,d=window.__dbg;g.stop();g.sim.speed=0;d.hour(12);
    const s=g.startView(); d.road(s.x,s.z,s.x+550,s.z+25,'twoLane');
    const seg=[...g.net.segs.values()].at(-1);
    const rows={};
    for(const kind of ['sedan','cityBus']){
      const car=g.traffic.launch({seg,s:seg.length*.1},{seg,s:seg.length*.9},null,null,kind,'camera check','town',true,12,true);
      if(!car)throw Error('No test route for '+kind);
      g.traffic.update(.05,1,12,1000,200,g.rts.target);g.frame(0,true);
      const target={kind:'car',id:car.id};
      const ok=g.rts.follow(target), samples=[];
      for(let i=0;i<210;i++){
        const pose=g.fields.poseOf(target);if(!pose)throw Error('Target disappeared early');
        const V=g.camera.position.constructor, at=new V(pose.x,pose.y,pose.z);
        if(i>=150){g.traffic.update(1/60,1,12,1000,200,at);}
        g.rts.update(1/60);g.camera.updateMatrixWorld();
        const current=g.fields.poseOf(target), point=new V(current.x,current.y+1,current.z).project(g.camera);
        samples.push({x:current.x,z:current.z,cx:g.camera.position.x,cy:g.camera.position.y,cz:g.camera.position.z,pitch:g.rts.pitch,range:g.rts.distance,screen:[point.x,point.y],ground:g.camera.position.y-g.terrain.h(g.camera.position.x,g.camera.position.z)});
      }
      const last=samples.at(-1), initial=samples[150];
      rows[kind]={ok,moved:Math.hypot(last.x-initial.x,last.z-initial.z),screen:last.screen,range:last.range,pitch:last.pitch,ground:last.ground};
      g.frame(0,true);rows[kind].image=g.renderer.domElement.toDataURL('image/jpeg',.9).split(',')[1];
      g.renderer.domElement.dispatchEvent(new WheelEvent('wheel',{clientX:480,clientY:270,deltaY:30}));
      rows[kind].manualRelease=g.rts.following===null;
    }
    const ped={arch:0,kind:'walk',action:'walk',seg:seg.id,dir:1,s:seg.length*.4,side:1,speed:1.2,life:200,x:0,y:0,z:0,yaw:0,phase:0,label:'camera check'};
    g.peds.placeOnSidewalk(ped);g.peds.add(ped);const p=g.peds.peds.at(-1),target={kind:'person',id:p.id};
    const ok=g.rts.follow(target);for(let i=0;i<180;i++)g.rts.update(1/60);
    const start={x:p.x,z:p.z};
    for(let i=0;i<120;i++){g.peds.update(1/60,1,g.rts.target,40,i/60);g.rts.update(1/60);}
    g.frame(0,true);const V=g.camera.position.constructor,screen=new V(p.x,p.y+1,p.z).project(g.camera);
    rows.person={ok,moved:Math.hypot(p.x-start.x,p.z-start.z),screen:[screen.x,screen.y],range:g.rts.distance,pitch:g.rts.pitch,ground:g.camera.position.y-g.terrain.h(g.camera.position.x,g.camera.position.z),image:g.renderer.domElement.toDataURL('image/jpeg',.9).split(',')[1]};
    p.gone=true;g.rts.update(1/60);rows.person.missingRelease=g.rts.following===null;
    return rows;
  });
  for(const [name,row] of Object.entries(result)){
    writeFileSync(`${out}/${name}.jpg`,Buffer.from(row.image,'base64'));delete row.image;
    const pass=row.ok&&row.moved>0.2&&row.screen.every(v=>Math.abs(v)<.95)&&row.pitch<.7&&row.ground>=1.49&&(row.manualRelease??row.missingRelease);
    console.log(pass?'OK':'FAIL',name,JSON.stringify(row));if(!pass)process.exitCode=1;
  }
  writeFileSync(out+'/result.json',JSON.stringify(result,null,2));
}finally{await browser.close();}
