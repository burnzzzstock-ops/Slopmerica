// The placement preview for special buildings (services, depots, landmarks):
// the building's own model as a translucent volume at exactly the transform
// it will be built with, its footprint on the ground, and an arrow at the
// entrance pointing to the road it fronts. When another building is in the
// way, that building gets a red outline drawn over everything.
import * as THREE from 'three';
import type { V2 } from '../core/math';

/** a building in the way: its footprint (half extents), where it stands and how tall it is */
export interface Blocker { x: number; y: number; z: number; yaw: number; hw: number; hd: number; model: { height: number } }

export class PlacementGhost {
  readonly group = new THREE.Group();
  private model: THREE.Mesh;
  private pad: THREE.Mesh;
  private door: THREE.Mesh;
  private bodyMat = new THREE.MeshBasicMaterial({ color: 0x57e389, transparent: true, opacity: 0.38, depthWrite: false });
  private padMat = new THREE.MeshBasicMaterial({ color: 0x57e389, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 });
  private doorMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide });
  private geos = new Map<string, THREE.BufferGeometry>();
  private key = '';
  /** the blocking building's box: faint red fill and bright edges, visible through trees and at night */
  readonly blocker = new THREE.Group();

  constructor(scene: THREE.Scene, name = 'placement-ghost') {
    this.group.name = name;
    this.blocker.name = `${name}-blocker`;
    const box = new THREE.BoxGeometry(1, 1, 1);
    box.translate(0, 0.5, 0);
    const fill = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: 0xff3b30, transparent: true, opacity: 0.2, depthWrite: false, depthTest: false }));
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(box), new THREE.LineBasicMaterial({ color: 0xff5a4a, transparent: true, opacity: 1, depthTest: false }));
    fill.renderOrder = 8;
    edges.renderOrder = 9;
    this.blocker.add(fill, edges);
    this.blocker.visible = false;
    scene.add(this.blocker);
    this.model = new THREE.Mesh(new THREE.BufferGeometry(), this.bodyMat);
    this.model.renderOrder = 5;
    const pg = new THREE.PlaneGeometry(1, 1);
    pg.rotateX(-Math.PI / 2);
    this.pad = new THREE.Mesh(pg, this.padMat);
    this.pad.renderOrder = 4;
    // a chevron on the ground at the entrance, pointing out to the street
    const sh = new THREE.Shape();
    sh.moveTo(-1.6, 0); sh.lineTo(0, 1.8); sh.lineTo(1.6, 0); sh.lineTo(0.9, 0); sh.lineTo(0, 0.95); sh.lineTo(-0.9, 0); sh.closePath();
    const dg = new THREE.ShapeGeometry(sh);
    dg.rotateX(Math.PI / 2); // shape +y -> world +z (toward the road)
    this.door = new THREE.Mesh(dg, this.doorMat);
    this.door.renderOrder = 7;
    this.group.add(this.model, this.pad, this.door);
    this.group.visible = false;
    scene.add(this.group);
  }

  /**
   * Show `key`'s model (made once by `make`) at x, y, z facing yaw, with a
   * hw x hd footprint; `door` marks the entrance (null: no road yet).
   */
  show(key: string, make: () => THREE.BufferGeometry, x: number, y: number, z: number, yaw: number, hw: number, hd: number, ok: boolean, door: V2 | null) {
    if (key !== this.key) {
      let g = this.geos.get(key);
      if (!g) { g = make(); this.geos.set(key, g); }
      this.model.geometry = g;
      this.key = key;
    }
    const col = ok ? 0x57e389 : 0xff5a4a;
    this.bodyMat.color.setHex(col);
    this.padMat.color.setHex(col);
    this.group.visible = true;
    this.model.position.set(x, y, z);
    this.model.rotation.set(0, yaw, 0);
    this.pad.position.set(x, y + 0.15, z);
    this.pad.rotation.set(0, yaw, 0);
    this.pad.scale.set(hw * 2, 1, hd * 2);
    this.door.visible = !!door;
    if (door) {
      this.door.position.set(door.x, y + 0.4, door.z);
      this.door.rotation.set(0, yaw, 0);
    }
  }

  /** Outline the building that's in the way (null: nothing is). */
  showBlocker(b: Blocker | null) {
    if (!b) { this.blocker.visible = false; return; }
    this.blocker.visible = true;
    this.blocker.position.set(b.x, b.y - 0.3, b.z);
    this.blocker.rotation.set(0, b.yaw, 0);
    this.blocker.scale.set(b.hw * 2 + 1.2, Math.max(4, b.model.height) + 1.5, b.hd * 2 + 1.2);
  }

  hide() {
    this.group.visible = false;
    this.blocker.visible = false;
  }
}
