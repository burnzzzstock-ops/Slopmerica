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
import { QUALITY } from '../config';

// ?q=low|medium|high|ultra: the quality preset's people knobs and shadow map size (without it: High's, which is the renderer's default)
const query = new URLSearchParams(location.search);
const presetName = query.get('q');
// (&near=40&max=12&shadow=120&lite=0 override single knobs of the preset, to measure one change at a time)
const preset = presetName && presetName in QUALITY ? { ...QUALITY[presetName as keyof typeof QUALITY] } : null;
if (preset) {
  if (query.has('near')) preset.peopleNear = +query.get('near')!;
  if (query.has('max')) preset.peopleNearMax = +query.get('max')!;
  if (query.has('shadow')) preset.peopleShadow = +query.get('shadow')!;
  if (query.has('lite')) preset.peopleShadowLite = query.get('lite') === '1';
}
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
sun.shadow.mapSize.set(preset?.shadowMap ?? 2048, preset?.shadowMap ?? 2048);
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
if (preset) (people as unknown as { setDetail?: (q: unknown) => void }).setDetail?.(preset); // (the old model has no knobs)
(people as unknown as { bindRenderer?: (r: THREE.WebGLRenderer) => void }).bindRenderer?.(renderer); // (the first model has no pose pass: nothing to bind)
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

// everyone a tile does not list goes underground, or the people of the earlier tiles stand around in the later ones
const placed = new Set<number>();
const spawned = new Set<number>();
function draw(t: Tile): void {
  for (const h of placed) people.set(h, 0, -1e4, 0, 0, 'idle', 0);
  placed.clear();
  for (const p of t.poses ?? []) { people.set(p.h, p.x, p.y ?? 0, p.z, p.yaw ?? 0, p.action, p.phase); placed.add(p.h); }
  place(t);
  camera.aspect = t.w / t.h;
  camera.fov = t.fov ?? 40;
  camera.position.set(...t.eye);
  camera.lookAt(...t.target);
  camera.near = Math.max(0.05, Math.min(t.eye[1], 3) * 0.05);
  camera.far = 3000;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  // (each tile has its own camera: the near figure and who is drawn at all are chosen from it; the first version of the renderer took positions only)
  people.flush(typeof (people as unknown as { setDetail?: unknown }).setDetail === 'function' ? [camera as never] : [camera.position]);
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
  const inst: { name: string; src: THREE.BufferAttribute; dst: THREE.BufferAttribute; size: number }[] = [];
  for (const name of Object.keys(geo.attributes)) {
    const a = geo.getAttribute(name) as THREE.BufferAttribute & { isInstancedBufferAttribute?: boolean };
    if (a.isInstancedBufferAttribute) {
      const dst = new THREE.BufferAttribute(new Float32Array(n * a.itemSize), a.itemSize);
      g.setAttribute(name, dst); inst.push({ name, src: a, dst, size: a.itemSize });
    } else g.setAttribute(name, a);
  }
  g.setDrawRange(0, n);
  const shader = {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: `#define CITIZEN_PROBE
      mat4 instanceMatrix = mat4(1.0);
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
  shader.uniforms.uProbeInstance = { value: opts.h }; // (the poses come from the pose pass: this person's row)
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
    people.flush([new THREE.Vector3(0, 2, Z + 6)]); // (a viewer in range: the person is on the lists, so his pose row is worked out)
    for (const q of inst) {
      const at = opts.h * q.size, a = q.dst.array as Float32Array, sa = q.src.array as Float32Array;
      // (the near figure's own arrays hold only the people who are near, in another order: the motion comes from the renderer by handle)
      const mo = q.name === 'iMotion' ? (people as unknown as { motionOf?: (h: number) => number[] }).motionOf?.(opts.h) : undefined;
      for (let i = 0; i < n; i++) for (let c = 0; c < q.size; c++) a[i * q.size + c] = mo ? mo[c] : sa[at + c];
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
  spawn: (arch: number, seed: number) => { const h = people.add(arch, seed); if (h >= 0) spawned.add(h); return h; },
  remove: (h: number) => { people.remove(h); spawned.delete(h); },
  /** everybody spawned so far goes underground (a check that reads who is drawn must not meet the people an earlier sheet left standing) */
  parkAll: () => { for (const h of spawned) people.set(h, 0, -1e4, 0, 0, 'idle', 0); placed.clear(); },
  render,
  probe,
  size: () => ({ w: window.innerWidth, h: window.innerHeight }),
  info: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }),
  /** hide / show the whole people group (for cost runs: hidden, the instances are not even drawn) */
  setVisible: (v: boolean) => {
    people.object.visible = v;
    // hidden also means no pose pass (the new model works the poses out in one draw outside the group)
    const r = people as unknown as { poseOn?: boolean; poseWas?: boolean };
    if (r.poseOn !== undefined) { r.poseWas ??= r.poseOn; r.poseOn = v && r.poseWas; }
  },
  /** how many people each draw list holds right now, and who (new model only) */
  lists: () => (people as unknown as { listCounts?: () => unknown }).listCounts?.() ?? null,
  listHandles: () => (people as unknown as { listHandles?: () => unknown }).listHandles?.() ?? null,
  /** the preset's people knobs (or the renderer's defaults: High's) */
  detail: () => ({ near: preset?.peopleNear ?? 64, nearMax: preset?.peopleNearMax ?? 9999, shadow: preset?.peopleShadow ?? 9999 }),
  preset: presetName,
  /** switch parts of a cost run on and off: the near figure, the far figure, the sun's shadow map */
  parts: (cfg: { near?: boolean; far?: boolean; shadows?: boolean; plain?: 'basic' | 'standard' | 'off'; flat?: boolean }) => {
    for (const c of people.object.children) {
      const m = c as THREE.InstancedMesh;
      if (c.name === 'people-near' && cfg.plain !== undefined) {
        const keep = (m.userData.keep ??= m.material);
        m.material = cfg.plain === 'basic' ? new THREE.MeshBasicMaterial({ color: 0x808080 }) : cfg.plain === 'standard' ? new THREE.MeshStandardMaterial({ color: 0x808080 }) : keep;
      }
      if (c.name === 'people-near' && cfg.flat !== undefined) {
        const keepG = (m.userData.keepGeo ??= m.geometry);
        m.geometry = cfg.flat ? keepG.toNonIndexed() : keepG;
      }
      if (c.name === 'people-near' && cfg.near !== undefined) c.visible = cfg.near;
      if ((c.name === 'people-far' || c.name === 'people-shadow') && cfg.far !== undefined) c.visible = cfg.far;
    }
    if (cfg.shadows !== undefined && renderer.shadowMap.enabled !== cfg.shadows) {
      renderer.shadowMap.enabled = cfg.shadows;
      scene.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined; if (m) (Array.isArray(m) ? m : [m]).forEach((x) => { x.needsUpdate = true; }); });
    }
  },
  api: { renderer: 'PeopleRenderer' },
};
if (hud) hud.textContent = `people lineup: ${ARCHETYPES.length} archetypes ready (window.__people)`;
