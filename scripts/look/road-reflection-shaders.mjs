// BASE_URL selects the build providing the actual road-plane reflection helper.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launch } from '../lib/browser.mjs';

const base=process.env.BASE_URL||'http://127.0.0.1:5173';
const browser=await launch();
try {
  const page=await browser.newPage({viewport:{width:640,height:400}});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base,{waitUntil:'networkidle',timeout:180000});
  const result=await page.evaluate(async ()=>{
    const THREE=await import('/node_modules/three/build/three.module.js');
    const {RoadReflection}=await import('/src/roads/roadReflection.ts');
    const renderer=new THREE.WebGLRenderer({antialias:false});
    renderer.setPixelRatio(2);renderer.setSize(320,200);
    renderer.toneMapping=THREE.NoToneMapping;
    const gl=renderer.getContext(),extension=gl.getExtension('WEBGL_debug_renderer_info');
    const device=gl.getParameter(extension?extension.UNMASKED_RENDERER_WEBGL:gl.RENDERER);
    const scene=new THREE.Scene();scene.background=new THREE.Color(0x101010);
    const camera=new THREE.PerspectiveCamera(50,1.6,.1,200);
    camera.position.set(0,8,20);camera.lookAt(0,0,0);camera.updateMatrixWorld();
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute([-10,0,-10,10,0,-10,10,0,10,-10,0,10],3));
    geometry.setAttribute('uv',new THREE.Float32BufferAttribute([.4,0,.6,0,.6,1,.4,1],2));
    geometry.setAttribute('aRoadState',new THREE.Float32BufferAttribute([1,.8,0,1,.8,0,1,.8,0,1,.8,0],3));
    geometry.setIndex([0,2,1,0,3,2]);
    const ground=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color:0x888888}));
    scene.add(ground);
    const red=new THREE.Mesh(new THREE.BoxGeometry(3,3,3),new THREE.MeshBasicMaterial({color:0xff0000}));
    red.position.y=2;scene.add(red);
    const blue=new THREE.Mesh(red.geometry,new THREE.MeshBasicMaterial({color:0x0000ff}));
    blue.position.y=-2;scene.add(blue);
    renderer.render(scene,camera);
    const mirror=new RoadReflection();mirror.enabled=true;
    const surfaces=[{mesh:ground,span:1,median:0}];
    let nested=false,shadowReused=false,inverseValid=false;
    scene.onBeforeRender=(renderer,scene,camera)=>{
      if(!camera.userData.isPlanarReflection)return;
      shadowReused=!renderer.shadowMap.autoUpdate&&!renderer.shadowMap.needsUpdate;
      const product=new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.projectionMatrixInverse).elements;
      inverseValid=product.every((value,i)=>Math.abs(value-(i%5===0?1:0))<1e-6);
      nested=mirror.render(renderer,scene,camera,surfaces,0)===false;
    };
    const previous=new THREE.WebGLRenderTarget(11,13);
    renderer.setRenderTarget(previous);renderer.setViewport(2,3,9,7);
    renderer.shadowMap.autoUpdate=true;renderer.shadowMap.needsUpdate=true;renderer.xr.enabled=true;
    const restored=()=>renderer.getRenderTarget()===previous&&renderer.getViewport(new THREE.Vector4()).toArray().join(',')==='2,3,9,7'
      &&renderer.shadowMap.autoUpdate&&renderer.shadowMap.needsUpdate&&renderer.xr.enabled&&ground.visible;
    const random=Math.random;let randomDraws=0;
    Math.random=()=>{randomDraws++;return .5;};
    try {mirror.render(renderer,scene,camera,surfaces,0);} finally {Math.random=random;}
    const initial={width:mirror.target.width,height:mirror.target.height,restored:restored(),randomDraws,nested,shadowReused,inverseValid};
    const read=()=>{
      const bytes=new Uint16Array(mirror.target.width*mirror.target.height*4);
      renderer.readRenderTargetPixels(mirror.target,0,0,mirror.target.width,mirror.target.height,bytes);
      let redPixels=0,bluePixels=0;
      for(let i=0;i<bytes.length;i+=4){
        const r=THREE.DataUtils.fromHalfFloat(bytes[i]),b=THREE.DataUtils.fromHalfFloat(bytes[i+2]);
        if(r>.1&&r>b*2)redPixels++;
        if(b>.1&&b>r*2)bluePixels++;
      }
      return {redPixels,bluePixels};
    };
    const flat=read();
    const reused=mirror.render(renderer,scene,camera,surfaces,1/120)===false;
    const sloped=geometry.clone();
    for(let i=0;i<4;i++)sloped.attributes.position.setY(i,sloped.attributes.position.getX(i)*.05);
    ground.geometry=sloped;
    mirror.render(renderer,scene,camera,surfaces,1/60);
    const slope={...read(),plane:mirror.uniforms.uRoadReflectionPlane.value.toArray()};
    renderer.setPixelRatio(1.5);renderer.setSize(360,240);
    camera.aspect=1.5;camera.updateProjectionMatrix();
    mirror.render(renderer,scene,camera,surfaces,1/30);
    const resized=[mirror.target.width,mirror.target.height];
    renderer.setRenderTarget(previous);renderer.setViewport(2,3,9,7);
    scene.onBeforeRender=()=>{throw new Error('intentional mirror failure');};
    let thrown=false;
    try {mirror.render(renderer,scene,camera,surfaces,1);} catch(error){thrown=error.message==='intentional mirror failure';}
    const failure={thrown,restored:restored(),disabled:mirror.uniforms.uRoadReflectionOn.value===0};
    scene.onBeforeRender=()=>{};
    mirror.render(renderer,scene,camera,surfaces,2);
    const recovered=mirror.uniforms.uRoadReflectionOn.value===1;
    mirror.dispose();
    const released=mirror.target===null&&mirror.uniforms.tRoadReflection.value===null;
    renderer.dispose();previous.dispose();geometry.dispose();sloped.dispose();red.geometry.dispose();
    ground.material.dispose();red.material.dispose();blue.material.dispose();
    return {device,initial,flat,reused,slope,resized,failure,recovered,released};
  });
  assert.deepEqual(errors,[]);
  if(process.env.GPU==='1')assert.ok(!/SwiftShader|llvmpipe|Basic Render|software/i.test(result.device));
  assert.deepEqual([result.initial.width,result.initial.height],[640,400]);
  assert.ok(result.initial.restored&&result.initial.nested&&result.initial.shadowReused&&result.initial.inverseValid);
  assert.equal(result.initial.randomDraws,0);
  assert.ok(result.flat.redPixels>100&&result.slope.redPixels>100);
  assert.equal(result.flat.bluePixels,0);assert.equal(result.slope.bluePixels,0);
  assert.ok(Math.abs(result.slope.plane[0]+.05/Math.hypot(1,.05))<1e-6);
  assert.ok(result.reused);assert.deepEqual(result.resized,[540,360]);
  assert.ok(result.failure.thrown&&result.failure.restored&&result.failure.disabled&&result.recovered&&result.released);
  mkdirSync('shots/road-reflection',{recursive:true});
  writeFileSync('shots/road-reflection/shaders.json',JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result));
  console.log('PASS full-resolution flat/sloped reflection, clipping, cadence, nested guard, zero RNG, resize, exception recovery and resource release');
} finally {await browser.close();}
