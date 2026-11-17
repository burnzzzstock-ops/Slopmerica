// Both faces must read left-to-right. Covers yawed street blades, one-sided
// speed plates and the upward-facing road lettering in the same draw batch.
import assert from 'node:assert/strict';
import { makeRig } from '../lib/roadrig.mjs';
const { server, THREE, rr } = await makeRig();
try {
  for (const yaw of [0, .6, Math.PI / 2, 2.3]) {
    const mesh = rr.details.buildTextMesh([{ kind:'street', text:'SLOP', x:0,y:0,z:0,yaw,w:4,h:1 }]);
    mesh.updateMatrixWorld(true);
    const right=new THREE.Vector3(Math.cos(yaw),0,Math.sin(yaw));
    const front=new THREE.Vector3(-Math.sin(yaw),0,Math.cos(yaw));
    for (const side of [1,-1]) {
      const uv=[];
      for (const screenX of [-1.5,1.5]) {
        const origin=front.clone().multiplyScalar(side*5).addScaledVector(right,screenX*side);
        const ray=new THREE.Raycaster(origin,front.clone().multiplyScalar(-side));
        const hits=ray.intersectObject(mesh);
        assert.equal(hits.length,1,'each face has one visible triangle');
        uv.push(hits[0].uv.x);
      }
      assert.ok(uv[1]>uv[0], `mirrored street blade at yaw ${yaw}, side ${side}`);
    }
    assert.equal(mesh.geometry.index.count/3,4,'two triangles per face');
    assert.equal(mesh.material.side,THREE.FrontSide);
    mesh.geometry.dispose(); mesh.material.map.dispose(); mesh.material.dispose();
  }
  const word=rr.details.buildTextMesh([{kind:'road',text:'SLOW',x:0,y:0,z:0,yaw:.4,w:4,h:1,horizontal:true}]);
  word.updateMatrixWorld(true);
  const top=new THREE.Raycaster(new THREE.Vector3(0,5,0),new THREE.Vector3(0,-1,0));
  assert.ok(top.intersectObject(word).length,'road paint faces up');
  const speed=rr.details.buildTextMesh([{kind:'speed',text:'35',x:0,y:0,z:0,yaw:0,w:1,h:1}]);
  speed.updateMatrixWorld(true);
  const behind=new THREE.Raycaster(new THREE.Vector3(.1,0,-5),new THREE.Vector3(0,0,1));
  assert.equal(behind.intersectObject(speed).length,0,'speed plate has no mirrored rear');
  console.log('PASS eight street-blade faces, upward road text and the blank back of a speed plate');
} finally { await server.close(); }
