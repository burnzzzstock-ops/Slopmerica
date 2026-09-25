import * as THREE from 'three';
import type { Game } from '../game';
import type { TransitLine, TransitStop } from './types';

const box = (w: number, h: number, d: number, color: number, opacity = 1) => new THREE.Mesh(
  new THREE.BoxGeometry(w, h, d),
  new THREE.MeshStandardMaterial({ color, roughness: 0.72, metalness: color === 0x777b80 ? 0.7 : 0.08, transparent: opacity < 1, opacity }),
);

function stopGroup(stop: TransitStop) {
  const g = new THREE.Group();
  // Concrete pad, bench, glass shelter and the tall roundel sign.
  const pad = box(5.8, 0.14, 2.3, 0xb7b4ab); pad.position.y = 0.07; g.add(pad);
  const seat = box(3.1, 0.18, 0.55, 0x6f472a); seat.position.set(-0.5, 0.78, -0.55); g.add(seat);
  for (const x of [-1.65, 0.65]) { const leg = box(0.14, 0.72, 0.14, 0x34363b); leg.position.set(x, 0.39, -0.55); g.add(leg); }
  const back = box(4.2, 2.55, 0.08, 0x9ed4dc, 0.34); back.position.set(-0.15, 1.4, -0.95); g.add(back);
  const roof = box(4.6, 0.16, 2.1, 0x39434b); roof.position.set(-0.15, 2.74, -0.2); g.add(roof);
  for (const x of [-2.25, 1.95]) { const post = box(0.1, 2.6, 0.1, 0x777b80); post.position.set(x, 1.36, -0.92); g.add(post); }
  const pole = box(0.12, 3.35, 0.12, 0x777b80); pole.position.set(2.55, 1.72, 0); g.add(pole);
  const sign = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.48, 0.13, 16), new THREE.MeshStandardMaterial({ color: 0x168bc0, emissive: 0x06384c }));
  sign.rotation.x = Math.PI / 2; sign.position.set(2.55, 3.15, 0); g.add(sign);
  g.position.set(stop.x, stop.y + 0.05, stop.z);
  g.rotation.y = stop.yaw;
  g.userData.stopId = stop.id;
  return g;
}

function ribbon(points: THREE.Vector3[], color: number, width = 1.35) {
  const pos: number[] = [], idx: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
    const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
    const rx = -dz / l, rz = dx / l;
    pos.push(points[i].x - rx * width, points[i].y + 0.82, points[i].z - rz * width);
    pos.push(points[i].x + rx * width, points[i].y + 0.82, points[i].z + rz * width);
    if (i) { const k = (i - 1) * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.88, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -8 }));
  mesh.renderOrder = 6;
  mesh.frustumCulled = false;
  return mesh;
}

export class TransitRenderer {
  readonly group = new THREE.Group();
  private stopGroups = new Map<number, THREE.Group>();
  private lineMeshes = new Map<number, THREE.Mesh>();
  private draft: THREE.Mesh | null = null;

  constructor(private g: Game) {
    this.group.name = 'transit-overlay';
    this.g.scene.add(this.group);
  }

  syncStops(stops: Iterable<TransitStop>) {
    const keep = new Set<number>();
    for (const s of stops) {
      keep.add(s.id);
      let node = this.stopGroups.get(s.id);
      if (!node) { node = stopGroup(s); this.stopGroups.set(s.id, node); this.group.add(node); }
      node.visible = true;
      const scale = 1 + Math.min(0.8, Math.sqrt(Math.max(0, s.boardings)) / 18);
      node.scale.setScalar(scale);
    }
    for (const [id, node] of this.stopGroups) if (!keep.has(id)) { node.removeFromParent(); this.stopGroups.delete(id); }
  }

  syncLines(lines: Iterable<TransitLine>, path: (line: TransitLine) => THREE.Vector3[]) {
    const keep = new Set<number>();
    for (const line of lines) {
      keep.add(line.id);
      this.lineMeshes.get(line.id)?.removeFromParent();
      this.lineMeshes.get(line.id)?.geometry.dispose();
      const pts = path(line);
      if (pts.length > 1) {
        const mesh = ribbon(pts, line.color);
        this.lineMeshes.set(line.id, mesh);
        this.group.add(mesh);
      }
    }
    for (const [id, mesh] of this.lineMeshes) if (!keep.has(id)) { mesh.removeFromParent(); mesh.geometry.dispose(); this.lineMeshes.delete(id); }
  }

  setDraft(points: THREE.Vector3[], color: number) {
    if (this.draft) { this.draft.removeFromParent(); this.draft.geometry.dispose(); this.draft = null; }
    if (points.length > 1) { this.draft = ribbon(points, color, 0.9); this.group.add(this.draft); }
  }

  setRoutesVisible(visible: boolean) {
    for (const mesh of this.lineMeshes.values()) mesh.visible = visible;
  }

  setVisible(visible: boolean) {
    this.group.visible = visible;
  }
}
