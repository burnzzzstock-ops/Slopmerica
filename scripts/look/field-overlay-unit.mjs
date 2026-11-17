import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { comparePixels } from './golden-diff.mjs';

const server = await createServer({cacheDir:'shots/tmp/vite/field-overlay-'+process.pid,server:{middlewareMode:true,watch:null,hmr:false,ws:false},appType:'custom',logLevel:'error'});
try {
  const { sampleOverlayField, overlayLegend } = await server.ssrLoadModule('/src/render/overlays.ts');
  const { HALF } = await server.ssrLoadModule('/src/config.ts');
  const field = {
    view:'landValue',w:2,h:2,cellM:10,data:new Float32Array([0,10,20,NaN]),min:0,max:20,version:1,
    legend:{title:'Land value',unit:'',lowLabel:'Cheap',highLabel:'Pricey',ramp:'goodHigh'},
  };
  assert.equal(sampleOverlayField(field,-HALF+5,-HALF+5),0);
  assert.equal(sampleOverlayField(field,-HALF+15,-HALF+5),10);
  assert.equal(sampleOverlayField(field,-HALF+10,-HALF+10),10);
  assert.equal(sampleOverlayField(field,-HALF+15,-HALF+15),null);
  assert.equal(sampleOverlayField(field,-HALF-1,-HALF+5),null);
  const standard = overlayLegend(field,'standard'), accessible = overlayLegend(field,'colorblind');
  assert.equal(standard.title,field.legend.title);
  assert.equal(standard.min,field.min);
  assert.equal(standard.max,field.max);
  assert.deepEqual(standard.stops.map(stop=>stop.value),[0,10,20]);
  assert.notDeepEqual(standard.stops,accessible.stops);
  const reversed=overlayLegend({...field,legend:{...field.legend,ramp:'badHigh'}},'colorblind');
  assert.deepEqual(accessible.stops.map(stop=>stop.color),reversed.stops.map(stop=>stop.color).reverse());
  assert.ok(Number.isNaN(field.data[3]));
  // Machado et al. 2009 severity100 linear-RGB transforms, also used by hud-icons.
  const transforms = [
    [[.152286,1.052583,-.204868],[.114503,.786281,.099216],[-.003882,-.048116,1.051998]],
    [[.367322,.860646,-.227968],[.280085,.672501,.047413],[-.011820,.042940,.968881]],
    [[1.255528,-.076749,-.178779],[-.078411,.930809,.147602],[.004733,.691367,.303900]],
  ];
  const simulate=(hex,matrix)=>{
    const rgb=hex.slice(1).match(/../g).map(pair=>parseInt(pair,16)/255)
      .map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
    return [...matrix.map(row=>{
      const value=Math.max(0,Math.min(1,row.reduce((sum,c,i)=>sum+c*rgb[i],0)));
      return Math.round(255*(value<=.0031308?value*12.92:1.055*value**(1/2.4)-.055));
    }),255];
  };
  for(const transform of transforms){
    const low=simulate(accessible.stops[0].color,transform),high=simulate(accessible.stops[2].color,transform);
    assert.equal(comparePixels(low,high,30).changed,1,'CVD ramp endpoints need perceptual separation');
  }
  console.log('PASS field centres, weighted interpolation, missing cells, bounds, genuine units and palette direction');
  console.log('PASS colorblind ramp endpoints exceed30 CIE Lab deltaE in three CVD simulations');
} finally { await server.close(); }
