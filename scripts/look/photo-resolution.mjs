// GPU=1 for a hardware export. Compare a real 4K scene draw to a 3× upscale
// of the same 720p view, and check that the city recovers its original targets.
import { mkdirSync, writeFileSync } from 'node:fs';
import { launch } from '../lib/browser.mjs';
const out = 'shots/look/postcards/4k'; mkdirSync(out, { recursive:true });
const browser = await launch();
try {
  const page = await browser.newPage({ viewport:{ width:1280,height:720 }, deviceScaleFactor:1 });
  await page.addInitScript(() => { localStorage.setItem('slopmerica.quality','high'); localStorage.setItem('slopmerica.onboarded','1'); localStorage.setItem('slopmerica.resolution','full'); });
  await page.goto(`${process.env.BASE_URL || 'http://127.0.0.1:5195'}/#skip&map=appalachia&mode=sandbox`, {timeout:180000});
  await page.waitForFunction(() => window.__game && window.__dbg, null, {timeout:300000});
  const { png, ...result } = await page.evaluate(async () => {
    const g=window.__game; g.stop(); g.rts.setView(10,-170,1440,0.48,0.53,true); g.frame(0,true);
    const p=g.photo,r=g.renderer,post=g.post,gl=r.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');
    const hardware=ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
    const original=post.render, draws=[], state=()=>[r.domElement.width,r.domElement.height, r.getPixelRatio(), post.sceneRT.width,post.sceneRT.height,g.camera.aspect];
    const before=state();
    p.enter(); p.weather='clear'; p.hour=18.5;
    post.render=function(...args){ draws.push(state().slice(0,5)); return original.apply(this,args); };
    const small=await createImageBitmap(await p.capture(false));
    const large=await createImageBitmap(await p.capture(false,{width:3840,height:2160}));
    const c=document.createElement('canvas'); c.width=3840; c.height=2160;
    const ctx=c.getContext('2d',{willReadFrequently:true});
    ctx.drawImage(small,0,0,3840,2160); const scaled=ctx.getImageData(0,0,3840,2160).data;
    ctx.drawImage(large,0,0); const actual=ctx.getImageData(0,0,3840,2160).data;
    let sum=0,n=0; for(let y=120;y<2040;y+=7)for(let x=120;x<3720;x+=7){ const k=(y*3840+x)*4; sum+=Math.abs(actual[k]-scaled[k])+Math.abs(actual[k+1]-scaled[k+1])+Math.abs(actual[k+2]-scaled[k+2]); n+=3; }
    const dims=[large.width,large.height], meanDelta=sum/n; large.close(); small.close();
    const framed=await p.capture(true,{width:3840,height:2160});
    const png=await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.readAsDataURL(framed);});
    let failureRestored=false;
    post.render=function(...args){if(r.domElement.width===3840)throw Error('intentional capture failure');return original.apply(this,args);};
    try { await p.capture(false,{width:3840,height:2160}); } catch(e) { failureRestored=e.message==='intentional capture failure' && JSON.stringify(before)===JSON.stringify(state()); }
    post.render=original; p.exit();
    return {png,hardware,dims,meanDelta,draws,before,after:state(),failureRestored};
  });
  result.chrome=browser.version();
  const pass=result.dims.join()==='3840,2160' && result.meanDelta>1 && result.draws.some(row=>row.join()==='3840,2160,1,3840,2160')
    && result.before.join()===result.after.join() && result.failureRestored && (!process.env.GPU || !/swiftshader|llvmpipe|basic render/i.test(result.hardware));
  writeFileSync(out+'/holler-county.png',Buffer.from(png,'base64')); writeFileSync(out+'/result.json',JSON.stringify({...result,pass},null,2));
  console.log(pass?'OK':'FAIL',JSON.stringify(result)); if(!pass)process.exitCode=1;
} finally {await browser.close();}
