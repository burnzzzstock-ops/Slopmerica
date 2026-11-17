import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createServer } from 'vite';

const server=await createServer({cacheDir:'shots/tmp/vite/vehicle-ultra-unit-'+process.pid,
  server:{middlewareMode:true,hmr:false,watch:null,ws:false},appType:'custom',logLevel:'error'});
try {
  const {VehiclePresentation}=await server.ssrLoadModule('/src/agents/vehiclePresentation.ts');
  const selection=new VehiclePresentation(1900,634);
  const camera=new THREE.PerspectiveCamera(60,1,.1,2000);
  camera.position.set(0,500,700);camera.lookAt(0,0,0);camera.updateMatrixWorld();
  const kinds=['sedan','suv','liftedTruck','bus','ambulance'];
  const cars=Array.from({length:3200},(_,i)=>({id:i+1,h:-1,kind:kinds[i%kinds.length]}));
  const original=JSON.stringify(cars),random=Math.random;
  let draws=0;
  Math.random=()=>{draws++;return .5;};
  try {
    for(const capacity of [1900,2600,1900,2600]) {
      selection.setCapacity(capacity);
      assert.equal(selection.begin(camera,0,1500),true,'capacity changes must rescan a stationary view');
      for(const [i,car] of cars.entries())selection.offer(car.h,car.kind,(i%50-25)*6,0,(Math.floor(i/50)-32)*8,car);
      selection.finish();
      assert.equal(selection.selected.length,capacity);
      for(const kind of kinds)assert.ok(selection.selected.filter(candidate=>candidate.kind===kind).length<=634);
      assert.equal(new Set(selection.selected.map(candidate=>candidate.key)).size,capacity);
      selection.setCapacity(capacity);
      assert.equal(selection.begin(camera,0,1500),false,'unchanged cap preserves normal scan cadence');
    }
    assert.equal(selection.begin(camera,.5,1500),true);
    for(const [i,car] of cars.entries())selection.offer(car.h,'sedan',(i%50-25)*6,0,(Math.floor(i/50)-32)*8,{...car,kind:'sedan'});
    selection.finish();
    assert.equal(selection.selected.length,634,'a single dominant kind must respect its existing array capacity');
  } finally {Math.random=random;}
  assert.equal(draws,0);
  assert.equal(JSON.stringify(cars),original);
  console.log('PASS 1900/2600 live selection, per-kind bounds, stationary invalidation, unchanged candidate data and zero RNG');
} finally {await server.close();}
