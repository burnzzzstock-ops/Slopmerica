// Vehicle lineup (dev/vehicles.html): the real VehicleRenderer on a plain road, no game, so every model can be captured at a
// fixed camera at 8 m, 40 m and 150 m, by day and by night (docs/HANDOFF_CARS_LOOK.md, "Build a vehicle lineup").
// It runs on the old renderer as well as the new one (options the old one doesn't know are ignored), which is what makes the
// before/after captures use the same page and the same camera. Driven by scripts/lineup.mjs through window.__lineup.
import * as THREE from 'three';
import { GLOW } from '../config';
import { ATMOS } from '../world/atmos';
import { VEHICLE_SPECS, VehicleRenderer } from '../agents/vehicles';
import * as Models from '../agents/models/vehicleModels';
import type { VehicleKind } from '../contracts';

const params = new URLSearchParams(location.search);
const W = Number(params.get('w') || 960), H = Number(params.get('h') || 540);
const stage = document.getElementById('stage')!;
const hud = document.getElementById('hud')!;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, W / H, 0.3, 3000); // the game's default field of view

// a baked sky for reflections, like the game's (world/sky.ts): pale zenith, light horizon, brown ground
{
  const dome = new THREE.Mesh(new THREE.SphereGeometry(100, 24, 12), new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide }));
  const pos = dome.geometry.getAttribute('position'), col = new Float32Array(pos.count * 3), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 100;
    if (y > 0) c.setRGB(0.62, 0.78, 1.0).lerp(new THREE.Color(0.95, 0.97, 1.0), 1 - Math.pow(y, 0.55));
    else c.setRGB(0.5, 0.46, 0.36).lerp(new THREE.Color(0.9, 0.93, 0.95), 1 + y * 4 < 0 ? 0 : Math.max(0, 1 + y * 4));
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  dome.geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const env = new THREE.Scene(); env.add(dome);
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(env, 0.02).texture;
  scene.environmentIntensity = 1;
}

const sun = new THREE.DirectionalLight(0xfff1d8, 3);
sun.position.set(-40, 70, 30);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 300 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);
const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x8a7a48, 1.1);
scene.add(hemi);

// an asphalt road with a dashed centre line and kerb strips, so shadows, pools of light and scale read
function roadTexture(): THREE.Texture {
  const c = document.createElement('canvas'); c.width = 512; c.height = 512;
  const g = c.getContext('2d')!;
  g.fillStyle = '#4b4e51'; g.fillRect(0, 0, 512, 512);
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 9000; i++) { const v = 60 + rnd() * 40; g.fillStyle = `rgba(${v},${v + 2},${v + 4},${0.25 + rnd() * 0.3})`; g.fillRect(rnd() * 512, rnd() * 512, 1 + rnd() * 2, 1 + rnd() * 2); }
  g.fillStyle = '#d8c25a'; g.fillRect(250, 0, 4, 512); g.fillRect(258, 0, 4, 512); // double yellow
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(30, 30); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshStandardMaterial({ map: roadTexture(), roughness: 0.93, metalness: 0 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
// a 5 m scale bar of white/black tiles, off to the side of the car
const bar = new THREE.Group();
for (let i = 0; i < 5; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(1, 0.02, 0.3), new THREE.MeshStandardMaterial({ color: i % 2 ? 0x222222 : 0xeeeeee })); b.position.set(i - 2, 0.01, 0); bar.add(b); }
bar.position.set(0, 0, -9); bar.visible = false; scene.add(bar);
const moonLamp = new THREE.PointLight(0xffb05a, 0, 30, 1.6); moonLamp.position.set(7, 6.5, 6); scene.add(moonLamp);

const renderers = new VehicleRenderer(scene, 24);
const vr = renderers as unknown as Record<string, unknown> & VehicleRenderer;
const modelList: Array<{ id: string; kind: VehicleKind }> = (Models as any).vehicleModelList
  ? (Models as any).vehicleModelList()
  : (Object.keys(VEHICLE_SPECS) as VehicleKind[]).map((k) => ({ id: k, kind: k }));
const PAINT_GREY = 0xb9bcbf;
let handles: number[] = [];

type ShowOpts = { dist?: number; az?: number; el?: number; night?: number; wet?: number; lod?: number; color?: number; auto?: boolean; gap?: number; look?: [number, number, number]; braking?: boolean; turn?: number; reverse?: boolean; parked?: boolean; speed?: number; seed?: number; scale?: boolean; fov?: number; drive?: { n: number; turn: number; step: number } };

function setNight(night: number) {
  vr.setNight(night);
  const lift = 1 + 0.85 * night;
  GLOW.value = 1 / lift;
  renderer.toneMappingExposure = 0.95 * lift;
  sun.color.set(night ? 0x8fa6d8 : 0xfff1d8);
  sun.intensity = night ? 0.55 : 3;
  hemi.intensity = night ? 0.32 : 1.1;
  hemi.color.set(night ? 0x5f79b0 : 0xcfe3ff);
  scene.environmentIntensity = night ? 0.18 : 1;
  moonLamp.intensity = night ? 90 : 0;
  scene.background = new THREE.Color(night ? 0x0d1420 : 0xa7bccb);
}

function show(ids: string | string[], o: ShowOpts = {}) {
  const list = Array.isArray(ids) ? ids : [ids];
  for (const h of handles) vr.remove(h);
  handles = [];
  setNight(o.night ?? 0);
  ATMOS.uWet.value = o.wet ?? 0;
  (vr as any).setLodOverride?.(o.lod ?? -1);
  // cars nose to tail along z, front toward +z, centred on the origin
  const specs = list.map((id) => VEHICLE_SPECS[(modelList.find((m) => m.id === id)?.kind ?? id) as VehicleKind]);
  const gap = o.gap ?? 2.2;
  const total = specs.reduce((a, s) => a + s.length, 0) + gap * (list.length - 1);
  let z = -total / 2;
  let hMax = 0;
  list.forEach((id, i) => {
    const info = modelList.find((m) => m.id === id) ?? { id, kind: id as VehicleKind };
    const s = VEHICLE_SPECS[info.kind];
    const h = (vr as any).add(info.kind, o.color ?? (o.auto ? 0xf2f2f2 : PAINT_GREY), { variant: info.id, exact: !o.auto, seed: o.seed ?? i + 1 });
    z += s.length / 2;
    vr.set(h, 0, 0, z, 0);
    if (o.braking) vr.setBraking(h, true);
    if (o.turn) vr.setTurn(h, o.turn);
    if (o.reverse) (vr as any).setReversing?.(h, true);
    if (o.parked) (vr as any).setParked?.(h, true);
    z += s.length / 2 + gap;
    hMax = Math.max(hMax, s.height);
    handles.push(h);
  });
  // drive: move the first car through a bend (n steps, `turn` radians of yaw and `step` metres each), calling set() every step like the traffic model does
  let follow: THREE.Vector3 | undefined;
  if (o.drive && handles.length) {
    const info = modelList.find((m) => m.id === list[0]) ?? { kind: list[0] as VehicleKind };
    let x = 0, z = -o.drive.n * o.drive.step * 0.5, yaw = 0;
    for (let k = 0; k < o.drive.n; k++) { yaw += o.drive.turn; x += Math.sin(yaw) * o.drive.step; z += Math.cos(yaw) * o.drive.step; vr.set(handles[0], x, 0, z, yaw); vr.flush(); }
    follow = new THREE.Vector3(x, 0, z);
    void info;
  }
  bar.visible = !!o.scale;
  if (camera.fov !== (o.fov ?? 50)) { camera.fov = o.fov ?? 50; camera.updateProjectionMatrix(); }
  const dist = o.dist ?? 12, az = ((o.az ?? 35) * Math.PI) / 180, el = ((o.el ?? 18) * Math.PI) / 180;
  const look = new THREE.Vector3(...(o.look ?? [0, hMax * 0.42, 0]));
  if (follow) look.add(follow);
  camera.position.set(look.x + Math.sin(az) * Math.cos(el) * dist, look.y + Math.sin(el) * dist, look.z + Math.cos(az) * Math.cos(el) * dist);
  camera.lookAt(look);
  camera.updateMatrixWorld(true);
  sun.target.position.set(0, 0, 0);
  sun.position.set(-38, 62, 26);
  for (let i = 0; i < 3; i++) { vr.updateLod(camera); vr.flush(); }
  renderer.render(scene, camera);
  const tris = renderer.info.render.triangles, calls = renderer.info.render.calls;
  hud.textContent = `${list.join(', ')}\n${dist} m · az ${o.az ?? 35} · el ${o.el ?? 18} · ${o.night ? 'night' : 'day'}${o.wet ? ' · wet' : ''}   ${calls} calls ${tris} tris`;
  return { calls, tris };
}

function frame(dt = 0.016, n = 1) {
  for (let i = 0; i < n; i++) { (vr as any).tick?.(dt); vr.updateLod(camera); vr.flush(); }
  renderer.render(scene, camera);
}

(window as any).__lineup = {
  ready: true,
  ids: () => modelList.map((m) => m.id),
  models: () => modelList.map((m) => ({ ...m, ...VEHICLE_SPECS[m.kind] })),
  show, frame, renderer, scene, camera, vr, stats: () => (vr as any).stats?.(),
};
show(modelList[0].id);
