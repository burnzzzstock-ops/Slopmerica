// Junction mouths without a browser (docs/cars-look/junction.md): loads the road code through Vite's SSR loader
// (the pattern of scripts/vehiclestats.mjs) and measures the DRAWN junction shape against what the cars use.
//
//   dump     the network the traffic model runs on: every node and segment (curve, length, trimA/trimB, heights) and, for
//            every junction, the control points of the curves cars follow (traffic.ts enterJunction: from the lane at the
//            leg's stop line to the lane at the next leg's entry), for the reference block (shots/lookbook/town.json) and
//            a set of synthetic junctions. Printed as a SHA-256 per group: identical hashes on the old and the new code
//            mean nothing the cars use has moved.
//   mouth    for each synthetic junction (class pair x angle, crossing and T): the fillet radius, the asphalt of the drawn
//            junction outside the roads' own strips (square metres), the whole drawn junction's area, and how close the
//            cars' curves come to the drawn kerb (minus a car's half width).
//   marks    where the zebra crossing and the stop bar sit on each leg (metres from the node) against the crossing road's
//            kerb line and the spot a stopped car's nose reaches.
//
// usage: node scripts/junctionmouth.mjs [--json out.json] [--png dir] [--no-block] [--quiet]
//        (run from the checkout to measure; for the old code: git archive a commit into a folder, link node_modules, run there)
import { createServer } from 'vite';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const jsonOut = opt('--json'), pngDir = opt('--png'), quiet = args.includes('--quiet');
const server = await createServer({ root: process.cwd(), server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom', logLevel: 'error' });
const NET = await server.ssrLoadModule('/src/roads/network.ts');
const RJ = await server.ssrLoadModule('/src/roads/roadJunction.ts');
const RT = await server.ssrLoadModule('/src/roads/roadTypes.ts');
const MATH = await server.ssrLoadModule('/src/core/math.ts');
let SEC = null; try { SEC = await server.ssrLoadModule('/src/roads/roadSection.ts'); } catch { /* */ }
const { ROAD_TYPES, laneOffset, carriageHalf } = RT;

const terrain = { h: () => 10, coverAt: () => 0, inBounds: () => true, gradeRoad() {}, forgetRoad() {}, raycast: () => null };
const trees = { cut() {} };
const newNet = () => { const n = new NET.RoadNetwork(terrain, trees); n.map = { id: 'flat' }; return n; };
const r6 = (v) => Math.round(v * 1e6) / 1e6;
const pt = (p) => [r6(p.x), r6(p.z)];
const sha = (o) => createHash('sha256').update(JSON.stringify(o)).digest('hex').slice(0, 16);

// ---- the cars' side: what enterJunction computes (agents/traffic.ts), for every ordered pair of legs and lane pair
function carCurves(net, node) {
  const legs = node.segs.map((id) => net.segs.get(id));
  const out = [];
  const frame = (seg, dir, s, lane) => {
    const arc = dir > 0 ? s : seg.length - s;
    const { i, f } = MATH.locate(seg.samp, MATH.clamp(arc, 0, seg.length));
    const a = seg.samp.pts[i], b = seg.samp.pts[i + 1];
    const tt = MATH.norm(MATH.sub(b, a));
    const t = { x: tt.x * dir, z: tt.z * dir }, r = { x: -t.z, z: t.x };
    const off = laneOffset(ROAD_TYPES[seg.type], lane);
    return { p: { x: MATH.lerp(a.x, b.x, f) + r.x * off, z: MATH.lerp(a.z, b.z, f) + r.z * off }, t };
  };
  for (const S of legs) {
    const dirS = S.b === node.id ? 1 : -1; // the leg is driven towards the node
    if (ROAD_TYPES[S.type].oneWay && false) continue;
    const exitS = S.length - (dirS > 0 ? S.trimB : S.trimA);
    for (const N of legs) {
      if (N === S) continue;
      const dirN = N.a === node.id ? 1 : -1; // and left on
      const entryS = dirN > 0 ? N.trimA : N.trimB;
      for (let lane = 0; lane < ROAD_TYPES[S.type].lanesPerDir; lane++) for (let lane2 = 0; lane2 < ROAD_TYPES[N.type].lanesPerDir; lane2++) {
        const f0 = frame(S, dirS, exitS, lane), f2 = frame(N, dirN, entryS, lane2);
        const d = Math.hypot(f2.p.x - f0.p.x, f2.p.z - f0.p.z), k = d * 0.42;
        const c1 = { x: f0.p.x + f0.t.x * k, z: f0.p.z + f0.t.z * k }, c2 = { x: f2.p.x - f2.t.x * k, z: f2.p.z - f2.t.z * k };
        out.push({ from: S.id, to: N.id, lane, lane2, p0: f0.p, c1, c2, p3: f2.p });
      }
    }
  }
  return out;
}
const bez = (c, u) => { const v = 1 - u, a = v * v * v, b = 3 * v * v * u, d = 3 * v * u * u, e = u * u * u; return { x: a * c.p0.x + b * c.c1.x + d * c.c2.x + e * c.p3.x, z: a * c.p0.z + b * c.c1.z + d * c.c2.z + e * c.p3.z }; };

function dumpNet(net) {
  const nodes = [...net.nodes.values()].sort((a, b) => a.id - b.id);
  const segs = [...net.segs.values()].sort((a, b) => a.id - b.id);
  const nd = nodes.map((n) => [n.id, r6(n.x), r6(n.z), r6(n.y), [...n.segs].sort((a, b) => a - b)]);
  const sg = segs.map((s) => [s.id, s.a, s.b, s.type, [s.curve.p0, s.curve.p1, s.curve.p2, s.curve.p3].map(pt), r6(s.length), r6(s.trimA), r6(s.trimB), s.hs.map(r6)]);
  const jc = [];
  for (const n of nodes) if (n.segs.length >= 2) for (const c of carCurves(net, n)) jc.push([n.id, c.from, c.to, c.lane, c.lane2, pt(c.p0), pt(c.c1), pt(c.c2), pt(c.p3)]);
  return { nodes: nd, segs: sg, curves: jc, hash: { nodes: sha(nd), segs: sha(sg), trims: sha(sg.map((s) => [s[0], s[6], s[7]])), curves: sha(jc) }, counts: { nodes: nd.length, segs: sg.length, curves: jc.length } };
}

// ---- geometry helpers
const areaOf = (P) => { let a = 0; for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; a += p.x * q.z - q.x * p.z; } return a / 2; };
const inPoly = (P, x, z) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const a = P[i], b = P[j]; if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) c = !c; } return c; };
const distSeg = (x, z, a, b) => { const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1, t = MATH.clamp(((x - a.x) * dx + (z - a.z) * dz) / l2, 0, 1); return Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t)); };

/** The drawn asphalt of a node: the corner curb loop of junctionShape, or null when the game falls back to the plain hull. */
function drawn(net, node, opts) {
  const J = RJ.junctionShape(net, node.id, opts);
  if (!J) return null;
  const loop = [];
  for (const c of J.corners) for (const p of c.curb) if (!loop.length || Math.hypot(p.x - loop[loop.length - 1].x, p.z - loop[loop.length - 1].z) > 0.01) loop.push(p);
  while (loop.length > 1 && Math.hypot(loop[0].x - loop[loop.length - 1].x, loop[0].z - loop[loop.length - 1].z) <= 0.01) loop.pop();
  return { J, loop };
}

/** Asphalt of the drawn junction that lies outside every leg's own strip (the flares of the curb returns), and the loop's area. */
function mouthArea(net, node, D) {
  const { J, loop } = D;
  const legs = J.legs.map((L) => ({ u: L.u, r: L.r, e: L.e }));
  // a leg is a strip through the node; a leg straight across from another makes the whole line
  let minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9;
  for (const p of loop) { minx = Math.min(minx, p.x); maxx = Math.max(maxx, p.x); minz = Math.min(minz, p.z); maxz = Math.max(maxz, p.z); }
  const h = 0.1;
  let inLoop = 0, extra = 0;
  for (let x = minx + h / 2; x < maxx; x += h) for (let z = minz + h / 2; z < maxz; z += h) {
    if (!inPoly(loop, x, z)) continue;
    inLoop++;
    const dx = x - node.x, dz = z - node.z;
    let inStrip = false;
    for (const L of legs) { const s = dx * L.u.x + dz * L.u.z, lat = dx * L.r.x + dz * L.r.z; if (s >= 0 && Math.abs(lat) <= L.e) { inStrip = true; break; } }
    if (!inStrip) extra++;
  }
  return { loop: +(inLoop * h * h).toFixed(1), extra: +(extra * h * h).toFixed(1) };
}

/** Kerb polylines as drawn: the corner curbs, plus each leg's straight curb line from its trim out 12 m. */
function kerbs(J, node) {
  const lines = [];
  for (const c of J.corners) if (c.kind !== 'none') lines.push(c.curb);
  for (const L of J.legs) for (const side of [-1, 1]) {
    const a = { x: node.x + L.u.x * L.trim + L.r.x * L.e * side, z: node.z + L.u.z * L.trim + L.r.z * L.e * side };
    const b = { x: a.x + L.u.x * 12, z: a.z + L.u.z * 12 };
    lines.push([a, b]);
  }
  return lines;
}

function clearance(net, node, D) {
  const curves = carCurves(net, node);
  const K = kerbs(D.J, node);
  let worst = { c: 1e9 };
  for (const c of curves) {
    const isStraight = false; void isStraight;
    for (let i = 0; i <= 24; i++) {
      const q = bez(c, i / 24);
      let dmin = 1e9;
      for (const line of K) for (let k = 0; k + 1 < line.length; k++) dmin = Math.min(dmin, distSeg(q.x, q.z, line[k], line[k + 1]));
      // (outside the drawn asphalt counts as negative)
      const inside = inPoly(D.loop, q.x, q.z) || D.J.legs.some((L) => { const dx = q.x - node.x, dz = q.z - node.z; return dx * L.u.x + dz * L.u.z >= L.trim - 1e-6 && Math.abs(dx * L.r.x + dz * L.r.z) <= L.e; });
      const v = inside ? dmin : -dmin;
      if (v < worst.c) worst = { c: v, from: c.from, to: c.to, lane: c.lane, lane2: c.lane2, u: i / 24 };
    }
  }
  return worst;
}

/** Clearance per corner: the closest a car's curve between the corner's two legs comes to that corner's kerb. */
function cornerClearance(net, node, J) {
  const curves = carCurves(net, node);
  return J.corners.map((c) => {
    const Li = J.legs[c.i].seg.id, Lj = J.legs[c.j].seg.id;
    let best = 1e9;
    for (const cv of curves) {
      if (!((cv.from === Li && cv.to === Lj) || (cv.from === Lj && cv.to === Li))) continue;
      for (let i = 0; i <= 24; i++) {
        const q = bez(cv, i / 24);
        for (let k = 0; k + 1 < c.curb.length; k++) best = Math.min(best, distSeg(q.x, q.z, c.curb[k], c.curb[k + 1]));
      }
    }
    return best;
  });
}

/**
 * The paint, leg by leg (roadJunction.ts legMarks, or null on the old code, which had fixed offsets from the ribbon's start):
 * zebra span and stop bar, the nose of a stopped 4.5 m car (the network stops a car's centre 1.5 m short of the leg's trim),
 * and how near a kerb comes to the zebra's rectangle (must stay clear of it).
 */
function markCheck(net, node, D) {
  const out = [];
  for (const L of D.J.legs) {
    const m = L.marks ?? { z0: L.trim + 0.7, z1: L.trim + 3.5, half: carriageHalf(ROAD_TYPES[L.seg.type]) - 0.5, bar: L.trim + 4.45 };
    const nt = L.atA ? L.seg.trimA : L.seg.trimB;
    const nose = nt - 0.75;
    // the zebra's rectangle in world metres, and the kerb polylines (corners only: the legs' own kerbs are clear by construction)
    const at = (s, lat) => ({ x: node.x + L.u.x * s + L.r.x * lat, z: node.z + L.u.z * s + L.r.z * lat });
    const rect = [at(m.z0, -m.half), at(m.z0, m.half), at(m.z1, m.half), at(m.z1, -m.half)];
    let kerb = 1e9;
    for (const c of D.J.corners) for (let k = 0; k + 1 < c.curb.length; k++) {
      const a = c.curb[k], b = c.curb[k + 1];
      if (inPoly(rect, a.x, a.z) || inPoly(rect, b.x, b.z)) { kerb = 0; continue; }
      for (let i = 0; i < 4; i++) kerb = Math.min(kerb, distSeg(rect[i].x, rect[i].z, a, b), distSeg((rect[i].x + rect[(i + 1) % 4].x) / 2, (rect[i].z + rect[(i + 1) % 4].z) / 2, a, b));
    }
    out.push({ leg: L.seg.id, type: L.seg.type, z0: +m.z0.toFixed(2), z1: +m.z1.toFixed(2), bar: +m.bar.toFixed(2), width: +(m.z1 - m.z0).toFixed(2), nose: +nose.toFixed(2), noseSlack: +(nose - m.z1).toFixed(2), kerb: +kerb.toFixed(2), trim: +L.trim.toFixed(2) });
  }
  return out;
}

// ---- synthetic junctions
const line = (net, a, b, type) => {
  const sa = net.snap(a.x, a.z), sb = net.snap(b.x, b.z), c = MATH.lineCubic({ x: sa.x, z: sa.z }, { x: sb.x, z: sb.z });
  const plan = net.plan(sa, c, type);
  if (!plan.ok) throw new Error(`plan refused: ${plan.reason}`);
  return net.build(sa, sb, c, type);
};
function synth(A, B, angDeg, kind) {
  const net = newNet();
  const L = 100, a = (angDeg * Math.PI) / 180;
  line(net, { x: -L, z: 0 }, { x: L, z: 0 }, A);
  if (kind === 'cross') line(net, { x: -L * Math.cos(a), z: -L * Math.sin(a) }, { x: L * Math.cos(a), z: L * Math.sin(a) }, B);
  else line(net, { x: L * Math.cos(a), z: L * Math.sin(a) }, { x: 0, z: 0 }, B);
  const node = [...net.nodes.values()].find((n) => Math.hypot(n.x, n.z) < 1 && n.segs.length >= 3);
  return { net, node };
}

const report = { block: null, synth: [], marks: [], sweep: [] };

// ---- the reference block
if (!args.includes('--no-block')) {
  const save = JSON.parse(readFileSync('shots/lookbook/town.json', 'utf8'));
  const net = newNet();
  net.restore(save.roads);
  const d = dumpNet(net);
  report.block = { counts: d.counts, hash: d.hash };
  // the drawn junctions of the block
  const rows = [];
  for (const n of net.nodes.values()) {
    if (n.segs.length < 3) continue;
    const D = drawn(net, n);
    if (!D) { rows.push({ node: n.id, legs: n.segs.length, types: n.segs.map((id) => net.segs.get(id).type).sort().join(','), drawn: 'hull' }); continue; }
    const m = mouthArea(net, n, D), c = clearance(net, n, D);
    rows.push({ marks: markCheck(net, n, D), cc: cornerClearance(net, n, D.J).map((v) => +v.toFixed(2)), own: D.J.corners.map((c) => (c.clear === undefined ? null : +c.clear.toFixed(2))), phis: D.J.corners.map((c) => Math.round((c.phi * 180) / Math.PI)), node: n.id, legs: n.segs.length, types: n.segs.map((id) => net.segs.get(id).type).sort().join(','), radii: D.J.corners.filter((k) => k.kind === 'fillet').map((k) => +k.radius.toFixed(2)), loop: m.loop, extra: m.extra, clear: +c.c.toFixed(2) });
  }
  report.block.junctions = rows;
  if (pngDir) mkdirSync(pngDir, { recursive: true });
}

// ---- the class x angle matrix
const PAIRS = [['twoLane', 'twoLane'], ['stroad4', 'twoLane'], ['stroad4', 'stroad4'], ['stroad6', 'twoLane'], ['oneWay2', 'twoLane'], ['oneWay1', 'oneWay1'], ['gravel', 'twoLane']];
const EXTRA = (opt('--angles') || '').split(',').filter(Boolean).map(Number);
const CROSS_ANG = [90, 75, 60, ...EXTRA], T_ANG = [90, 75, 60, 105, 120, ...EXTRA, ...EXTRA.map((a) => 180 - a)];
const synthHashes = [];
for (const [A, B] of PAIRS) {
  for (const [kind, angs] of [['cross', CROSS_ANG], ['T', T_ANG]]) for (const ang of angs) {
    let row = { A, B, kind, ang };
    try {
      const { net, node } = synth(A, B, ang, kind);
      if (!node) { row.err = 'no junction node'; report.synth.push(row); continue; }
      const d = dumpNet(net);
      synthHashes.push([A, B, kind, ang, d.hash]);
      const D = drawn(net, node);
      row.legs = node.segs.length;
      if (!D) { row.drawn = 'hull'; report.synth.push(row); continue; }
      const m = mouthArea(net, node, D), c = clearance(net, node, D);
      row.radii = D.J.corners.map((k) => (k.kind === 'fillet' ? +k.radius.toFixed(2) : k.kind === 'straight' ? 's' : '-'));
      row.trims = D.J.legs.map((L) => +L.trim.toFixed(2));
      row.netTrims = node.segs.map((id) => { const s = net.segs.get(id); return +(s.a === node.id ? s.trimA : s.trimB).toFixed(2); });
      row.loop = m.loop; row.extra = m.extra; row.clear = +c.c.toFixed(2); row.worst = c;
      row.marks = markCheck(net, node, D);
      report.synth.push(row);
      if (pngDir && ((A === 'twoLane' && B === 'twoLane' && [90, 60].includes(ang)) || (A === 'stroad4' && B === 'twoLane' && [90, 60].includes(ang)))) plotJunction(pngDir, `${A}-${B}-${kind}-${ang}`, net, node, D);
    } catch (e) { row.err = String(e.message || e); report.synth.push(row); }
  }
}
report.synthHash = sha(synthHashes);

// ---- odd layouts: the game's Freedom Circle (a ring of four quarter arcs and four stubs), close crossings and a shared node
const cases = [];
{
  const arcAt = (c, r, a0) => { const a1 = a0 + Math.PI / 2, k = 0.5523 * r; const p0 = { x: c.x + Math.cos(a0) * r, z: c.z + Math.sin(a0) * r }, p3 = { x: c.x + Math.cos(a1) * r, z: c.z + Math.sin(a1) * r }; return { p0, p1: { x: p0.x - Math.sin(a0) * k, z: p0.z + Math.cos(a0) * k }, p2: { x: p3.x + Math.sin(a1) * k, z: p3.z - Math.cos(a1) * k }, p3 }; };
  for (const [name, R] of [['roundabout R=28 (the game\'s)', 28], ['roundabout R=18', 18]]) {
    const net = newNet(), c = { x: 0, z: 0 };
    for (let k = 0; k < 4; k++) { const cv = arcAt(c, R, (k * Math.PI) / 2); const plan = net.plan(net.snap(cv.p0.x, cv.p0.z), cv, 'twoLane'); if (plan.ok || /Overlaps/.test(plan.reason || '')) net.build(net.snap(cv.p0.x, cv.p0.z), net.snap(cv.p3.x, cv.p3.z), cv, 'twoLane'); }
    for (let k = 0; k < 4; k++) { const a = (k * Math.PI) / 2, p = { x: Math.cos(a) * R, z: Math.sin(a) * R }, q = { x: Math.cos(a) * (R + 46), z: Math.sin(a) * (R + 46) }; try { line(net, p, q, 'twoLane'); } catch (e) { void e; } }
    cases.push({ name, net });
  }
  for (const gap of [40, 26, 18, 14]) {
    const net = newNet();
    line(net, { x: -100, z: 0 }, { x: 100, z: 0 }, 'twoLane'); line(net, { x: -100, z: gap }, { x: 100, z: gap }, 'twoLane');
    try { line(net, { x: 0, z: -100 }, { x: 0, z: 100 + gap }, 'twoLane'); } catch (e) { void e; }
    cases.push({ name: `two crossings ${gap} m apart`, net });
  }
  { // curved roads: two arcs crossing, and an S-bend meeting a straight street
    const net = newNet(), curve = (a, c, b, type) => { const sa = net.snap(a.x, a.z), sb = net.snap(b.x, b.z), cv = MATH.quadCubic({ x: sa.x, z: sa.z }, c, { x: sb.x, z: sb.z }); if (net.plan(sa, cv, type).ok) net.build(sa, sb, cv, type); };
    curve({ x: -100, z: 20 }, { x: 0, z: -30 }, { x: 100, z: 20 }, 'twoLane'); curve({ x: -20, z: -100 }, { x: 40, z: 0 }, { x: -20, z: 100 }, 'twoLane');
    cases.push({ name: 'two curved two-lane roads crossing', net });
    const net2 = newNet(); const c2 = (a, c, b, type) => { const sa = net2.snap(a.x, a.z), sb = net2.snap(b.x, b.z), cv = MATH.quadCubic({ x: sa.x, z: sa.z }, c, { x: sb.x, z: sb.z }); if (net2.plan(sa, cv, type).ok) net2.build(sa, sb, cv, type); };
    c2({ x: -110, z: 0 }, { x: 0, z: 50 }, { x: 110, z: 0 }, 'stroad4'); c2({ x: 0, z: -100 }, { x: 25, z: -40 }, { x: 0, z: 30 }, 'twoLane');
    cases.push({ name: 'curved stroad with a curved side street', net: net2 });
  }
  { // a couplet: two one-way stroads 26 m apart, crossed by a two-lane street
    const net = newNet();
    line(net, { x: -100, z: 0 }, { x: 100, z: 0 }, 'oneWay2'); line(net, { x: 100, z: 26 }, { x: -100, z: 26 }, 'oneWay2');
    try { line(net, { x: 0, z: -100 }, { x: 0, z: 126 }, 'twoLane'); } catch (e) { void e; }
    cases.push({ name: 'one-way couplet 26 m apart x two-lane', net });
  }
}
report.odd = [];
for (const { name, net } of cases) {
  const d = dumpNet(net), rows = [];
  for (const n of net.nodes.values()) {
    if (n.segs.length < 3) continue;
    const D = drawn(net, n);
    if (!D) { rows.push({ node: n.id, legs: n.segs.length, drawn: 'hull' }); continue; }
    const m = mouthArea(net, n, D), c = clearance(net, n, D);
    rows.push({ node: n.id, legs: n.segs.length, radii: D.J.corners.map((k) => (k.kind === 'fillet' ? +k.radius.toFixed(2) : k.kind === 's')), loop: m.loop, outside: m.extra, clear: +c.c.toFixed(2), marks: markCheck(net, n, D).map((k) => k.kerb) });
  }
  report.odd.push({ name, hash: d.hash.trims, rows });
}

// ---- radius sweep: request one radius at every corner (the clamps may shrink it) and see how close the cars come
if (args.includes('--sweep')) {
  for (const [A, B] of [['twoLane', 'twoLane'], ['stroad4', 'twoLane'], ['oneWay1', 'oneWay1']]) for (const ang of [60, 75, 90, 105, 120]) {
    const { net, node } = synth(A, B, ang, 'cross');
    for (const r of [1.5, 2, 2.5, 3, 3.5, 4, 5]) {
      const D = drawn(net, node, { radius: () => r });
      if (!D) continue;
      const cc = cornerClearance(net, node, D.J);
      const rows = D.J.corners.map((c, k) => ({ phi: +(c.phi * 180 / Math.PI).toFixed(0), r: c.kind === 'fillet' ? +c.radius.toFixed(2) : 0, clear: +cc[k].toFixed(2) }));
      report.sweep.push({ A, B, ang, want: r, rows });
    }
  }
  console.log('radius sweep (cross): A/B ang want -> per corner [phi r clearance]');
  for (const w of report.sweep) console.log(`${w.A}/${w.B}`.padEnd(18), String(w.ang).padStart(3), String(w.want).padStart(4), w.rows.map((x) => `${x.phi}:${x.r}:${x.clear}`).join('  '));
}

// ---- a tiny plan-view rasteriser (PNG via zlib) so a junction can be looked at without a browser
function plotJunction(dir, name, net, node, D) {
  const S = 14, R = 30, N = Math.round(2 * R * S); // 14 px per metre, 60 m square
  const px = new Uint8Array(N * N * 3).fill(58);
  const set = (i, j, c) => { if (i < 0 || j < 0 || i >= N || j >= N) return; const o = (j * N + i) * 3; px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; };
  const W = (x, z) => [Math.round((x - node.x + R) * S), Math.round((z - node.z + R) * S)];
  // asphalt: the loop, plus each leg's strip beyond its trim
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = node.x - R + (i + 0.5) / S, z = node.z - R + (j + 0.5) / S;
    let asph = inPoly(D.loop, x, z);
    for (const L of D.J.legs) { const dx = x - node.x, dz = z - node.z; if (dx * L.u.x + dz * L.u.z >= L.trim && Math.abs(dx * L.r.x + dz * L.r.z) <= L.e) asph = true; }
    if (asph) set(i, j, [104, 104, 108]);
    else {
      // walk (within the road's outer edge) in pale concrete
      for (const L of D.J.legs) { const dx = x - node.x, dz = z - node.z; if (dx * L.u.x + dz * L.u.z >= L.trim && Math.abs(dx * L.r.x + dz * L.r.z) <= L.h) set(i, j, [150, 148, 140]); }
    }
  }
  const stroke = (a, b, c, w = 1) => { const [x0, y0] = W(a.x, a.z), [x1, y1] = W(b.x, b.z); const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0))); for (let k = 0; k <= n; k++) { const x = Math.round(x0 + ((x1 - x0) * k) / n), y = Math.round(y0 + ((y1 - y0) * k) / n); for (let dx = -w + 1; dx < w; dx++) for (let dy = -w + 1; dy < w; dy++) set(x + dx, y + dy, c); } };
  for (const line of kerbs(D.J, node)) for (let k = 0; k + 1 < line.length; k++) stroke(line[k], line[k + 1], [240, 240, 240], 1);
  for (const c of carCurves(net, node)) { let prev = bez(c, 0); for (let i = 1; i <= 30; i++) { const q = bez(c, i / 30); stroke(prev, q, c.lane === 0 && c.lane2 === 0 ? [255, 190, 40] : [255, 120, 40], 1); prev = q; } }
  for (const L of D.J.legs) { stroke({ x: node.x + L.u.x * 2, z: node.z + L.u.z * 2 }, { x: node.x + L.u.x * R, z: node.z + L.u.z * R }, [70, 130, 220], 1); }
  // the paint: zebra rectangle (white), stop bar (thick white), the nose of a stopped 4.5 m car (green)
  for (const L of D.J.legs) {
    const m = L.marks ?? { z0: L.trim + 0.7, z1: L.trim + 3.5, half: carriageHalf(ROAD_TYPES[L.seg.type]) - 0.5, bar: L.trim + 4.45 };
    const P = (s2, lat) => ({ x: node.x + L.u.x * s2 + L.r.x * lat, z: node.z + L.u.z * s2 + L.r.z * lat });
    const q = [P(m.z0, -m.half), P(m.z0, m.half), P(m.z1, m.half), P(m.z1, -m.half)];
    for (let i = 0; i < 4; i++) stroke(q[i], q[(i + 1) % 4], [255, 255, 255], 1);
    stroke(P(m.bar, -0.2), P(m.bar, -(carriageHalf(ROAD_TYPES[L.seg.type]) - 0.2)), [255, 255, 255], 2);
    const nt = L.atA ? L.seg.trimA : L.seg.trimB;
    for (const lat of [-1.75, 1.75]) stroke(P(nt - 0.75, lat), P(nt - 0.75 + 0.01, lat), [60, 255, 60], 3);
  }
  stroke({ x: node.x - 0.5, z: node.z }, { x: node.x + 0.5, z: node.z }, [255, 0, 0], 2);
  // PNG
  const raw = Buffer.alloc((N * 3 + 1) * N);
  for (let j = 0; j < N; j++) { raw[j * (N * 3 + 1)] = 0; Buffer.from(px.buffer, j * N * 3, N * 3).copy(raw, j * (N * 3 + 1) + 1); }
  const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (buf) => { let c = -1; for (const b of buf) c = crcT[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td)); return Buffer.concat([len, td, cr]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 2;
  writeFileSync(join(dir, `${name}.png`), Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

if (!quiet) {
  console.log('reference block network hash', JSON.stringify(report.block?.hash), JSON.stringify(report.block?.counts));
  console.log('synthetic junctions network hash', report.synthHash);
  const mk = (rows) => { const all = rows.flatMap((r) => r.marks ?? []); return all.length ? { legs: all.length, zebraW: [Math.min(...all.map((m) => m.width)), Math.max(...all.map((m) => m.width))], noseInsideZebra: all.filter((m) => m.noseSlack < 0).length, worstNoseSlack: Math.min(...all.map((m) => m.noseSlack)), kerbInZebra: all.filter((m) => m.kerb < 0.15).length, minKerb: Math.min(...all.map((m) => m.kerb)), barToNose: [Math.min(...all.map((m) => +(m.nose - m.bar).toFixed(2))), Math.max(...all.map((m) => +(m.nose - m.bar).toFixed(2)))] } : null; };
  console.log('paint, synthetic:', JSON.stringify(mk(report.synth)));
  if (report.block) console.log('paint, block:', JSON.stringify(mk(report.block.junctions)));
  console.log('A/B kind ang | radii | trims (drawn) | trims (net) | junction m2 | outside strips m2 | car-curve clearance to kerb (m)');
  for (const r of report.synth) console.log(`${r.A}/${r.B}`.padEnd(18), r.kind.padEnd(5), String(r.ang).padStart(3), '|', r.err ? r.err : r.drawn ? 'hull' : `${JSON.stringify(r.radii)} | ${JSON.stringify(r.trims)} | ${JSON.stringify(r.netTrims)} | ${r.loop} | ${r.extra} | ${r.clear}`);
  if (report.block) {
    console.log('reference block junctions:');
    for (const r of report.block.junctions) console.log(' ', r.node, r.legs, r.types.padEnd(38), r.drawn ? 'hull' : `radii ${JSON.stringify(r.radii)} loop ${r.loop} outside ${r.extra} clear ${r.clear}`);
  }
}
if (!quiet) {
  console.log('odd layouts (roundabout, close crossings, couplet): junction nodes as drawn');
  for (const o of report.odd) {
    console.log(' ', o.name, 'network trims', o.hash);
    for (const r of o.rows) console.log('     node', r.node, r.legs, 'legs', r.drawn ? 'hull' : `radii ${JSON.stringify(r.radii)} loop ${r.loop} outside ${r.outside} clear ${r.clear} kerb-to-zebra ${JSON.stringify(r.marks)}`);
  }
}
// ---- verdicts
let failed = 0;
const cmp = opt('--compare');
if (cmp) {
  const ref = JSON.parse(readFileSync(cmp, 'utf8'));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const checks = [
    ['reference block: nodes, segments, trims, junction curves identical to the reference run', same(ref.block?.hash, report.block?.hash)],
    ['synthetic junctions (class pair x angle): network identical', ref.synthHash === report.synthHash],
    ['roundabout, close crossings, couplet: trims identical', same(ref.odd?.map((o) => o.hash), report.odd.map((o) => o.hash))],
  ];
  for (const [label, ok] of checks) { console.log(ok ? 'OK  ' : 'FAIL', label); if (!ok) failed++; }
}
const minClear = opt('--min-clear');
if (minClear) {
  const bad = [];
  for (const j of report.block?.junctions ?? []) (j.cc ?? []).forEach((v, i) => { if (j.own?.[i] != null && v < +minClear) bad.push(`block node ${j.node} corner ${i}: ${v}`); });
  const ok = bad.length === 0;
  console.log(ok ? 'OK  ' : 'FAIL', `every drawn kerb return in the reference block leaves the cars' turning curves at least ${minClear} m of asphalt`, ok ? '' : bad.join('; '));
  if (!ok) failed++;
}
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(report, null, 1));
await server.close();
process.exitCode = failed ? 1 : 0;
