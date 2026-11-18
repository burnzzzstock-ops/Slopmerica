// BASE_URL serves a frozen build. This is a synthetic 3,000-car presentation
// stress rig; the actual-town vehicle-pool test separately checks Game wiring.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launch } from '../lib/browser.mjs';

const base=process.env.BASE_URL||'http://127.0.0.1:5173';
const out=process.env.OUT||'shots/vehicle-ultra';
mkdirSync(out,{recursive:true});
const browser=await launch();
try {
  const page=await browser.newPage({viewport:{width:1280,height:720}});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(/Shader Error|GL_INVALID|VALIDATE_STATUS/.test(message.text()))errors.push(message.text());});
  await page.goto(base+'/package.json',{waitUntil:'load'});
  const result=await page.evaluate(async()=>{
    const THREE=await import('/node_modules/three/build/three.module.js');
    const {VehicleRenderer,VEHICLE_SPECS}=await import('/src/agents/vehicles.ts');
    const {StreetAudio}=await import('/src/audio/streetAudio.ts');
    const {Synth}=await import('/src/audio/synth.ts');
    const scene=new THREE.Scene();scene.background=new THREE.Color(0xc8d1d6);
    scene.add(new THREE.HemisphereLight(0xffffff,0x777777,3));
    const renderer=new THREE.WebGLRenderer({antialias:false,preserveDrawingBuffer:true});
    renderer.setSize(1280,720);document.body.appendChild(renderer.domElement);
    const gl=renderer.getContext(),extension=gl.getExtension('WEBGL_debug_renderer_info');
    const device=gl.getParameter(extension?extension.UNMASKED_RENDERER_WEBGL:gl.RENDERER);
    if(/swiftshader|llvmpipe|basic render|software|WARP/i.test(device))throw Error('Hardware GPU required');
    const camera=new THREE.PerspectiveCamera(50,1280/720,1,2000);
    camera.position.set(0,780,500);camera.lookAt(0,0,0);camera.updateMatrixWorld();
    const vr=new VehicleRenderer(scene,1900),kinds=Object.keys(VEHICLE_SPECS);
    vr.setLodOverride(2);
    while(vr.pending.length)vr.flush(0);
    let allocated=0;
    for(let i=0;i<1901;i++) {
      const handle=vr.add(kinds[i%kinds.length],0xaabbcc);
      if(handle>=0){allocated++;vr.set(handle,8000+i,0,8000,0);vr.setParked(handle,true);}
    }
    if(allocated!==1900||vr.add('sedan',0xffffff)!==-1)throw Error('Logical allocation limit changed');
    const cars=Array.from({length:3000},(_,i)=>{
      const x=(i%50-25)*9,z=(Math.floor(i/50)-30)*12;
      return {id:10000+i,h:-1,kind:kinds[i%kinds.length],paint:0xaabbcc,posed:true,
        shown:new Float64Array([x,0,z,0]),pose:new Float64Array([x,0,z,0,0,0]),pose0:new Float64Array([x,0,z,0,0,0]),
        x,y:0,z,yaw:0,v:8,brakeT:0,turn:0,crashed:0,parked:false,dep:0,arr:-1,drawn:{why:'lane'}};
    });
    const serialized=JSON.stringify(cars);
    const draw=quality=>{vr.observeTraffic(cars,camera,1,quality);vr.flush(0);renderer.render(scene,camera);};
    // Warm each existing slot before measuring switches. More visible cars use
    // their normal appearance records without growing any typed/GPU buffers.
    draw('ultra');draw('high');
    const buffers=()=>{
      const result=new Set();
      for(const batches of [vr.batches,vr.presentationBatches])for(const batch of batches.values())
        for(const value of Object.values(batch))if(ArrayBuffer.isView(value))result.add(value.buffer);
      for(const mapping of [vr.presentationPickIds,vr.presentationPickHandles])
        for(const array of mapping.values())result.add(array.buffer);
      vr.object.traverse(object=>{
        for(const attr of Object.values(object.geometry?.attributes??{}))result.add((attr.array??attr.data.array).buffer);
        if(object.geometry?.index)result.add(object.geometry.index.array.buffer);
        for(const attr of [object.instanceMatrix,object.instanceColor])if(attr)result.add(attr.array.buffer);
      });
      return [...result];
    };
    const storage=buffers(),rng=vr.rngState,active=vr.stats().active;
    const oldRandom=Math.random;let randomDraws=0;
    Math.random=()=>{randomDraws++;return .5;};
    const rows=[],images=[];
    let highIds,extra;
    try {
      for(const quality of ['high','ultra','low','medium','high','ultra']) {
        draw(quality);
        const stats=vr.presentationStats(),expected={low:450,medium:800,high:1400,ultra:2600}[quality];
        if(stats.capacity!==expected||stats.selected!==expected||stats.drawnCars.length!==expected)throw Error('Wrong '+quality+' presentation count '+JSON.stringify(stats));
        if(quality==='high'&&!highIds)highIds=new Set(stats.drawnCars);
        if(quality==='ultra'&&!extra)extra=cars.find(car=>vr.isCarDrawn(car.id)&&!highIds.has(car.id));
        const after=buffers();
        if(after.length!==storage.length||after.some((buffer,i)=>buffer!==storage[i]))throw Error('Capacity switch replaced array/GPU storage');
        const perKind=[...vr.presentationLists.values()].map(list=>list.length);
        if(perKind.some(count=>count>vr.perKind))throw Error('Per-kind GPU capacity exceeded');
        const target=quality==='ultra'?extra:cars.find(car=>vr.isCarDrawn(car.id));
        scene.updateMatrixWorld(true);
        const ray=new THREE.Raycaster(new THREE.Vector3(target.x,50,target.z),new THREE.Vector3(0,-1,0));
        const picked=vr.pickCarId(ray);
        if(picked!==target.id)throw Error('Drawn identity lost in picking');
        if(quality==='high'&&extra&&vr.isCarDrawn(extra.id))throw Error('Shrinking the cap retained an evicted car');
        rows.push({quality,...stats,drawnCars:stats.drawnCars.length,perKind,picked,
          calls:renderer.info.render.calls,triangles:renderer.info.render.triangles});
        if(images.length<2)images.push({quality,png:renderer.domElement.toDataURL().split(',')[1]});
      }
    } finally {Math.random=oldRandom;}
    if(randomDraws||vr.rngState!==rng||vr.stats().active!==active||JSON.stringify(cars)!==serialized)throw Error('Presentation changed random/allocation/candidate state');
    const audio=[];
    for(const quality of ['ultra','high']) {
      draw(quality);
      const context=new OfflineAudioContext(2,22050,22050);
      const street=new StreetAudio(new Synth(context,()=>.5),context.destination,{rng:()=>.5,voices:8,sirens:3,horns:0});
      street.update(.3,cars,{x:extra.x,y:2,z:extra.z,rx:1,rz:0,dist:40},
        {rain:0,wet:0,hush:0,speed:1,drawn:id=>vr.isCarDrawn(id)});
      const voices=street.debug();
      if(!voices.length||voices.some(voice=>!vr.isCarDrawn(voice.id)))throw Error('Sound membership differs from actual drawn cars');
      const expanded=voices.some(voice=>!highIds.has(voice.id));
      if(quality==='ultra'&&!expanded)throw Error('Expanded selection received no voice');
      if(quality==='high'&&expanded)throw Error('Evicted selection retained a voice');
      const output=await context.startRendering();
      const peak=Math.max(...output.getChannelData(0).map(Math.abs));
      if(!(peak>0))throw Error('Selected audio was silent');
      audio.push({quality,ids:voices.map(voice=>voice.id),expanded,peak});
    }
    const report={device,candidates:cars.length,logicalCapacity:1900,allocated,perKind:vr.perKind,
      bufferBytes:storage.reduce((sum,buffer)=>sum+buffer.byteLength,0),buffersUnchanged:true,
      candidateStateUnchanged:JSON.stringify(cars)===serialized,randomDraws,rendererRngUnchanged:vr.rngState===rng,rows,audio,images};
    vr.dispose();renderer.dispose();return report;
  });
  for(const image of result.images)writeFileSync(`${out}/${image.quality}.png`,Buffer.from(image.png,'base64'));
  delete result.images;
  assert.deepEqual(errors,[]);
  writeFileSync(`${out}/result.json`,JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result));
} finally {await browser.close();}
console.log('PASS 2600 mixed posed cars, fixed GPU buffers/logical allocation, stationary switching, picking and actual drawn sound membership');
