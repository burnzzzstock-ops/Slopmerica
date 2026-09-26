// Turns the road network into meshes: textured ribbons per road type, junction
// polygons, concrete skirts / bridge decks / barriers / pillars, and street lights.
import * as THREE from 'three';
import { clamp, convexHull, lerp, locate, norm, sub, V2 } from '../core/math';
import { carriageHalf, ROAD_TYPES, RoadType, RoadTypeId, ROAD_ORDER } from './roadTypes';
import type { RNode, RoadNetwork, RSeg } from './network';
import { StreetDetails } from './streetDetails';
import type { SignalStateProvider } from './streetDetails';

const REPEAT = 12; // meters per texture repeat along the road

class Buf {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  idx: number[] = [];
  get count() {
    return this.pos.length / 3;
  }
  v(x: number, y: number, z: number, nx: number, ny: number, nz: number, u = 0, w = 0, c?: [number, number, number]) {
    this.pos.push(x, y, z);
    this.nor.push(nx, ny, nz);
    this.uv.push(u, w);
    if (c) this.col.push(c[0], c[1], c[2]);
    return this.count - 1;
  }
  tri(a: number, b: number, c: number) {
    this.idx.push(a, b, c);
  }
  quad(a: number, b: number, c: number, d: number) {
    // a-b-c-d in screen-CCW order
    this.idx.push(a, b, c, a, c, d);
  }
  /** Axis-aligned-ish box given center, half sizes and yaw. */
  box(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, yaw: number, color: [number, number, number]) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const P = (x: number, y: number, z: number): [number, number, number] => [cx + x * c - z * s, cy + y, cz + x * s + z * c];
    const faces: [number[], number[][]][] = [
      [[0, 1, 0], [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]]],
      [[0, -1, 0], [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]]],
      [[1, 0, 0], [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]]],
      [[-1, 0, 0], [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]]],
      [[0, 0, 1], [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]],
      [[0, 0, -1], [[-1, -1, -1], [-1, 1, -1], [1, 1, -1], [1, -1, -1]]],
    ];
    for (const [n, corners] of faces) {
      const nx = n[0] * c - n[2] * s, nz = n[0] * s + n[2] * c;
      const ids = corners.map(([x, y, z]) => {
        const p = P(x * hx, y * hy, z * hz);
        return this.v(p[0], p[1], p[2], nx, n[1], nz, 0, 0, color);
      });
      this.idx.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]);
    }
  }
}

function concat(bufs: Buf[], withColor: boolean, withUv: boolean): THREE.BufferGeometry {
  let nv = 0, ni = 0;
  for (const b of bufs) { nv += b.count; ni += b.idx.length; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3);
  const uv = withUv ? new Float32Array(nv * 2) : null;
  const col = withColor ? new Float32Array(nv * 3) : null;
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let ov = 0, oi = 0;
  for (const b of bufs) {
    pos.set(b.pos, ov * 3);
    nor.set(b.nor, ov * 3);
    if (uv) uv.set(b.uv, ov * 2);
    if (col && b.col.length) col.set(b.col, ov * 3);
    for (let k = 0; k < b.idx.length; k++) idx[oi + k] = b.idx[k] + ov;
    ov += b.count;
    oi += b.idx.length;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  if (uv) g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (col) g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}

// ------------------------------------------------------------------ textures
function noiseFill(ctx: CanvasRenderingContext2D, w: number, h: number, base: [number, number, number], amp: number) {
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const n = (Math.random() - 0.5) * amp;
    img.data[i * 4] = base[0] + n;
    img.data[i * 4 + 1] = base[1] + n;
    img.data[i * 4 + 2] = base[2] + n;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

function roadTexture(t: RoadType, maxAniso: number): THREE.CanvasTexture {
  const W = 256, H = 512;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  const px = (m: number) => (m / t.width) * W; // meters across -> px
  const py = (m: number) => (m / REPEAT) * H;
  if (t.id === 'gravel') {
    noiseFill(ctx, W, H, [132, 112, 86], 50);
    ctx.fillStyle = 'rgba(90,72,52,0.35)';
    for (const x of [0.28, 0.72]) ctx.fillRect(W * x - 14, 0, 28, H); // tire ruts
  } else {
    noiseFill(ctx, W, H, [84, 84, 88], 22);
    const half = t.width / 2;
    const sw = t.sidewalk;
    if (sw > 0) {
      ctx.fillStyle = '#9d9a92';
      ctx.fillRect(0, 0, px(sw), H);
      ctx.fillRect(W - px(sw), 0, px(sw), H);
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      for (let y = 0; y < H; y += py(2)) { ctx.fillRect(0, y, px(sw), 2); ctx.fillRect(W - px(sw), y, px(sw), 2); }
      ctx.fillStyle = '#6f6c66';
      ctx.fillRect(px(sw) - 3, 0, 3, H);
      ctx.fillRect(W - px(sw), 0, 3, H);
    }
    const ch = carriageHalf(t);
    const cx = W / 2;
    const line = (mOff: number, color: string, dashed: boolean, wPx = 3) => {
      ctx.fillStyle = color;
      const x = cx + px(mOff) - wPx / 2;
      if (!dashed) ctx.fillRect(x, 0, wPx, H);
      else for (let y = 0; y < H; y += py(12)) ctx.fillRect(x, y, wPx, py(3.5));
    };
    // edge lines
    line(-ch + 0.3, '#e8e8e2', false);
    line(ch - 0.3, '#e8e8e2', false);
    if (t.centerTurn) {
      const h2 = t.laneW / 2;
      line(-h2, '#e8c33a', false);
      line(-h2 + 0.35, '#e8c33a', true);
      line(h2, '#e8c33a', false);
      line(h2 - 0.35, '#e8c33a', true);
    } else if (t.median > 0) {
      ctx.fillStyle = '#4a4a4c';
      ctx.fillRect(cx - px(t.median / 2), 0, px(t.median), H);
      line(-t.median / 2 - 0.3, '#e8c33a', false);
      line(t.median / 2 + 0.3, '#e8c33a', false);
    } else {
      line(-0.15, '#e8c33a', false);
      line(0.15, '#e8c33a', false);
    }
    const inner = (t.centerTurn ? t.laneW / 2 : 0) + t.median / 2;
    for (let k = 1; k < t.lanesPerDir; k++) {
      line(inner + k * t.laneW, '#e8e8e2', true);
      line(-(inner + k * t.laneW), '#e8e8e2', true);
    }
    // oil stains in lane centers
    ctx.fillStyle = 'rgba(20,20,20,0.12)';
    for (let k = 0; k < t.lanesPerDir; k++) {
      const off = inner + (k + 0.5) * t.laneW;
      ctx.fillRect(cx + px(off) - 6, 0, 12, H);
      ctx.fillRect(cx - px(off) - 6, 0, 12, H);
    }
    void half;
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = maxAniso;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function asphaltTexture(maxAniso: number) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  noiseFill(ctx, 256, 256, [84, 84, 88], 22);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = maxAniso;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ------------------------------------------------------------------ renderer
interface SegGeo {
  surf: Buf;
  conc: Buf;
  lights: { x: number; y: number; z: number; yaw: number }[];
}

const CONCRETE: [number, number, number] = [0.62, 0.61, 0.58];
const CONCRETE_DARK: [number, number, number] = [0.34, 0.3, 0.25];
const CURB: [number, number, number] = [0.69, 0.68, 0.64];

/** Render-only trim at a junction, based on intersecting carriageways rather
 * than the graph's wider curb/sidewalk clearance envelope. */
function visualTrim(net: RoadNetwork, seg: RSeg, nodeId: number) {
  const node = net.nodes.get(nodeId);
  if (!node || node.segs.length < 2) return 0;
  const direction = (s: RSeg) => {
    const atA = s.a === nodeId, pts = s.samp.pts;
    return atA
      ? norm(sub(pts[Math.min(2, pts.length - 1)], pts[0]))
      : norm(sub(pts[Math.max(0, pts.length - 3)], pts[pts.length - 1]));
  };
  const dir = direction(seg);
  let trim = 0;
  for (const id of node.segs) {
    const other = net.segs.get(id);
    if (!other || other === seg) continue;
    const od = direction(other);
    if (dir.x * od.x + dir.z * od.z < -0.9) continue;
    const sin = Math.abs(dir.x * od.z - dir.z * od.x);
    trim = Math.max(trim, carriageHalf(ROAD_TYPES[other.type]) / Math.max(0.35, sin));
  }
  return Math.min(trim, seg.length * 0.45);
}

export class RoadRenderer {
  readonly group = new THREE.Group();
  private segGeo = new Map<number, SegGeo>();
  private nodeGeo = new Map<number, Buf>();
  private typeMeshes = new Map<RoadTypeId, THREE.Mesh>();
  private junctionMesh: THREE.Mesh;
  private concMesh: THREE.Mesh;
  private dirty = true;
  private lampPoles: THREE.InstancedMesh;
  private lampHeads: THREE.InstancedMesh;
  private lampMat: THREE.MeshStandardMaterial;
  private details = new StreetDetails();
  readonly typeMats = new Map<RoadTypeId, THREE.MeshStandardMaterial>();

  constructor(private net: RoadNetwork, renderer: THREE.WebGLRenderer) {
    const aniso = renderer.capabilities.getMaxAnisotropy();
    for (const id of ROAD_ORDER) {
      const mat = new THREE.MeshStandardMaterial({ map: roadTexture(ROAD_TYPES[id], aniso), roughness: 0.92, metalness: 0, envMapIntensity: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
      this.typeMats.set(id, mat);
      const m = new THREE.Mesh(new THREE.BufferGeometry(), mat);
      m.receiveShadow = true;
      this.typeMeshes.set(id, m);
      this.group.add(m);
    }
    const jt = asphaltTexture(aniso);
    this.junctionMesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ map: jt, roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 }));
    this.junctionMesh.receiveShadow = true;
    this.group.add(this.junctionMesh);
    this.concMesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }));
    this.concMesh.castShadow = true;
    this.concMesh.receiveShadow = true;
    this.group.add(this.concMesh);

    const pole = new THREE.CylinderGeometry(0.09, 0.13, 8, 5);
    pole.translate(0, 4, 0);
    const arm = new THREE.BoxGeometry(0.12, 0.12, 2.2);
    arm.translate(0, 7.9, -1.0);
    const poleGeo = mergeSimple([pole, arm]);
    this.lampPoles = new THREE.InstancedMesh(poleGeo, new THREE.MeshStandardMaterial({ color: 0x55585c, roughness: 0.6, metalness: 0.4 }), 4000);
    const head = new THREE.BoxGeometry(0.5, 0.18, 0.9);
    head.translate(0, 7.8, -2.0);
    this.lampMat = new THREE.MeshStandardMaterial({ color: 0x333333, emissive: 0xffc27a, emissiveIntensity: 0 });
    this.lampHeads = new THREE.InstancedMesh(head, this.lampMat, 4000);
    this.lampPoles.count = this.lampHeads.count = 0;
    this.lampPoles.castShadow = true;
    this.group.add(this.lampPoles, this.lampHeads);
    this.group.add(this.details.group);

    net.events.on('segAdded', (s) => this.invalidateSeg(s));
    net.events.on('segChanged', (s) => this.invalidateSeg(s));
    net.events.on('segTrimmed', (s) => this.invalidateSeg(s));
    net.events.on('segRemoved', (s) => {
      this.segGeo.delete(s.id);
      this.invalidateJunction(s.a);
      this.invalidateJunction(s.b);
    });
    net.events.on('nodeChanged', (n) => this.invalidateJunction(n.id));
  }

  private invalidateSeg(s: RSeg) {
    this.segGeo.delete(s.id);
    this.invalidateNode(s.a);
    this.invalidateNode(s.b);
  }
  private invalidateNode(id: number) {
    this.nodeGeo.delete(id);
    this.dirty = true;
  }
  /** Visual approach trims depend on every road meeting at the node. */
  private invalidateJunction(id: number) {
    const node = this.net.nodes.get(id);
    if (node) for (const segId of node.segs) this.segGeo.delete(segId);
    this.invalidateNode(id);
  }

  setNight(n: number) {
    this.lampMat.emissiveIntensity = n * 4;
  }

  /** Connects visible traffic lights to the simulation without coupling render and traffic modules. */
  setSignalStateProvider(provider?: SignalStateProvider) {
    this.details.setSignalStateProvider(provider);
  }

  private wetWas = -1;
  /** Rain makes asphalt dark and glossy. */
  setWet(w: number) {
    if (Math.abs(w - this.wetWas) < 0.02) return;
    this.wetWas = w;
    const mats = [...this.typeMats.values(), this.junctionMesh.material as THREE.MeshStandardMaterial];
    for (const m of mats) {
      m.roughness = 0.92 - w * 0.55;
      m.color.setScalar(1 - w * 0.35);
    }
  }

  update() {
    this.details.updateSignals();
    if (!this.dirty) return;
    this.dirty = false;
    const perType = new Map<RoadTypeId, Buf[]>();
    const conc: Buf[] = [];
    const junc: Buf[] = [];
    const lights: { x: number; y: number; z: number; yaw: number }[] = [];
    for (const seg of this.net.segs.values()) {
      let g = this.segGeo.get(seg.id);
      if (!g) this.segGeo.set(seg.id, (g = this.buildSeg(seg)));
      let arr = perType.get(seg.type);
      if (!arr) perType.set(seg.type, (arr = []));
      arr.push(g.surf);
      conc.push(g.conc);
      lights.push(...g.lights);
    }
    for (const n of this.net.nodes.values()) {
      let b = this.nodeGeo.get(n.id);
      if (!b) this.nodeGeo.set(n.id, (b = this.buildNode(n)));
      if (b.count) junc.push(b);
    }
    for (const [id, mesh] of this.typeMeshes) {
      mesh.geometry.dispose();
      const list = perType.get(id);
      mesh.geometry = list && list.length ? concat(list, false, true) : new THREE.BufferGeometry();
    }
    this.junctionMesh.geometry.dispose();
    this.junctionMesh.geometry = junc.length ? concat(junc, false, true) : new THREE.BufferGeometry();
    this.concMesh.geometry.dispose();
    this.concMesh.geometry = conc.length ? concat(conc, true, true) : new THREE.BufferGeometry();

    const m = new THREE.Matrix4();
    const n = Math.min(lights.length, 4000);
    for (let i = 0; i < n; i++) {
      const L = lights[i];
      m.makeRotationY(L.yaw).setPosition(L.x, L.y, L.z);
      this.lampPoles.setMatrixAt(i, m);
      this.lampHeads.setMatrixAt(i, m);
    }
    this.lampPoles.count = this.lampHeads.count = n;
    this.lampPoles.instanceMatrix.needsUpdate = this.lampHeads.instanceMatrix.needsUpdate = true;
    this.lampPoles.computeBoundingSphere();
    this.lampHeads.computeBoundingSphere();
    this.details.rebuild(this.net);
  }

  /** Point, tangent, height at arc length d along a segment. */
  static frame(seg: RSeg, d: number) {
    const { i, f } = locate(seg.samp, d);
    const a = seg.samp.pts[i], b = seg.samp.pts[i + 1];
    const p: V2 = { x: lerp(a.x, b.x, f), z: lerp(a.z, b.z, f) };
    const t = norm(sub(b, a));
    const y = lerp(seg.hs[i], seg.hs[i + 1], f);
    const g = lerp(seg.ground[i], seg.ground[i + 1], f);
    return { p, t, y, ground: g };
  }

  private buildSeg(seg: RSeg): SegGeo {
    const t = ROAD_TYPES[seg.type];
    const hw = t.width / 2;
    const surf = new Buf(), conc = new Buf();
    const lights: SegGeo['lights'] = [];
    // Network trims reserve curb, sidewalk and clearance space. Rendering only
    // needs the overlap of the intersecting carriageways.
    const s0 = visualTrim(this.net, seg, seg.a);
    const s1 = seg.length - visualTrim(this.net, seg, seg.b);
    if (s1 - s0 < 0.5) return { surf, conc, lights };
    const driveways: { d: number; side: number }[] = [];
    if (t.sidewalk > 0) {
      for (let d = s0 + 18 + (seg.id % 5) * 4; d < s1 - 12; d += 34 + (seg.id % 3) * 5) {
        driveways.push({ d, side: ((Math.floor(d / 30) + seg.id) & 1) ? 1 : -1 });
      }
    }
    const steps: number[] = [s0];
    for (const c of seg.samp.cum) if (c > s0 + 0.2 && c < s1 - 0.2) steps.push(c);
    // Add three curb samples per apron for a cheap, visible driveway dip.
    for (const drive of driveways) for (const o of [-1.7, 0, 1.7]) if (drive.d + o > s0 && drive.d + o < s1) steps.push(drive.d + o);
    steps.push(s1);
    steps.sort((a, b) => a - b);
    for (let i = steps.length - 1; i > 0; i--) if (steps[i] - steps[i - 1] < 0.01) steps.splice(i, 1);
    let prevL = -1, prevR = -1;
    let prevBL = -1, prevBR = -1, prevTL = -1, prevTR = -1;
    let prevCurb: number[][] | undefined;
    for (let k = 0; k < steps.length; k++) {
      const d = steps[k];
      const F = RoadRenderer.frame(seg, d);
      const r = { x: -F.t.z, z: F.t.x };
      const y = F.y + 0.06;
      // slope for normal
      const F2 = RoadRenderer.frame(seg, Math.min(seg.length, d + 1));
      const grade = F2.y - F.y;
      const nl = Math.hypot(grade, 1);
      const nx = (-grade * F.t.x) / nl, ny = 1 / nl, nz = (-grade * F.t.z) / nl;
      const L = surf.v(F.p.x - r.x * hw, y, F.p.z - r.z * hw, nx, ny, nz, 0, d / REPEAT);
      const R = surf.v(F.p.x + r.x * hw, y, F.p.z + r.z * hw, nx, ny, nz, 1, d / REPEAT);
      if (prevL >= 0) {
        surf.tri(prevL, prevR, L);
        surf.tri(prevR, R, L);
      }
      prevL = L;
      prevR = R;
      // concrete sides (curb / embankment face / bridge deck)
      const elevated = F.y - F.ground > 2.6;
      const bottom = elevated ? F.y - 1.3 : F.y - 1.1;
      const col = elevated ? CONCRETE : CONCRETE_DARK;
      const tl = conc.v(F.p.x - r.x * hw, y, F.p.z - r.z * hw, -r.x, 0, -r.z, 0, 0, col);
      const bl = conc.v(F.p.x - r.x * hw, bottom, F.p.z - r.z * hw, -r.x, 0, -r.z, 0, 0, col);
      const tr = conc.v(F.p.x + r.x * hw, y, F.p.z + r.z * hw, r.x, 0, r.z, 0, 0, col);
      const br = conc.v(F.p.x + r.x * hw, bottom, F.p.z + r.z * hw, r.x, 0, r.z, 0, 0, col);
      if (prevTL >= 0) {
        conc.quad(prevTL, prevBL, bl, tl);
        conc.quad(prevTR, tr, br, prevBR);
        if (elevated) {
          // underside
          conc.quad(prevBL, prevBR, br, bl);
        }
      }
      prevTL = tl; prevBL = bl; prevTR = tr; prevBR = br;

      // A narrow raised curb reads at street level without tessellating each slab.
      if (t.sidewalk > 0) {
        const ch = carriageHalf(t);
        const curb: number[][] = [];
        for (const side of [-1, 1]) {
          const inner = ch - 0.08, outer = ch + 0.14;
          const ix = F.p.x + r.x * inner * side, iz = F.p.z + r.z * inner * side;
          const ox = F.p.x + r.x * outer * side, oz = F.p.z + r.z * outer * side;
          const base = F.y + 0.06;
          const lowered = driveways.some((drive) => drive.side === side && Math.abs(drive.d - d) < 0.15);
          const top = base + (lowered ? 0.025 : 0.13);
          curb.push([
            conc.v(ix, top, iz, 0, 1, 0, 0, 0, CURB),
            conc.v(ox, top, oz, 0, 1, 0, 0, 0, CURB),
            conc.v(ox, base, oz, r.x * side, 0, r.z * side, 0, 0, CURB),
          ]);
        }
        if (prevCurb) {
          for (let side = 0; side < 2; side++) {
            const a = prevCurb[side], q = curb[side];
            conc.quad(a[0], a[1], q[1], q[0]);
            conc.quad(a[1], a[2], q[2], q[1]);
          }
        }
        prevCurb = curb;
      }
    }
    // Pillars and lighting. Guardrails and median rails are instanced by StreetDetails.
    const yaw = (d: number) => {
      const F = RoadRenderer.frame(seg, d);
      return Math.atan2(F.t.x, F.t.z);
    };
    for (let d = s0 + 10; d < s1 - 6; d += 22) {
      const F = RoadRenderer.frame(seg, d);
      if (F.y - F.ground <= 2.6) continue;
      const r = { x: -F.t.z, z: F.t.x };
      const ya = yaw(d);
      const top = F.y - 1.3;
      const bot = Math.min(F.ground, 0) - 3;
      const cols = hw > 9 ? [-hw * 0.55, hw * 0.55] : [0];
      for (const o of cols) {
        conc.box(F.p.x + r.x * o, bot, F.p.z + r.z * o, 0.9, (top - bot) / 2, 0.9, ya, CONCRETE);
      }
      conc.box(F.p.x, top - 0.6, F.p.z, hw * 0.9, 0.5, 1.1, ya, CONCRETE);
    }
    if (t.sidewalk > 0 || t.id === 'highway') {
      const spacing = t.id === 'highway' ? 40 : 30;
      let side = 1;
      for (let d = s0 + 8; d < s1 - 4; d += spacing) {
        const F = RoadRenderer.frame(seg, d);
        const r = { x: -F.t.z, z: F.t.x };
        const off = hw - 0.5;
        const x = F.p.x + r.x * off * side, z = F.p.z + r.z * off * side;
        // lamp arm points toward the road center (arm is along local -Z)
        const ang = Math.atan2(r.x * side, r.z * side);
        lights.push({ x, y: F.y, z, yaw: ang });
        side = -side;
      }
    }
    return { surf, conc, lights };
  }

  private buildNode(n: RNode): Buf {
    const b = new Buf();
    const segs = n.segs.map((id) => this.net.segs.get(id)!).filter(Boolean);
    if (!segs.length) return b;
    const y = n.y + 0.08;
    if (segs.length === 1) {
      // dead end: round cap; residential roads get a cul-de-sac bulb
      const s = segs[0];
      const t = ROAD_TYPES[s.type];
      const r = t.width / 2 * (t.id === 'twoLane' || t.id === 'gravel' ? 1.55 : 1.0);
      const c = b.v(n.x, y, n.z, 0, 1, 0, n.x / 8, n.z / 8);
      const N = 20;
      const ids: number[] = [];
      for (let k = 0; k < N; k++) {
        const a = (k / N) * Math.PI * 2;
        const px = n.x + Math.cos(a) * r, pz = n.z + Math.sin(a) * r;
        ids.push(b.v(px, y, pz, 0, 1, 0, px / 8, pz / 8));
      }
      for (let k = 0; k < N; k++) b.tri(c, ids[(k + 1) % N], ids[k]);
      return b;
    }
    const trims = segs.map((s) => (s.a === n.id ? s.trimA : s.trimB));
    if (trims.every((t) => t < 0.01)) return b;
    const pts: V2[] = [{ x: n.x, z: n.z }];
    const edgeHeights: { p: V2; y: number }[] = [];
    for (const s of segs) {
      const atA = s.a === n.id;
      const t = ROAD_TYPES[s.type];
      const trim = visualTrim(this.net, s, n.id);
      const d = atA ? trim : s.length - trim;
      const F = RoadRenderer.frame(s, clamp(d, 0, s.length));
      const r = { x: -F.t.z, z: F.t.x };
      const hw = carriageHalf(t);
      const left = { x: F.p.x + r.x * hw, z: F.p.z + r.z * hw };
      const right = { x: F.p.x - r.x * hw, z: F.p.z - r.z * hw };
      pts.push(left, right);
      edgeHeights.push({ p: left, y: F.y + 0.08 }, { p: right, y: F.y + 0.08 });
    }
    let hull = convexHull(pts);
    // screen-CCW (x right, -z up) needs negative xz signed area
    let area = 0;
    for (let k = 0; k < hull.length; k++) {
      const p = hull[k], q = hull[(k + 1) % hull.length];
      area += p.x * q.z - q.x * p.z;
    }
    if (area > 0) hull = hull.reverse();
    const c = b.v(n.x, y, n.z, 0, 1, 0, n.x / 8, n.z / 8);
    // Approach profiles can differ noticeably on hills. Keep the center pinned
    // to the averaged node height, but meet each road at its sampled edge height.
    const ids = hull.map((p) => {
      let best = edgeHeights[0], d2 = Infinity;
      for (const edge of edgeHeights) {
        const dx = p.x - edge.p.x, dz = p.z - edge.p.z, dd = dx * dx + dz * dz;
        if (dd < d2) { best = edge; d2 = dd; }
      }
      return b.v(p.x, best?.y ?? y, p.z, 0, 1, 0, p.x / 8, p.z / 8);
    });
    for (let k = 0; k < ids.length; k++) b.tri(c, ids[k], ids[(k + 1) % ids.length]);
    return b;
  }
}

function mergeSimple(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const parts = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  for (const g of parts) n += g.getAttribute('position').count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  let o = 0;
  for (const g of parts) {
    pos.set(g.getAttribute('position').array as Float32Array, o * 3);
    nor.set(g.getAttribute('normal').array as Float32Array, o * 3);
    o += g.getAttribute('position').count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}
