import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createServer } from 'vite';

const server=await createServer({cacheDir:'shots/tmp/vite/road-reflection-'+process.pid,server:{middlewareMode:true,watch:null,hmr:false,ws:false},appType:'custom',logLevel:'error'});
try {
  const {roadMirrorPlanes,RoadReflection}=await server.ssrLoadModule('/src/roads/roadReflection.ts');
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute([0,4,0,10,4.4,0,0,4,10],3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute([.5,0,.5,1,.5,0],2));
  geometry.setAttribute('aRoadState',new THREE.Float32BufferAttribute([1,.8,0,1,.8,0,1,.8,0],3));
  geometry.setIndex([0,2,1]);
  const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial());
  const surface={mesh,span:.4,median:0};
  const positions=geometry.attributes.position.array.slice();
  const [candidate]=roadMirrorPlanes([surface]);
  assert.ok(candidate&&candidate.area>50);
  assert.ok(Math.abs(candidate.plane.normal.x+.04/Math.hypot(1,.04))<1e-6);
  const point=new THREE.Vector3();
  for(let i=0;i<3;i++)assert.ok(Math.abs(candidate.plane.distanceToPoint(point.fromBufferAttribute(geometry.attributes.position,i)))<1e-7);
  assert.ok(candidate.plane.distanceToPoint(new THREE.Vector3(0,14,0))>9.9,'separate elevated road is outside this mirror plane');
  assert.equal(roadMirrorPlanes([{...surface,select:false}]).length,0);
  assert.equal(roadMirrorPlanes([{...surface,median:.05}]).length,0,'raised median cannot select the mirror');
  geometry.attributes.aRoadState.setY(0,0).setY(1,0).setY(2,0);
  assert.equal(roadMirrorPlanes([surface]).length,0,'dry grade has no puddle plane');
  geometry.attributes.aRoadState.setY(0,.8).setY(1,.8).setY(2,.8);
  geometry.setIndex([0,1,2]);
  assert.equal(roadMirrorPlanes([surface]).length,0,'down-facing triangles cannot select the mirror');
  geometry.setIndex([0,2,1]);
  mesh.position.y=7;
  const [moved]=roadMirrorPlanes([surface]);
  assert.ok(Math.abs(moved.plane.distanceToPoint(candidate.center.clone().add(new THREE.Vector3(0,7,0))))<1e-7);
  assert.deepEqual(geometry.attributes.position.array,positions,'reflection sampling preserves source geometry');
  const random=Math.random;
  let draws=0;
  Math.random=()=>{draws++;return .5;};
  try {const reflection=new RoadReflection();reflection.dispose();roadMirrorPlanes([surface]);}
  finally {Math.random=random;}
  assert.equal(draws,0,'CPU preparation draws no simulation RNG');
  geometry.dispose();mesh.material.dispose();
  console.log('PASS actual sloped planes, grade separation, median/dry/backface rejection, transforms, unchanged geometry and zero global RNG');
} finally {await server.close();}
