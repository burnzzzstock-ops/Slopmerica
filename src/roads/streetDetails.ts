import * as THREE from 'three';
import { lerp, locate, norm, sub, V2 } from '../core/math';
import type { RoadNetwork, RSeg } from './network';
import { carriageHalf, ROAD_TYPES } from './roadTypes';

interface Frame {
  p: V2;
  t: V2;
  y: number;
  ground: number;
}

interface Placement {
  x: number;
  y: number;
  z: number;
  yaw: number;
  sx?: number;
  sy?: number;
  sz?: number;
}

interface PolePoint extends Placement {
  rx: number;
  rz: number;
}

interface SignalPlacement extends Placement {
  nodeId: number;
  segId: number;
}

interface TextPanel extends Placement {
  text: string;
  kind: 'street' | 'speed' | 'road' | 'arrow';
  w: number;
  h: number;
  horizontal?: boolean;
}

export type SignalAspect = 'red' | 'yellow' | 'green';
/** Boolean providers remain supported for simple red/green integrations. */
export type SignalStateProvider = (nodeId: number, segId: number) => SignalAspect | boolean;

const frameAt = (seg: RSeg, d: number): Frame => {
  const { i, f } = locate(seg.samp, d);
  const a = seg.samp.pts[i], b = seg.samp.pts[i + 1];
  return {
    p: { x: lerp(a.x, b.x, f), z: lerp(a.z, b.z, f) },
    t: norm(sub(b, a)),
    y: lerp(seg.hs[i], seg.hs[i + 1], f),
    ground: lerp(seg.ground[i], seg.ground[i + 1], f),
  };
};

const yawAt = (f: Frame) => Math.atan2(f.t.x, f.t.z);
const sideAt = (f: Frame) => ({ x: -f.t.z, z: f.t.x });
const visualTrim = (net: RoadNetwork, seg: RSeg, nodeId: number) => {
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
};
const hash01 = (a: number, b: number) => {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 17, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 0xffffffff;
};

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
  for (const g of parts) if (!geos.includes(g)) g.dispose();
  for (const g of geos) g.dispose();
  return out;
}

function transformAt(p: Placement, out: THREE.Matrix4) {
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.yaw);
  out.compose(
    new THREE.Vector3(p.x, p.y, p.z),
    q,
    new THREE.Vector3(p.sx ?? 1, p.sy ?? 1, p.sz ?? 1),
  );
}

/** Procedural, instanced street furniture rebuilt with the road network. */
export class StreetDetails {
  readonly group = new THREE.Group();
  private meshes: THREE.Object3D[] = [];
  private signalBulbs?: THREE.InstancedMesh;
  private pedestrianBulbs?: THREE.InstancedMesh;
  private signalPlacements: SignalPlacement[] = [];
  private signalProvider?: SignalStateProvider;
  private signalColors = new Uint8Array(0);
  private readonly signalRed = new THREE.Color(0xff2b19);
  private readonly signalGreen = new THREE.Color(0x45ff4f);
  private readonly signalAmber = new THREE.Color(0xffb52a);
  private readonly signalRedDim = new THREE.Color(0x230a08);
  private readonly signalAmberDim = new THREE.Color(0x251807);
  private readonly signalGreenDim = new THREE.Color(0x09200b);

  private readonly darkMetal = new THREE.MeshStandardMaterial({ color: 0x44484b, roughness: 0.62, metalness: 0.38 });
  private readonly galvanized = new THREE.MeshStandardMaterial({ color: 0x8d9290, roughness: 0.52, metalness: 0.48 });
  private readonly wood = new THREE.MeshStandardMaterial({ color: 0x594534, roughness: 0.96 });
  private readonly white = new THREE.MeshStandardMaterial({ color: 0xe8e6db, roughness: 0.84 });
  private readonly signalDark = new THREE.MeshStandardMaterial({ color: 0x272b28, roughness: 0.68, metalness: 0.15 });
  private readonly red = new THREE.MeshStandardMaterial({ color: 0xa92821, roughness: 0.78 });
  private readonly yellow = new THREE.MeshStandardMaterial({ color: 0xd5961b, roughness: 0.72 });
  private readonly asphaltDark = new THREE.MeshBasicMaterial({ color: 0x171719, transparent: true, opacity: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -5 });
  private readonly signalLight = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, toneMapped: false });
  private readonly wireMat = new THREE.LineBasicMaterial({ color: 0x252321, transparent: true, opacity: 0.78 });

  private readonly utilityPoleGeo: THREE.BufferGeometry;
  private readonly crossArmGeo = new THREE.BoxGeometry(1.5, 0.12, 0.12);
  private readonly railGeo = new THREE.BoxGeometry(0.32, 0.42, 6.25);
  private readonly railPostGeo = new THREE.BoxGeometry(0.16, 0.9, 0.16);
  private readonly reflectorGeo = new THREE.BoxGeometry(0.18, 0.18, 0.08);
  private readonly crosswalkGeo = new THREE.BoxGeometry(1, 0.025, 0.34);
  private readonly apronGeo = new THREE.BoxGeometry(1, 0.035, 1);
  private readonly stainGeo = new THREE.CircleGeometry(1, 10).rotateX(-Math.PI / 2);
  private readonly signPostGeo = new THREE.CylinderGeometry(0.045, 0.055, 2.3, 5).translate(0, 1.15, 0);
  private readonly stopSignGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.055, 8).rotateX(Math.PI / 2).translate(0, 2.35, 0);
  private readonly signalPoleGeo: THREE.BufferGeometry;
  private readonly signalArmGeo = new THREE.BoxGeometry(1, 0.12, 0.12).translate(-0.5, 4.18, 0);
  private readonly signalHeadGeo = new THREE.BoxGeometry(0.46, 1.18, 0.36).translate(0, 3.77, 0);
  private readonly signalBulbGeo = new THREE.SphereGeometry(0.17, 8, 6).translate(0, 0, -0.21);
  private readonly pedestrianHeadGeo = new THREE.BoxGeometry(0.46, 0.5, 0.22).translate(0, 2.75, 0);
  private readonly pedestrianBulbGeo = new THREE.CircleGeometry(0.13, 8).translate(0, 2.75, -0.12);
  private readonly hydrantGeo: THREE.BufferGeometry;
  private readonly mailboxGeo: THREE.BufferGeometry;
  private readonly shelterGeo: THREE.BufferGeometry;
  private readonly adGeo = new THREE.PlaneGeometry(2.2, 1.35).rotateY(-Math.PI / 2).translate(-0.57, 1.25, 0);
  private readonly adMat: THREE.MeshBasicMaterial;

  constructor() {
    const pole = new THREE.CylinderGeometry(0.1, 0.15, 7.5, 6).translate(0, 3.75, 0);
    const cap = new THREE.BoxGeometry(0.2, 0.2, 0.2).translate(0, 7.5, 0);
    this.utilityPoleGeo = mergeSimple([pole, cap]);

    const signalPole = new THREE.CylinderGeometry(0.09, 0.12, 4.25, 6).translate(0, 2.125, 0);
    this.signalPoleGeo = signalPole.toNonIndexed();
    signalPole.dispose();

    const hydrantBody = new THREE.CylinderGeometry(0.15, 0.19, 0.62, 7).translate(0, 0.31, 0);
    const hydrantTop = new THREE.SphereGeometry(0.18, 7, 4).translate(0, 0.63, 0);
    const hydrantNozzle = new THREE.CylinderGeometry(0.08, 0.08, 0.42, 6).rotateZ(Math.PI / 2).translate(0, 0.42, 0);
    this.hydrantGeo = mergeSimple([hydrantBody, hydrantTop, hydrantNozzle]);

    const mailboxPost = new THREE.BoxGeometry(0.09, 1.05, 0.09).translate(0, 0.525, 0);
    const mailboxBox = new THREE.BoxGeometry(0.42, 0.36, 0.72).translate(0, 1.08, 0);
    this.mailboxGeo = mergeSimple([mailboxPost, mailboxBox]);

    const shelterParts = [
      new THREE.BoxGeometry(1.25, 0.12, 3.2).translate(0, 2.35, 0),
      new THREE.BoxGeometry(0.09, 2.3, 0.09).translate(-0.53, 1.15, -1.45),
      new THREE.BoxGeometry(0.09, 2.3, 0.09).translate(-0.53, 1.15, 1.45),
      new THREE.BoxGeometry(0.09, 2.3, 0.09).translate(0.53, 1.15, -1.45),
      new THREE.BoxGeometry(0.09, 2.3, 0.09).translate(0.53, 1.15, 1.45),
      new THREE.BoxGeometry(0.6, 0.12, 2.2).translate(0.18, 0.62, 0),
      new THREE.BoxGeometry(0.12, 0.58, 0.12).translate(0.18, 0.3, -0.82),
      new THREE.BoxGeometry(0.12, 0.58, 0.12).translate(0.18, 0.3, 0.82),
    ];
    this.shelterGeo = mergeSimple(shelterParts);
    this.adMat = new THREE.MeshBasicMaterial({ map: this.makeAdTexture(), side: THREE.DoubleSide, toneMapped: false });
  }

  setSignalStateProvider(provider?: SignalStateProvider) {
    this.signalProvider = provider;
    this.signalColors.fill(255);
  }

  rebuild(net: RoadNetwork) {
    for (const object of this.meshes) {
      this.group.remove(object);
      // Instanced meshes use shared geometry; wire geometry is rebuilt and owned here.
      if (object instanceof THREE.LineSegments) object.geometry.dispose();
      if (object.userData.ownedStreetDetail && object instanceof THREE.Mesh) {
        object.geometry.dispose();
        const material = object.material as THREE.Material & { map?: THREE.Texture | null };
        material.map?.dispose();
        material.dispose();
      }
    }
    this.meshes.length = 0;
    this.signalBulbs = undefined;
    this.pedestrianBulbs = undefined;
    this.signalPlacements.length = 0;

    const utilityPoles: Placement[] = [];
    const crossArms: Placement[] = [];
    const railBeams: Placement[] = [];
    const railPosts: Placement[] = [];
    const reflectors: Placement[] = [];
    const crosswalks: Placement[] = [];
    const aprons: Placement[] = [];
    const stains: Placement[] = [];
    const signPosts: Placement[] = [];
    const stopSigns: Placement[] = [];
    const signalPoles: Placement[] = [];
    const signalArms: Placement[] = [];
    const signalHeads: Placement[] = [];
    const signalBulbPlacements: Placement[] = [];
    const pedestrianHeads: Placement[] = [];
    const pedestrianPlacements: Placement[] = [];
    const hydrants: Placement[] = [];
    const mailboxes: Placement[] = [];
    const shelters: Placement[] = [];
    const ads: Placement[] = [];
    const textPanels: TextPanel[] = [];
    const wirePositions: number[] = [];

    for (const seg of net.segs.values()) {
      const t = ROAD_TYPES[seg.type];
      const s0 = seg.trimA, s1 = seg.length - seg.trimB;
      if (s1 - s0 < 4) continue;

      if (t.id === 'gravel' || t.id === 'twoLane') {
        const side = (seg.id & 1) ? 1 : -1;
        const line: PolePoint[] = [];
        for (let d = s0 + 12; d < s1 - 8; d += 42) {
          const f = frameAt(seg, d), r = sideAt(f);
          const off = t.width / 2 + 2.2;
          const p: PolePoint = { x: f.p.x + r.x * off * side, y: f.y, z: f.p.z + r.z * off * side, yaw: yawAt(f), rx: r.x, rz: r.z };
          line.push(p);
          utilityPoles.push(p);
          crossArms.push({ ...p, y: p.y + 7.15 });
        }
        for (let i = 1; i < line.length; i++) this.addWireSpan(wirePositions, line[i - 1], line[i]);
      }

      for (let d = s0 + 3; d < s1 - 3; d += 6.2) {
        const f = frameAt(seg, d);
        if (f.y - f.ground <= 2.6 && t.id !== 'highway') continue;
        const r = sideAt(f), yaw = yawAt(f);
        for (const side of [-1, 1]) {
          const off = t.width / 2 - 0.35;
          railBeams.push({ x: f.p.x + r.x * off * side, y: f.y + 0.56, z: f.p.z + r.z * off * side, yaw });
          if ((Math.floor(d / 6.2) & 1) === 0) {
            railPosts.push({ x: f.p.x + r.x * off * side, y: f.y + 0.42, z: f.p.z + r.z * off * side, yaw });
            reflectors.push({ x: f.p.x + r.x * (off - 0.18) * side, y: f.y + 0.68, z: f.p.z + r.z * (off - 0.18) * side, yaw });
          }
        }
        if (t.median > 0) railBeams.push({ x: f.p.x, y: f.y + 0.56, z: f.p.z, yaw });
      }

      if (t.sidewalk > 0) {
        for (let d = s0 + 34 + (seg.id % 3) * 9; d < s1 - 10; d += 105) {
          const f = frameAt(seg, d), r = sideAt(f), side = ((Math.floor(d / 40) + seg.id) & 1) ? 1 : -1;
          const off = t.width / 2 + 0.65;
          hydrants.push({ x: f.p.x + r.x * off * side, y: f.y, z: f.p.z + r.z * off * side, yaw: yawAt(f) });
        }
        // Flush concrete aprons span the sidewalk at plausible parcel intervals.
        for (let d = s0 + 18 + (seg.id % 5) * 4; d < s1 - 12; d += 34 + (seg.id % 3) * 5) {
          const f = frameAt(seg, d), r = sideAt(f), side = ((Math.floor(d / 30) + seg.id) & 1) ? 1 : -1;
          const off = carriageHalf(t) + t.sidewalk * 0.52;
          aprons.push({ x: f.p.x + r.x * off * side, y: f.y + 0.115, z: f.p.z + r.z * off * side, yaw: yawAt(f), sx: t.sidewalk + 0.35, sz: 3.1 });
        }
        // A sparse shelter cadence reads as transit infrastructure without a route simulation.
        if (seg.length > 125 && (t.id === 'twoLane' || t.centerTurn)) {
          for (let d = s0 + 62 + (seg.id % 3) * 18; d < s1 - 34; d += 220) {
            const f = frameAt(seg, d), r = sideAt(f), side = (seg.id & 1) ? 1 : -1;
            const off = carriageHalf(t) + Math.max(0.7, t.sidewalk * 0.58);
            const p = { x: f.p.x + r.x * off * side, y: f.y, z: f.p.z + r.z * off * side, yaw: yawAt(f) + (side < 0 ? Math.PI : 0) };
            shelters.push(p);
            ads.push(p);
          }
        }
      }
      if (t.id === 'gravel' || t.id === 'twoLane') {
        for (let d = s0 + 25 + (seg.id % 4) * 7; d < s1 - 8; d += 78) {
          const f = frameAt(seg, d), r = sideAt(f), side = ((Math.floor(d / 60) + seg.id) & 1) ? 1 : -1;
          const off = t.width / 2 + 1.0;
          mailboxes.push({ x: f.p.x + r.x * off * side, y: f.y, z: f.p.z + r.z * off * side, yaw: yawAt(f) + (side > 0 ? 0 : Math.PI) });
        }
      }

      // Parked-car drips appear in repeatable curbside stall positions.
      if (t.id === 'twoLane') {
        for (let d = s0 + 16; d < s1 - 10; d += 19) {
          const f = frameAt(seg, d), r = sideAt(f), side = ((Math.floor(d / 19) + seg.id) & 1) ? 1 : -1;
          const off = Math.max(0.8, carriageHalf(t) - 0.9);
          stains.push({ x: f.p.x + r.x * off * side, y: f.y + 0.105, z: f.p.z + r.z * off * side, yaw: yawAt(f), sx: 0.34, sz: 0.82 });
        }
      }

      const ageYears = Math.max(0, (net.day - seg.builtDay) / 365);
      const damageCount = Math.min(8, Math.floor(Math.max(0, ageYears - 0.35) * seg.length / 155));
      for (let k = 0; k < damageCount; k++) {
        const d = s0 + 8 + hash01(seg.id, k * 7) * Math.max(1, s1 - s0 - 16);
        const f = frameAt(seg, d), r = sideAt(f);
        const lateral = (hash01(seg.id, k * 7 + 1) - 0.5) * carriageHalf(t) * 1.55;
        const x = f.p.x + r.x * lateral, z = f.p.z + r.z * lateral;
        const size = 0.22 + hash01(seg.id, k * 7 + 2) * 0.34;
        stains.push({ x, y: f.y + 0.11, z, yaw: yawAt(f), sx: size * 1.25, sz: size });
        // Two connected line segments suggest branching cracks at almost no geometry cost.
        const tx = f.t.x, tz = f.t.z, len = 0.65 + size;
        wirePositions.push(
          x - tx * len, f.y + 0.115, z - tz * len, x, f.y + 0.115, z,
          x, f.y + 0.115, z, x + (tx + r.x * 0.45) * len, f.y + 0.115, z + (tz + r.z * 0.45) * len,
        );
      }

      if (t.id === 'twoLane' && seg.length > 78 && seg.id % 4 === 0) {
        const f = frameAt(seg, seg.length * 0.5);
        textPanels.push({ x: f.p.x, y: f.y + 0.108, z: f.p.z, yaw: yawAt(f), w: 3.1, h: 5.4, text: seg.id % 8 === 0 ? 'SCHOOL' : 'SLOW', kind: 'road', horizontal: true });
      }
    }

    for (const node of net.nodes.values()) {
      if (node.segs.length < 2) continue;
      const segs = node.segs.map((id) => net.segs.get(id)).filter((s): s is RSeg => !!s);
      const signalized = segs.length >= 3 && segs.some((s) => ROAD_TYPES[s.type].signals);
      for (const seg of segs) {
        const t = ROAD_TYPES[seg.type];
        const atA = seg.a === node.id;
        const base = atA ? seg.trimA : seg.length - seg.trimB;
        const dir = atA ? 1 : -1;
        const renderTrim = visualTrim(net, seg, node.id);
        const markBase = atA ? renderTrim : seg.length - renderTrim;
        if (t.sidewalk > 0) {
          for (let k = -3; k <= 3; k++) {
            const d = Math.max(0, Math.min(seg.length, markBase + dir * (1.2 + (k + 3) * 0.46)));
            const f = frameAt(seg, d);
            crosswalks.push({ x: f.p.x, y: f.y + 0.105, z: f.p.z, yaw: yawAt(f), sx: carriageHalf(t) * 2 });
          }
        }
        if (segs.length < 3) continue;
        const d = Math.max(0, Math.min(seg.length, base + dir * 3.6));
        const f = frameAt(seg, d), r = sideAt(f);
        const approachSide = atA ? -1 : 1;
        const barFrame = frameAt(seg, Math.max(0, Math.min(seg.length, markBase + dir * 4.45)));
        const barSide = sideAt(barFrame), ch = carriageHalf(t);
        crosswalks.push({
          x: barFrame.p.x + barSide.x * approachSide * ch * 0.5,
          y: barFrame.y + 0.108,
          z: barFrame.p.z + barSide.z * approachSide * ch * 0.5,
          yaw: yawAt(barFrame), sx: Math.max(1, ch - 0.35), sz: 1.1,
        });
        if (t.centerTurn) {
          const arrowFrame = frameAt(seg, Math.max(0, Math.min(seg.length, base + dir * 11)));
          textPanels.push({
            x: arrowFrame.p.x, y: arrowFrame.y + 0.108, z: arrowFrame.p.z,
            yaw: yawAt(arrowFrame) + (atA ? Math.PI : 0), w: 2.2, h: 4.5,
            text: 'TURN', kind: 'arrow', horizontal: true,
          });
        }
        const off = t.width / 2 + 0.45;
        const x = f.p.x + r.x * off * approachSide;
        const z = f.p.z + r.z * off * approachSide;
        const yaw = yawAt(f) + (atA ? Math.PI : 0);
        if (signalized) {
          const armLength = Math.max(2.6, ch * 0.78 + 0.45);
          const p: SignalPlacement = { x, y: f.y, z, yaw, nodeId: node.id, segId: seg.id };
          signalPoles.push(p);
          signalArms.push({ ...p, sx: armLength });
          const head = { ...p, x: x - Math.cos(yaw) * armLength, z: z + Math.sin(yaw) * armLength };
          signalHeads.push(head);
          this.signalPlacements.push(head);
          for (const height of [4.16, 3.77, 3.38]) signalBulbPlacements.push({ ...head, y: head.y + height });
          const walk = { ...p, yaw: yaw + Math.PI / 2 };
          pedestrianHeads.push(walk);
          pedestrianPlacements.push(walk);
        } else {
          const p = { x, y: f.y, z, yaw };
          signPosts.push(p);
          stopSigns.push(p);
        }
      }

      // One shared pole carries up to two crossing street blades.
      const named = [...new Map(segs.map((s) => [s.name, s])).values()].slice(0, 2);
      const anchor = named[0];
      if (anchor && named.length >= 2) {
        const atA = anchor.a === node.id, base = atA ? anchor.trimA : anchor.length - anchor.trimB;
        const f = frameAt(anchor, Math.max(0, Math.min(anchor.length, base + (atA ? 1 : -1) * 5)));
        const r = sideAt(f), off = ROAD_TYPES[anchor.type].width / 2 + 0.75;
        const pole = { x: f.p.x + r.x * off, y: f.y, z: f.p.z + r.z * off, yaw: yawAt(f) };
        signPosts.push(pole);
        for (let i = 0; i < named.length; i++) {
          const road = named[i];
          const rf = frameAt(road, road.length * 0.5);
          textPanels.push({ ...pole, y: pole.y + 2.22 + i * 0.43, yaw: yawAt(rf), w: 3.15, h: 0.36, text: road.name, kind: 'street' });
        }
      }
    }

    // Repeated speed signs reuse just a handful of atlas labels.
    for (const seg of net.segs.values()) {
      const t = ROAD_TYPES[seg.type];
      if (t.id === 'gravel' || seg.length < 70) continue;
      const d = Math.min(seg.length - seg.trimB - 10, seg.trimA + 18);
      if (d <= seg.trimA) continue;
      const f = frameAt(seg, d), r = sideAt(f), off = t.width / 2 + 0.7;
      const p = { x: f.p.x + r.x * off, y: f.y, z: f.p.z + r.z * off, yaw: yawAt(f) };
      signPosts.push(p);
      textPanels.push({ ...p, y: p.y + 1.92, w: 0.56, h: 0.78, text: String(Math.round((t.speed * 2.237) / 5) * 5), kind: 'speed' });
    }

    this.addInstances(this.utilityPoleGeo, this.wood, utilityPoles, true);
    this.addInstances(this.crossArmGeo, this.wood, crossArms, true);
    this.addInstances(this.railGeo, this.galvanized, railBeams, true);
    this.addInstances(this.railPostGeo, this.darkMetal, railPosts, true);
    this.addInstances(this.reflectorGeo, this.yellow, reflectors, false);
    this.addInstances(this.crosswalkGeo, this.white, crosswalks, false, 3);
    this.addInstances(this.apronGeo, this.white, aprons, false);
    this.addInstances(this.stainGeo, this.asphaltDark, stains, false, 4);
    this.addInstances(this.signPostGeo, this.galvanized, signPosts, true);
    this.addInstances(this.stopSignGeo, this.red, stopSigns, true);
    this.addInstances(this.signalPoleGeo, this.darkMetal, signalPoles, true);
    this.addInstances(this.signalArmGeo, this.darkMetal, signalArms, true);
    this.addInstances(this.signalHeadGeo, this.signalDark, signalHeads, true);
    this.signalBulbs = this.addInstances(this.signalBulbGeo, this.signalLight, signalBulbPlacements, false);
    this.addInstances(this.pedestrianHeadGeo, this.signalDark, pedestrianHeads, true);
    this.pedestrianBulbs = this.addInstances(this.pedestrianBulbGeo, this.signalLight, pedestrianPlacements, false);
    this.addInstances(this.hydrantGeo, this.yellow, hydrants, true);
    this.addInstances(this.mailboxGeo, this.galvanized, mailboxes, true);
    this.addInstances(this.shelterGeo, this.darkMetal, shelters, true);
    this.addInstances(this.adGeo, this.adMat, ads, false);
    const textMesh = this.buildTextMesh(textPanels);
    if (textMesh) this.addObject(textMesh);

    if (wirePositions.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(wirePositions, 3));
      geo.computeBoundingSphere();
      const wires = new THREE.LineSegments(geo, this.wireMat);
      this.addObject(wires);
    }
    this.signalColors = new Uint8Array(this.signalPlacements.length);
    this.signalColors.fill(255);
    this.updateSignals();
  }

  updateSignals() {
    const bulbs = this.signalBulbs;
    if (!bulbs) return;
    let changed = false;
    for (let i = 0; i < this.signalPlacements.length; i++) {
      const p = this.signalPlacements[i];
      const supplied = this.signalProvider?.(p.nodeId, p.segId);
      const state = supplied === true || supplied === 'green' ? 1 : supplied === false || supplied === 'red' ? 0 : 2;
      if (this.signalColors[i] === state) continue;
      this.signalColors[i] = state;
      bulbs.setColorAt(i * 3, state === 0 ? this.signalRed : this.signalRedDim);
      bulbs.setColorAt(i * 3 + 1, state === 2 ? this.signalAmber : this.signalAmberDim);
      bulbs.setColorAt(i * 3 + 2, state === 1 ? this.signalGreen : this.signalGreenDim);
      this.pedestrianBulbs?.setColorAt(i, state === 0 ? this.signalGreen : this.signalRed);
      changed = true;
    }
    if (changed && bulbs.instanceColor) bulbs.instanceColor.needsUpdate = true;
    if (changed && this.pedestrianBulbs?.instanceColor) this.pedestrianBulbs.instanceColor.needsUpdate = true;
  }

  private makeAdTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createLinearGradient(0, 0, 256, 512);
    grad.addColorStop(0, '#ffb000');
    grad.addColorStop(0.52, '#ef3c23');
    grad.addColorStop(1, '#6f176d');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 512);
    ctx.strokeStyle = '#ffe85a';
    ctx.lineWidth = 14;
    ctx.strokeRect(12, 12, 232, 488);
    ctx.fillStyle = '#fff7df';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '900 68px Arial Black, sans-serif';
    ctx.fillText('SLOP', 128, 180);
    ctx.font = '900 31px Arial Black, sans-serif';
    ctx.fillText('MORE NOW', 128, 242);
    ctx.font = '700 21px Arial, sans-serif';
    ctx.fillText('ZERO WAIT', 128, 310);
    ctx.fillText('ZERO REGRETS*', 128, 342);
    ctx.font = '13px Arial, sans-serif';
    ctx.fillText('*regrets sold separately', 128, 464);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  /** Street blades, speed signs, road words, and arrows share one rebuild-time atlas and draw call. */
  private buildTextMesh(panels: TextPanel[]) {
    if (!panels.length) return undefined;
    const cellW = 256, cellH = 96, cols = 8, maxLabels = 320;
    const labels = [...new Map(panels.map((p) => [`${p.kind}:${p.text}`, p])).values()].slice(0, maxLabels);
    const rows = Math.ceil(labels.length / cols);
    let canvasH = 128;
    while (canvasH < rows * cellH) canvasH *= 2;
    const canvas = document.createElement('canvas');
    canvas.width = cellW * cols;
    canvas.height = Math.min(4096, canvasH);
    const ctx = canvas.getContext('2d')!;
    const slots = new Map<string, { x: number; y: number }>();

    for (let i = 0; i < labels.length; i++) {
      const p = labels[i], x = (i % cols) * cellW, y = Math.floor(i / cols) * cellH;
      slots.set(`${p.kind}:${p.text}`, { x, y });
      ctx.save();
      ctx.translate(x, y);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (p.kind === 'street') {
        ctx.fillStyle = '#17633d';
        ctx.fillRect(2, 7, cellW - 4, cellH - 14);
        ctx.strokeStyle = '#e8eee7';
        ctx.lineWidth = 3;
        ctx.strokeRect(5, 10, cellW - 10, cellH - 20);
        ctx.fillStyle = '#ffffff';
        const name = p.text.toUpperCase();
        let size = 38;
        do { ctx.font = `800 ${size--}px Arial, sans-serif`; } while (size > 19 && ctx.measureText(name).width > cellW - 22);
        ctx.fillText(name, cellW / 2, cellH / 2 + 1);
      } else if (p.kind === 'speed') {
        ctx.fillStyle = '#f7f6ee';
        ctx.fillRect(38, 3, cellW - 76, cellH - 6);
        ctx.strokeStyle = '#171717';
        ctx.lineWidth = 5;
        ctx.strokeRect(42, 7, cellW - 84, cellH - 14);
        ctx.fillStyle = '#111111';
        ctx.font = '700 18px Arial, sans-serif';
        ctx.fillText('SPEED', cellW / 2, 26);
        ctx.font = '900 48px Arial Black, sans-serif';
        ctx.fillText(p.text, cellW / 2, 63);
      } else if (p.kind === 'arrow') {
        ctx.fillStyle = '#f1efe4';
        ctx.beginPath();
        ctx.moveTo(142, 91); ctx.lineTo(165, 91); ctx.lineTo(165, 53);
        ctx.lineTo(104, 53); ctx.lineTo(104, 72); ctx.lineTo(55, 43);
        ctx.lineTo(104, 14); ctx.lineTo(104, 33); ctx.lineTo(142, 33);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.fillStyle = '#f1efe4';
        const text = p.text.toUpperCase();
        let size = 62;
        do { ctx.font = `900 ${size--}px Arial Black, sans-serif`; } while (size > 28 && ctx.measureText(text).width > cellW - 10);
        ctx.fillText(text, cellW / 2, cellH / 2);
      }
      ctx.restore();
    }

    const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
    for (const p of panels) {
      const slot = slots.get(`${p.kind}:${p.text}`);
      if (!slot) continue;
      const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
      const xx = { x: c, z: s }, zz = { x: -s, z: c };
      const hw = p.w / 2, hh = p.h / 2;
      const base = pos.length / 3;
      const corners = p.horizontal
        ? [
            [p.x - xx.x * hw - zz.x * hh, p.y, p.z - xx.z * hw - zz.z * hh],
            [p.x + xx.x * hw - zz.x * hh, p.y, p.z + xx.z * hw - zz.z * hh],
            [p.x + xx.x * hw + zz.x * hh, p.y, p.z + xx.z * hw + zz.z * hh],
            [p.x - xx.x * hw + zz.x * hh, p.y, p.z - xx.z * hw + zz.z * hh],
          ]
        : [
            [p.x - xx.x * hw, p.y - hh, p.z - xx.z * hw],
            [p.x + xx.x * hw, p.y - hh, p.z + xx.z * hw],
            [p.x + xx.x * hw, p.y + hh, p.z + xx.z * hw],
            [p.x - xx.x * hw, p.y + hh, p.z - xx.z * hw],
          ];
      for (const q of corners) {
        pos.push(q[0], q[1], q[2]);
        nor.push(p.horizontal ? 0 : zz.x, p.horizontal ? 1 : 0, p.horizontal ? 0 : zz.z);
      }
      const u0 = slot.x / canvas.width, u1 = (slot.x + cellW) / canvas.width;
      const v0 = 1 - (slot.y + cellH) / canvas.height, v1 = 1 - slot.y / canvas.height;
      uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geometry.setIndex(idx);
    geometry.computeBoundingSphere();
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, alphaTest: 0.22, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, toneMapped: false });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 5;
    mesh.userData.ownedStreetDetail = true;
    return mesh;
  }

  private addWireSpan(out: number[], a: PolePoint, b: PolePoint) {
    for (const side of [-0.52, 0, 0.52]) {
      const ax = a.x + a.rx * side, az = a.z + a.rz * side;
      const bx = b.x + b.rx * side, bz = b.z + b.rz * side;
      const ay = a.y + 7.2, by = b.y + 7.2;
      const mx = (ax + bx) / 2, my = (ay + by) / 2 - 0.42, mz = (az + bz) / 2;
      out.push(ax, ay, az, mx, my, mz, mx, my, mz, bx, by, bz);
    }
  }

  private addInstances(
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    placements: Placement[],
    shadow: boolean,
    renderOrder = 0,
  ) {
    if (!placements.length) return undefined;
    const mesh = new THREE.InstancedMesh(geo, mat, placements.length);
    const m = new THREE.Matrix4();
    for (let i = 0; i < placements.length; i++) {
      transformAt(placements[i], m);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = shadow;
    mesh.receiveShadow = shadow;
    mesh.renderOrder = renderOrder;
    mesh.computeBoundingSphere();
    this.addObject(mesh);
    return mesh;
  }

  private addObject<T extends THREE.Object3D>(object: T) {
    this.meshes.push(object);
    this.group.add(object);
    return object;
  }
}
