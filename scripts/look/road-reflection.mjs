// BASE_URL and NEXT_URL compare the same frozen town, with controlled rain and hour.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch } from '../lib/browser.mjs';
import { capture, shots } from './golden-scenes.mjs';

const urls=[process.env.BASE_URL||'http://127.0.0.1:5173'];
if(process.env.NEXT_URL)urls.push(process.env.NEXT_URL);
const out=process.env.OUT||'shots/road-reflection/town';
const qualities=(process.env.PRESETS||'high,ultra').split(',');
const camera=process.env.CAMERA?JSON.parse(process.env.CAMERA):null;
assert.ok(qualities.every(quality=>['low','high','ultra'].includes(quality)));
if(camera)assert.ok(camera.length===5&&camera.every(Number.isFinite));
mkdirSync(out,{recursive:true});
const results=[];
const browser=await launch();
try {
  for(const [index,base] of urls.entries()) for(const quality of qualities) {
    const label=index===urls.length-1?'after':'before';
    const shot={...shots.find(shot=>shot.id==='block-high-junction-noon'),quality};
    if(camera)shot.camera=camera;
    await capture(browser,shot,base,false,async page=>{
      const errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      page.on('console',message=>{if(/Shader Error|GL_INVALID|VALIDATE_STATUS/.test(message.text()))errors.push(message.text());});
      for(const state of ['dry','wet','wet-night']) {
        const {png,...report}=await page.evaluate(async state=>{
          const THREE=await import('/node_modules/three/build/three.module.js');
          const g=window.__game;
          g.hour=state==='wet-night'?23:12.5;
          g.weather.wet=state==='dry'?0:1;
          g.env.envT=-Infinity;g.env.envKey='';
          // Step the renderer clock across its normal mirror refresh cadence.
          // frame(0) keeps the simulation, traffic and exact lot data stationary.
          for(let frame=0;frame<4;frame++){g.time=(frame+1)/30;g.frame(0);}
          const hash=arrays=>{
            let value=2166136261;
            for(const array of arrays)for(const byte of new Uint8Array(array.buffer,array.byteOffset,array.byteLength))value=Math.imul(value^byte,16777619)>>>0;
            return value.toString(16);
          };
          const meshes=[...g.roads.typeMeshes.values(),g.roads.junctionMesh,g.roads.crosswalkMesh];
          const geometry=meshes.flatMap(mesh=>['position','normal','uv'].map(name=>mesh.geometry.attributes[name]?.array).concat(mesh.geometry.index?.array)).filter(Boolean);
          const mirror=g.roads.surfaceState.reflection,target=mirror?.target;
          const buffer=g.renderer.getDrawingBufferSize(new THREE.Vector2());
          const canvas=document.createElement('canvas');canvas.width=buffer.x;canvas.height=buffer.y;
          canvas.getContext('2d',{alpha:false}).drawImage(g.renderer.domElement,0,0);
          const png=canvas.toDataURL().split(',')[1];
          const calls=g.perf.calls,triangles=g.perf.triangles;
          let environmentHash=null;
          if(g.env.envRT){const rt=g.env.envRT,bytes=new Uint16Array(rt.width*rt.height*4);g.renderer.readRenderTargetPixels(rt,0,0,rt.width,rt.height,bytes);environmentHash=hash([bytes]);}
          let changed=0,roadPixels=0;
          if(mirror?.uniforms.uRoadReflectionOn.value) {
            const keep=new Set(meshes),hidden=[];
            g.scene.traverse(object=>{if((object.isMesh||object.isLine)&&!keep.has(object)&&object.visible){hidden.push(object);object.visible=false;}});
            const probe=new THREE.WebGLRenderTarget(640,360),renderer=g.renderer,previous=renderer.getRenderTarget();
            const clearColor=renderer.getClearColor(new THREE.Color()),clearAlpha=renderer.getClearAlpha(),background=g.scene.background;
            const enabled=mirror.uniforms.uRoadReflectionOn.value;
            const pixels=[new Uint8Array(640*360*4),new Uint8Array(640*360*4)];
            try {
              renderer.setRenderTarget(probe);renderer.setClearColor(0,0);g.scene.background=null;
              for(let i=0;i<2;i++) {
                mirror.uniforms.uRoadReflectionOn.value=i;
                renderer.clear();renderer.render(g.scene,g.camera);
                renderer.readRenderTargetPixels(probe,0,0,640,360,pixels[i]);
              }
            } finally {
              renderer.setRenderTarget(previous);renderer.setClearColor(clearColor,clearAlpha);g.scene.background=background;
              mirror.uniforms.uRoadReflectionOn.value=enabled;
              for(const object of hidden)object.visible=true;
              probe.dispose();
            }
            for(let i=0;i<pixels[0].length;i+=4) {
              if(pixels[0][i+3])roadPixels++;
              if(Math.max(...[0,1,2].map(channel=>Math.abs(pixels[0][i+channel]-pixels[1][i+channel])))>1)changed++;
            }
          }
          const gpuMs=[];
          if(mirror?.uniforms.uRoadReflectionOn.value) {
            const gl=g.renderer.getContext(),extension=gl.getExtension('EXT_disjoint_timer_query_webgl2');
            if(extension) {
              const queries=[];
              for(let i=0;i<6;i++) {
                const query=gl.createQuery();queries.push(query);
                gl.beginQuery(extension.TIME_ELAPSED_EXT,query);
                g.roads.renderReflection(g.renderer,g.scene,g.camera,g.time+(i+1)/30);
                gl.endQuery(extension.TIME_ELAPSED_EXT);
              }
              gl.flush();
              let attempts=0;
              while(!gl.getQueryParameter(queries.at(-1),gl.QUERY_RESULT_AVAILABLE)) {
                if(++attempts>1000||gl.isContextLost())throw Error('Road mirror GPU timer timed out');
                await new Promise(resolve=>setTimeout(resolve,10));
              }
              if(gl.getParameter(extension.GPU_DISJOINT_EXT))throw Error('Road mirror GPU timer was disjoint');
              for(const query of queries){gpuMs.push(gl.getQueryParameter(query,gl.QUERY_RESULT)/1e6);gl.deleteQuery(query);}
            }
          }
          return {png,population:g.sim.population,buildings:g.buildings.list.size,roads:g.net.segs.size,day:g.sim.day,
            calls,triangles,geometryHash:hash(geometry),environmentHash,buffer:buffer.toArray(),
            target:target?[target.width,target.height]:null,enabled:mirror?.uniforms.uRoadReflectionOn.value??0,
            plane:target?mirror.uniforms.uRoadReflectionPlane.value.toArray():null,center:mirror?.selected?.center.toArray()??null,candidates:mirror?.planes.length??0,
            changed,roadPixels,gpuMs};
        },state);
        writeFileSync(join(out,`${label}-${quality}-${state}.png`),Buffer.from(png,'base64'));
        results.push({label,quality,state,...report});
        writeFileSync(join(out,'results.json'),JSON.stringify(results,null,2)+'\n');
        console.log(label,quality,state,JSON.stringify(report));
        assert.deepEqual(errors,[]);
        const before=results.find(row=>row.label==='before'&&row.quality===quality&&row.state===state);
        if(label==='after'&&before) {
          for(const key of ['population','buildings','roads','day','geometryHash','environmentHash'])assert.equal(report[key],before[key],key+' differs across the rendering pair');
          if(quality!=='ultra'||state==='dry')for(const key of ['calls','triangles'])assert.equal(report[key],before[key]);
        }
        if(label==='after'&&quality==='ultra'&&state!=='dry') {
          assert.deepEqual(report.target,report.buffer);
          assert.equal(report.enabled,1);
          assert.ok(report.candidates>0&&report.changed>0,'real coplanar puddles must sample the scene mirror');
        } else assert.equal(report.enabled,0);
      }
      if(label==='after'&&quality==='ultra') {
        const transition=await page.evaluate(()=>{
          const g=window.__game,mirror=g.roads.surfaceState.reflection;
          g.requestQuality('high');g.frame(0);
          const released=mirror.target===null&&mirror.uniforms.uRoadReflectionOn.value===0;
          g.requestQuality('ultra');g.time+=1/30;g.frame(0);
          return {released,resumed:!!mirror.target&&mirror.uniforms.uRoadReflectionOn.value===1};
        });
        assert.ok(transition.released&&transition.resumed,'normal quality changes release and recreate the road mirror immediately');
        writeFileSync(join(out,'quality-transition.json'),JSON.stringify(transition,null,2)+'\n');
      }
    },process.env.GPU==='1'?'hardware':'swiftshader');
  }
} finally {await browser.close();}
console.log('PASS actual-town Ultra mirror pixels, full resolution, unchanged simulation/geometry/sky and High/dry budgets');
