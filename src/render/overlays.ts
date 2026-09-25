// Info views: traffic congestion ribbons and land-value building tint.
import * as THREE from 'three';
import type { ExtView } from '../ext/registry';
import { lerp } from '../core/math';
import { ROAD_TYPES } from '../roads/roadTypes';
import type { Game } from '../game';

export type ViewMode = 'none' | 'traffic' | 'landValue';

const C_GOOD = new THREE.Color(0x3ddc84);
const C_MID = new THREE.Color(0xffd23a);
const C_BAD = new THREE.Color(0xff3b3b);

export class Overlays {
  mode: ViewMode = 'none';
  /** active extension info view (exclusive with the core modes) */
  ext: ExtView | null = null;
  private traffic: THREE.Mesh;
  private t = 0;

  constructor(private game: Game) {
    this.traffic = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -10 }));
    this.traffic.renderOrder = 4;
    this.traffic.visible = false;
    this.traffic.frustumCulled = false;
    game.scene.add(this.traffic);
  }

  setExt(v: ExtView | null) {
    if (this.ext && this.ext !== v) this.ext.disable(this.game);
    if (v) this.set('none');
    this.ext = v;
    v?.enable(this.game);
  }

  set(mode: ViewMode) {
    if (mode !== 'none' && this.ext) { this.ext.disable(this.game); this.ext = null; }
    if (this.mode === 'landValue' && mode !== 'landValue') this.resetBuildingColors();
    this.mode = mode;
    this.traffic.visible = mode === 'traffic';
    this.t = 0;
  }

  /** Tint every building (null = no tint). For info views. */
  tintBuildings(colorFor: (b: import('../sim/buildings').Bld) => THREE.Color | null) {
    const B = this.game.buildings;
    for (const b of B.list.values()) B.setTint(b, colorFor(b));
  }

  resetBuildingColors() {
    const B = this.game.buildings;
    for (const b of B.list.values()) B.setTint(b, null);
  }

  update(dt: number) {
    if (this.ext) { this.ext.update?.(this.game, dt); return; }
    if (this.mode === 'none') return;
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 0.5;
    if (this.mode === 'traffic') this.buildTraffic();
    else if (this.mode === 'landValue') {
      const c = new THREE.Color();
      for (const b of this.game.buildings.list.values()) {
        if (b.inst < 0) continue;
        const v = b.lv / 100;
        c.copy(C_BAD).lerp(C_MID, Math.min(1, v * 2)).lerp(C_GOOD, Math.max(0, v * 2 - 1));
        this.game.buildings.setTint(b, c);
      }
    }
  }

  private buildTraffic() {
    const pos: number[] = [], col: number[] = [], idx: number[] = [];
    const c = new THREE.Color();
    for (const s of this.game.net.segs.values()) {
      const vc = s.vc;
      c.copy(C_GOOD).lerp(C_MID, Math.min(1, vc / 0.5)).lerp(C_BAD, Math.max(0, Math.min(1, (vc - 0.5) / 0.5)));
      if (s.blocked > 0) c.set(0xff00aa);
      const hw = ROAD_TYPES[s.type].width / 2 + 0.3;
      const pts = s.samp.pts;
      const base = pos.length / 3;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
        const tx = b.x - a.x, tz = b.z - a.z;
        const l = Math.hypot(tx, tz) || 1;
        const rx = -tz / l, rz = tx / l;
        const y = s.hs[i] + 0.5;
        pos.push(pts[i].x - rx * hw, y, pts[i].z - rz * hw, pts[i].x + rx * hw, y, pts[i].z + rz * hw);
        col.push(c.r, c.g, c.b, c.r, c.g, c.b);
        if (i > 0) {
          const k = base + (i - 1) * 2;
          idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    this.traffic.geometry.dispose();
    this.traffic.geometry = g;
    void lerp;
  }
}
