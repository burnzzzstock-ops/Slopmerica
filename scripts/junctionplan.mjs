// A plan view of the DRAWN junction, rasterised from the real road meshes (no browser, no GPU): every triangle of the road
// ribbons, the junction asphalt, the corner slabs and banks, the zebra strip and the instanced crosswalk lines is painted top
// down into a PNG, with the sim's stop-line noses (green) and the street lamps (yellow) on top. For looking at a change to the
// corners or the paint on old and new code side by side, in seconds.
//
// usage: node scripts/junctionplan.mjs --out dir [--nodes 49,42,45] [--synth twoLane,twoLane,90,cross ...] [--size 56]
//   --nodes   nodes of the reference block (default 49 68 42 45)
//   --synth   A,B,angle,kind  a synthetic junction on flat ground: A runs through, B crosses it (kind cross) or ends on it (T)
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { join } from 'node:path';
import { makeRig } from './lib/roadrig.mjs';

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const optAll = (k) => args.flatMap((a, i) => (a === k ? [args[i + 1]] : []));
const outDir = opt('--out') || 'shots/junction-plan';
const SIZE = +(opt('--size') || 56), PPM = 16;
mkdirSync(outDir, { recursive: true });
const rig = await makeRig();
const { THREE, NET, MESH, MATH, ROAD_TYPES, net: blockNet, rr: blockRr } = rig;

function png(N, px, file) {
  const raw = Buffer.alloc((N * 3 + 1) * N);
  for (let j = 0; j < N; j++) { raw[j * (N * 3 + 1)] = 0; Buffer.from(px.buffer, j * N * 3, N * 3).copy(raw, j * (N * 3 + 1) + 1); }
  const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (buf) => { let c = -1; for (const b of buf) c = crcT[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td)); return Buffer.concat([len, td, cr]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 2;
  writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

function plan(net, rr, node, name) {
  const N = SIZE * PPM, px = new Uint8Array(N * N * 3).fill(48);
  const wx = (x) => (x - node.x + SIZE / 2) * PPM, wz = (z) => (z - node.z + SIZE / 2) * PPM;
  const put = (i, j, c) => { if (i < 0 || j < 0 || i >= N || j >= N) return; const o = (j * N + i) * 3; px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; };
  // one triangle, painted by a colour function of its barycentric weights
  const tri = (a, b, c, colour) => {
    const ax = wx(a.x), ay = wz(a.z), bx = wx(b.x), by = wz(b.z), cx = wx(c.x), cy = wz(c.z);
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(N - 1, Math.ceil(Math.max(ax, bx, cx)));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(N - 1, Math.ceil(Math.max(ay, by, cy)));
    const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(d) < 1e-9) return;
    for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) {
      const l1 = ((by - cy) * (i + 0.5 - cx) + (cx - bx) * (j + 0.5 - cy)) / d, l2 = ((cy - ay) * (i + 0.5 - cx) + (ax - cx) * (j + 0.5 - cy)) / d, l3 = 1 - l1 - l2;
      if (l1 < -1e-4 || l2 < -1e-4 || l3 < -1e-4) continue;
      const col = colour(l1, l2, l3);
      if (col) put(i, j, col);
    }
  };
  const each = (mesh, fn) => {
    const P = mesh.geometry.getAttribute('position'), I = mesh.geometry.index, UV = mesh.geometry.getAttribute('uv'), COL = mesh.geometry.getAttribute('color'), NOR = mesh.geometry.getAttribute('normal');
    if (!P || !I) return;
    for (let k = 0; k + 2 < I.count; k += 3) {
      const ids = [I.getX(k), I.getX(k + 1), I.getX(k + 2)];
      const v = ids.map((q) => ({ x: P.getX(q), z: P.getZ(q), y: P.getY(q), u: UV ? UV.getX(q) : 0, w: UV ? UV.getY(q) : 0, c: COL ? [COL.getX(q), COL.getY(q), COL.getZ(q)] : [1, 1, 1], ny: NOR ? NOR.getY(q) : 1 }));
      if (Math.max(v[0].x, v[1].x, v[2].x) < node.x - SIZE / 2 || Math.min(v[0].x, v[1].x, v[2].x) > node.x + SIZE / 2 || Math.max(v[0].z, v[1].z, v[2].z) < node.z - SIZE / 2 || Math.min(v[0].z, v[1].z, v[2].z) > node.z + SIZE / 2) continue;
      fn(v);
    }
  };
  // banks and concrete tops first, then the ribbons, the junction asphalt, the zebra
  each(rr.concMesh, (v) => { if (v[0].ny + v[1].ny + v[2].ny < 1.5) return; tri(v[0], v[1], v[2], (a, b, c) => { const r = a * v[0].c[0] + b * v[1].c[0] + c * v[2].c[0], g = a * v[0].c[1] + b * v[1].c[1] + c * v[2].c[1], bl = a * v[0].c[2] + b * v[1].c[2] + c * v[2].c[2]; return [Math.min(255, 255 * Math.sqrt(r) * 0.9), Math.min(255, 255 * Math.sqrt(g) * 0.9), Math.min(255, 255 * Math.sqrt(bl) * 0.9)]; }); });
  for (const [id, mesh] of rr.typeMeshes) {
    const t = ROAD_TYPES[id], hw = t.width / 2, ch = MATH_ch(t);
    each(mesh, (v) => tri(v[0], v[1], v[2], (a, b, c) => {
      const u = a * v[0].u + b * v[1].u + c * v[2].u, off = (u * 2 - 1) * hw;
      if (Math.abs(off) > ch + 0.3) return [176, 174, 166];
      if (Math.abs(off) > ch) return [150, 148, 142];
      if (t.sidewalk > 0 && Math.abs(off) < 0.2 && !t.oneWay && !t.median) return [225, 190, 60];
      return [88, 88, 94];
    }));
  }
  each(rr.junctionMesh, (v) => tri(v[0], v[1], v[2], () => [84, 84, 90]));
  each(rr.crosswalkMesh, (v) => tri(v[0], v[1], v[2], (a, b, c) => { const u = a * v[0].u + b * v[1].u + c * v[2].u, f = u - Math.floor(u); return f >= 6 / 64 && f < 40 / 64 ? [236, 236, 228] : [84, 84, 90]; }));
  // instanced crosswalk lines, stop bars (white boxes 1 x 0.34 m before scaling) and stop signs
  for (const o of rr.details.group.children) {
    if (!o.isInstancedMesh) continue;
    const g = o.geometry.parameters;
    const isBox = g && g.width === 1 && g.depth === 0.34, isSign = g && g.radiusTop === 0.42;
    if (!isBox && !isSign) continue;
    const m = new THREE.Matrix4(), p = new THREE.Vector3();
    for (let i = 0; i < o.count; i++) {
      o.getMatrixAt(i, m);
      p.setFromMatrixPosition(m);
      if (Math.abs(p.x - node.x) > SIZE / 2 || Math.abs(p.z - node.z) > SIZE / 2) continue;
      const e = m.elements;
      if (isSign) { for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) if (di * di + dj * dj <= 10) put(Math.round(wx(p.x)) + di, Math.round(wz(p.z)) + dj, [210, 40, 40]); continue; }
      // the box's local x and z axes in the ground plane
      const ax = e[0], az = e[2], bx = e[8], bz = e[10], hx = 0.5, hz = 0.17;
      const c1 = { x: p.x - ax * hx - bx * hz, z: p.z - az * hx - bz * hz }, c2 = { x: p.x + ax * hx - bx * hz, z: p.z + az * hx - bz * hz }, c3 = { x: p.x + ax * hx + bx * hz, z: p.z + az * hx + bz * hz }, c4 = { x: p.x - ax * hx + bx * hz, z: p.z - az * hx + bz * hz };
      tri(c1, c2, c3, () => [250, 250, 245]); tri(c1, c3, c4, () => [250, 250, 245]);
    }
  }
  for (const L of rr.lampSpots) if (Math.abs(L.x - node.x) < SIZE / 2 && Math.abs(L.z - node.z) < SIZE / 2) for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) put(Math.round(wx(L.x)) + di, Math.round(wz(L.z)) + dj, [255, 200, 40]);
  // the sim's noses: a car waiting at the line holds its nose STOP_LINE (3 m) behind the leg's trim (traffic.ts; a car's position is its nose)
  for (const id of node.segs) {
    const s = net.segs.get(id), atA = s.a === node.id, trim = atA ? s.trimA : s.trimB;
    const F = MESH.RoadRenderer.frame(s, MATH.clamp(atA ? trim + 3 : s.length - trim - 3, 0, s.length));
    const t = { x: atA ? -F.t.x : F.t.x, z: atA ? -F.t.z : F.t.z }, r = { x: -t.z, z: t.x }, lane = net.type ? 0 : 0;
    void lane;
    const off = ROAD_TYPES[s.type].lanesPerDir === 1 ? 1.75 : 1.75 + 3.5 * (ROAD_TYPES[s.type].lanesPerDir - 1) + (ROAD_TYPES[s.type].centerTurn ? 1.75 : 0) * 0;
    for (const o2 of [off]) for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) if (di * di + dj * dj <= 9) put(Math.round(wx(F.p.x + r.x * o2)) + di, Math.round(wz(F.p.z + r.z * o2)) + dj, [60, 255, 90]);
  }
  put(Math.round(wx(node.x)), Math.round(wz(node.z)), [255, 0, 0]);
  png(N, px, join(outDir, `${name}.png`));
  console.log('wrote', join(outDir, `${name}.png`));
}
function MATH_ch(t) { return t.oneWay ? (t.lanesPerDir * t.laneW) / 2 : t.lanesPerDir * t.laneW + (t.centerTurn ? t.laneW / 2 : 0) + t.median / 2; }

const nodesArg = (opt('--nodes') ?? (optAll('--synth').length ? '' : '49,68,42,45')).split(',').filter(Boolean).map(Number);
for (const id of nodesArg) { const n = blockNet.nodes.get(id); if (n) plan(blockNet, blockRr, n, `block-node-${id}`); }
for (const spec of optAll('--synth')) {
  const [A, B, ang, kind] = spec.split(',');
  const net = new NET.RoadNetwork(blockNet.terrain, { cut() {} });
  net.map = { id: 'flat' };
  const line = (a, b, type) => { const sa = net.snap(a.x, a.z), sb = net.snap(b.x, b.z); net.build(sa, sb, MATH.lineCubic({ x: sa.x, z: sa.z }, { x: sb.x, z: sb.z }), type); };
  const L = 100, a = (+ang * Math.PI) / 180;
  line({ x: -L, z: 0 }, { x: L, z: 0 }, A);
  if (kind === 'cross') line({ x: -L * Math.cos(a), z: -L * Math.sin(a) }, { x: L * Math.cos(a), z: L * Math.sin(a) }, B);
  else line({ x: L * Math.cos(a), z: L * Math.sin(a) }, { x: 0, z: 0 }, B);
  const rr = new MESH.RoadRenderer(net, { capabilities: { getMaxAnisotropy: () => 4 } });
  rr.update();
  const node = [...net.nodes.values()].find((n) => Math.hypot(n.x, n.z) < 1 && n.segs.length >= 3);
  if (node) plan(net, rr, node, `synth-${A}-${B}-${kind}-${ang}`);
}
await rig.server.close();
