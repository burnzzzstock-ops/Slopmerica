import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createServer } from 'vite';

const server = await createServer({ server:{ middlewareMode:true, watch:null, hmr:false, ws:false }, appType:'custom', logLevel:'error' });
try {
  const { Terrain } = await server.ssrLoadModule('/src/world/terrain.ts');
  const { MAPS } = await server.ssrLoadModule('/src/world/maps.ts');
  const { HM_N } = await server.ssrLoadModule('/src/config.ts');
  const heights = new Float32Array(HM_N * HM_N).fill(10);
  const cover = new Float32Array(heights.length).fill(.25);
  const paint = new Uint8Array(heights.length);
  const roadMask = new Uint8Array(heights.length);
  const i = 768, j = 768, id = j * HM_N + i;
  for (const def of MAPS) {
    const terrain = Object.assign(Object.create(Terrain.prototype), {
      heights, cover, paint, roadMask, map:{def},
      pal:Object.fromEntries(Object.entries(def.palette).map(([key,value])=>[key,new THREE.Color(value)])),
    });
    for (let lod = 0; lod < 4; lod++) {
      const natural = new THREE.Color(), dirt = new THREE.Color(), weights = [0,0,0,0], delta = [0,0,0,0];
      paint[id] = 0;
      terrain.shade(i,j,natural,weights,lod,delta);
      assert.deepEqual(delta,[0,0,0,0]);
      paint[id] = 1;
      terrain.shade(i,j,dirt,weights,lod,delta);
      for (let channel = 0; channel < 3; channel++) {
        assert.ok(Math.abs(natural.toArray()[channel]+delta[channel]-dirt.toArray()[channel])<1e-12,
          'paint contribution exactly reconstructs the old albedo including LOD speckle');
      }
      assert.equal(delta[3],1);
      for (const kind of [0,2,3,4]) {
        paint[id] = kind;
        terrain.shade(i,j,dirt,weights,lod,delta);
        assert.deepEqual(delta,[0,0,0,0],'unpainted/lawn/paved/scorched surfaces retain their original blend');
      }
      const chunk = {cx:6,cz:6,roads:0,minY:0,maxY:0};
      paint[id] = 0;
      const plain = terrain.buildChunk(chunk,lod);
      paint[id] = 1;
      const painted = terrain.buildChunk(chunk,lod);
      for (const name of ['position','normal']) assert.deepEqual(painted.attributes[name].array,plain.attributes[name].array);
      assert.deepEqual(painted.index.array,plain.index.array);
      const attribute = painted.attributes.paintDelta;
      assert.equal(attribute.count,painted.attributes.position.count);
      assert.ok([...attribute.array].every(Number.isFinite));
      assert.equal(attribute.getW(0),1);
      const n = 128 / [1,2,4,8][lod] + 1;
      assert.deepEqual([...attribute.array.slice(n*n*4,n*n*4+4)],[...attribute.array.slice(0,4)],'skirt copies the adjoining paint contribution');
      assert.equal(heights[id],10);
      assert.equal(paint[id],1);
      plain.dispose();painted.dispose();
    }
  }
  console.log('PASS three palettes × four LODs, exact paint contribution, pure surfaces, unchanged geometry and matching skirts');
} finally { await server.close(); }
