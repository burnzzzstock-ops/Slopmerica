// Controlled road-age and wetness inputs on the committed town. The simulation's
// roadCondition contract reads the segment dates, and normal Game.frame uploads it.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch } from '../lib/browser.mjs';
import { capture, shots } from './golden-scenes.mjs';

const urls = [process.env.BASE_URL || 'http://127.0.0.1:5173'];
if (process.env.NEXT_URL) urls.push(process.env.NEXT_URL);
const out = process.env.OUT || 'shots/road-weather';
mkdirSync(out, {recursive:true});
const results=[];
const browser=await launch();
try {
  for (const [index,base] of urls.entries()) {
    const label=index===urls.length-1?'after':'before';
    for (const quality of ['low','high']) {
      const shot=shots.find(shot=>shot.id===`block-${quality}-junction-noon`);
      await capture(browser,shot,base,false,async page=>{
        const errors=[];
        page.on('pageerror',error=>errors.push(error.message));
        page.on('console',message=>{if(/Shader Error|GL_INVALID|VALIDATE_STATUS/.test(message.text()))errors.push(message.text());});
        for(const state of ['fresh-dry','old-dry','old-wet','old-wet-night','fresh-restored']) {
          const {png,...data}=await page.evaluate(async state=>{
            const g=window.__game, old=state.startsWith('old'), wet=state.includes('wet');
            for(const segment of g.net.segs.values())segment.builtDay=g.sim.day-(old?365*22:0);
            g.hour=state.endsWith('night')?23:12.5;
            const weatherSurface = await window.__weatherFixture(g.weather.kind, { surface: wet ? 'wet' : 'dry', keepKind: true });
            // The sky's normal 1.2s wall-clock throttle must not retain a
            // previous state's environment while this test freezes time.
            g.env.envT=-Infinity;
            g.env.envKey='';
            for(let frame=0;frame<3;frame++)g.frame(0);
            const attributes=[...g.roads.typeMeshes.entries()].filter(([id])=>id!=='gravel').map(([,mesh])=>mesh.geometry.getAttribute('aRoadState'));
            attributes.push(g.roads.junctionMesh.geometry.getAttribute('aRoadState'),g.roads.crosswalkMesh.geometry.getAttribute('aRoadState'));
            let vertices=0,dips=0,minCondition=1,maxCondition=0;
            for(const attribute of attributes.filter(Boolean))for(let i=0;i<attribute.count;i++) {
              vertices++;if(attribute.getY(i)>.01)dips++;
              minCondition=Math.min(minCondition,attribute.getX(i));maxCondition=Math.max(maxCondition,attribute.getX(i));
            }
            const conditions=[...g.net.segs.values()].map(segment=>g.fields.roadCondition(segment.id));
            let fingerprint=2166136261;
            const meshes=[...g.roads.typeMeshes.values(),g.roads.junctionMesh,g.roads.crosswalkMesh,g.roads.concMesh];
            for(const mesh of meshes) {
              for(const name of ['position','normal','uv']) {
                const array=mesh.geometry.getAttribute(name)?.array;
                if(!array)continue;
                for(const value of new Uint32Array(array.buffer,array.byteOffset,array.byteLength/4))fingerprint=Math.imul(fingerprint^value,16777619)>>>0;
              }
              for(const value of mesh.geometry.index?.array??[])fingerprint=Math.imul(fingerprint^value,16777619)>>>0;
            }
            const canvas=document.createElement('canvas');
            canvas.width=innerWidth*devicePixelRatio;canvas.height=innerHeight*devicePixelRatio;
            canvas.getContext('2d',{alpha:false}).drawImage(g.renderer.domElement,0,0,canvas.width,canvas.height);
            const png=canvas.toDataURL().split(',')[1];
            // Read only the actual asphalt meshes with unchanged materials and
            // lighting, so vegetation slicing cannot satisfy the wear check.
            const THREE=await import('/node_modules/three/build/three.module.js');
            let environmentFingerprint=null;
            if(g.env.envRT) {
              const target=g.env.envRT;
              const pixels=new Uint16Array(target.width*target.height*4);
              g.renderer.readRenderTargetPixels(target,0,0,target.width,target.height,pixels);
              let hash=2166136261;
              for(const value of pixels)hash=Math.imul(hash^value,16777619)>>>0;
              environmentFingerprint=hash.toString(16);
            }
            const probeTarget=new THREE.WebGLRenderTarget(640,360);
            const keep=new Set([...g.roads.typeMeshes.values(),g.roads.junctionMesh,g.roads.crosswalkMesh]);
            const hidden=[];
            g.scene.traverse(object=>{if(object.isMesh&&!keep.has(object)&&object.visible){hidden.push(object);object.visible=false;}});
            const renderer=g.renderer, priorTarget=renderer.getRenderTarget();
            const clearColor=renderer.getClearColor(new THREE.Color()),clearAlpha=renderer.getClearAlpha();
            const pixels=new Uint8Array(640*360*4);
            try {
              renderer.setRenderTarget(probeTarget);renderer.setClearColor(0,0);renderer.clear();
              renderer.render(g.scene,g.camera);
              renderer.readRenderTargetPixels(probeTarget,0,0,640,360,pixels);
            } finally {
              renderer.setRenderTarget(priorTarget);renderer.setClearColor(clearColor,clearAlpha);
              for(const object of hidden)object.visible=true;
              probeTarget.dispose();
            }
            window.__roadProbes??=new Map();
            const previous=window.__roadProbes.get(wet?'old-dry':'fresh-dry');
            let roadPixels=0,changed=0,meanLuma=0;
            for(let i=0;i<pixels.length;i+=4) {
              if(!pixels[i+3])continue;
              roadPixels++;meanLuma+=.2126*pixels[i]+.7152*pixels[i+1]+.0722*pixels[i+2];
              if(previous&&Math.max(Math.abs(pixels[i]-previous[i]),Math.abs(pixels[i+1]-previous[i+1]),Math.abs(pixels[i+2]-previous[i+2]))>3)changed++;
            }
            window.__roadProbes.set(state,pixels);
            const pixelProbe={roadPixels,changed,changedFraction:changed/Math.max(1,roadPixels),meanLuma:meanLuma/Math.max(1,roadPixels)};
            return {png,calls:g.perf.calls,triangles:g.perf.triangles,pixelProbe,
              population:g.sim.population,buildings:g.buildings.list.size,roads:g.net.segs.size,environmentFingerprint,
              conditionMin:Math.min(...conditions),conditionMax:Math.max(...conditions),vertices,dips,minCondition,maxCondition,
              weatherSurface,wet:g.roads.wetWas,environment:!!g.scene.environment,geometryFingerprint:fingerprint.toString(16)};
          },state);
          writeFileSync(join(out,`${label}-${quality}-${state}.png`),Buffer.from(png,'base64'));
          results.push({label,quality,state,...data});
          writeFileSync(join(out,'results.json'),JSON.stringify(results,null,2)+'\n');
          console.log(label,quality,state,JSON.stringify(data));
          assert.deepEqual(errors,[]);
          assert.equal(data.conditionMin,state.startsWith('old')?0:1,'actual contract must match segment dates');
          assert.equal(data.conditionMax,data.conditionMin);
          const initial=results.find(row=>row.label===label&&row.quality===quality);
          assert.equal(data.geometryFingerprint,initial.geometryFingerprint,'age and rain must preserve every geometry attribute/index');
          if(state==='fresh-restored')assert.equal(data.pixelProbe.changed,0,'repair and dry weather restore the exact asphalt pixels');
          const before=results.find(row=>row.label==='before'&&row.quality===quality&&row.state===state);
          if(label==='after'&&before) {
            assert.equal(data.geometryFingerprint,before.geometryFingerprint,'weathering preserves road geometry');
            assert.equal(data.calls,before.calls,'weathering adds no draw calls');
            assert.equal(data.triangles,before.triangles,'weathering adds no triangles');
            assert.equal(data.population,before.population);
            assert.equal(data.buildings,before.buildings);
            assert.equal(data.roads,before.roads);
            assert.equal(data.environmentFingerprint,before.environmentFingerprint,'paired views use identical baked sky environments');
          }
          if(label==='after') {
            assert.ok(data.vertices>0&&data.dips>0,'real terrain roads supply condition and dip attributes');
            assert.ok(Math.abs(data.minCondition-data.conditionMin)<1e-5);
            assert.ok(Math.abs(data.maxCondition-data.conditionMax)<1e-5);
            if(state==='old-dry'||state==='old-wet')assert.ok(data.pixelProbe.changedFraction>.005,'age and wetness must visibly change asphalt pixels');
          }
        }
      },process.env.GPU==='1'?'hardware':'swiftshader');
    }
  }
} finally {await browser.close();}
console.log('PASS actual roadCondition input, repaired attributes, real dips and all road shaders');
