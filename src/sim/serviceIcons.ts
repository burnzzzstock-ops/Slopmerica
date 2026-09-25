// Problem notification bubbles over buildings (no power, no water, trash,
// fire, crime, sick, abandoned...). One instanced billboard draw call with a
// small vector-drawn icon atlas (no emoji fonts: those differ per device).
import * as THREE from 'three';

export type Problem = 'power' | 'water' | 'sewage' | 'garbage' | 'fire' | 'crime' | 'sick' | 'abandoned' | 'education' | 'pollution';
export const PROBLEMS: Problem[] = ['power', 'water', 'sewage', 'garbage', 'fire', 'crime', 'sick', 'abandoned', 'education', 'pollution'];
const COLS = 10;
const S = 96;

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

export class ProblemIcons {
  readonly mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  private pos: THREE.InstancedBufferAttribute;
  private icon: THREE.InstancedBufferAttribute;
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
    this.grow(256);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { tIcons: { value: drawAtlas() }, uTime: { value: 0 }, uPx: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute vec4 iPos; // xyz + phase
        attribute float iIcon;
        uniform float uTime;
        varying vec2 vUv;
        varying float vFade;
        void main() {
          vec3 p = iPos.xyz;
          p.y += sin(uTime * 2.4 + iPos.w) * 0.6;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float dist = -mv.z;
          // constant-ish screen size: grows with distance, clamped
          float s = clamp(dist * 0.035, 3.2, 26.0);
          mv.xy += position.xy * s;
          vFade = 1.0 - smoothstep(1400.0, 1900.0, dist);
          vUv = vec2((iIcon + uv.x) / ${COLS.toFixed(1)}, uv.y);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tIcons;
        varying vec2 vUv;
        varying float vFade;
        void main() {
          vec4 c = texture2D(tIcons, vUv);
          if (c.a < 0.08) discard;
          gl_FragColor = vec4(c.rgb, c.a * vFade);
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    scene.add(this.mesh);
  }

  private grow(n: number) {
    this.cap = n;
    this.pos = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
    this.icon = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
    this.pos.setUsage(THREE.DynamicDrawUsage);
    this.icon.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('iPos', this.pos);
    this.geo.setAttribute('iIcon', this.icon);
  }

  /** Replace all icons. items: x,y,z,problem */
  set(items: { x: number; y: number; z: number; p: Problem; id: number }[]) {
    if (items.length > this.cap) this.grow(Math.ceil(items.length * 1.5));
    const P = this.pos.array as Float32Array, I = this.icon.array as Float32Array;
    items.forEach((it, i) => {
      P[i * 4] = it.x; P[i * 4 + 1] = it.y; P[i * 4 + 2] = it.z; P[i * 4 + 3] = (it.id * 1.7) % 6.28;
      I[i] = PROBLEMS.indexOf(it.p);
    });
    this.pos.needsUpdate = true;
    this.icon.needsUpdate = true;
    this.geo.instanceCount = items.length;
  }

  tick(dt: number) {
    this.mat.uniforms.uTime.value += dt;
  }

  set visible(v: boolean) { this.mesh.visible = v; }
}
