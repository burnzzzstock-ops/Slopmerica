// Player tools: inspect, road (straight / curve / freeform), One More Lane,
// bulldoze, zoning brush. Converts pointer input into world edits.
import * as THREE from 'three';
import { add, Cubic, dist, lineCubic, norm, quadCubic, sampleCubic, scale, sub, V2, closestOnSampled } from '../core/math';
import type { PointerHandlers } from '../render/camera';
import type { Snap } from '../roads/network';
import { ROAD_TYPES, RoadTypeId } from '../roads/roadTypes';
import type { LandmarkId, ZoneType } from '../contracts';
import { landmarkFootprint } from '../buildings/generator';
import type { Game } from '../game';

export type ToolId = 'inspect' | 'road' | 'upgrade' | 'bulldoze' | 'zone' | 'dezone' | 'landmark';
export type RoadMode = 'straight' | 'curve' | 'freeform';

export interface ToolTip {
  text: string;
  bad?: boolean;
}

export class Tools implements PointerHandlers {
  active: ToolId = 'inspect';
  roadType: RoadTypeId = 'twoLane';
  roadMode: RoadMode = 'straight';
  zoneType: ZoneType = 'resLow';
  brush = 1; // 0 small, 1 medium, 2 large
  landmark: LandmarkId = 'slopCannon';
  tip: ToolTip | null = null;
  onChange?: () => void;

  private start: Snap | null = null;
  private control: V2 | null = null;
  private lastDir: V2 | null = null;
  private hover: THREE.Vector3 | null = null;
  private painting = false;

  private preview: THREE.Mesh;
  private previewMat: THREE.MeshBasicMaterial;
  private marker: THREE.Mesh;
  private highlight: THREE.Mesh;
  private brushRing: THREE.Mesh;

  constructor(private game: Game) {
    this.previewMat = new THREE.MeshBasicMaterial({ color: 0x7fd8ff, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
    this.preview = new THREE.Mesh(new THREE.BufferGeometry(), this.previewMat);
    this.preview.renderOrder = 5;
    this.preview.visible = false;
    const ring = new THREE.RingGeometry(3.2, 4.2, 32);
    ring.rotateX(-Math.PI / 2);
    this.marker = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false }));
    this.marker.renderOrder = 6;
    this.marker.visible = false;
    this.highlight = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0xff4d4d, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide }));
    this.highlight.renderOrder = 5;
    this.highlight.visible = false;
    const br = new THREE.RingGeometry(0.93, 1, 48);
    br.rotateX(-Math.PI / 2);
    this.brushRing = new THREE.Mesh(br, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthTest: false }));
    this.brushRing.renderOrder = 6;
    this.brushRing.visible = false;
    game.scene.add(this.preview, this.marker, this.highlight, this.brushRing);
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.cancel();
    });
  }

  set(tool: ToolId) {
    this.cancel();
    this.active = tool;
    this.game.zones?.setOverlay(tool === 'zone' || tool === 'dezone');
    this.onChange?.();
  }

  brushRadius() {
    return [10, 22, 44][this.brush];
  }

  toolCapturesDrag(): boolean {
    return this.active === 'zone' || this.active === 'dezone' || this.active === 'bulldoze' || this.active === 'road' || this.active === 'landmark';
  }

  touchLift(): number {
    return this.active === 'road' || this.active === 'landmark' ? 64 : 0;
  }

  /** Is a road stroke in progress? (for the touch Done button) */
  get drawing() {
    return this.active === 'road' && !!this.start;
  }

  private snapR() {
    return Math.max(this.game.isTouch ? 16 : 10, this.game.rts.distance * (this.game.isTouch ? 0.03 : 0.015));
  }
  private startedThisTouch = false;

  cancel() {
    this.start = null;
    this.control = null;
    this.lastDir = null;
    this.painting = false;
    this.preview.visible = false;
    this.tip = null;
    this.onChange?.();
  }

  // ------------------------------------------------------------------ pointer
  down(p: THREE.Vector3 | null, e: PointerEvent) {
    if (!p) return;
    if (e.button === 2) { this.cancel(); return; }
    this.hover = p;
    if (this.active === 'road' && e.pointerType !== 'mouse') {
      this.startedThisTouch = false;
      if (!this.start) {
        this.start = this.game.net.snap(p.x, p.z, this.snapR());
        this.lastDir = null;
        this.startedThisTouch = true;
        this.game.audio.play('click');
      }
      return;
    }
    switch (this.active) {
      case 'zone':
      case 'dezone':
        this.painting = true;
        this.paint(p);
        break;
      case 'bulldoze':
        this.painting = true;
        break;
      case 'inspect':
        break;
    }
  }

  move(p: THREE.Vector3 | null, _e: PointerEvent, dragging: boolean) {
    this.hover = p;
    if (!p) return;
    if ((this.active === 'zone' || this.active === 'dezone') && this.painting && dragging) this.paint(p);
    if (this.active === 'bulldoze' && this.painting && dragging) this.bulldozeAt(p);
  }

  up(p: THREE.Vector3 | null, e: PointerEvent, wasDrag: boolean) {
    const wasPainting = this.painting;
    this.painting = false;
    if (!p) return;
    if (e.button === 2) return;
    switch (this.active) {
      case 'road':
        if (e.pointerType === 'mouse') {
          if (!wasDrag) this.roadClick(p);
        } else if (this.startedThisTouch && !wasDrag) {
          // tapped the start point: wait for the next drag or tap
        } else if (this.roadMode === 'curve' && !this.control) {
          this.control = { x: p.x, z: p.z };
          this.game.audio.play('click');
        } else this.roadClick(p);
        this.startedThisTouch = false;
        break;
      case 'upgrade':
        if (!wasDrag) this.upgradeAt(p, e.shiftKey);
        break;
      case 'bulldoze':
        if (!wasDrag || !wasPainting) this.bulldozeAt(p);
        break;
      case 'inspect':
        if (!wasDrag) this.game.inspect(p, e);
        break;
      case 'landmark':
        if (!wasDrag && this.game.placeLandmark(this.landmark, p)) this.set('inspect');
        break;
    }
  }

  // ------------------------------------------------------------------ road tool
  private curveTo(end: V2): Cubic | null {
    if (!this.start) return null;
    const a: V2 = { x: this.start.x, z: this.start.z };
    if (this.roadMode === 'curve' && this.control) return quadCubic(a, this.control, end);
    if (this.roadMode === 'freeform') {
      const dir = this.lastDir ?? this.game.net.continueDir(this.start);
      if (dir) {
        const L = dist(a, end);
        const c = add(a, scale(dir, L * 0.5));
        return quadCubic(a, c, end);
      }
    }
    return lineCubic(a, end);
  }

  private snapEnd(p: THREE.Vector3): Snap {
    let s = this.game.net.snap(p.x, p.z, this.snapR());
    // angle snapping for straight roads (15° steps) when free
    if (s.kind === 'free' && this.start && this.roadMode === 'straight') {
      const a = { x: this.start.x, z: this.start.z };
      const d = sub({ x: p.x, z: p.z }, a);
      const L = Math.hypot(d.x, d.z);
      const ang = Math.atan2(d.z, d.x);
      const step = Math.PI / 12;
      const snapped = Math.round(ang / step) * step;
      if (Math.abs(snapped - ang) < 0.05) {
        const Ls = Math.round(L / 8) * 8 || L;
        s = { kind: 'free', x: a.x + Math.cos(snapped) * Ls, z: a.z + Math.sin(snapped) * Ls };
      }
    }
    return s;
  }

  private roadClick(p: THREE.Vector3) {
    const net = this.game.net;
    if (!this.start) {
      this.start = net.snap(p.x, p.z, this.snapR());
      this.lastDir = null;
      this.game.audio.play('click');
      return;
    }
    if (this.roadMode === 'curve' && !this.control) {
      this.control = { x: p.x, z: p.z };
      this.game.audio.play('click');
      return;
    }
    const end = this.snapEnd(p);
    const curve = this.curveTo({ x: end.x, z: end.z });
    if (!curve) return;
    const plan = net.plan(this.start, curve, this.roadType, this.game.sim.spendable());
    if (!plan.ok) {
      this.game.toast(plan.reason ?? 'Nope', true);
      this.game.audio.play('error');
      return;
    }
    const segs = net.build(this.start, end, curve, this.roadType);
    if (segs.length) {
      this.game.sim.spend(plan.cost, 'Road construction');
      if (plan.grant > 0) this.game.sim.earn(plan.grant, 'grants');
      if (plan.grant > 0) this.game.floatText(`+$${plan.grant.toLocaleString()} Federal Slop Grant`, p, '#9dff3c');
      this.game.onRoadBuilt(segs, plan);
      this.game.pushUndo({ kind: 'build', segIds: segs.map((x) => x.id), refund: plan.cost - plan.grant });
      // continue drawing from the end like Skylines
      const last = segs[segs.length - 1];
      const endNode = net.nodes.get(last.b)!;
      const samp = sampleCubic(curve, 4);
      const n = samp.pts.length;
      this.lastDir = norm(sub(samp.pts[n - 1], samp.pts[n - 2]));
      this.start = { kind: 'node', id: endNode.id, x: endNode.x, z: endNode.z };
      this.control = null;
    }
  }

  private upgradeAt(p: THREE.Vector3, wholeStreet: boolean) {
    const net = this.game.net;
    const pick = net.pickSeg(p.x, p.z, 3);
    if (!pick) return;
    const segs = wholeStreet ? [...net.segs.values()].filter((s) => s.street === pick.seg.street && s.type === pick.seg.type) : [pick.seg];
    const next = ROAD_TYPES[pick.seg.type].next;
    if (!next) {
      this.game.toast('MAX LANES. For now. (Try a highway.)', true);
      return;
    }
    let cost = 0, grant = 0;
    for (const s of segs) {
      const c = s.length * (ROAD_TYPES[next].costPerM - ROAD_TYPES[s.type].costPerM * 0.3);
      cost += c;
      grant += c * ROAD_TYPES[next].fedGrant;
    }
    if (cost - grant > this.game.sim.spendable()) {
      this.game.toast('Not enough money for one more lane', true);
      this.game.audio.play('error');
      return;
    }
    const prev = segs.map((s) => ({ id: s.id, type: s.type }));
    for (const s of segs) net.upgrade(s.id, next);
    this.game.pushUndo({ kind: 'upgrade', prev, refund: Math.round(cost - grant) });
    this.game.sim.spend(Math.round(cost), 'ONE MORE LANE');
    this.game.sim.earn(Math.round(grant), 'grants');
    if (grant > 0) this.game.floatText(`+$${Math.round(grant).toLocaleString()} Federal Slop Grant`, p, '#9dff3c');
    this.game.onLaneAdded(segs, next);
  }

  private bulldozeAt(p: THREE.Vector3) {
    if (this.game.bulldozeAt(p)) return;
    const pick = this.game.net.pickSeg(p.x, p.z, 1);
    if (!pick) return;
    this.game.net.removeSeg(pick.seg.id);
    this.game.sim.refund(Math.round(pick.seg.length * ROAD_TYPES[pick.seg.type].costPerM * 0.2));
    this.game.audio.play('bulldoze');
    this.game.particles.emit('dust', p.x, p.y + 1, p.z, { count: 30, spread: 6 });
  }

  private paint(p: THREE.Vector3) {
    this.game.zones.paint(p.x, p.z, this.brushRadius(), this.active === 'dezone' ? null : this.zoneType);
  }

  // ------------------------------------------------------------------ per frame
  update() {
    const net = this.game.net;
    const hov = this.hover;
    this.marker.visible = false;
    this.highlight.visible = false;
    this.brushRing.visible = false;
    if (!hov) return;
    if (this.active === 'road') {
      const s = this.start ? this.snapEnd(hov) : net.snap(hov.x, hov.z, this.snapR());
      this.marker.visible = true;
      this.marker.position.set(s.x, this.game.terrain.h(s.x, s.z) + 0.6, s.z);
      (this.marker.material as THREE.MeshBasicMaterial).color.set(s.kind === 'free' ? 0xffffff : 0x9dff3c);
      if (this.start) {
        const end: V2 = { x: s.x, z: s.z };
        let curve: Cubic | null;
        if (this.roadMode === 'curve' && !this.control) curve = lineCubic({ x: this.start.x, z: this.start.z }, end);
        else curve = this.curveTo(end);
        if (curve) {
          const plan = net.plan(this.start, curve, this.roadType, this.game.sim.spendable());
          this.drawRibbon(this.preview, curve, ROAD_TYPES[this.roadType].width);
          this.preview.visible = true;
          this.previewMat.color.set(plan.ok ? 0x7fd8ff : 0xff4d4d);
          const net$ = plan.cost - plan.grant;
          this.tip = plan.ok
            ? { text: `${Math.round(plan.length)} m · $${net$.toLocaleString()}${plan.grant ? ` (feds pay $${plan.grant.toLocaleString()})` : ''}${plan.bridgeLen > 5 ? ' · bridge' : ''}` }
            : { text: plan.reason ?? 'Nope', bad: true };
        }
      } else {
        this.preview.visible = false;
        this.tip = { text: this.game.isTouch ? `${ROAD_TYPES[this.roadType].name}: drag from where the road starts · two fingers move the map` : `${ROAD_TYPES[this.roadType].name}: click to start` };
      }
    } else if (this.active === 'upgrade' || this.active === 'bulldoze') {
      const pick = net.pickSeg(hov.x, hov.z, this.active === 'bulldoze' ? 1 : 3);
      const b = this.active === 'bulldoze' ? this.game.buildingAt(hov) : null;
      if (b) {
        this.tip = { text: `Bulldoze ${b}` , bad: true };
      } else if (pick) {
        this.drawRibbon(this.highlight, pick.seg.curve, ROAD_TYPES[pick.seg.type].width + 1);
        this.highlight.visible = true;
        (this.highlight.material as THREE.MeshBasicMaterial).color.set(this.active === 'upgrade' ? 0x9dff3c : 0xff4d4d);
        const t = ROAD_TYPES[pick.seg.type];
        this.tip = this.active === 'upgrade'
          ? t.next ? { text: `ONE MORE LANE: ${t.name} → ${ROAD_TYPES[t.next].name} (shift = whole street)` } : { text: 'Already MAX LANES', bad: true }
          : { text: `Bulldoze ${pick.seg.name}`, bad: true };
      } else this.tip = null;
    } else if (this.active === 'landmark') {
      const fp = landmarkFootprint(this.landmark);
      const chk = this.game.canPlaceLandmark(this.landmark, hov.x, hov.z);
      const w = fp.widthCells * 8, d = fp.depthCells * 8;
      const c = Math.cos(chk.yaw), s = Math.sin(chk.yaw);
      const corners = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([lx, lz]) => ({ x: hov.x + lx * c + lz * s, z: hov.z - lx * s + lz * c }));
      const pos: number[] = [];
      for (const k of [0, 1, 2, 0, 2, 3]) pos.push(corners[k].x, hov.y + 1, corners[k].z);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      this.highlight.geometry.dispose();
      this.highlight.geometry = g;
      this.highlight.visible = true;
      (this.highlight.material as THREE.MeshBasicMaterial).color.set(chk.ok ? 0x9dff3c : 0xff4d4d);
      this.tip = chk.ok ? { text: 'Click to place (faces the nearest road)' } : { text: chk.reason ?? 'Nope', bad: true };
    } else if (this.active === 'zone' || this.active === 'dezone') {
      const r = this.brushRadius();
      this.brushRing.visible = true;
      this.brushRing.scale.set(r, 1, r);
      this.brushRing.position.set(hov.x, hov.y + 0.8, hov.z);
      this.tip = null;
    } else this.tip = null;
  }

  private drawRibbon(mesh: THREE.Mesh, c: Cubic, width: number) {
    const s = sampleCubic(c, 3);
    const pos: number[] = [];
    const idx: number[] = [];
    const hw = width / 2;
    for (let i = 0; i < s.pts.length; i++) {
      const p = s.pts[i];
      const q = s.pts[Math.min(i + 1, s.pts.length - 1)], o = s.pts[Math.max(0, i - 1)];
      const t = norm(sub(q, o));
      const r = { x: -t.z, z: t.x };
      const y = Math.max(this.game.terrain.h(p.x, p.z), 0) + 0.9;
      pos.push(p.x - r.x * hw, y, p.z - r.z * hw, p.x + r.x * hw, y, p.z + r.z * hw);
      if (i > 0) {
        const a = (i - 1) * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    mesh.geometry.dispose();
    mesh.geometry = g;
  }
}

export { closestOnSampled };
