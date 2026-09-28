// Contours and slope shading around the cursor while drawing roads or placing
// buildings (playtest 5: "Road routes failed at 24% and later 21% grade; a
// gentler route worked. Add contours, slope shading, and a live grade preview
// that remain readable at night"). Heights are sampled on a grid around the
// cursor and painted into a canvas draped over the ground: a thin contour
// every 5 m of height, a bold one every 25 m (traced with marching squares,
// so they're smooth), amber where the ground nears the 15% road limit and red
// past it. Unlit, so it reads the same at night. Rebuilt
// only when the cursor has moved a good way, so it costs nothing per frame.
import * as THREE from 'three';
import { WATER } from '../config';
import type { Terrain } from '../world/terrain';

const SIZE = 460; // metres across
const N = 154; // height samples per side (~3 m apart)
const CANVAS = 1024; // canvas pixels per side
const SEG = 52; // mesh segments per side (the drape)
const MINOR = 5, MAJOR = 25; // contour intervals (m)
/** the road rule (roads/network.ts): a road climbs at most 15% of its length */
export const MAX_GRADE = 0.15;
const WARN_GRADE = 0.1;

export class GradeOverlay {
  readonly mesh: THREE.Mesh;
  private canvas = document.createElement('canvas');
  private tex: THREE.CanvasTexture;
  private cx = NaN;
  private cz = NaN;

  constructor(private terrain: Terrain) {
    this.canvas.width = this.canvas.height = CANVAS;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false, toneMapped: false, fog: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.renderOrder = 5;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.name = 'grade-overlay';
  }

  /** show it around (x, z), re-centring once the cursor is a quarter of the way to its edge */
  show(x: number, z: number) {
    if (!(Math.abs(x - this.cx) < SIZE * 0.25 && Math.abs(z - this.cz) < SIZE * 0.25)) this.rebuild(Math.round(x / 8) * 8, Math.round(z / 8) * 8);
    this.mesh.visible = true;
  }

  hide() {
    this.mesh.visible = false;
  }

  /** forget the painted area (the ground changed: terraforming, a new map) */
  invalidate() {
    this.cx = this.cz = NaN;
  }

  private rebuild(cx: number, cz: number) {
    this.cx = cx;
    this.cz = cz;
    const T = this.terrain, step = SIZE / (N - 1), x0 = cx - SIZE / 2, z0 = cz - SIZE / 2;
    const h = new Float32Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) h[j * N + i] = T.h(x0 + i * step, z0 + j * step);
    const ctx = this.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, CANVAS, CANVAS);
    // slope shading, one pixel a sample, drawn smoothly scaled up
    const shade = document.createElement('canvas');
    shade.width = shade.height = N;
    const sc = shade.getContext('2d')!, img = sc.createImageData(N, N), d = img.data;
    for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
      if (h[j * N + i] < WATER + 0.2) continue;
      const gx = (h[j * N + i + 1] - h[j * N + i - 1]) / (2 * step), gz = (h[(j + 1) * N + i] - h[(j - 1) * N + i]) / (2 * step);
      const grade = Math.hypot(gx, gz), o = (j * N + i) * 4;
      if (grade > MAX_GRADE) { d[o] = 255; d[o + 1] = 64; d[o + 2] = 52; d[o + 3] = 70; }
      else if (grade > WARN_GRADE) { d[o] = 255; d[o + 1] = 190; d[o + 2] = 40; d[o + 3] = 48; }
    }
    sc.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(shade, 0, 0, CANVAS, CANVAS);
    // contours: marching squares on the height grid, one path per weight
    const px = CANVAS / (N - 1);
    let mn = Infinity, hi = -Infinity;
    for (const y of h) { if (y < mn) mn = y; if (y > hi) hi = y; }
    const lo = Math.floor(Math.max(WATER, mn) / MINOR) * MINOR;
    const minor = new Path2D(), major = new Path2D();
    for (let lv = lo + MINOR; lv < hi; lv += MINOR) {
      if (lv <= WATER + 0.2) continue;
      const path = Math.abs(lv % MAJOR) < 1e-6 ? major : minor;
      for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
        const a = h[j * N + i], b = h[j * N + i + 1], c = h[(j + 1) * N + i + 1], e = h[(j + 1) * N + i];
        const k = (a > lv ? 1 : 0) | (b > lv ? 2 : 0) | (c > lv ? 4 : 0) | (e > lv ? 8 : 0);
        if (k === 0 || k === 15) continue;
        // where the level crosses each edge of the cell (top, right, bottom, left)
        const t = (u: number, v: number) => (lv - u) / (v - u);
        const P = [
          [(i + t(a, b)) * px, j * px], [(i + 1) * px, (j + t(b, c)) * px],
          [(i + t(e, c)) * px, (j + 1) * px], [i * px, (j + t(a, e)) * px],
        ];
        const seg = (p: number, q: number) => { path.moveTo(P[p][0], P[p][1]); path.lineTo(P[q][0], P[q][1]); };
        switch (k) {
          case 1: case 14: seg(3, 0); break;
          case 2: case 13: seg(0, 1); break;
          case 3: case 12: seg(3, 1); break;
          case 4: case 11: seg(1, 2); break;
          case 6: case 9: seg(0, 2); break;
          case 7: case 8: seg(3, 2); break;
          case 5: seg(3, 0); seg(1, 2); break;
          case 10: seg(0, 1); seg(2, 3); break;
        }
      }
    }
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(20, 24, 32, 0.35)'; // a dark edge so the lines read on pale ground
    ctx.lineWidth = 3.2; ctx.stroke(major);
    ctx.lineWidth = 2; ctx.stroke(minor);
    ctx.strokeStyle = 'rgba(240, 244, 255, 0.95)';
    ctx.lineWidth = 1.8; ctx.stroke(major);
    ctx.strokeStyle = 'rgba(235, 240, 255, 0.5)';
    ctx.lineWidth = 1; ctx.stroke(minor);
    // a soft round edge: strongest near the cursor
    ctx.globalCompositeOperation = 'destination-in';
    const r = ctx.createRadialGradient(CANVAS / 2, CANVAS / 2, CANVAS * 0.3, CANVAS / 2, CANVAS / 2, CANVAS * 0.5);
    r.addColorStop(0, 'rgba(0,0,0,1)');
    r.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = r;
    ctx.fillRect(0, 0, CANVAS, CANVAS);
    ctx.globalCompositeOperation = 'source-over';
    this.tex.needsUpdate = true;
    // drape the plane over the ground, a little above it
    const pos = this.mesh.geometry.attributes.position as THREE.BufferAttribute;
    for (let k = 0; k < pos.count; k++) pos.setY(k, Math.max(WATER, T.h(cx + pos.getX(k), cz + pos.getZ(k))) + 0.45);
    pos.needsUpdate = true;
    this.mesh.position.set(cx, 0, cz);
  }
}
