/** Ambient visibility where two surfaces meet in an inward corner.
 * Outward corners and coplanar tile seams remain fully exposed. */
export function contactAO(positions: number[], normals: number[], indices?: number[], enabled?: boolean[]) {
  const incident = new Map<string, number[]>();
  const centers: number[] = [];
  const count = indices?.length ?? positions.length / 3;
  const key = (i: number) => [positions[i], positions[i + 1], positions[i + 2]].map(v => Math.round(v * 1000)).join(',');
  const vertex = (i: number) => (indices ? indices[i] : i) * 3;
  for (let triangle = 0; triangle < count; triangle += 3) {
    const a = vertex(triangle), b = vertex(triangle + 1), c = vertex(triangle + 2);
    const centerIndex = centers.length;
    for (let axis = 0; axis < 3; axis++) centers.push((positions[a + axis] + positions[b + axis] + positions[c + axis]) / 3);
    for (const i of [a, b, c]) {
      const at = key(i);
      let faces = incident.get(at);
      if (!faces) incident.set(at, faces = []);
      faces.push(centerIndex);
    }
  }
  const result = new Float32Array(positions.length / 3).fill(1);
  for (let i = 0; i < positions.length; i += 3) {
    if (enabled && !enabled[i / 3]) continue;
    let occlusion = 0;
    for (const center of incident.get(key(i)) ?? []) {
      const x = centers[center] - positions[i], y = centers[center + 1] - positions[i + 1], z = centers[center + 2] - positions[i + 2];
      const length = Math.hypot(x, y, z);
      if (length < 1e-5) continue;
      // The other face lies in this vertex's outward hemisphere only at
      // a concave join. A face's own centroid lies in its tangent plane.
      const facing = (x * normals[i] + y * normals[i + 1] + z * normals[i + 2]) / length;
      occlusion = Math.max(occlusion, facing);
    }
    const shade = 1 - 0.24 * Math.min(1, Math.max(0, occlusion - 0.03));
    result[i / 3] = shade;
  }
  return result;
}
