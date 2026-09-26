// Cities: Skylines-style camera: WASD/arrow pan, right/middle-drag orbit,
// wheel zoom toward cursor, Q/E rotate, mouse at a screen edge scrolls. Touch: one finger pans (or uses the
// active tool), two fingers pinch-zoom, twist to rotate, drag to tilt/pan.
import * as THREE from 'three';
import { HALF, WATER } from '../config';
import { clamp } from '../core/math';
import type { Terrain } from '../world/terrain';

export interface PointerHandlers {
  /** true if the active tool uses one-finger/left drags (zone brush etc.) */
  toolCapturesDrag(): boolean;
  /** screen px to lift the touch point above the finger (so it isn't hidden) */
  touchLift?(): number;
  down(p: THREE.Vector3 | null, e: PointerEvent): void;
  move(p: THREE.Vector3 | null, e: PointerEvent, dragging: boolean): void;
  up(p: THREE.Vector3 | null, e: PointerEvent, wasDrag: boolean): void;
  cancel(): void;
  /** a right-click without a drag (defaults to cancel) */
  rightClick?(): void;
}

export class RTSCamera {
  target = new THREE.Vector3(0, 10, 0);
  distance = 700;
  yaw = 0.6;
  pitch = 0.85;
  private goal = { target: new THREE.Vector3(0, 10, 0), distance: 700, yaw: 0.6, pitch: 0.85 };
  private keys = new Set<string>();
  /** mouse at a window edge scrolls the map (desktop; Settings can turn it off) */
  edgeScroll = true;
  /** last mouse position and whether it was over the map itself (not a panel) */
  private mouse: { x: number; y: number; overMap: boolean } | null = null;
  /** seconds the mouse has rested in the edge band (a short delay avoids jolts on the way to a button) */
  private edgeT = 0;
  private ray = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private pointers = new Map<number, { x: number; y: number; sx: number; sy: number }>();
  private mode: 'none' | 'orbit' | 'tool' | 'pan1' | 'multi' = 'none';
  private orbitButton = -1;
  private moved = false;
  private last = { x: 0, y: 0 };
  private multiStart: { d: number; a: number; cx: number; cy: number } | null = null;
  enabled = true;
  hover: THREE.Vector3 | null = null;
  lastClient = { x: -1, y: -1 };

  constructor(public camera: THREE.PerspectiveCamera, private dom: HTMLElement, private terrain: Terrain, private handlers: PointerHandlers) {
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      this.keys.add(e.key.toLowerCase());
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => { this.keys.clear(); this.mouse = null; });
    // the mouse left the window (or the frame the game runs in): stop edge scrolling
    window.addEventListener('mouseout', (e) => { if (!e.relatedTarget) this.mouse = null; });
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    dom.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    dom.addEventListener('pointerdown', (e) => this.onDown(e));
    window.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    window.addEventListener('pointercancel', (e) => this.onUp(e, true));
  }

  setView(x: number, z: number, dist: number, yaw = this.yaw, pitch = this.pitch, instant = false) {
    this.goal.target.set(x, this.terrain.h(x, z), z);
    this.goal.distance = dist;
    this.goal.yaw = yaw;
    this.goal.pitch = pitch;
    if (instant) {
      this.target.copy(this.goal.target);
      this.distance = dist;
      this.yaw = yaw;
      this.pitch = pitch;
    }
  }

  groundAt(clientX: number, clientY: number): THREE.Vector3 | null {
    const r = this.dom.getBoundingClientRect();
    this.ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
    return this.terrain.raycast(this.ray.ray.origin, this.ray.ray.direction);
  }

  private onWheel(e: WheelEvent) {
    if (!this.enabled) return;
    e.preventDefault();
    const f = Math.exp(Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 120) * 0.0022);
    this.zoomAt(f, e.clientX, e.clientY);
  }

  private zoomAt(f: number, cx: number, cy: number) {
    const before = this.goal.distance;
    const next = clamp(before * f, 25, 6500);
    const p = this.groundAt(cx, cy);
    if (p && next < before) {
      const k = 1 - next / before;
      this.goal.target.x += (p.x - this.goal.target.x) * k;
      this.goal.target.z += (p.z - this.goal.target.z) * k;
    }
    this.goal.distance = next;
  }

  private isTouch(e: PointerEvent) {
    return e.pointerType === 'touch' || e.pointerType === 'pen';
  }

  private onDown(e: PointerEvent) {
    if (!this.enabled) return;
    this.dom.setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
    this.moved = false;
    this.last = { x: e.clientX, y: e.clientY };
    if (this.pointers.size >= 2) {
      if (this.mode === 'tool') this.handlers.cancel();
      this.mode = 'multi';
      this.multiStart = null;
      return;
    }
    if (!this.isTouch(e) && (e.button === 2 || e.button === 1)) {
      this.mode = 'orbit';
      this.orbitButton = e.button;
      return;
    }
    if (e.button === 0) {
      const touchPans = this.isTouch(e) && !this.handlers.toolCapturesDrag();
      this.mode = touchPans ? 'pan1' : 'tool';
      if (this.mode === 'tool') this.handlers.down(this.groundAt(e.clientX, e.clientY - this.lift(e)), e);
    }
  }

  private onMove(e: PointerEvent) {
    if (e.pointerType === 'mouse') this.mouse = { x: e.clientX, y: e.clientY, overMap: e.target === this.dom };
    const pt = this.pointers.get(e.pointerId);
    if (e.target === this.dom || pt) this.lastClient = { x: e.clientX, y: e.clientY };
    if (!pt) {
      if (e.target === this.dom && this.mode === 'none') {
        this.hover = this.groundAt(e.clientX, e.clientY);
        this.handlers.move(this.hover, e, false);
      }
      return;
    }
    const dx = e.clientX - pt.x, dy = e.clientY - pt.y;
    pt.x = e.clientX;
    pt.y = e.clientY;
    if (Math.hypot(e.clientX - pt.sx, e.clientY - pt.sy) > 6) this.moved = true;

    if (this.mode === 'orbit') {
      this.goal.yaw -= dx * 0.005;
      this.goal.pitch = clamp(this.goal.pitch + dy * 0.004, this.minPitch(), 1.48);
    } else if (this.mode === 'pan1') {
      this.panScreen(dx, dy);
    } else if (this.mode === 'tool') {
      this.hover = this.groundAt(e.clientX, e.clientY - this.lift(e));
      this.handlers.move(this.hover, e, this.moved);
    } else if (this.mode === 'multi' && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      if (!this.multiStart) {
        this.multiStart = { d, a: ang, cx, cy };
        return;
      }
      const s = this.multiStart;
      if (d > 10) this.zoomAt(s.d / d, cx, cy);
      let da = ang - s.a;
      if (da > Math.PI) da -= Math.PI * 2;
      if (da < -Math.PI) da += Math.PI * 2;
      this.goal.yaw -= da;
      const mdx = cx - s.cx, mdy = cy - s.cy;
      // two-finger vertical drag with fingers level = tilt; otherwise pan
      if (Math.abs(a.y - b.y) < 60 && Math.abs(mdy) > Math.abs(mdx) * 1.5) {
        this.goal.pitch = clamp(this.goal.pitch + mdy * 0.005, this.minPitch(), 1.48);
      } else {
        this.panScreen(mdx, mdy);
      }
      this.multiStart = { d, a: ang, cx, cy };
    }
  }

  private onUp(e: PointerEvent, cancelled = false) {
    const pt = this.pointers.get(e.pointerId);
    if (!pt) return;
    this.pointers.delete(e.pointerId);
    if (this.mode === 'tool') {
      if (cancelled) this.handlers.cancel();
      else this.handlers.up(this.groundAt(e.clientX, e.clientY - this.lift(e)), e, this.moved);
    } else if (this.mode === 'orbit' && this.orbitButton === 2 && !this.moved && !cancelled) {
      // right-click (no drag) = stop: ends the road being drawn, puts a building
      // away; right-drag still orbits
      if (this.handlers.rightClick) this.handlers.rightClick(); else this.handlers.cancel();
    } else if (this.mode === 'pan1' && !this.moved && !cancelled) {
      // a tap without a drag acts as a click
      const p = this.groundAt(e.clientX, e.clientY);
      this.handlers.down(p, e);
      this.handlers.up(p, e, false);
    }
    if (this.pointers.size === 0) this.mode = 'none';
    else if (this.pointers.size === 1 && this.mode === 'multi') {
      this.mode = 'pan1';
      this.moved = true;
    }
  }

  private lift(e: PointerEvent) {
    return this.isTouch(e) ? (this.handlers.touchLift?.() ?? 0) : 0;
  }

  private minPitch() {
    return this.goal.distance < 180 ? 0.1 : 0.28;
  }

  private panScreen(dx: number, dy: number) {
    const k = this.distance * 0.0017 * (1 / Math.max(0.35, Math.sin(this.pitch)));
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    // drag moves the ground with the finger: right = (fz, -fx), forward = (-fx, -fz)
    this.goal.target.x += (-fz * dx - fx * dy) * k;
    this.goal.target.z += (fx * dx - fz * dy) * k;
    this.clampTarget();
  }

  /** Slide the view by a world offset (smoothly, like a pan). */
  nudge(dx: number, dz: number) {
    this.goal.target.x += dx;
    this.goal.target.z += dz;
    this.clampTarget();
  }

  /**
   * Edge scrolling: the closer the mouse is to a window edge (within EDGE px,
   * over the map rather than a panel), the faster the map slides that way.
   * Off while a button is held (drawing, orbiting) or the tab is hidden.
   */
  private edgePan(dt: number) {
    const EDGE = 18, m = this.mouse;
    const w = window.innerWidth, h = window.innerHeight;
    let ex = 0, ey = 0;
    if (this.edgeScroll && m && m.overMap && this.pointers.size === 0 && !document.hidden) {
      if (m.x < EDGE) ex = -(1 - m.x / EDGE); else if (m.x > w - EDGE) ex = 1 - (w - m.x) / EDGE;
      if (m.y < EDGE) ey = -(1 - m.y / EDGE); else if (m.y > h - EDGE) ey = 1 - (h - m.y) / EDGE;
    }
    if (!ex && !ey) { this.edgeT = 0; return; }
    this.edgeT += dt;
    if (this.edgeT < 0.1) return;
    // ease in over the first half second, then full speed
    const ramp = Math.min(1, (this.edgeT - 0.1) / 0.4);
    const sp = Math.max(120, this.distance) * 1.1 * dt * ramp * (this.keys.has('shift') ? 2.5 : 1);
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const r = Math.sign(ex) * (0.35 + 0.65 * Math.abs(ex)), f = -Math.sign(ey) * (0.35 + 0.65 * Math.abs(ey));
    // screen right = (fz, -fx), screen up = (-fx, -fz), as with the D and W keys
    this.goal.target.x += (r * fz - f * fx) * sp;
    this.goal.target.z += (-r * fx - f * fz) * sp;
    this.clampTarget();
  }

  private clampTarget() {
    this.goal.target.x = clamp(this.goal.target.x, -HALF - 200, HALF + 200);
    this.goal.target.z = clamp(this.goal.target.z, -HALF - 200, HALF + 200);
  }

  update(dt: number) {
    const k = this.keys;
    const sp = Math.max(120, this.distance) * 1.1 * dt * (k.has('shift') ? 2.5 : 1);
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    let mx = 0, mz = 0;
    if (k.has('w') || k.has('arrowup')) { mx -= fx; mz -= fz; }
    if (k.has('s') || k.has('arrowdown')) { mx += fx; mz += fz; }
    if (k.has('a') || k.has('arrowleft')) { mx -= fz; mz += fx; }
    if (k.has('d') || k.has('arrowright')) { mx += fz; mz -= fx; }
    if (mx || mz) {
      this.goal.target.x += mx * sp;
      this.goal.target.z += mz * sp;
      this.clampTarget();
    }
    this.edgePan(dt);
    if (k.has('q')) this.goal.yaw += dt * 1.4;
    if (k.has('e')) this.goal.yaw -= dt * 1.4;
    if (k.has('r')) this.goal.pitch = clamp(this.goal.pitch + dt, this.minPitch(), 1.48);
    if (k.has('f')) this.goal.pitch = clamp(this.goal.pitch - dt, this.minPitch(), 1.48);
    if (k.has('=') || k.has('+')) this.goal.distance = clamp(this.goal.distance * (1 - dt * 1.5), 25, 6500);
    if (k.has('-')) this.goal.distance = clamp(this.goal.distance * (1 + dt * 1.5), 25, 6500);

    const s = 1 - Math.pow(0.0001, dt);
    this.goal.target.y = Math.max(WATER, this.terrain.h(this.goal.target.x, this.goal.target.z));
    this.target.lerp(this.goal.target, s);
    this.distance += (this.goal.distance - this.distance) * s;
    this.yaw += (this.goal.yaw - this.yaw) * s;
    this.pitch += (this.goal.pitch - this.pitch) * s;

    const cp = Math.cos(this.pitch), sp2 = Math.sin(this.pitch);
    const pos = this.camera.position;
    pos.set(this.target.x + Math.sin(this.yaw) * cp * this.distance, this.target.y + sp2 * this.distance, this.target.z + Math.cos(this.yaw) * cp * this.distance);
    const ground = Math.max(WATER, this.terrain.h(pos.x, pos.z)) + 4;
    if (pos.y < ground) pos.y = ground;
    this.camera.lookAt(this.target);
    this.camera.near = clamp(this.distance * 0.004, 0.5, 8);
    this.camera.far = 50000;
    this.camera.updateProjectionMatrix();
  }
}
