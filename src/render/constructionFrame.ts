import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CELL } from '../config';
import { generateConstruction } from '../buildings/kitGenerator';
import { Kit, col } from '../buildings/kit';
import { T } from '../buildings/atlas';
import { addBuildingClipAttribute } from './buildingClip';

/** Retain the existing scaffold and crane at their real proportions. Thin
 * floor plates appear at their actual storey heights as the body rises. */
export function constructionFrame(widthCells: number, depthCells: number, height: number, seed: number) {
  const scaffold = generateConstruction(widthCells, depthCells, height, seed);
  const count = scaffold.getAttribute('position').count;
  scaffold.setAttribute('buildClipY', new THREE.BufferAttribute(new Float32Array(count).fill(-1), 1));

  const width = Math.max(4, Math.min(widthCells * CELL - 2.2, 22));
  const depth = Math.max(4, Math.min(depthCells * CELL - 2.2, 18));
  const centerZ = -Math.max(0, depthCells * CELL - depth) * 0.22;
  const floors = Math.max(1, Math.ceil(height / 3.4 - 1e-6));
  const kit = new Kit();
  const concrete = col(0x969a96);
  for (let floor = 1; floor <= floors; floor++) {
    const y = floor * height / floors;
    kit.slab(-width / 2, centerZ - depth / 2, width / 2, centerZ + depth / 2, y, T.CONCRETE, concrete);
  }
  const plates = kit.build();
  addBuildingClipAttribute(plates);
  const geometry = mergeGeometries([scaffold, plates]);
  scaffold.dispose();
  plates.dispose();
  if (!geometry) throw new Error('Construction geometry formats must match');
  return geometry;
}
