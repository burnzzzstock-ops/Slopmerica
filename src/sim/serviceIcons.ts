// Problem notification bubbles over buildings (no power, no water, trash,
// fire, crime, sick, abandoned...). One instanced billboard draw call with a
// small vector-drawn icon atlas (no emoji fonts: those differ per device).
// Zoomed out, a neighbourhood's bubbles merge into one bigger bubble showing
// its most common problem and a count badge.
import * as THREE from 'three';

export type Problem = 'power' | 'water' | 'sewage' | 'garbage' | 'fire' | 'crime' | 'sick' | 'abandoned' | 'education' | 'pollution';
export const PROBLEMS: Problem[] = ['power', 'water', 'sewage', 'garbage', 'fire', 'crime', 'sick', 'abandoned', 'education', 'pollution'];
const COLS = 10;
const S = 96;

/** One bubble: a building's problem, or (n > 1) a neighbourhood's, with how many of each. */
export interface ProblemItem { x: number; y: number; z: number; p: Problem; id: number; n?: number; mix?: Partial<Record<Problem, number>> }

/** 0-9 and "+" for the count badges, white on clear (11 cells of 40 x 64 px) */
function drawDigits(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 40 * 11; c.height = 64;
  const x = c.getContext('2d')!;
  x.fillStyle = '#fff';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.font = '900 54px Overpass, "Arial Narrow", Arial, sans-serif';
  for (let i = 0; i < 11; i++) x.fillText(i < 10 ? String(i) : '+', i * 40 + 20, 35, 38);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  return t;
}

function drawAtlas(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = S * COLS; c.height = S;
  const x = c.getContext('2d')!;
  PROBLEMS.forEach((p, i) => {
    const ox = i * S, cx = ox + S / 2, cy = S / 2;
    // bubble: red (utilities/danger) or amber (quality-of-life)
    const warn = p === 'education' || p === 'pollution' || p === 'crime' || p === 'sick';
    x.save();
    x.beginPath(); x.arc(cx, cy, S * 0.44, 0, Math.PI * 2);
    x.fillStyle = 'rgba(0,0,0,0.35)'; x.fill();
    x.beginPath(); x.arc(cx, cy - 2, S * 0.4, 0, Math.PI * 2);
    x.fillStyle = warn ? '#f2a51a' : p === 'abandoned' ? '#5b5f66' : '#e0262e'; x.fill();
    x.lineWidth = 5; x.strokeStyle = '#fff'; x.stroke();
    x.translate(cx, cy - 2);
    x.fillStyle = '#fff'; x.strokeStyle = '#fff'; x.lineJoin = 'round'; x.lineCap = 'round';
    const k = S / 96;
    x.scale(k, k);
    switch (p) {
      case 'power': // lightning bolt
        x.beginPath(); x.moveTo(6, -28); x.lineTo(-14, 4); x.lineTo(0, 4); x.lineTo(-6, 28); x.lineTo(15, -6); x.lineTo(1, -6); x.lineTo(8, -28); x.closePath(); x.fill(); break;
      case 'water': // drop
        x.beginPath(); x.moveTo(0, -28); x.bezierCurveTo(12, -10, 18, 0, 18, 9); x.arc(0, 9, 18, 0, Math.PI); x.bezierCurveTo(-18, 0, -12, -10, 0, -28); x.fill(); break;
      case 'sewage': // pipe with drips
        x.fillRect(-22, -16, 30, 10); x.fillRect(4, -16, 10, 22);
        x.beginPath(); x.arc(9, 16, 5, 0, Math.PI * 2); x.fill(); x.beginPath(); x.arc(9, 28, 3.5, 0, Math.PI * 2); x.fill(); break;
      case 'garbage': // trash can
        x.fillRect(-15, -12, 30, 36); x.fillRect(-20, -20, 40, 6); x.fillRect(-6, -26, 12, 6);
        x.fillStyle = '#e0262e'; for (const dx of [-8, 0, 8]) x.fillRect(dx - 1.5, -6, 3, 24); break;
      case 'fire': // flame
        x.beginPath(); x.moveTo(0, -28); x.bezierCurveTo(22, -6, 20, 10, 16, 18); x.bezierCurveTo(10, 30, -10, 30, -16, 18);
        x.bezierCurveTo(-22, 6, -12, -6, -6, -12); x.bezierCurveTo(-4, -2, 2, 0, 2, -8); x.bezierCurveTo(4, -16, 0, -22, 0, -28); x.fill();
        x.fillStyle = '#e0262e'; x.beginPath(); x.ellipse(0, 16, 7, 10, 0, 0, Math.PI * 2); x.fill(); break;
      case 'crime': // burglar mask
        x.beginPath(); x.ellipse(0, -2, 26, 13, 0, 0, Math.PI * 2); x.fill();
        x.fillStyle = '#f2a51a'; x.beginPath(); x.ellipse(-10, -2, 7, 5, 0, 0, Math.PI * 2); x.ellipse(10, -2, 7, 5, 0, 0, Math.PI * 2); x.fill();
        x.fillStyle = '#fff'; x.fillRect(-4, 14, 8, 12); break;
      case 'sick': // thermometer
        x.lineWidth = 9; x.beginPath(); x.moveTo(0, -24); x.lineTo(0, 10); x.stroke();
        x.beginPath(); x.arc(0, 16, 10, 0, Math.PI * 2); x.fill();
        x.fillStyle = '#f2a51a'; x.fillRect(-2, -8, 4, 18); x.beginPath(); x.arc(0, 16, 6, 0, Math.PI * 2); x.fill(); break;
      case 'abandoned': // house with X
        x.beginPath(); x.moveTo(-22, 0); x.lineTo(0, -22); x.lineTo(22, 0); x.lineTo(16, 0); x.lineTo(16, 24); x.lineTo(-16, 24); x.lineTo(-16, 0); x.closePath(); x.fill();
        x.strokeStyle = '#5b5f66'; x.lineWidth = 6; x.beginPath(); x.moveTo(-8, 4); x.lineTo(8, 20); x.moveTo(8, 4); x.lineTo(-8, 20); x.stroke(); break;
      case 'education': // grad cap
        x.beginPath(); x.moveTo(-28, -6); x.lineTo(0, -18); x.lineTo(28, -6); x.lineTo(0, 6); x.closePath(); x.fill();
        x.fillRect(-14, 0, 28, 12); x.lineWidth = 3; x.beginPath(); x.moveTo(22, -4); x.lineTo(22, 16); x.stroke(); break;
      case 'pollution': // factory smoke cloud
        x.beginPath(); x.arc(-10, 2, 12, 0, Math.PI * 2); x.arc(6, -6, 14, 0, Math.PI * 2); x.arc(14, 8, 10, 0, Math.PI * 2); x.arc(-2, 12, 10, 0, Math.PI * 2); x.fill(); break;
    }
    x.restore();
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.anisotropy = 4;
  return t;
}

/** How big a bubble is in the world at `dist` from the camera (the shader and pick() share it). */
function bubbleSize(dist: number, n: number) {
  if (n <= 1) return Math.min(26, Math.max(3.2, dist * 0.035));
  // a neighbourhood's bubble keeps a readable size far out, and grows a little with its count
  return Math.min(140, Math.max(3.2, dist * 0.035)) * Math.min(2, 1.25 + 0.12 * Math.log2(n));
}

export class ProblemIcons {
  readonly mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  private pos: THREE.InstancedBufferAttribute;
  private icon: THREE.InstancedBufferAttribute;
  private count: THREE.InstancedBufferAttribute;
  private cap = 0;
  private mat: THREE.ShaderMaterial;

  constructor(scene: THREE.Scene) {
    this.geo = new THREE.InstancedBufferGeometry();
    const q = new THREE.PlaneGeometry(1, 1);
    this.geo.index = q.index;
    this.geo.setAttribute('position', q.getAttribute('position'));
    this.geo.setAttribute('uv', q.getAttribute('uv'));
    this.pos = new THREE.InstancedBufferAttribute(new Float32Array(0), 4);
    this.icon = new THREE.InstancedBufferAttribute(new Float32Array(0), 1);
    this.count = new THREE.InstancedBufferAttribute(new Float32Array(0), 1);
    this.grow(256);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { tIcons: { value: drawAtlas() }, tDigits: { value: drawDigits() }, uTime: { value: 0 }, uPx: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute vec4 iPos; // xyz + phase
        attribute float iIcon;
        attribute float iCount; // buildings behind this bubble (1 = one building)
        uniform float uTime;
        varying vec2 vUv;
        varying vec2 vQ;
        varying float vFade;
        varying float vCount;
        void main() {
          vec3 p = iPos.xyz;
          p.y += sin(uTime * 2.4 + iPos.w) * 0.6;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float dist = -mv.z;
          // constant-ish screen size: grows with distance, clamped (bubbleSize() in JS)
          bool many = iCount > 1.5;
          float s = many ? clamp(dist * 0.035, 3.2, 140.0) * min(2.0, 1.25 + 0.12 * log2(iCount)) : clamp(dist * 0.035, 3.2, 26.0);
          mv.xy += position.xy * s;
          vFade = 1.0 - (many ? smoothstep(3600.0, 4400.0, dist) : smoothstep(1400.0, 1900.0, dist));
          vUv = vec2((iIcon + uv.x) / ${COLS.toFixed(1)}, uv.y);
          vQ = uv;
          vCount = iCount;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tIcons;
        uniform sampler2D tDigits;
        varying vec2 vUv;
        varying vec2 vQ;
        varying float vFade;
        varying float vCount;
        void main() {
          vec4 c = texture2D(tIcons, vUv);
          if (vCount > 1.5) {
            // the count: a dark disc with a white ring at the top right, "99+" past 99
            vec2 q = (vQ - vec2(0.79, 0.79)) / 0.21;
            float d = length(q);
            if (d < 1.0) {
              vec3 col = d > 0.84 ? vec3(1.0) : vec3(0.012, 0.01, 0.02);
              float n = min(floor(vCount + 0.5), 100.0);
              float digits = n > 99.5 ? 3.0 : n > 9.5 ? 2.0 : 1.0;
              float w = 1.3 / digits;
              float gx = (q.x + 0.65) / w;
              if (abs(q.y) < 0.62 && gx >= 0.0 && gx < digits) {
                float k = floor(gx);
                float glyph = digits > 2.5 ? (k > 1.5 ? 10.0 : 9.0) : digits > 1.5 ? (k < 0.5 ? floor(n / 10.0) : mod(n, 10.0)) : n;
                col = mix(col, vec3(1.0), texture2D(tDigits, vec2((glyph + fract(gx)) / 11.0, q.y / 1.24 + 0.5)).a);
              }
              c = vec4(col, 1.0);
            }
          }
          if (c.a < 0.08) discard;
          gl_FragColor = vec4(c.rgb, c.a * vFade);
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.name = 'problem-icons';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    scene.add(this.mesh);
  }

  private grow(n: number) {
    this.cap = n;
    this.pos = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
    this.icon = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
    this.count = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
    this.pos.setUsage(THREE.DynamicDrawUsage);
    this.icon.setUsage(THREE.DynamicDrawUsage);
    this.count.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('iPos', this.pos);
    this.geo.setAttribute('iIcon', this.icon);
    this.geo.setAttribute('iCount', this.count);
  }

  private items: ProblemItem[] = [];
  private v = new THREE.Vector3();

  /** the bubbles shown right now (tests, the hover tip) */
  get shown(): readonly ProblemItem[] {
    return this.items;
  }

  /**
   * The icon under a screen point (client px), nearest the camera first. The
   * shader sizes icons by distance; the same rule is used here.
   */
  pick(camera: THREE.PerspectiveCamera, rect: DOMRect, cx: number, cy: number): ProblemItem | null {
    if (!this.mesh.visible) return null;
    let best: ProblemItem | null = null, bd = Infinity;
    const k = rect.height / (2 * Math.tan((camera.fov * Math.PI) / 360));
    for (const it of this.items) {
      const n = it.n ?? 1;
      this.v.set(it.x, it.y, it.z);
      const dist = this.v.distanceTo(camera.position);
      if (dist > (n > 1 ? 4400 : 1900)) continue;
      this.v.project(camera);
      if (this.v.z > 1) continue;
      const sx = rect.left + ((this.v.x + 1) / 2) * rect.width, sy = rect.top + ((1 - this.v.y) / 2) * rect.height;
      const half = (bubbleSize(dist, n) * k) / dist / 2 + 3;
      if (Math.abs(cx - sx) <= half && Math.abs(cy - sy) <= half * 1.4 && dist < bd) { bd = dist; best = it; }
    }
    return best;
  }

  /** Replace all icons. */
  set(items: ProblemItem[]) {
    this.items = items.slice();
    if (items.length > this.cap) this.grow(Math.ceil(items.length * 1.5));
    const P = this.pos.array as Float32Array, I = this.icon.array as Float32Array, N = this.count.array as Float32Array;
    items.forEach((it, i) => {
      P[i * 4] = it.x; P[i * 4 + 1] = it.y; P[i * 4 + 2] = it.z; P[i * 4 + 3] = (Math.abs(it.id) * 1.7) % 6.28;
      I[i] = PROBLEMS.indexOf(it.p);
      N[i] = it.n ?? 1;
    });
    this.pos.needsUpdate = true;
    this.icon.needsUpdate = true;
    this.count.needsUpdate = true;
    this.geo.instanceCount = items.length;
  }

  tick(dt: number) {
    this.mat.uniforms.uTime.value += dt;
  }

  set visible(v: boolean) { this.mesh.visible = v; }
}
