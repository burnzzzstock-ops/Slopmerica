// BASE_URL selects the frozen build for actual-town active and direct 4K exports.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { launch } from '../lib/browser.mjs';
import { readSave } from '../lib/fixtures.mjs';
import { SAVE } from '../refblock.mjs';
import { capture, shots } from './golden-scenes.mjs';

const base=process.env.BASE_URL||'http://127.0.0.1:5173';
const out=process.env.OUT||'shots/road-reflection/photo';
mkdirSync(out,{recursive:true});
const browser=await launch();
try {
  const shot={...shots.find(shot=>shot.id==='block-high-junction-noon'),quality:'ultra',camera:[-17,-3,65,Math.PI/2,.13]};
  const frame=await capture(browser,shot,base,false,async page=>{
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('console',message=>{if(/Shader Error|GL_INVALID|VALIDATE_STATUS/.test(message.text()))errors.push(message.text());});
    const result=await page.evaluate(async ()=>{
      const THREE=await import('/node_modules/three/build/three.module.js');
      const { WATER, HALF } = await import('/src/config.ts');
      const g=window.__game,r=g.renderer,mirror=g.roads.surfaceState.reflection;
      await window.__weatherFixture(g.weather.kind, { surface: 'wet', keepKind: true });
      g.env.envT=-Infinity;g.env.envKey='';
      for(let i=0;i<4;i++){g.time=(i+1)/30;g.frame(0);}
      const fingerprint=JSON.stringify(window.__dbg.fingerprint());
      const cameraState=()=>JSON.stringify([g.camera.position.toArray(),g.camera.quaternion.toArray(),g.camera.fov,g.camera.aspect]);
      const native=()=>({buffer:r.getDrawingBufferSize(new THREE.Vector2()).toArray(),
        viewport:r.getViewport(new THREE.Vector4()).toArray(),scissor:r.getScissor(new THREE.Vector4()).toArray(),
        scissorTest:r.getScissorTest(),target:r.getRenderTarget()?.uuid??null,
        post:[g.post.sceneRT.width,g.post.sceneRT.height],
        water:[g.water.reflection.rt.width,g.water.reflection.rt.height],
        refraction:g.waterRefraction.size, surface:g.waterRefraction.surfaceSize ?? null});
      const initial=native(),initialCamera=cameraState(),eye=g.camera.position.clone();
      const angles=new THREE.Euler().setFromQuaternion(g.camera.quaternion,'YXZ');
      const originalMirror=g.roads.renderReflection,originalPost=g.post.render;
      const waterMirror = g.water.reflection;
      const originalWater = waterMirror.render;
      const originalScenePass = g.post.scenePass;
      const rows=[],images=[];
      let events=[];
      let waterEvents=[];
      waterMirror.render = function(renderer, scene, camera, ...args) {
        const rendered = originalWater.call(this, renderer, scene, camera, ...args);
        waterEvents.push({
          kind: 'water', rendered,
          buffer: renderer.getDrawingBufferSize(new THREE.Vector2()).toArray(),
          target: [this.rt.width, this.rt.height], eye: camera.position.toArray(),
          freshEye: this.lastEye.equals(camera.position),
          freshProjection: this.lastProjection.equals(camera.projectionMatrix),
        });
        return rendered;
      };
      g.post.scenePass = (target, camera, draw) => {
        const copies = g.waterRefraction.copies;
        originalScenePass(target, camera, draw);
        waterEvents.push({
          kind: 'refraction', buffer: r.getDrawingBufferSize(new THREE.Vector2()).toArray(),
          scene: [target.width, target.height], target: g.waterRefraction.size,
          surface: g.waterRefraction.surfaceSize ?? null,
          copies: g.waterRefraction.copies - copies, eye: camera.position.toArray(),
        });
      };
      g.roads.renderReflection=function(renderer,scene,camera,...args){
        const value=originalMirror.call(this,renderer,scene,camera,...args);
        events.push({kind:'mirror',buffer:renderer.getDrawingBufferSize(new THREE.Vector2()).toArray(),
          target:mirror.target?[mirror.target.width,mirror.target.height]:null,
          enabled:mirror.uniforms.uRoadReflectionOn.value,
          eye:camera.position.toArray(),freshEye:mirror.lastEye.equals(camera.position),
          freshProjection:mirror.lastProjection.equals(camera.projectionMatrix),
          matrix:mirror.uniforms.uRoadReflectionMatrix.value.toArray(),
          plane:mirror.uniforms.uRoadReflectionPlane.value.toArray()});
        return value;
      };
      g.post.render=function(...args){events.push({kind:'post',buffer:r.getDrawingBufferSize(new THREE.Vector2()).toArray()});return originalPost.apply(this,args);};
      try {
        for(const mode of ['active','direct']) {
          if(mode==='active') {
            g.photo.enter();g.photo.weather='rain';g.photo.hour=12.5;g.photo.focusDistance=65;
            g.photo.frame(0);
          } else {
            g.photo.exit();
            await window.__weatherFixture(g.weather.kind, { surface: 'wet', keepKind: true });
          }
          const oldMatrix=mirror.uniforms.uRoadReflectionMatrix.value.toArray();
          // Change the real lens immediately before the first export, with no
          // intervening live frame that could refresh its reflection cache.
          const nextEye=eye.clone().add(new THREE.Vector3(mode==='active'?2:4,1,0));
          if(mode==='active') {
            g.photo.setPose(nextEye.x,nextEye.y,nextEye.z,angles.y+.035,angles.x);
            g.photo.fov=57;
          } else {
            g.camera.position.copy(nextEye);
            g.camera.quaternion.setFromEuler(new THREE.Euler(angles.x,angles.y+.07,0,'YXZ'));
            g.camera.fov=61;g.camera.updateProjectionMatrix();g.camera.updateMatrixWorld();
          }
          const expectedCamera=cameraState();events=[];waterEvents=[];
          const blob=await g.photo.capture(false,{width:3840,height:2160});
          const bitmap=await createImageBitmap(blob),dimensions=[bitmap.width,bitmap.height];bitmap.close();
          const png=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=reject;reader.readAsDataURL(blob);});
          const exported=events.filter(event=>event.buffer[0]===3840);
          const first=exported[0],restored=native();
          if(first?.kind!=='mirror'||first.enabled!==1||!first.freshEye||!first.freshProjection)throw Error(mode+' first export retained a stale mirror');
          if(JSON.stringify(first.target)!=='[3840,2160]'||JSON.stringify(first.eye)!==JSON.stringify(nextEye.toArray()))throw Error(mode+' export used the wrong buffer or lens');
          if(JSON.stringify(first.matrix)===JSON.stringify(oldMatrix))throw Error(mode+' export reused the previous texture projection');
          if(exported[1]?.kind!=='post')throw Error(mode+' scene drew before its mirror');
          if(JSON.stringify(initial)!==JSON.stringify(restored)||JSON.stringify([mirror.target.width,mirror.target.height])!==JSON.stringify(initial.buffer))throw Error(mode+' did not restore native render state');
          if(cameraState()!==expectedCamera||(mode==='active'&&cameraState()!==initialCamera))throw Error(mode+' changed the game camera');
          if(JSON.stringify(window.__dbg.fingerprint())!==fingerprint)throw Error(mode+' changed simulation state');
          const copy = waterEvents.find(event => event.kind === 'refraction' && event.buffer[0] === 3840);
          if (!copy || copy.copies !== 1 || copy.target.width !== 3840 || copy.target.height !== 2160
            || !copy.surface || copy.surface.width !== 3840 || copy.surface.height !== 2160) throw Error(mode+' refraction or surface depth did not use the full export');
          rows.push({subject:'road',mode,dimensions,events,waterEvents,restored,simulationUnchanged:true,cameraUnchanged:true});
          images.push({mode,png});
        }
        // A separate real river camera makes the water mirror eligible. The
        // street view above proves the road mirror at the same export size.
        g.photo.exit();
        const nearbyWater = [...waterMirror.waterBounds]
          .sort((a, b) => a.distanceToPoint(g.camera.position) - b.distanceToPoint(g.camera.position));
        let river = null;
        for (const box of nearbyWater) {
          for (let z = Math.max(-HALF, box.min.z); z <= Math.min(HALF, box.max.z); z += 8) {
            for (let x = Math.max(-HALF, box.min.x); x <= Math.min(HALF, box.max.x); x += 8) {
              const height = g.terrain.h(x, z);
              if (height < WATER - 1 && (!river || height < river.y)) river = new THREE.Vector3(x, height, z);
            }
          }
          if (river) break;
        }
        if (!river) throw Error('No submerged terrain point for the water export check');
        g.rts.setView(river.x, river.z, 180, .6, .55, true);
        g.frame(0);
        const waterNative = native();
        const waterFingerprint = JSON.stringify(window.__dbg.fingerprint());
        for (const mode of ['active', 'direct']) {
          if (mode === 'active') {
            g.photo.enter();
            g.photo.weather = 'rain';
            g.photo.hour = 12.5;
            g.photo.frame(0);
          } else g.photo.exit();
          const expectedCamera = cameraState();
          waterEvents = [];
          const blob = await g.photo.capture(false, { width: 3840, height: 2160 });
          const bitmap = await createImageBitmap(blob);
          const dimensions = [bitmap.width, bitmap.height];
          bitmap.close();
          const exported = waterEvents.filter(event => event.buffer[0] === 3840);
          const reflected = exported.find(event => event.kind === 'water');
          const copied = exported.find(event => event.kind === 'refraction');
          if (!reflected?.rendered || !reflected.freshEye || !reflected.freshProjection
            || JSON.stringify(reflected.target) !== '[3840,2160]') throw Error(mode+' water mirror did not use the full current export lens');
          if (!copied || copied.copies !== 1 || copied.target.width !== 3840 || copied.target.height !== 2160
            || !copied.surface || copied.surface.width !== 3840 || copied.surface.height !== 2160
            || JSON.stringify(copied.eye) !== JSON.stringify(reflected.eye)) throw Error(mode+' water color/depth copy used the wrong export size or lens');
          if (JSON.stringify(native()) !== JSON.stringify(waterNative)) throw Error(mode+' water resources did not restore native dimensions');
          if (cameraState() !== expectedCamera) throw Error(mode+' water capture changed the game camera');
          if (JSON.stringify(window.__dbg.fingerprint()) !== waterFingerprint) throw Error(mode+' water capture changed simulation state');
          rows.push({ subject: 'water', mode, dimensions, waterPoint: river.toArray(), waterHeight: WATER, waterEvents, restored: native(), simulationUnchanged: true, cameraUnchanged: true });
          const png = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result.split(',')[1]);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
          images.push({ mode: 'water-' + mode, png });
        }
      } finally {
        g.roads.renderReflection=originalMirror;
        g.post.render=originalPost;
        waterMirror.render=originalWater;
        g.post.scenePass=originalScenePass;
        g.photo.exit();
      }
      if(r.getContext().getError()!==0)throw Error('WebGL error after photo export');
      return {population:g.sim.population,buildings:g.buildings.list.size,rows,images};
    });
    assert.deepEqual(errors,[]);
    for(const image of result.images)writeFileSync(`${out}/${image.mode}-4k.png`,Buffer.from(image.png,'base64'));
    delete result.images;
    for(const row of result.rows)assert.deepEqual(row.dimensions,[3840,2160]);
    return result;
  },process.env.GPU==='1'?'hardware':'swiftshader');
  const report={renderer:frame.renderer,fixture: SAVE,fixtureHash:createHash('sha256').update(readSave(SAVE)).digest('hex'),...frame.measurement};
  writeFileSync(`${out}/results.json`,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
} finally {await browser.close();}
console.log('PASS active/direct Ultra 4K road and water mirrors, color/depth copies, current lenses, native resources and exact simulation');
