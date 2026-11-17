// GPU A/B of one flat mixed junction. Same network, camera and uniforms.
// Pixel samples sit 0.3m either side of each approach seam, off the paint.
// BASE_URL checks one build. Set NEXT_URL as well for frozen before/after evidence.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch } from '../lib/browser.mjs';
const urls=[process.env.BASE_URL||'http://127.0.0.1:5173'];
if(process.env.NEXT_URL)urls.push(process.env.NEXT_URL);
const out=process.env.OUT||'shots/roads';
mkdirSync(out,{recursive:true});
const browser=await launch();
let failed=0;
try {
  for (const [index,base] of urls.entries()) {
    const page=await browser.newPage({viewport:{width:900,height:650}});
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(/Shader Error|VALIDATE_STATUS|GL_INVALID/.test(m.text()))errors.push(m.text());});
    await page.goto(base,{waitUntil:'networkidle',timeout:180000});
    await page.evaluate(()=>document.fonts.ready);
    const report=await page.evaluate(async () => {
      const THREE=await import('/node_modules/three/build/three.module.js');
      const {RoadNetwork}=await import('/src/roads/network.ts');
      const {RoadRenderer}=await import('/src/roads/roadMesh.ts');
      const {StreetDetails}=await import('/src/roads/streetDetails.ts');
      const {lineCubic}=await import('/src/core/math.ts');
      const {junctionShape}=await import('/src/roads/roadJunction.ts');
      const terrain={h:()=>10,coverAt:()=>0,inBounds:()=>true,gradeRoad(){},forgetRoad(){},raycast:()=>null};
      const net=new RoadNetwork(terrain,{cut(){}});
      const build=(x,z,type) => {
        const from=net.snap(x,z),to=net.snap(0,0);
        net.build(from,to,lineCubic(from,to),type);
      };
      build(-80,0,'stroad4');build(80,0,'stroad4');build(0,-80,'twoLane');build(0,80,'twoLane');
      const renderer=new THREE.WebGLRenderer({antialias:false,preserveDrawingBuffer:true});
      renderer.setSize(900,650);
      renderer.outputColorSpace=THREE.SRGBColorSpace;
      renderer.setClearColor(0xccc8b9);
      const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-65,65,65*650/900,-65*650/900,.1,1000);
      camera.position.set(0,100,0);camera.up.set(0,0,-1);camera.lookAt(0,10,0);
      scene.add(new THREE.AmbientLight(0xffffff,Math.PI));
      let randomState=1776;
      Math.random=()=>{randomState=(Math.imul(randomState,1664525)+1013904223)>>>0;return randomState/4294967296;};
      const rr=new RoadRenderer(net,renderer);
      rr.update();
      scene.add(rr.group);
      const drawn=[...rr.typeMeshes.values(),rr.junctionMesh,rr.crosswalkMesh,rr.concMesh];
      for(const child of rr.group.children)if(!drawn.includes(child))child.visible=false;
      renderer.render(scene,camera);
      const gl=renderer.getContext(),debug=gl.getExtension('WEBGL_debug_renderer_info');
      const gpu=debug&&gl.getParameter(debug.UNMASKED_RENDERER_WEBGL);
      const png=renderer.domElement.toDataURL().split(',')[1],calls=renderer.info.render.calls,triangles=renderer.info.render.triangles;
      // Crossing bars deliberately cover this seam. Exclude that decal layer
      // for the diagnostic, then sample the unpainted asphalt on both sides.
      rr.crosswalkMesh.visible=false;
      renderer.render(scene,camera);
      const pixels=new Uint8Array(900*650*4);gl.readPixels(0,0,900,650,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
      const sample=(x,z)=>{
        const p=new THREE.Vector3(x,10.13,z).project(camera);
        const ix=Math.max(0,Math.min(899,Math.round((p.x*.5+.5)*900))),iy=Math.max(0,Math.min(649,Math.round((p.y*.5+.5)*650)));
        return [...pixels.subarray((iy*900+ix)*4,(iy*900+ix)*4+3)];
      };
      const node=[...net.nodes.values()].find(n=>Math.abs(n.x)<1&&Math.abs(n.z)<1);
      const junction=junctionShape(net,node.id);
      const seams=[];
      for(const leg of junction.legs){
        const f=RoadRenderer.frame(leg.seg,leg.atA?leg.trim:leg.seg.length-leg.trim);
        const sign=leg.atA?1:-1,dx=f.t.x*sign,dz=f.t.z*sign;
        const pairs=[];
        for(let lateral=-leg.e+.7;lateral<leg.e-.7;lateral+=.2){
          const x=f.p.x-dz*lateral,z=f.p.z+dx*lateral;
          const inside=sample(x-dx*.3,z-dz*.3),outside=sample(x+dx*.3,z+dz*.3);
          if(Math.max(...inside,...outside)<140 && Math.abs(outside[0]-outside[2])<18)pairs.push({inside,outside});
        }
        seams.push({type:leg.seg.type,pairs});
      }
      // Front/back proof uses an isolated sign in the same browser.
      const details=new StreetDetails();
      const sign=details.buildTextMesh([{kind:'street',text:'SLOP STREET',x:0,y:0,z:0,yaw:0,w:4,h:1}]);
      const signScene=new THREE.Scene();signScene.add(sign);
      const signCamera=new THREE.OrthographicCamera(-2.25,2.25,.8,-.8,.1,20);
      renderer.setSize(450,160);renderer.setClearColor(0x252923);
      const blades=[];
      for(const side of[1,-1]){
        signCamera.position.set(0,0,side*5);signCamera.up.set(0,1,0);signCamera.lookAt(0,0,0);
        renderer.render(signScene,signCamera);
        blades.push(renderer.domElement.toDataURL().split(',')[1]);
      }
      renderer.dispose();
      return {png,blades,seams,calls,triangles,gpu};
    });
    const toLab=rgb=>{
      const [r,g,b]=rgb.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});
      const f=v=>v>216/24389?Math.cbrt(v):24389/27*v/116+16/116;
      const x=f((.4124564*r+.3575761*g+.1804375*b)/.95047),y=f(.2126729*r+.7151522*g+.072175*b),z=f((.0193339*r+.119192*g+.9503041*b)/1.08883);
      return [116*y-16,500*(x-y),200*(y-z)];
    };
    const deltas=report.seams.map(s=>s.pairs.map(p=>{const a=toLab(p.inside),b=toLab(p.outside);return Math.hypot(...a.map((n,k)=>n-b[k]));}));
    const label=index===urls.length-1?'after':'before';
    writeFileSync(join(out,label+'.png'),Buffer.from(report.png,'base64'));
    report.blades.forEach((data,i)=>writeFileSync(join(out,label+(i?'-rear':'-front')+'.png'),Buffer.from(data,'base64')));
    const seamMeans=deltas.map(values=>values.reduce((a,b)=>a+b,0)/values.length);
    const summary={...report,png:undefined,blades:undefined,deltas,seamMeans,meanDelta:seamMeans.reduce((a,b)=>a+b,0)/seamMeans.length,errors};
    writeFileSync(join(out,label+'.json'),JSON.stringify(summary,null,2)+'\n');
    console.log(label,JSON.stringify({...summary,seams:summary.seams.map(s=>({type:s.type,samples:s.pairs.length})),deltas:undefined}));
    if(label==='after' && seamMeans.some(n=>!Number.isFinite(n)||n>=3))failed++;
    if(process.env.GPU==='1' && /SwiftShader|llvmpipe|basic|WARP|softpipe/i.test(report.gpu))failed++;
    if(errors.length)failed++;
    await page.close();
  }
} finally {await browser.close();}
if(failed)process.exitCode=1;
