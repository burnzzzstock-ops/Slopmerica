// The placement preview for special buildings (services, depots, landmarks):
// the building's own model as a translucent volume at exactly the transform
// it will be built with, its footprint on the ground, and an arrow at the
// entrance pointing to the road it fronts.
import * as THREE from 'three';
import type { V2 } from '../core/math';

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

  constructor(scene: THREE.Scene, name = 'placement-ghost') {
    this.group.name = name;
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

  hide() {
    this.group.visible = false;
  }
}
