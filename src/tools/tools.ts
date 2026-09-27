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

export type ToolId = 'inspect' | 'road' | 'upgrade' | 'bulldoze' | 'zone' | 'dezone' | 'landmark' | 'ext';
export type RoadMode = 'straight' | 'curve' | 'freeform';

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
    return this.active === 'road' && !!this.start;
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
    return this.active === 'road' && !!this.start && !!this.pendingEnd;
  }
  /** Build the planned touch road or landmark (the action-bar Build button). */
  buildPending() {
    if (this.active === 'landmark') {
      if (this.landmarkAt && this.game.placeLandmark(this.landmark, this.landmarkAt)) { crumb(`placed landmark ${this.landmark}`); this.set('inspect'); }
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
    if (this.active === 'road') {
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
      const where = spot.front ? `fronts ${spot.front.seg.name}` : 'no road here yet: it faces the one you build';
      if (!spot.ok) this.tip = { text: spot.reason ?? 'Nope', bad: true };
      else if (!this.game.isTouch) this.tip = { text: `Click to place · ${where}` };
      else this.tip = this.landmarkAt
        ? cost > this.game.sim.spendable() ? { text: 'Not enough money', bad: true } : { text: `${where} · tap Build, or drag to move it` }
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
