import * as THREE from 'three';
import { T, tileNames, type Tile } from '../art';
import { withVisualRandom } from './visualRandom';
export { withVisualRandom as withBuildingLodRandom } from './visualRandom';

/** Renderer telemetry measures proxy preparation, including its buffer upload. */
export function timeBuildingLod(build: () => void): number {
  const started = performance.now();
  withVisualRandom(build);
  return performance.now() - started;
}

let tiles: Tile[] | undefined;
const tileCache = new Map<string, string>();
type Point2 = [number, number];
const signedArea = (a: Point2, b: Point2, c: Point2) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
/** Area equality cannot distinguish a hole from an equal-area overlap. */
function overlap(a: Point2[], b: Point2[]) {
  const bounds = (p: Point2[]) => [Math.min(...p.map(v => v[0])), Math.max(...p.map(v => v[0])), Math.min(...p.map(v => v[1])), Math.max(...p.map(v => v[1]))];
  const ba = bounds(a), bb = bounds(b);
  if (Math.min(ba[1], bb[1]) - Math.max(ba[0], bb[0]) <= 1e-6 || Math.min(ba[3], bb[3]) - Math.max(ba[2], bb[2]) <= 1e-6) return 0;
  let polygon = a;
  const sign = Math.sign(signedArea(b[0], b[1], b[2]));
  for (let edge = 0; edge < 3 && polygon.length; edge++) {
    const first = b[edge], second = b[(edge + 1) % 3], clipped: Point2[] = [];
    for (let i = 0; i < polygon.length; i++) {
      const p = polygon[i], q = polygon[(i + 1) % polygon.length];
      const dp = signedArea(first, second, p) * sign, dq = signedArea(first, second, q) * sign;
      if (dp >= 0) clipped.push(p);
      if ((dp >= 0) !== (dq >= 0)) { const t = dp / (dp - dq); clipped.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]); }
    }
    polygon = clipped;
  }
  let area = 0;
  for (let i = 1; i + 1 < polygon.length; i++) area += Math.abs(signedArea(polygon[0], polygon[i], polygon[i + 1])) * 0.5;
  return area;
}
function tileAt(u: number, v: number) {
  const key = `${Math.floor(u * 4096)},${Math.floor(v * 4096)}`;
  const hit = tileCache.get(key);
  if (hit) return hit;
  tiles ??= tileNames().map(T);
  const tile = tiles.find(t => u >= t.u0 - 1e-6 && u <= t.u1 + 1e-6 && v >= t.v0 - 1e-6 && v <= t.v1 + 1e-6)?.name ?? key;
  tileCache.set(key, tile);
  return tile;
}

/** A shadow silhouette: rectangular coplanar runs become one quad.
 * Nonrectangular roofs, chamfers, gaps and Kit's texture-array format stay
 * verbatim. Its stretched atlas UVs must never enter the visible scene. */
export function buildingSilhouette(source: THREE.BufferGeometry): THREE.BufferGeometry | null {
  if (source.index || source.hasAttribute('tile')) return null;
  const p = source.getAttribute('position'), n = source.getAttribute('normal'), uv = source.getAttribute('uv');
  if (!uv || !n) return null;
  type Face = { ids: number[]; axis: number; u: number; v: number; sign: number; area: number; lo: number[]; hi: number[]; uvLo: number[]; uvHi: number[] };
  const groups = new Map<string, Face>(), rest: number[] = [];
  for (let i = 0; i < p.count; i += 3) {
    const normal = [n.getX(i), n.getY(i), n.getZ(i)];
    const axis = normal.findIndex(v => Math.abs(v) > 0.9999);
    if (axis < 0) { rest.push(i, i + 1, i + 2); continue; }
    if ([i + 1, i + 2].some(j => Math.abs(p.getComponent(j, axis) - p.getComponent(i, axis)) > 0.001 || [0, 1, 2].some(k => Math.abs(n.getComponent(j, k) - normal[k]) > 0.0001))) { rest.push(i, i + 1, i + 2); continue; }
    const u = axis === 0 ? 2 : 0, v = axis === 1 ? 2 : 1, sign = Math.sign(normal[axis]);
    const tile = tileAt((uv.getX(i) + uv.getX(i + 1) + uv.getX(i + 2)) / 3, (uv.getY(i) + uv.getY(i + 1) + uv.getY(i + 2)) / 3);
    const key = `${axis}/${sign}/${Math.round(p.getComponent(i, axis) * 1000)}/${tile}`;
    let face = groups.get(key);
    if (!face) { face = { ids: [], axis, u, v, sign, area: 0, lo: [Infinity, Infinity], hi: [-Infinity, -Infinity], uvLo: [Infinity, Infinity], uvHi: [-Infinity, -Infinity] }; groups.set(key, face); }
    const x0 = p.getComponent(i, u), y0 = p.getComponent(i, v), x1 = p.getComponent(i + 1, u), y1 = p.getComponent(i + 1, v), x2 = p.getComponent(i + 2, u), y2 = p.getComponent(i + 2, v);
    face.area += Math.abs((x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)) * 0.5;
    face.lo[0] = Math.min(face.lo[0], x0, x1, x2); face.lo[1] = Math.min(face.lo[1], y0, y1, y2);
    face.hi[0] = Math.max(face.hi[0], x0, x1, x2); face.hi[1] = Math.max(face.hi[1], y0, y1, y2);
    face.ids.push(i, i + 1, i + 2);
    for (let j = i; j < i + 3; j++) for (let k = 0; k < 2; k++) { const value = uv.getComponent(j, k); face.uvLo[k] = Math.min(face.uvLo[k], value); face.uvHi[k] = Math.max(face.uvHi[k], value); }
  }
  const output: Record<string, number[]> = Object.fromEntries(Object.keys(source.attributes).map(k => [k, []]));
  const copy = (i: number) => { for (const [key, attr] of Object.entries(source.attributes)) for (let k = 0; k < attr.itemSize; k++) output[key].push(attr.getComponent(i, k)); };
  for (const i of rest) copy(i);
  for (const f of groups.values()) {
    const area = (f.hi[0] - f.lo[0]) * (f.hi[1] - f.lo[1]);
    if (f.ids.length <= 6 || Math.abs(area - f.area) > Math.max(0.001, area * 0.0001)) { for (const i of f.ids) copy(i); continue; }
    const corners = [[f.lo[0], f.lo[1]], [f.hi[0], f.lo[1]], [f.hi[0], f.hi[1]], [f.lo[0], f.hi[1]]];
    const chosen = corners.map(([x, y]) => f.ids.reduce((best, i) => {
      const d = (j: number) => (p.getComponent(j, f.u) - x) ** 2 + (p.getComponent(j, f.v) - y) ** 2;
      return d(i) < d(best) ? i : best;
    }, f.ids[0]));
    // Only a real rectangular boundary may collapse. Separate coplanar wings
    // or overlapping trim must not fill a gap in the building's silhouette.
    if (chosen.some((i, c) => Math.abs(p.getComponent(i, f.u) - corners[c][0]) > 0.001 || Math.abs(p.getComponent(i, f.v) - corners[c][1]) > 0.001)) { for (const i of f.ids) copy(i); continue; }
    const triangles: Point2[][] = [];
    for (let i = 0; i < f.ids.length; i += 3) triangles.push(f.ids.slice(i, i + 3).map(j => [p.getComponent(j, f.u), p.getComponent(j, f.v)]));
    // Equal total area, no overlap and all vertices within these bounds prove
    // the rectangle has no holes. Bound the uncommon large-face analysis.
    if (triangles.length > 80 || triangles.some((a, i) => triangles.slice(i + 1).some(b => overlap(a, b) > Math.max(1e-5, area * 1e-7)))) { for (const i of f.ids) copy(i); continue; }
    const winding = (f.axis === 2 ? 1 : -1) * f.sign;
    const [a, b, c] = f.ids;
    const dx1 = p.getComponent(b, f.u) - p.getComponent(a, f.u), dy1 = p.getComponent(b, f.v) - p.getComponent(a, f.v);
    const dx2 = p.getComponent(c, f.u) - p.getComponent(a, f.u), dy2 = p.getComponent(c, f.v) - p.getComponent(a, f.v), det = dx1 * dy2 - dx2 * dy1;
    const gradients = [0, 1].map(k => { const d1 = uv.getComponent(b, k) - uv.getComponent(a, k), d2 = uv.getComponent(c, k) - uv.getComponent(a, k); return [(d1 * dy2 - d2 * dy1) / det, (dx1 * d2 - dx2 * d1) / det]; });
    for (const corner of winding > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]) {
      copy(chosen[corner]);
      for (let k = 0; k < 2; k++) {
        const slope = gradients[k], axis = Math.abs(slope[0]) >= Math.abs(slope[1]) ? 0 : 1;
        let fraction = (corners[corner][axis] - f.lo[axis]) / (f.hi[axis] - f.lo[axis]);
        if (slope[axis] < 0) fraction = 1 - fraction;
        output.uv[output.uv.length - 2 + k] = f.uvLo[k] + fraction * (f.uvHi[k] - f.uvLo[k]);
      }
    }
  }
  if (output.position.length >= p.count * 3 * 0.85) return null;
  const geometry = new THREE.BufferGeometry();
  for (const [name, values] of Object.entries(output)) geometry.setAttribute(name, new THREE.Float32BufferAttribute(values, source.getAttribute(name).itemSize));
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}

/** Strip disconnected sub-pixel furnishings while retaining the exact wall,
 * roof and atlas vertices. Connected components preserve stepped silhouettes
 * and rooflines without inventing a replacement texture or material. */
export function buildingLod(source: THREE.BufferGeometry): THREE.BufferGeometry | null {
  const position = source.getAttribute('position'), count = source.index?.count ?? position.count;
  if (count < 240) return null;
  const parent = new Int32Array(position.count);
  for (let i = 0; i < parent.length; i++) parent[i] = i;
  const find = (n: number): number => {
    let root = n;
    while (parent[root] !== root) root = parent[root];
    while (parent[n] !== n) { const next = parent[n]; parent[n] = root; n = next; }
    return root;
  };
  const join = (a: number, b: number) => { parent[find(a)] = find(b); };
  const index = (i: number) => source.index ? source.index.getX(i) : i;
  const points = new Map<string, number>();
  for (let i = 0; i < position.count; i++) {
    const key = [position.getX(i), position.getY(i), position.getZ(i)].map(v => Math.round(v * 1000)).join(',');
    const previous = points.get(key);
    if (previous === undefined) points.set(key, i); else join(i, previous);
  }
  for (let i = 0; i < count; i += 3) { join(index(i), index(i + 1)); join(index(i), index(i + 2)); }
  const bounds = new Map<number, THREE.Box3>();
  const point = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    const root = find(i);
    let box = bounds.get(root);
    if (!box) { box = new THREE.Box3(); bounds.set(root, box); }
    box.expandByPoint(point.fromBufferAttribute(position, i));
  }
  const keep = new Set<number>(), size = new THREE.Vector3();
  let largest = -1, largestArea = -1;
  for (const [root, box] of bounds) {
    box.getSize(size);
    const area = Math.max(size.x * size.y, size.x * size.z, size.y * size.z);
    if (area > largestArea) { largest = root; largestArea = area; }
    if (area >= 20) keep.add(root);
  }
  keep.add(largest);
  const indices: number[] = [];
  for (let i = 0; i < count; i += 3) if (keep.has(find(index(i)))) indices.push(index(i), index(i + 1), index(i + 2));
  if (indices.length > count * 0.85 || indices.length === 0) return null;
  // Preserve every attribute, including Kit's tile/night values and vertex AO.
  const geometry = new THREE.BufferGeometry();
  const remap = new Map<number, number>(), vertices: number[] = [], faces: number[] = [];
  for (const i of indices) {
    let vertex = remap.get(i);
    if (vertex === undefined) { vertex = vertices.length; remap.set(i, vertex); vertices.push(i); }
    faces.push(vertex);
  }
  for (const [name, attr] of Object.entries(source.attributes)) {
    const values = new Float32Array(vertices.length * attr.itemSize);
    for (let i = 0; i < vertices.length; i++) for (let k = 0; k < attr.itemSize; k++) values[i * attr.itemSize + k] = attr.getComponent(vertices[i], k);
    geometry.setAttribute(name, new THREE.BufferAttribute(values, attr.itemSize));
  }
  if (source.index) geometry.setIndex(faces);
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}
