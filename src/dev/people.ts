// Dev-only pedestrian lineup (dev/people.html): the citizen renderer on a plain pavement, no game, no town, so it loads in
// seconds and a script can shoot every archetype at any distance, day or night, doing anything. It only touches the public
// PeopleRenderer API (add / set / flush / setNight), so the same page runs on the old and the new model code and the two can
// be compared with the same camera. Everything is on `window.__people`:
//   render(tiles, {night})  draw one or more viewport tiles, each with its own camera and poses (scripts/peoplelineup.mjs)
//   probe({...})            run the model's own vertex shader on the GPU for one person, read every deformed vertex back and
//                           report how far the feet skate on the ground (scripts/peoplefeet.mjs)
import * as THREE from 'three';
import type { PersonAction } from '../contracts';
import { ARCHETYPES, PeopleRenderer } from '../agents/people';

const hud = document.getElementById('hud');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.autoClear = true;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const DAY_BG = new THREE.Color('#9db4bd'), NIGHT_BG = new THREE.Color('#0b1220');
scene.background = DAY_BG.clone();

const sun = new THREE.DirectionalLight('#fff1d2', 3.1);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);
const hemi = new THREE.HemisphereLight('#dbedff', '#5a5540', 1.9);
scene.add(hemi);
// one warm street lamp that follows the tile at night
const lamp = new THREE.PointLight('#ffb864', 0, 40, 1.6);
scene.add(lamp);

function gridTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#8f8b82'; g.fillRect(0, 0, 256, 256);
  // 1 m tiles (256 px = 4 m): a faint joint every metre and a darker line every 4 m, so a planted foot is visible against it
  g.strokeStyle = 'rgba(40,40,40,.28)'; g.lineWidth = 2;
  for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(i * 64, 0); g.lineTo(i * 64, 256); g.moveTo(0, i * 64); g.lineTo(256, i * 64); g.stroke(); }
  g.strokeStyle = 'rgba(20,20,20,.5)'; g.lineWidth = 3; g.strokeRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
const gridTex = gridTexture();
gridTex.repeat.set(200 / 4, 200 / 4);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ map: gridTex, roughness: 0.95, metalness: 0 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const people = new PeopleRenderer(scene, 700);
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 2000);

export interface Pose { h: number; x: number; y?: number; z: number; yaw?: number; action: PersonAction; phase: number }
export interface Tile {
  x: number; y: number; w: number; h: number;
  eye: [number, number, number]; target: [number, number, number]; fov?: number;
  poses?: Pose[]; night?: boolean;
  /** shift the pavement grid along z (so a planted foot stays on its tile joint while the body walks past) */
  groundZ?: number;
  /** half-size (m) of the sun's shadow box around the target */
  shadow?: number;
  /** names to hang over heads: projected with this tile's camera and drawn as page text */
  labels?: { text: string; x: number; y: number; z: number }[];
  labelPx?: number;
}

function place(t: Tile): void {
  const night = !!t.night;
  scene.background = (night ? NIGHT_BG : DAY_BG) as THREE.Color;
  sun.color.set(night ? '#7f9bd6' : '#fff1d2');
  sun.intensity = night ? 0.55 : 3.1;
  hemi.intensity = night ? 0.9 : 1.9;
  renderer.toneMappingExposure = night ? 1.9 : 1.1;
  const tg = new THREE.Vector3(...t.target);
  const half = t.shadow ?? 8;
  sun.target.position.copy(tg);
  sun.position.set(tg.x - 0.45 * 60, tg.y + 0.8 * 60, tg.z + 0.25 * 60);
  const sc = sun.shadow.camera;
  sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half; sc.near = 5; sc.far = 130;
  sc.updateProjectionMatrix();
  lamp.intensity = night ? 90 : 0;
  lamp.position.set(t.eye[0] * 0.5 + tg.x * 0.5 + 1.5, 4.6, t.eye[2] * 0.5 + tg.z * 0.5 - 1);
  ground.position.set(0, 0, 0);
  gridTex.offset.set(0, -((t.groundZ ?? 0) / 4));
  people.setNight(night ? 1 : 0);
}

function draw(t: Tile): void {
  for (const p of t.poses ?? []) people.set(p.h, p.x, p.y ?? 0, p.z, p.yaw ?? 0, p.action, p.phase);
  people.flush();
  place(t);
  camera.aspect = t.w / t.h;
  camera.fov = t.fov ?? 40;
  camera.position.set(...t.eye);
  camera.lookAt(...t.target);
  camera.near = Math.max(0.05, Math.min(t.eye[1], 3) * 0.05);
  camera.far = 3000;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  const H = window.innerHeight;
  renderer.setViewport(t.x, H - t.y - t.h, t.w, t.h);
  renderer.setScissor(t.x, H - t.y - t.h, t.w, t.h);
  renderer.setScissorTest(true);
  renderer.render(scene, camera);
}

const labelLayer = document.createElement('div');
labelLayer.style.cssText = 'position:fixed;inset:0;pointer-events:none;overflow:hidden';
document.body.append(labelLayer);

function labels(t: Tile): void {
  const v = new THREE.Vector3();
  for (const l of t.labels ?? []) {
    v.set(l.x, l.y, l.z).project(camera);
    if (v.z > 1 || Math.abs(v.x) > 1 || Math.abs(v.y) > 1) continue;
    const el = document.createElement('div');
    el.textContent = l.text;
    el.style.cssText = `position:absolute;transform:translate(-50%,-100%);white-space:nowrap;font:${t.labelPx ?? 10}px/1 ui-sans-serif,Arial,sans-serif;font-weight:700;color:#fff;background:#0009;padding:1px 3px;border-radius:2px;left:${t.x + (v.x * 0.5 + 0.5) * t.w}px;top:${t.y + (0.5 - v.y * 0.5) * t.h}px`;
    labelLayer.append(el);
  }
}

function render(tiles: Tile[]): void {
  labelLayer.textContent = '';
  for (const t of tiles) { draw(t); labels(t); }
  renderer.setScissorTest(false);
}

/** Feet on the ground, from the real vertex shader (see the header). */
function probe(opts: {
  h: number; action: PersonAction; /** metres travelled per sample */ step: number; samples: number;
  /** metres of ground per leg cycle the game assumes: pedestrians.ts STRIDE, 1.42 walking and 2.2 running */ stride: number;
  /** shader zone ids of the feet (aTag.y); default: the shoe zone, 4 */ zones?: number[];
  raw?: boolean;
}) {
  const near = (people as unknown as { near: { mesh: THREE.InstancedMesh; material: { material: THREE.MeshStandardMaterial } } }).near;
  const geo = near.mesh.geometry;
  const pos = geo.getAttribute('position');
  const tag = geo.getAttribute('aTag');
  const n = pos.count;
  // a point per vertex; per-instance attributes expanded to constants (the model's own attribute names, so it runs on old and new code)
  const g = new THREE.BufferGeometry();
  const inst: { src: THREE.BufferAttribute; dst: THREE.BufferAttribute; size: number }[] = [];
  for (const name of Object.keys(geo.attributes)) {
    const a = geo.getAttribute(name) as THREE.BufferAttribute & { isInstancedBufferAttribute?: boolean };
    if (a.isInstancedBufferAttribute) {
      const dst = new THREE.BufferAttribute(new Float32Array(n * a.itemSize), a.itemSize);
      g.setAttribute(name, dst); inst.push({ src: a, dst, size: a.itemSize });
    } else g.setAttribute(name, a);
  }
  g.setDrawRange(0, n);
  const shader = {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: `mat4 instanceMatrix = mat4(1.0);
      #include <common>
      uniform vec2 uProbeSize;
      varying vec3 vProbe;
      void main() {
        #include <beginnormal_vertex>
        #include <begin_vertex>
        vProbe = transformed;
        vec2 px = vec2(mod(float(gl_VertexID), uProbeSize.x), floor(float(gl_VertexID) / uProbeSize.x));
        gl_Position = vec4((px + 0.5) / uProbeSize * 2.0 - 1.0, 0.0, 1.0);
        gl_PointSize = 1.0;
      }`,
    fragmentShader: '#include <common>\n#include <color_fragment>\nvec3 totalEmissiveRadiance = emissive;',
  };
  (near.material.material.onBeforeCompile as (s: unknown, r: unknown) => void)(shader, renderer);
  const W = 1024, Hh = Math.ceil(n / W);
  shader.uniforms.uProbeSize = { value: new THREE.Vector2(W, Hh) };
  for (const k of ['uLodDistance', 'uFarDistance']) if (shader.uniforms[k]) shader.uniforms[k].value = 1e9;
  const mat = new THREE.ShaderMaterial({
    uniforms: shader.uniforms as never, vertexShader: shader.vertexShader,
    fragmentShader: 'varying vec3 vProbe; void main() { gl_FragColor = vec4(vProbe, 1.0); }',
    depthTest: false, depthWrite: false, blending: THREE.NoBlending,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  const pscene = new THREE.Scene(); pscene.add(pts);
  const rt = new THREE.WebGLRenderTarget(W, Hh, { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false });
  const cam = new THREE.PerspectiveCamera();
  const out = new Float32Array(W * Hh * 4);
  const zones = new Set(opts.zones ?? [4]);
  const foot: { i: number; side: 0 | 1 }[] = [];
  for (let i = 0; i < n; i++) if (zones.has(Math.round(tag.getY(i)))) foot.push({ i, side: pos.getX(i) < 0 ? 0 : 1 });

  const frames: { top: number; x: Float32Array; y: Float32Array; z: Float32Array }[] = [];
  const collapsed = new Uint8Array(foot.length);
  const oldRT = renderer.getRenderTarget();
  const keepClear = renderer.getClearColor(new THREE.Color()); const keepAlpha = renderer.getClearAlpha();
  const keepViewport = renderer.getViewport(new THREE.Vector4());
  renderer.setScissorTest(false);
  for (let s = 0; s < opts.samples; s++) {
    const Z = s * opts.step;
    people.set(opts.h, 0, 0, Z, 0, opts.action, Z / opts.stride);
    for (const q of inst) {
      const at = opts.h * q.size, a = q.dst.array as Float32Array, sa = q.src.array as Float32Array;
      for (let i = 0; i < n; i++) for (let c = 0; c < q.size; c++) a[i * q.size + c] = sa[at + c];
      q.dst.needsUpdate = true;
    }
    renderer.setRenderTarget(rt);
    renderer.setViewport(0, 0, W, Hh);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(pscene, cam);
    renderer.readRenderTargetPixels(rt, 0, 0, W, Hh, out);
    const x = new Float32Array(foot.length), y = new Float32Array(foot.length), z = new Float32Array(foot.length);
    let top = -1e9;
    for (let k = 0; k < foot.length; k++) { const o = foot[k].i * 4; x[k] = out[o]; y[k] = out[o + 1]; z[k] = out[o + 2] + Z; }
    for (let i = 0; i < n; i++) top = Math.max(top, out[i * 4 + 1]);
    // shoe pieces the person does not wear collapse to the instance origin (the shader drops them as degenerate triangles):
    // they are not feet, and left in they would count as soles that slide at exactly the ground speed
    if (s === 0) for (let k = 0; k < foot.length; k++) { const o = foot[k].i * 4; if (out[o] === 0 && out[o + 1] === 0 && out[o + 2] === 0) collapsed[k] = 1; }
    frames.push({ top, x, y, z });
  }
  renderer.setRenderTarget(oldRT); renderer.setClearColor(keepClear, keepAlpha); renderer.setViewport(keepViewport);
  rt.dispose(); mat.dispose(); g.dispose();
  people.set(opts.h, 0, 0, 0, 0, 'idle', 0);

  // the sole is the lowest a foot vertex ever gets; a vertex is "on the ground" within `band` of it
  let sole = 1e9, tops = [1e9, -1e9];
  for (const f of frames) { for (let k = 0; k < foot.length; k++) if (!collapsed[k]) sole = Math.min(sole, f.y[k]); tops = [Math.min(tops[0], f.top), Math.max(tops[1], f.top)]; }
  const result: Record<string, unknown> = { vertices: n, footVertices: foot.length - collapsed.reduce((p, q) => p + q, 0), sole: +sole.toFixed(4), topRange: tops.map((v) => +v.toFixed(3)) };
  for (const band of [0.012, 0.03]) {
    const ratios: number[] = [];
    const contactFrames = [0, 0];
    let airborne = 0;
    for (let s = 1; s < frames.length; s++) {
      const a = frames[s - 1], b = frames[s];
      const on = [false, false];
      for (let k = 0; k < foot.length; k++) {
        if (!collapsed[k] && a.y[k] < sole + band && b.y[k] < sole + band) {
          on[foot[k].side] = true;
          ratios.push(Math.hypot(b.z[k] - a.z[k], b.x[k] - a.x[k]) / opts.step);
        }
      }
      contactFrames[0] += on[0] ? 1 : 0; contactFrames[1] += on[1] ? 1 : 0;
      if (!on[0] && !on[1]) airborne++;
    }
    ratios.sort((p, q) => p - q);
    const mean = ratios.reduce((p, q) => p + q, 0) / Math.max(1, ratios.length);
    const pct = (p: number) => ratios.length ? ratios[Math.min(ratios.length - 1, Math.floor(p * ratios.length))] : NaN;
    result[`band${band}`] = { contactVertexFrames: ratios.length, slideMeanPct: +(mean * 100).toFixed(1), slideP95Pct: +(pct(0.95) * 100).toFixed(1), slideMaxPct: +(ratios.length ? ratios[ratios.length - 1] * 100 : NaN).toFixed(1), contactFracL: +(contactFrames[0] / (frames.length - 1)).toFixed(2), contactFracR: +(contactFrames[1] / (frames.length - 1)).toFixed(2), airborneFrac: +(airborne / (frames.length - 1)).toFixed(2) };
  }
  if (opts.raw) result.frames = frames.map((f) => ({ top: f.top, y: Array.from(f.y), z: Array.from(f.z) }));
  return result;
}

(window as unknown as Record<string, unknown>).__people = {
  ready: true,
  archetypes: ARCHETYPES.map((a, i) => ({ i, id: a.id, name: a.name, vices: a.vices })),
  spawn: (arch: number, seed: number) => people.add(arch, seed),
  remove: (h: number) => people.remove(h),
  render,
  probe,
  size: () => ({ w: window.innerWidth, h: window.innerHeight }),
  info: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }),
  api: { renderer: 'PeopleRenderer' },
};
if (hud) hud.textContent = `people lineup: ${ARCHETYPES.length} archetypes ready (window.__people)`;
