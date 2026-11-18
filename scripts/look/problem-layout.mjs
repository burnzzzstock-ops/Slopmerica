import assert from 'node:assert/strict';
import * as THREE from 'three';
import { clusterProblemItems, PROBLEMS } from '../../src/sim/serviceIcons.ts';

// Synthetic layout units exercise the renderer independently of city simulation.
const items = Array.from({ length: 1000 }, (_, id) => ({
  id: id + 1, x: (id % 40 - 19.5) * 4, y: 20, z: (Math.floor(id / 40) - 12) * 4,
  p: PROBLEMS[id % PROBLEMS.length],
}));
const original = JSON.stringify(items);
function bounds(item, camera, width, height) {
  const phase = Math.abs(item.id) * 1.7 % 6.28;
  const point = new THREE.Vector3(item.x, item.y + Math.sin(phase) * .6, item.z).applyMatrix4(camera.matrixWorldInverse);
  const depth = -point.z, n = item.n ?? 1;
  const size = n > 1 ? Math.min(140, Math.max(3.2, depth * .035)) * Math.min(2, 1.25 + .12 * Math.log2(n))
    : Math.min(22, Math.max(1, depth * .03)) * (item.p === 'road' ? 1.8 : 1);
  point.applyMatrix4(camera.projectionMatrix);
  return {x:(point.x+1)*width/2,y:(1-point.y)*height/2,half:size*height/Math.tan(25*Math.PI/180)/4/depth+3};
}
function assertSeparate(shown, camera, width, height) {
  const boxes = shown.map(item => bounds(item,camera,width,height));
  for (let i=0;i<boxes.length;i++) for(let j=i+1;j<boxes.length;j++) {
    const a=boxes[i],b=boxes[j],half=a.half+b.half;
    assert.ok(Math.abs(a.x-b.x)>=half || Math.abs(a.y-b.y)>=half*1.4,'bubble hit regions overlap');
  }
}
for (const [width, height] of [[390,844],[1280,720]]) {
  const camera = new THREE.PerspectiveCamera(50, width / height, .1, 10000);
  camera.position.set(0,220,650);
  camera.lookAt(0,0,0);
  camera.updateMatrixWorld(true);
  const shown = clusterProblemItems(items, camera, width, height);
  assert.ok(shown.length <= 25);
  assert.equal(shown.reduce((n, item) => n + (item.n ?? 1), 0), 1000);
  assert.deepEqual(shown, clusterProblemItems(items.toReversed(), camera, width, height));
  assertSeparate(shown,camera,width,height);
  const spread = items.map((item,index) => {
    const sx=(index%40/39-.5)*1.8, sy=(Math.floor(index/40)/24-.5)*1.8;
    const position=new THREE.Vector3(sx*700/camera.projectionMatrix.elements[0],sy*700/camera.projectionMatrix.elements[5],-700).applyMatrix4(camera.matrixWorld);
    return {...item,x:position.x,y:position.y,z:position.z};
  });
  const wide = clusterProblemItems(spread,camera,width,height);
  assert.ok(wide.length<=25,'screen-spanning problems exceed the budget');
  assert.equal(wide.reduce((n,item)=>n+(item.n??1),0),1000);
  assertSeparate(wide,camera,width,height);
  for (let a = 0; a < shown.length; a++) {
    const counts = shown[a].mix ?? { [shown[a].p]: 1 };
    assert.equal(Object.values(counts).reduce((n, count) => n + count, 0), shown[a].n ?? 1);
  }
  const filtered = clusterProblemItems(items, camera, width, height, 'power');
  assert.equal(filtered.reduce((n, item) => n + (item.n ?? 1), 0), items.filter(item => item.p === 'power').length);
  assert.ok(filtered.every(item => item.p === 'power' && Object.keys(item.mix ?? {}).every(key => key === 'power')));
  assert.equal(clusterProblemItems(items, camera, width, height, 'goods').length, 0);
  const rear = items.map(item => ({ ...item, z: 1000 }));
  assert.equal(clusterProblemItems(rear, camera, width, height).length, 0);
  const mixed = clusterProblemItems([{id:-1,x:0,y:20,z:0,p:'garbage',n:7,mix:{garbage:4,power:3}}],camera,width,height,'power');
  assert.equal(mixed[0].n, 3);
  assert.deepEqual(mixed[0].mix, {power:3});
  console.log(`${width}×${height}: 1000 synthetic items retained in ${shown.length} dense / ${wide.length} screen-spanning groups`);
}
assert.equal(JSON.stringify(items), original, 'layout must not mutate simulation items');
console.log('PASS stable order, count conservation, view filtering and behind-camera exclusion');
