import * as THREE from 'three';

/** Yield original vertex indices for a coarse opaque depth pass. The maximum
 * local displacement on any axis is one cell. Retain winding when removing
 * triangles that map to identical representatives. */
export function clusteredShadowIndices(geometry: THREE.BufferGeometry, cell: number) {
  const position = geometry.getAttribute('position'), index = geometry.index;
  const count = index?.count ?? position.count;
  const cells = new Map<string, number>(), remap = new Uint32Array(position.count);
  for (let i = 0; i < position.count; i++) {
    const x = Math.round(position.getX(i) / cell), y = Math.round(position.getY(i) / cell);
    const key = x + ',' + y + ',' + Math.round(position.getZ(i) / cell);
    let vertex = cells.get(key);
    if (vertex === undefined) {
      vertex = i;
      cells.set(key, vertex);
    }
    remap[i] = vertex;
  }
  const faces: number[] = [], seen = new Set<string>();
  for (let i = 0; i < count; i += 3) {
    const a = remap[index ? index.getX(i) : i];
    const b = remap[index ? index.getX(i + 1) : i + 1];
    const c = remap[index ? index.getX(i + 2) : i + 2];
    if (a === b || a === c || b === c) continue;
    const key = a < b && a < c ? [a, b, c].join(',') : b < c ? [b, c, a].join(',') : [c, a, b].join(',');
    if (seen.has(key)) continue;
    faces.push(a, b, c);
    seen.add(key);
  }
  return faces;
}

interface ShadowRanges {
  full: number;
  ranges: { start: number; count: number }[];
}
const prepared = new WeakMap<THREE.BufferGeometry, ShadowRanges>();

/** Street fittings share source geometry between rebuilds. Pack alternate
 * indices once and select by the active sun map's world-space texel width. */
export function bindPropShadow(mesh: THREE.InstancedMesh, maxScale = 1) {
  const geometry = mesh.geometry;
  let lod = prepared.get(geometry);
  if (!lod) {
    const source = geometry.index;
    const packed = source ? Array.from(source.array) : Array.from({ length: geometry.getAttribute('position').count }, (_, i) => i);
    const full = packed.length;
    const ranges = [.12, .3, 1].map(cell => {
      const indices = clusteredShadowIndices(geometry, cell);
      if (!indices.length || indices.length >= full) return { start: 0, count: full };
      const start = packed.length;
      for (const index of indices) packed.push(index);
      return { start, count: indices.length };
    });
    geometry.setIndex(packed);
    geometry.setDrawRange(0, full);
    lod = { full, ranges };
    prepared.set(geometry, lod);
  }
  const { full, ranges } = lod;
  mesh.onBeforeShadow = (renderer, _object, _camera, camera) => {
    if (!(camera instanceof THREE.OrthographicCamera)) return;
    const pixels = renderer.getRenderTarget()?.width;
    if (!pixels) return;
    const texel = (camera.right - camera.left) / (camera.zoom * pixels * maxScale);
    const range = texel >= 3.5 ? ranges[2] : texel >= 1 ? ranges[1] : texel >= .45 ? ranges[0] : null;
    if (range) geometry.setDrawRange(range.start, range.count);
  };
  mesh.onAfterShadow = () => geometry.setDrawRange(0, full);
}
