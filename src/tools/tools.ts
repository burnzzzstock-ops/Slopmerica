// Player tools: inspect, road (straight / curve / freeform), One More Lane,
// bulldoze, zoning brush. Converts pointer input into world edits.
import * as THREE from 'three';
import { add, Cubic, dist, lineCubic, locate, norm, quadCubic, sampleCubic, scale, sub, V2, closestOnSampled } from '../core/math';
import type { PointerHandlers } from '../render/camera';
import type { Snap } from '../roads/network';
import { ROAD_TYPES, RoadTypeId } from '../roads/roadTypes';
import type { LandmarkId, ZoneType } from '../contracts';
import { ZONE_LABEL } from '../zones/zoning';
import { generateLandmark, landmarkFootprint } from '../buildings/generator';
import { PlacementGhost } from './placementGhost';
import { LANDMARK_COST, LANDMARKS, type Game } from '../game';
import { EXT, type ExtTool } from '../ext/registry';
import { crumb } from '../ui/bugreport';
import { buildGrid, GRID_BLOCKS, gridShape, gridSpacing, planGrid, type GridBlock, type GridLineState, type GridShape } from './gridRoads';

export type ToolId = 'inspect' | 'road' | 'upgrade' | 'bulldoze' | 'zone' | 'dezone' | 'landmark' | 'ext';
export type RoadMode = 'straight' | 'curve' | 'freeform' | 'grid';

export interface ToolTip {
  text: string;
  bad?: boolean;
  /** a success to confirm (drawn green) */
  good?: boolean;
}

const BRUSH_SEGS = 72;

export class Tools implements PointerHandlers {
  active: ToolId = 'inspect';
  roadType: RoadTypeId = 'twoLane';
  roadMode: RoadMode = 'straight';
  /** grid mode: block size (lot rows either side of each street) */
  gridBlock: GridBlock = 'M';
  zoneType: ZoneType = 'resLow';
  brush = 1; // 0 small, 1 medium, 2 large
  landmark: LandmarkId = 'slopCannon';
  tip: ToolTip | null = null;
  onChange?: () => void;
  /** id of the registered extension tool when active === 'ext' */
  extTool: string | null = null;
  private get ext(): ExtTool | undefined {
    return this.active === 'ext' && this.extTool ? EXT.tools.get(this.extTool) : undefined;
  }

  /** touch: the extension tool's planned placement waiting for Build, if any */
  /**
   * What the player has in hand, for the "Placing …" badge: the service,
   * depot or landmark about to be built (null for road, zoning and brushes).
   */
  get placingLabel(): string | null {
    if (this.active === 'ext') return this.ext?.placing?.(this.game) ?? null;
    if (this.active === 'landmark') { const l = LANDMARKS.find((x) => x.id === this.landmark); return l ? `${l.icon} ${l.name}` : 'Landmark'; }
    return null;
  }

  /**
   * Right-click: cancel whatever is in progress (a planned spot, a draft);
   * with nothing in progress, put a placement tool away. Roads keep their
   * tool (a right-click ends the road being drawn).
   */
  rightClick() {
    const busy = !!this.extPending || !!this.pending || (this.active === 'ext' && !!this.ext?.busy?.(this.game));
    if (busy || !this.placingLabel) { this.cancel(); return; }
    crumb('right-click: put the tool away');
    this.set('inspect');
  }

  get extPending(): { cost: number | null } | null {
    return this.ext?.pending?.(this.game) ?? null;
  }
  confirmExt() {
    this.ext?.confirm?.(this.game);
    this.onChange?.();
  }
  /** the action-bar Done: let an extension tool finish its draft first */
  finishExt() {
    this.ext?.done?.(this.game);
  }

  /** Activate a registered extension tool (see src/ext/registry.ts). */
  setExt(id: string) {
    this.set('ext');
    this.extTool = id;
    this.onChange?.();
  }

  private start: Snap | null = null;
  private control: V2 | null = null;
  private lastDir: V2 | null = null;
  private hover: THREE.Vector3 | null = null;
  /** last terrain point under the cursor (for extension tools) */
  get hoverPoint() {
    return this.hover;
  }
  private painting = false;

  private preview: THREE.Mesh;
  private previewMat: THREE.MeshBasicMaterial;
  private marker: THREE.Mesh;
  /** where the road being drawn starts (lime ring) */
  private startPin: THREE.Mesh;
  private highlight: THREE.Mesh;
  private brushRing: THREE.Mesh;
  private ghost: PlacementGhost;

  constructor(private game: Game) {
    this.previewMat = new THREE.MeshBasicMaterial({ color: 0x7fd8ff, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide, vertexColors: true });
    this.preview = new THREE.Mesh(new THREE.BufferGeometry(), this.previewMat);
    this.preview.renderOrder = 5;
    this.preview.visible = false;
    const ring = new THREE.RingGeometry(3.2, 4.2, 32);
    ring.rotateX(-Math.PI / 2);
    this.marker = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false }));
    this.marker.renderOrder = 6;
    this.marker.visible = false;
    this.startPin = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: 0x9dff3c, transparent: true, opacity: 0.95, depthTest: false }));
    this.startPin.renderOrder = 7;
    this.startPin.visible = false;
    this.highlight = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0xff4d4d, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide }));
    this.highlight.renderOrder = 5;
    this.highlight.visible = false;
    // the zoning brush: a ring draped on the ground (it follows the slope and
    // hides behind trees and buildings, instead of a flat hoop drawn over them)
    const br = new THREE.BufferGeometry();
    br.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(BRUSH_SEGS * 2 * 3), 3));
    const idx: number[] = [];
    for (let i = 0; i < BRUSH_SEGS; i++) {
      const a = i * 2, b = ((i + 1) % BRUSH_SEGS) * 2;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
    br.setIndex(idx);
    this.brushRing = new THREE.Mesh(br, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }));
    this.brushRing.renderOrder = 6;
    this.brushRing.frustumCulled = false;
    this.brushRing.visible = false;
    game.scene.add(this.preview, this.marker, this.startPin, this.highlight, this.brushRing);
    this.ghost = new PlacementGhost(game.scene, 'landmark-ghost');
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.cancel();
    });
  }

  set(tool: ToolId) {
    if (tool !== this.active) crumb(`tool ${tool}`);
    this.cancel();
    // a finger's last spot isn't a hover: don't carry it into the next tool
    if (this.game.isTouch) this.hover = null;
    if (tool !== 'ext') this.extTool = null;
    this.active = tool;
    this.game.zones?.setOverlay(tool === 'zone' || tool === 'dezone');
    this.onChange?.();
  }

  private impactKey = '';
  private impact = { upkeep: 0, upkeepLater: 0, trees: 0, joins: '' as string };
  /** Upkeep, trees cleared and connection for the road being drawn (cached per shape). */
  private roadImpact(curve: Cubic, end: V2) {
    const key = `${this.roadType}|${curve.p0.x.toFixed(1)},${curve.p0.z.toFixed(1)}|${curve.p1.x.toFixed(1)},${curve.p1.z.toFixed(1)}|${curve.p2.x.toFixed(1)},${curve.p2.z.toFixed(1)}|${end.x.toFixed(1)},${end.z.toFixed(1)}`;
    if (key === this.impactKey) return this.impact;
    this.impactKey = key;
    const net = this.game.net, t = ROAD_TYPES[this.roadType];
    const samp = sampleCubic(curve, 4);
    const perWk = samp.length * t.upkeepPerM;
    const name = (s: Snap | null) => {
      if (!s) return '';
      if (s.kind === 'seg') return net.segs.get(s.id)?.name ?? 'a road';
      if (s.kind === 'node') { const n = net.nodes.get(s.id); const sg = n && n.segs.length ? net.segs.get(n.segs[0]) : null; return sg?.name ?? ''; }
      return '';
    };
    const joins = name(this.start) || name(net.snap(end.x, end.z, 6));
    this.impact = {
      upkeep: Math.max(1, Math.round(perWk * 0.35)),
      upkeepLater: Math.max(1, Math.round(perWk)),
      trees: this.game.trees.countAlong(samp.pts, t.width / 2 + 4),
      joins,
    };
    return this.impact;
  }

  /**
   * The Growth Ponzi at the moment of choosing: the weekly balance before and
   * after this road, and where it lands once today's roads (this one too)
   * have aged four years at today's taxes. Null in sandbox.
   */
  private budgetAfter(upkeep: number, upkeepLater: number): { text: string; flips: boolean; now: number; after: number } | null {
    const s = this.game.sim;
    if (s.money === Infinity) return null;
    const rate = (v: number) => `${v < 0 ? '−' : '+'}$${Math.abs(Math.round(v)).toLocaleString()}`;
    const now = s.forecastWeek().net, after = now - upkeep;
    const aged = after - (this.game.net.upkeep(365 * 4) - this.game.net.upkeep()) - (upkeepLater - upkeep);
    const flips = now >= 0 && after < 0;
    return {
      now, after, flips,
      text: `${flips ? '⚠️ ' : ''}budget ${rate(now)} → ${rate(after)}/wk${aged < after - 1 ? ` (${rate(aged)}/wk once roads age)` : ''}`,
    };
  }

  brushRadius() {
    return [10, 22, 44][this.brush];
  }

  private drapeBrush(cx: number, cz: number, r: number) {
    const pos = this.brushRing.geometry.getAttribute('position') as THREE.BufferAttribute;
    const w = Math.max(0.7, r * 0.05);
    const T = this.game.terrain;
    for (let i = 0; i < BRUSH_SEGS; i++) {
      const a = (i / BRUSH_SEGS) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
      for (let j = 0; j < 2; j++) {
        const R = j ? r : r - w, x = cx + c * R, z = cz + sn * R;
        pos.setXYZ(i * 2 + j, x, T.h(x, z) + 0.6, z);
      }
    }
    pos.needsUpdate = true;
    this.brushRing.visible = true;
  }

  toolCapturesDrag(): boolean {
    if (this.active === 'ext') return !!this.ext?.capturesDrag;
    return this.active === 'zone' || this.active === 'dezone' || this.active === 'bulldoze' || this.active === 'road' || this.active === 'landmark';
  }

  touchLift(): number {
    if (this.active === 'ext') return this.ext?.touchLift ?? 0;
    return this.active === 'road' || this.active === 'landmark' ? 64 : 0;
  }

  /** Is a road stroke in progress? (for the touch Done button) */
  get drawing() {
    return this.active === 'road' && (!!this.start || !!this.grid.a);
  }

  // Touch roads are planned first and built on confirm (no accidental roads).
  private pendingEnd: THREE.Vector3 | null = null;
  /** the start is the end of a road just built (not a point the player picked) */
  private chained = false;
  private touchDown = false;
  /** net cost of the planned touch road, or null when nothing is waiting */
  pendingCost: number | null = null;
  /** touch: where a landmark is planned, waiting for the Build button */
  private landmarkAt: THREE.Vector3 | null = null;
  /** A planned (touch) road or landmark is waiting for the Build button. */
  get pending() {
    if (this.active === 'landmark') return !!this.landmarkAt;
    if (this.active === 'road' && this.roadMode === 'grid') return !!this.grid.c && !!this.gridCache?.plan.ok;
    return this.active === 'road' && !!this.start && !!this.pendingEnd;
  }
  /** Build the planned touch road or landmark (the action-bar Build button). */
  buildPending() {
    if (this.active === 'landmark') {
      if (this.landmarkAt && this.game.placeLandmark(this.landmark, this.landmarkAt)) { crumb(`placed landmark ${this.landmark}`); this.set('inspect'); }
      return;
    }
    if (this.active === 'road' && this.roadMode === 'grid') {
      if (this.grid.c) this.gridBuild(this.grid.c);
      this.onChange?.();
      return;
    }
    if (!this.pendingEnd || !this.start) return;
    const p = this.pendingEnd;
    this.pendingEnd = null;
    this.pendingCost = null;
    this.roadClick(p);
    this.onChange?.();
  }

  private snapR() {
    return Math.max(this.game.isTouch ? 16 : 10, this.game.rts.distance * (this.game.isTouch ? 0.03 : 0.015));
  }
  private startedThisTouch = false;

  cancel() {
    this.ext?.cancel?.(this.game);
    this.landmarkAt = null;
    this.pendingEnd = null;
    this.pendingCost = null;
    this.grid = { a: null, align: [], b: null, c: null, startedThisTouch: false };
    this.chained = false;
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
    // right button: roads and brushes stop what they're doing at once; placing
    // tools wait for the release so a right-drag can still orbit the camera
    if (e.button === 2) { if (!this.placingLabel && this.active !== 'ext') this.cancel(); return; }
    this.hover = p;
    if (this.active === 'ext') { this.ext?.down?.(this.game, p, e); return; }
    if (this.active === 'road' && e.pointerType !== 'mouse' && this.roadMode === 'grid') {
      this.touchDown = true;
      this.grid.startedThisTouch = false;
      if (!this.grid.a) {
        // the first corner goes right under the finger, like a road's start
        const under = this.game.rts.groundAt(e.clientX, e.clientY) ?? p;
        this.gridCorner(under);
        this.grid.startedThisTouch = true;
      }
      return;
    }
    if (this.active === 'road' && e.pointerType !== 'mouse') {
      this.startedThisTouch = false;
      this.touchDown = true;
      // After a build the road stays chained to its end, but only a touch near
      // that end continues it: touching anywhere else starts a fresh road there.
      const far = this.chained && !!this.start && !this.pendingEnd && Math.hypot(p.x - this.start.x, p.z - this.start.z) > Math.max(this.snapR() * 2.5, 30);
      if (!this.start || far) {
        // the first point goes right under the finger (the lift is for the moving end)
        const under = this.game.rts.groundAt(e.clientX, e.clientY) ?? p;
        this.start = this.game.net.snap(under.x, under.z, this.snapR());
        this.chained = false;
        this.lastDir = null;
        this.control = null;
        this.startedThisTouch = true;
        this.game.audio.play('click');
      }
      return;
    }
    switch (this.active) {
      case 'zone':
      case 'dezone':
        this.painting = true;
        this.warnedZoned = false;
        this.game.zones.beginStroke();
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
    if (this.active === 'ext') { this.ext?.move?.(this.game, p, _e, dragging); return; }
    if (!p) return;
    if ((this.active === 'zone' || this.active === 'dezone') && this.painting && dragging) this.paint(p);
    if (this.active === 'bulldoze' && this.painting && dragging) this.bulldozeAt(p);
  }

  up(p: THREE.Vector3 | null, e: PointerEvent, wasDrag: boolean) {
    const wasPainting = this.painting;
    this.painting = false;
    if (wasPainting && (this.active === 'zone' || this.active === 'dezone')) this.strokeSummary();
    if (e.pointerType !== 'mouse') this.touchDown = false;
    if (e.button === 2) return; // the camera turns a right-click into rightClick()
    if (this.active === 'ext') { this.ext?.up?.(this.game, p, e, wasDrag); return; }
    if (!p) return;
    switch (this.active) {
      case 'road':
        if (this.roadMode === 'grid') {
          if (!wasDrag && this.doubleTap(p, e) && this.grid.a && !this.grid.startedThisTouch) {
            this.cancel();
            this.game.audio.play('click', 0.4);
          } else if (e.pointerType === 'mouse') {
            if (!wasDrag) this.gridClick(p);
          } else if (!this.grid.startedThisTouch || wasDrag) {
            // touch: lift to set the first side, then the width, which waits
            // for the Build button (touch again to re-aim)
            if (this.grid.b) { this.grid.c = { x: p.x, z: p.z }; this.game.audio.play('click', 0.5); }
            else this.gridClick(p);
          }
          this.grid.startedThisTouch = false;
          this.onChange?.();
          break;
        }
        if (!wasDrag && this.doubleTap(p, e) && this.start) {
          // double-tap / double-click: stop drawing this road
          this.cancel();
          this.game.audio.play('click', 0.4);
        } else if (e.pointerType === 'mouse') {
          if (!wasDrag) this.roadClick(p);
        } else if (this.startedThisTouch && !wasDrag) {
          // tapped the start point: wait for the next drag or tap (park the
          // lifted aim on the start so no stray preview road hangs off it)
          if (this.start) this.hover = new THREE.Vector3(this.start.x, this.game.terrain.h(this.start.x, this.start.z), this.start.z);
        } else if (this.roadMode === 'curve' && !this.control) {
          this.control = { x: p.x, z: p.z };
          this.game.audio.play('click');
        } else {
          // plan it; the Build button makes it real (touch again to re-aim)
          this.pendingEnd = p.clone();
          this.game.audio.play('click', 0.5);
        }
        this.startedThisTouch = false;
        this.onChange?.();
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
        if (e.pointerType === 'mouse') {
          if (!wasDrag && this.game.placeLandmark(this.landmark, p)) { crumb(`placed landmark ${this.landmark}`); this.set('inspect'); }
        } else {
          // touch: plan it (a tap goes under the finger, a drag where the
          // lifted footprint was); the Build button makes it real
          const at = wasDrag ? p : this.game.rts.groundAt(e.clientX, e.clientY) ?? p;
          this.landmarkAt = at.clone();
          this.hover = this.landmarkAt;
        }
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
      // commune in the way: open it, where the buy-out and lawsuit buttons are
      const c = plan.blocker !== undefined ? this.game.communes.list.find((x) => x.id === plan.blocker) : null;
      if (c) this.game.select({ kind: 'commune', c });
      return;
    }
    const sim = this.game.sim;
    const weekBefore = sim.money === Infinity ? null : sim.forecastWeek().net;
    this.game.trees.recordCuts();
    const segs = net.build(this.start, end, curve, this.roadType);
    const trees = this.game.trees.takeCuts();
    if (segs.length) {
      sim.spend(plan.cost, 'Road construction');
      if (plan.grant > 0) sim.earn(plan.grant, 'grants');
      if (plan.grant > 0) this.game.floatText(`+$${plan.grant.toLocaleString()} Federal Slop Grant`, p, '#9dff3c');
      this.game.onRoadBuilt(segs, plan);
      this.game.pushUndo({ kind: 'build', segIds: segs.map((x) => x.id), refund: plan.cost - plan.grant, label: ROAD_TYPES[this.roadType].name, trees });
      crumb(`built ${ROAD_TYPES[this.roadType].name} ${Math.round(plan.length)} m ($${plan.cost - plan.grant})`);
      // the Ponzi's turn: this road tipped the weekly balance into the red
      const weekAfter = weekBefore === null ? null : sim.forecastWeek().net;
      if (weekBefore !== null && weekAfter !== null && weekBefore >= 0 && weekAfter < 0) {
        sim.alert('warn', `🛣️ A new road put the weekly budget in the red (${Math.round(weekAfter)}/wk)`);
        this.game.toast(`That road put the weekly budget in the red: +$${Math.round(weekBefore).toLocaleString()} → −$${Math.abs(Math.round(weekAfter)).toLocaleString()}/wk. New buildings' fees cover it while the town grows; they stop when growth stops, and the upkeep doesn't.`, true);
      }
      // continue drawing from the end like Skylines
      const last = segs[segs.length - 1];
      const endNode = net.nodes.get(last.b)!;
      const samp = sampleCubic(curve, 4);
      const n = samp.pts.length;
      this.lastDir = norm(sub(samp.pts[n - 1], samp.pts[n - 2]));
      this.start = { kind: 'node', id: endNode.id, x: endNode.x, z: endNode.z };
      this.control = null;
      this.chained = true;
    }
  }

  private upgradeAt(p: THREE.Vector3, wholeStreet: boolean) {
    const net = this.game.net;
    const pick = net.pickSeg(p.x, p.z, 3);
    if (!pick) return;
    const segs = wholeStreet ? [...net.segs.values()].filter((s) => s.street === pick.seg.street && s.type === pick.seg.type) : [pick.seg];
    if (this.game.upgradeRoads(segs, p).ok) crumb(`one more lane: ${segs.length} block(s) → ${ROAD_TYPES[pick.seg.type].name}`);
  }

  private bulldozeAt(p: THREE.Vector3) {
    const what = this.game.buildingAt(p);
    if (this.game.bulldozeAt(p)) { crumb(`bulldozed ${what}`); return; }
    const pick = this.game.net.pickSeg(p.x, p.z, 1);
    if (!pick) return;
    crumb(`bulldozed road ${pick.seg.name ?? pick.seg.id}`);
    this.game.bulldozeRoad(pick.seg);
    this.game.particles.emit('dust', p.x, p.y + 1, p.z, { count: 30, spread: 6 });
  }

  private paint(p: THREE.Vector3) {
    this.game.zones.paint(p.x, p.z, this.brushRadius(), this.active === 'dezone' ? null : this.zoneType);
  }

  /** builders' appetite for a zone right now, and whether it's enough to build */
  zoneDemand(z: ZoneType) {
    const k = z === 'resLow' || z === 'resHigh' ? 'res' : z === 'comLow' || z === 'comHigh' ? 'com' : z === 'industry' ? 'ind' : 'off';
    const v = Math.round(this.game.sim.demand[k]);
    return { letter: k[0].toUpperCase(), v, ok: v >= 5 };
  }

  /** after a brush stroke: what got zoned, what was refused and why, and whether it will grow */
  private strokeSummary() {
    const r = this.game.zones.endStroke();
    const dez = this.active === 'dezone';
    const refused = [
      r.notOwned && `${r.notOwned} outside your land (buy it in 🏞️ Land)`,
      r.otherZone && `${r.otherZone} already zoned something else (Dezone first)`,
      r.built && `${r.built} already built on${dez ? ' (bulldoze first)' : ''}`,
    ].filter(Boolean) as string[];
    if (!r.changed && !refused.length) return;
    crumb(`${dez ? 'dezoned' : `zoned ${this.zoneType}`} ${r.changed}${refused.length ? `, refused ${refused.join('; ')}` : ''}`);
    let msg = r.changed ? `${dez ? 'Dezoned' : 'Zoned'} ${r.changed} lot${r.changed === 1 ? '' : 's'}${dez ? '' : ` ${ZONE_LABEL[this.zoneType]}`}` : 'Nothing zoned';
    if (refused.length) msg += ` · ${refused.join(' · ')}`;
    if (!dez && r.changed) { const d = this.zoneDemand(this.zoneType); msg += d.ok ? ` · builders want it (${d.letter} +${d.v})` : ` · waiting for demand (${d.letter} ${d.v > 0 ? '+' : ''}${d.v}; building starts at +5)`; }
    this.game.toast(msg, !r.changed);
  }
  private warnedZoned = false;
  private lastTap = { t: -1e9, x: 0, z: 0 };

  /** Second tap/click on the same spot right after the first: ends the road. */
  private doubleTap(p: THREE.Vector3, e: PointerEvent): boolean {
    // event time, not handling time: building the first tap's road can be slow
    const now = e.timeStamp || performance.now();
    const dbl = now - this.lastTap.t < 380 && Math.hypot(p.x - this.lastTap.x, p.z - this.lastTap.z) < this.snapR() * 1.5;
    this.lastTap = dbl ? { t: -1e9, x: 0, z: 0 } : { t: now, x: p.x, z: p.z };
    return dbl;
  }

  // ------------------------------------------------------------------ grid tool
  // Corner, first side, width: the whole grid goes down at once (gridRoads.ts).
  private grid: { a: Snap | null; align: V2[]; b: V2 | null; c: V2 | null; startedThisTouch: boolean } = { a: null, align: [], b: null, c: null, startedThisTouch: false };
  private gridCache: { key: string; shape: GridShape; plan: ReturnType<typeof planGrid> } | null = null;

  private gridCorner(p: THREE.Vector3) {
    const a = this.game.net.snap(p.x, p.z, this.snapR());
    // starting on a road: the first side can run along it
    this.grid = { a, align: this.game.net.armDirs(a), b: null, c: null, startedThisTouch: false };
    this.game.audio.play('click');
  }

  private gridShapeTo(c: V2 | null, b: V2 | null = this.grid.b) {
    const a = this.grid.a;
    if (!a || !b) return null;
    return gridShape({ x: a.x, z: a.z }, b, c, gridSpacing(this.roadType, this.gridBlock), this.grid.align);
  }

  private gridClick(p: THREE.Vector3) {
    if (ROAD_TYPES[this.roadType].id === 'highway') { this.game.toast("Grids are for streets: a highway can't have crossroads. Pick another road.", true); this.game.audio.play('error'); return; }
    if (!this.grid.a) { this.gridCorner(p); return; }
    const at = { x: p.x, z: p.z };
    if (!this.grid.b) {
      if (!this.gridShapeTo(null, at)) { this.game.toast(`Pull the first side out further: a block here is ${Math.round(gridSpacing(this.roadType, this.gridBlock))} m.`, true); this.game.audio.play('error'); return; }
      this.grid.b = at;
      this.game.audio.play('click');
      return;
    }
    this.gridBuild(at);
  }

  private gridBuild(c: V2) {
    const shape = this.gridShapeTo(c);
    if (!shape) return;
    const type = this.roadType, name = ROAD_TYPES[type].name, sim = this.game.sim;
    const weekBefore = sim.money === Infinity ? null : sim.forecastWeek().net;
    const r = buildGrid(this.game, shape, type);
    const skipped = [...r.skipped].map(([why, n]) => `${n} left out: ${why}`).join(' · ');
    if (!r.built) {
      this.game.toast(r.have === r.total ? 'Those streets are all there already.' : `Can't build that grid. ${skipped}`, true);
      this.game.audio.play('error');
      this.grid.c = null;
      return;
    }
    const net$ = r.cost - r.grant;
    this.game.pushUndo({ kind: 'build', segIds: r.segIds, refund: net$, label: `${name} grid`, trees: r.trees });
    crumb(`built a ${shape.nu}x${shape.nv} ${name} grid: ${r.built}/${r.total} streets, ${Math.round(r.length)} m ($${net$})`);
    const mid = new THREE.Vector3(shape.a.x + (shape.u.x * shape.nu + shape.v.x * shape.nv) * shape.S * 0.5, 0, shape.a.z + (shape.u.z * shape.nu + shape.v.z * shape.nv) * shape.S * 0.5);
    mid.y = this.game.terrain.h(mid.x, mid.z);
    if (r.grant > 0) this.game.floatText(`+$${r.grant.toLocaleString()} Federal Slop Grant`, mid, '#9dff3c');
    const bits = [
      `${r.built} street${r.built === 1 ? '' : 's'}, ${Math.round(r.length).toLocaleString()} m, $${net$.toLocaleString()}`,
      r.have ? `${r.have} already there` : '',
      r.razed ? `${r.razed} building${r.razed === 1 ? '' : 's'} bulldozed` : '',
      skipped,
    ].filter(Boolean);
    this.game.toast(`Built a ${shape.nu}×${shape.nv}-block grid: ${bits.join(' · ')}`, !!skipped);
    const weekAfter = weekBefore === null ? null : sim.forecastWeek().net;
    if (weekBefore !== null && weekAfter !== null && weekBefore >= 0 && weekAfter < 0) {
      sim.alert('warn', `🛣️ A new street grid put the weekly budget in the red (${Math.round(weekAfter)}/wk)`);
      this.game.toast(`That grid put the weekly budget in the red: +$${Math.round(weekBefore).toLocaleString()} → −$${Math.abs(Math.round(weekAfter)).toLocaleString()}/wk. Zone it so new buildings' fees cover the upkeep.`, true);
    }
    this.grid = { a: null, align: [], b: null, c: null, startedThisTouch: false };
    this.gridCache = null;
    this.pendingCost = null;
  }

  private gridUpdate(hov: THREE.Vector3) {
    const net = this.game.net, t = ROAD_TYPES[this.roadType], touch = this.game.isTouch;
    const aim = this.grid.c && !this.touchDown ? new THREE.Vector3(this.grid.c.x, 0, this.grid.c.z) : hov;
    const s = this.grid.a ? { kind: 'free', x: aim.x, z: aim.z } : net.snap(aim.x, aim.z, this.snapR());
    this.marker.visible = true;
    this.marker.position.set(s.x, this.game.terrain.h(s.x, s.z) + 0.6, s.z);
    (this.marker.material as THREE.MeshBasicMaterial).color.set(s.kind === 'free' ? 0xffffff : 0x9dff3c);
    this.pendingCost = null;
    const A = this.grid.a;
    if (A) {
      this.startPin.visible = true;
      this.startPin.position.set(A.x, this.game.terrain.h(A.x, A.z) + 0.7, A.z);
      this.startPin.scale.setScalar(this.marker.scale.x * 1.35);
    }
    if (t.id === 'highway') { this.preview.visible = false; this.tip = { text: "Grids are for streets: a highway can't have crossroads. Pick another road.", bad: true }; return; }
    const S = gridSpacing(this.roadType, this.gridBlock), blk = `${GRID_BLOCKS[this.gridBlock].label.toLowerCase()} blocks, streets ${Math.round(S)} m apart`;
    if (!A) { this.preview.visible = false; this.tip = { text: `▦ ${t.name} grid (${blk}): ${touch ? 'touch' : 'click'} the first corner${s.kind !== 'free' ? ' · on a road: the grid can run along it' : ''}` }; return; }
    const at = { x: aim.x, z: aim.z };
    const shape = this.grid.b ? this.gridShapeTo(at) : this.gridShapeTo(null, at);
    if (!shape) { this.preview.visible = false; this.tip = { text: `${touch ? 'Drag' : 'Pull'} out the first side (${blk})` }; return; }
    const key = [this.roadType, S, A.x.toFixed(1), A.z.toFixed(1), shape.u.x.toFixed(4), shape.u.z.toFixed(4), shape.v.x.toFixed(4), shape.v.z.toFixed(4), shape.nu, shape.nv, net.segs.size, net.nodes.size, Math.round(this.game.sim.spendable() / 5000)].join('|');
    if (this.gridCache?.key !== key) {
      const plan = planGrid(this.game, shape, this.roadType);
      this.drawGrid(plan.lines, t.width, !!t.oneWay);
      this.gridCache = { key, shape, plan };
    }
    const plan = this.gridCache.plan;
    this.preview.visible = true;
    this.previewMat.color.set(0xffffff);
    const net$ = plan.cost - plan.grant;
    if (!this.grid.b) {
      this.tip = { text: `${shape.nu} block${shape.nu === 1 ? '' : 's'} along, ${Math.round(shape.nu * S)} m · ${touch ? 'lift' : 'click'} to set the first side, then pull out the width` };
      return;
    }
    this.pendingCost = this.grid.c && plan.ok ? net$ : null;
    const upkeep = Math.max(1, Math.round(plan.length * t.upkeepPerM * 0.35)), later = Math.max(1, Math.round(plan.length * t.upkeepPerM));
    const budget = this.budgetAfter(upkeep, later);
    const why = [...plan.reasons].sort((x, y) => y[1] - x[1])[0]?.[0];
    const bits = [
      `▦ ${shape.nu}×${shape.nv} blocks · ${plan.ok} street${plan.ok === 1 ? '' : 's'} · ${Math.round(plan.length).toLocaleString()} m · $${net$.toLocaleString()}${plan.grant ? ` (feds pay $${plan.grant.toLocaleString()})` : ''}`,
      `+$${upkeep}/wk upkeep (→ $${later}/wk as it ages)`,
      budget?.text ?? '',
      plan.have ? `${plan.have} already there` : '',
      plan.bad ? `⚠️ ${plan.bad} red street${plan.bad === 1 ? '' : 's'} left out: ${why}` : '',
      // a width planned by touch waits for the Build button
      plan.ok ? (this.grid.c ? (this.touchDown ? 'lift to plan it' : 'tap Build, or drag to re-aim') : touch ? 'lift to plan it' : 'click to build') : '',
    ].filter(Boolean);
    this.tip = { text: plan.ok ? bits.join(' · ') : `Nothing here can be built: ${why ?? 'every street is already there'}`, bad: !plan.ok || !!plan.bad || !!budget?.flips };
  }

  /** the planned grid: every street as a ribbon, red where it can't be built, faint where it's already there */
  private drawGrid(lines: GridLineState[], width: number, oneWay: boolean) {
    const pos: number[] = [], col: number[] = [], idx: number[] = [];
    const T = this.game.terrain, hw = width / 2;
    for (const l of lines) {
      const c = l.state === 'ok' ? [0.5, 0.85, 1] : l.state === 'bad' ? [1, 0.3, 0.3] : [0.75, 0.75, 0.75];
      const dx = l.b.x - l.a.x, dz = l.b.z - l.a.z, L = Math.hypot(dx, dz);
      const tx = dx / L, tz = dz / L, rx = -tz, rz = tx;
      const n = Math.max(1, Math.ceil(L / 6)), k0 = pos.length / 3;
      for (let i = 0; i <= n; i++) {
        const x = l.a.x + (dx * i) / n, z = l.a.z + (dz * i) / n, y = Math.max(T.h(x, z), 0) + 0.9;
        pos.push(x - rx * hw, y, z - rz * hw, x + rx * hw, y, z + rz * hw);
        col.push(...c, ...c);
        if (i > 0) { const a = k0 + (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      }
      // one-ways show which way each street runs
      if (oneWay && l.state !== 'have') for (let d = 8; d < L - 4; d += 24) {
        const x = l.a.x + tx * d, z = l.a.z + tz * d, y = Math.max(T.h(x, z), 0) + 0.95;
        const k = pos.length / 3, w = Math.min(1.6, hw * 0.6);
        pos.push(x + tx * 2.2, y, z + tz * 2.2, x - tx * 0.9 + rx * w, y, z - tz * 0.9 + rz * w, x - tx * 0.9 - rx * w, y, z - tz * 0.9 - rz * w);
        col.push(0.15, 0.15, 0.2, 0.15, 0.15, 0.2, 0.15, 0.15, 0.2);
        idx.push(k, k + 1, k + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    this.preview.geometry.dispose();
    this.preview.geometry = g;
  }

  // ------------------------------------------------------------------ per frame
  update() {
    const net = this.game.net;
    const hov = this.hover;
    this.marker.visible = false;
    this.startPin.visible = false;
    this.highlight.visible = false;
    this.brushRing.visible = false;
    this.ghost.hide();
    // road rings stay a readable size on screen at any zoom (bigger on phones)
    this.marker.scale.setScalar(Math.max(1, this.game.rts.distance * (this.game.isTouch ? 0.009 : 0.005)));
    if (this.active === 'ext') { this.tip = this.ext?.tip?.(this.game) ?? null; return; }
    if (!hov) {
      // phones have no hover before the first touch: say how to start
      if (this.game.isTouch) this.tip = this.idleTouchTip();
      return;
    }
    if (this.active === 'road' && this.roadMode === 'grid') this.gridUpdate(hov);
    else if (this.active === 'road') {
      const aim = this.pendingEnd && !this.touchDown ? this.pendingEnd : hov;
      const s = this.start ? this.snapEnd(aim) : net.snap(aim.x, aim.z, this.snapR());
      this.marker.visible = true;
      this.marker.position.set(s.x, this.game.terrain.h(s.x, s.z) + 0.6, s.z);
      (this.marker.material as THREE.MeshBasicMaterial).color.set(s.kind === 'free' ? 0xffffff : 0x9dff3c);
      if (this.start) {
        this.startPin.visible = true;
        this.startPin.position.set(this.start.x, this.game.terrain.h(this.start.x, this.start.z) + 0.7, this.start.z);
        this.startPin.scale.setScalar(this.marker.scale.x * 1.35);
      }
      if (this.start && !this.pendingEnd && this.game.isTouch && Math.hypot(s.x - this.start.x, s.z - this.start.z) < 8) {
        // just placed the start: say what to do next instead of "Too short"
        this.preview.visible = false;
        this.tip = { text: this.chained ? 'Drag from the green ring to keep going, touch elsewhere for a new road, or tap Done' : 'Start set · now drag or tap where the road ends' };
      } else if (this.start) {
        const end: V2 = { x: s.x, z: s.z };
        let curve: Cubic | null;
        if (this.roadMode === 'curve' && !this.control) curve = lineCubic({ x: this.start.x, z: this.start.z }, end);
        else curve = this.curveTo(end);
        if (curve) {
          const plan = net.plan(this.start, curve, this.roadType, this.game.sim.spendable());
          this.drawRibbon(this.preview, curve, ROAD_TYPES[this.roadType].width, !!ROAD_TYPES[this.roadType].oneWay);
          this.preview.visible = true;
          this.previewMat.color.set(plan.ok ? 0x7fd8ff : 0xff4d4d);
          const net$ = plan.cost - plan.grant;
          this.pendingCost = this.pendingEnd && plan.ok ? net$ : null;
          if (plan.ok) {
            // what the road commits you to, before you click: the forever cost, the
            // trees, the homes, and whether anything can drive to it
            const im = this.roadImpact(curve, end);
            const budget = this.budgetAfter(im.upkeep, im.upkeepLater);
            const bits = [
              `${Math.round(plan.length)} m · $${net$.toLocaleString()}${plan.grant ? ` (feds pay $${plan.grant.toLocaleString()})` : ''}`,
              `+$${im.upkeep}/wk upkeep (→ $${im.upkeepLater}/wk as it ages)`,
              budget?.text ?? '',
              plan.bridgeLen > 5 ? 'bridge' : '',
              plan.demolish ? `bulldozes ${plan.demolish} building${plan.demolish === 1 ? '' : 's'}` : '',
              im.trees ? `clears ~${im.trees} tree${im.trees === 1 ? '' : 's'}` : '',
              im.joins ? `joins ${im.joins}` : '⚠️ not connected to any road',
            ].filter(Boolean);
            this.tip = { text: bits.join(' · ') + (this.pendingEnd && !this.touchDown ? ' · tap Build, or drag to re-aim' : ''), bad: !!plan.demolish || !im.joins || !!budget?.flips };
          } else this.tip = { text: plan.reason ?? 'Nope', bad: true };
        }
      } else {
        this.preview.visible = false;
        this.tip = { text: this.game.isTouch ? `Drag to draw a ${ROAD_TYPES[this.roadType].name} · Done when finished` : `${ROAD_TYPES[this.roadType].name}: click to start` };
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
          : { text: `Bulldoze ${pick.seg.name}${this.transitNote(pick.seg.id)}`, bad: true };
      } else this.tip = null;
    } else if (this.active === 'landmark') {
      const fp = landmarkFootprint(this.landmark);
      const spot = this.game.landmarkSpot(this.landmark, hov.x, hov.z);
      const hw = (fp.widthCells * 8) / 2, hd = (fp.depthCells * 8) / 2;
      const y = this.game.buildings.padHeight(spot.x, spot.z, hw, hd, spot.yaw);
      const id = this.landmark;
      this.ghost.show(`lm|${id}`, () => generateLandmark(id, 1).geometry, spot.x, y, spot.z, spot.yaw, hw, hd, spot.ok, spot.front?.door ?? null);
      this.ghost.showBlocker(!spot.ok && spot.blocker ? spot.blocker : null);
      const cost = LANDMARK_COST[this.landmark];
      this.pendingCost = this.landmarkAt && spot.ok && cost <= this.game.sim.spendable() ? cost : null;
      // it can go down before its road, but it does nothing until one links it to the network
      const linked = !!spot.front && (this.game.linkedRoad?.(spot.front.seg) ?? true);
      const where = !spot.front ? '🚧 no road here: it does nothing until a road connects it to your streets'
        : !linked ? `🚧 ${spot.front.seg.name} doesn't join the rest of your roads: it does nothing until it does`
        : `fronts ${spot.front.seg.name}`;
      if (!spot.ok) this.tip = { text: spot.reason ?? 'Nope', bad: true };
      else if (!this.game.isTouch) this.tip = { text: `Click to place · ${where}`, bad: !linked };
      else this.tip = this.landmarkAt
        ? cost > this.game.sim.spendable() ? { text: 'Not enough money', bad: true } : { text: `${where} · tap Build, or drag to move it`, bad: !linked }
        : { text: 'Tap or drag to where it goes' };
    } else if (this.active === 'zone' || this.active === 'dezone') {
      this.drapeBrush(hov.x, hov.z, this.brushRadius());
      if (this.active === 'dezone') this.tip = { text: 'Dezone: unzones empty lots' };
      else {
        const d = this.zoneDemand(this.zoneType);
        this.tip = { text: `${ZONE_LABEL[this.zoneType]}: ${d.ok ? `builders want it (${d.letter} +${d.v})` : `waiting for demand (${d.letter} ${d.v > 0 ? '+' : ''}${d.v}; starts at +5)`} · dim lots are waiting` };
      }
    } else this.tip = null;
  }

  /** " · ends the 69 Express bus line" when a road carries bus stops */
  private transitNote(segId: number): string {
    const lines = (this.game as { transit?: { linesOnSeg(id: number): { name: string }[] } }).transit?.linesOnSeg(segId) ?? [];
    if (!lines.length) return '';
    const the = (n: string) => (/^the /i.test(n) ? n : `the ${n}`);
    return ` · ⚠️ ends ${lines.map((l) => the(l.name)).join(' and ')} bus line${lines.length > 1 ? 's' : ''} (${lines.length > 1 ? 'their' : 'its'} stops are on it)`;
  }

  private idleTouchTip(): { text: string; bad?: boolean } | null {
    switch (this.active) {
      case 'road': return { text: `Drag to draw a ${ROAD_TYPES[this.roadType].name} · Done when finished` };
      case 'landmark': return { text: 'Tap or drag to where it goes' };
      case 'bulldoze': return { text: 'Tap or drag over what to bulldoze', bad: true };
      case 'upgrade': return { text: 'Tap a road to add a lane' };
      default: return null;
    }
  }

  private drawRibbon(mesh: THREE.Mesh, c: Cubic, width: number, oneWay = false) {
    const s = sampleCubic(c, 3);
    const pos: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const hw = width / 2;
    for (let i = 0; i < s.pts.length; i++) {
      const p = s.pts[i];
      const q = s.pts[Math.min(i + 1, s.pts.length - 1)], o = s.pts[Math.max(0, i - 1)];
      const t = norm(sub(q, o));
      const r = { x: -t.z, z: t.x };
      const y = Math.max(this.game.terrain.h(p.x, p.z), 0) + 0.9;
      pos.push(p.x - r.x * hw, y, p.z - r.z * hw, p.x + r.x * hw, y, p.z + r.z * hw);
      col.push(1, 1, 1, 1, 1, 1);
      if (i > 0) {
        const a = (i - 1) * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    // a one-way shows which way it will run: chevrons the way you're dragging
    if (oneWay) for (let d = 5; d < s.length - 3; d += 11) {
      const { i, f } = locate(s, d);
      const a = s.pts[i], b = s.pts[i + 1];
      const t = norm(sub(b, a)), r = { x: -t.z, z: t.x };
      const px = a.x + (b.x - a.x) * f, pz = a.z + (b.z - a.z) * f;
      const y = Math.max(this.game.terrain.h(px, pz), 0) + 0.95;
      const k = pos.length / 3, w = Math.min(1.6, hw * 0.6);
      pos.push(px + t.x * 2.2, y, pz + t.z * 2.2, px - t.x * 0.9 + r.x * w, y, pz - t.z * 0.9 + r.z * w, px - t.x * 0.9 - r.x * w, y, pz - t.z * 0.9 - r.z * w);
      col.push(0.15, 0.15, 0.2, 0.15, 0.15, 0.2, 0.15, 0.15, 0.2);
      idx.push(k, k + 1, k + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    mesh.geometry.dispose();
    mesh.geometry = g;
  }
}

export { closestOnSampled };
