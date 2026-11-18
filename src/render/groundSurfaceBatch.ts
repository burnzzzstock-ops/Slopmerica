import * as THREE from 'three';
import { withVisualRandom } from './visualRandom';

/** Partition an indexed, static mesh into pieces for BatchedMesh frustum
 * culling. Positions/normals and winding come from the finished source mesh
 * so the pieces agree exactly at shared edges. */
export function batchGroundSurface(source: THREE.BufferGeometry, material: THREE.Material, cellSize: number, verticalDisplacement = 0) {
  const index = source.getIndex()!, position = source.getAttribute('position');
  const tiles = new Map<string, { vertices: Map<number, number>; indices: number[] }>();
  let vertexCount = 0;
  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i), b = index.getX(i + 1), c = index.getX(i + 2);
    const x = (position.getX(a) + position.getX(b) + position.getX(c)) / 3;
    const z = (position.getZ(a) + position.getZ(b) + position.getZ(c)) / 3;
    const key = Math.floor(x / cellSize) + ',' + Math.floor(z / cellSize);
    let tile = tiles.get(key);
    if (!tile) { tile = { vertices: new Map(), indices: [] }; tiles.set(key, tile); }
    for (const id of [a, b, c]) {
      let local = tile.vertices.get(id);
      if (local === undefined) { local = tile.vertices.size; tile.vertices.set(id, local); vertexCount++; }
      tile.indices.push(local);
    }
  }
  return withVisualRandom(() => {
    const batch = new THREE.BatchedMesh(tiles.size, vertexCount, index.count, material);
    batch.sortObjects = false;
    for (const tile of tiles.values()) {
      const piece = new THREE.BufferGeometry();
      for (const [name, attr] of Object.entries(source.attributes)) {
        const packed = new Float32Array(tile.vertices.size * attr.itemSize);
        for (const [original, local] of tile.vertices) for (let k = 0; k < attr.itemSize; k++) {
          packed[local * attr.itemSize + k] = attr.getComponent(original, k);
        }
        piece.setAttribute(name, new THREE.BufferAttribute(packed, attr.itemSize));
      }
      piece.setIndex(tile.indices);
      if (verticalDisplacement) {
        piece.computeBoundingBox();
        piece.boundingBox!.max.y += verticalDisplacement;
        piece.boundingSphere = piece.boundingBox!.getBoundingSphere(new THREE.Sphere());
      }
      batch.addInstance(batch.addGeometry(piece));
      piece.dispose();
    }
    return batch;
  });
}
