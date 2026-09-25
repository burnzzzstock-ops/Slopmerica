import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { VehicleKind } from '../../contracts';

export interface VehicleDimensions { length: number; width: number; height: number }

export interface VehicleLodGeometry {
  shell: THREE.BufferGeometry;
  detail: THREE.BufferGeometry;
  lights?: THREE.BufferGeometry;
}

export interface VehicleModelGeometry {
  near: VehicleLodGeometry;
  far: VehicleLodGeometry;
  wheelRadius: number;
  nearTriangles: number;
  farTriangles: number;
}

type V3 = readonly [number, number, number];
type TaggedPart = {
  geometry: THREE.BufferGeometry;
  color: number;
  zone?: number;
  wheel?: number;
  wheelX?: number;
  wheelY?: number;
  wheelZ?: number;
  signal?: number;
  fade?: readonly number[];
};

const M = new THREE.Matrix4();
const E = new THREE.Euler();

function transformed(g: THREE.BufferGeometry, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0): THREE.BufferGeometry {
  E.set(rx, ry, rz);
  M.makeRotationFromEuler(E).setPosition(x, y, z);
  g.applyMatrix4(M);
  return g;
}

function box(w: number, h: number, l: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.BufferGeometry {
  return transformed(new THREE.BoxGeometry(w, h, l), x, y, z, rx, ry, rz);
}

function cyl(r: number, depth: number, x: number, y: number, z: number, rz = 0, seg = 10): THREE.BufferGeometry {
  return transformed(new THREE.CylinderGeometry(r, r, depth, seg, 1, false), x, y, z, 0, 0, rz);
}

function sphere(r: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(r, 10, 6);
  g.scale(sx, sy, sz);
  g.translate(x, y, z);
  return g;
}

function quad(a: V3, b: V3, c: V3, d: V3, uv: readonly number[] = [0, 0, 1, 0, 1, 1, 0, 1]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([
    ...a, ...b, ...c, ...a, ...c, ...d,
  ], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([
    uv[0], uv[1], uv[2], uv[3], uv[4], uv[5], uv[0], uv[1], uv[4], uv[5], uv[6], uv[7],
  ], 2));
  g.computeVertexNormals();
  return g;
}

interface Station { z: number; bottom: number; top: number; half: number; roof: number }

/** Six-sided rings produce a chamfer down both shoulders instead of a toy-like box. */
function loft(stations: readonly Station[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  for (const s of stations) pos.push(
    -s.half, s.bottom, s.z,
    -s.half, s.top * 0.78 + s.bottom * 0.22, s.z,
    -s.roof, s.top, s.z,
    s.roof, s.top, s.z,
    s.half, s.top * 0.78 + s.bottom * 0.22, s.z,
    s.half, s.bottom, s.z,
  );
  for (let i = 0; i < stations.length - 1; i++) {
    const a = i * 6, b = (i + 1) * 6;
    for (let j = 0; j < 6; j++) {
      const k = (j + 1) % 6;
      idx.push(a + j, b + j, b + k, a + j, b + k, a + k);
    }
  }
  for (const [ring, flip] of [[0, true], [(stations.length - 1) * 6, false]] as const) {
    for (let j = 1; j < 5; j++) idx.push(...(flip ? [ring, ring + j + 1, ring + j] : [ring, ring + j, ring + j + 1]));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function tag(part: TaggedPart, kind: 'detail' | 'light'): THREE.BufferGeometry {
  let g = part.geometry;
  if (g.index) g = g.toNonIndexed();
  const n = g.getAttribute('position').count;
  const c = new THREE.Color(part.color);
  const colors = new Float32Array(n * 3);
  const zone = new Float32Array(n);
  const wheel = new Float32Array(n);
  const wheelCenter = new Float32Array(n * 3);
  const signal = new Float32Array(n);
  const fade = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    zone[i] = part.zone ?? 0;
    wheel[i] = part.wheel ?? 0;
    wheelCenter[i * 3] = part.wheelX ?? 0;
    wheelCenter[i * 3 + 1] = part.wheelY ?? 0;
    wheelCenter[i * 3 + 2] = part.wheelZ ?? 0;
    signal[i] = part.signal ?? 0;
    fade[i] = part.fade?.[i] ?? 1;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.setAttribute('zone', new THREE.BufferAttribute(zone, 1));
  g.setAttribute('wheel', new THREE.BufferAttribute(wheel, 1));
  g.setAttribute('wheelCenter', new THREE.BufferAttribute(wheelCenter, 3));
  g.setAttribute('signal', new THREE.BufferAttribute(signal, 1));
  g.setAttribute('fade', new THREE.BufferAttribute(fade, 1));
  if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  return g;
}

function mergeTagged(parts: TaggedPart[], kind: 'detail' | 'light'): THREE.BufferGeometry {
  if (!parts.length) {
    const g = tag({ geometry: new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([], 3)), color: 0xffffff }, kind);
    g.setAttribute('normal', new THREE.Float32BufferAttribute([], 3));
    return g;
  }
  const gs = parts.map((p) => tag(p, kind));
  const out = mergeGeometries(gs, false);
  if (!out) throw new Error('Could not merge procedural vehicle geometry');
  for (const g of gs) g.dispose();
  return out;
}

function mergeShell(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const gs = parts.map((source) => source.index ? source.toNonIndexed() : source);
  const out = gs.length === 1 ? gs[0] : mergeGeometries(gs, false);
  if (!out) throw new Error('Could not merge procedural vehicle shell');
  if (gs.length > 1) for (const g of gs) g.dispose();
  return out;
}

function triCount(g: THREE.BufferGeometry): number {
  return (g.index?.count ?? g.getAttribute('position').count) / 3;
}

const TILE_COLS = 4, TILE_ROWS = 3;
const DECAL_TILE: Record<string, number> = {
  sheriff: 0, ambulance: 1, slop: 2, peace: 3,
  plate: 4, grille: 5, stroad: 6, propane: 7,
  fire: 8, tow: 9, bus: 10, stripe: 11,
};

let atlas: THREE.Texture | undefined;

/** One generated atlas for seams, grilles, plates, liveries, and bumper jokes. */
export function vehicleDecalAtlas(): THREE.Texture {
  if (atlas) return atlas;
  if (typeof document === 'undefined') {
    const data = new Uint8Array([255, 255, 255, 255]);
    atlas = new THREE.DataTexture(data, 1, 1);
    atlas.needsUpdate = true;
    return atlas;
  }
  const canvas = document.createElement('canvas');
  canvas.width = 1024; canvas.height = 768;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const labels = [
    ['SHERIFF', '#ddd7c9', '#17191b'], ['AMBULANCE', '#f4f1e8', '#b21f2d'], ['SLOP', '#111315', '#c6f432'], ['☮', '#e9dfbd', '#e16b5a'],
    ['69-SLOP', '#f1eee2', '#17202a'], ['▦▦▦▦', '#17191b', '#aeb4b8'], ['MY OTHER CAR IS A STROAD', '#eee9dd', '#17191b'], ['I ♥ PROPANE', '#eee9dd', '#b22d26'],
    ['ENGINE 69', '#b31e27', '#f1c95d'], ['SLOP TOW', '#efbd35', '#17191b'], ['FREE LOVE / $8 GAS', '#36a99b', '#f6e9c6'], ['///', '#f3efe7', '#bd2530'],
  ];
  labels.forEach(([text, bg, fg], i) => {
    const x = (i % TILE_COLS) * 256, y = Math.floor(i / TILE_COLS) * 256;
    ctx.fillStyle = bg; ctx.fillRect(x + 8, y + 42, 240, 172);
    ctx.strokeStyle = fg; ctx.lineWidth = 8; ctx.strokeRect(x + 12, y + 46, 232, 164);
    ctx.fillStyle = fg;
    ctx.font = `${text.length > 16 ? 25 : text.length > 9 ? 36 : 62}px Arial Black, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const words = text.split(' ');
    if (text.length > 16) {
      const split = Math.ceil(words.length / 2);
      ctx.fillText(words.slice(0, split).join(' '), x + 128, y + 105);
      ctx.fillText(words.slice(split).join(' '), x + 128, y + 158);
    } else ctx.fillText(text, x + 128, y + 130);
  });
  atlas = new THREE.CanvasTexture(canvas);
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.minFilter = THREE.LinearMipmapLinearFilter;
  atlas.magFilter = THREE.LinearFilter;
  atlas.generateMipmaps = true;
  return atlas;
}

function tileUv(name: keyof typeof DECAL_TILE): number[] {
  const tile = DECAL_TILE[name];
  const col = tile % TILE_COLS, row = Math.floor(tile / TILE_COLS);
  const u0 = (col + 0.04) / TILE_COLS, u1 = (col + 0.96) / TILE_COLS;
  const v0 = 1 - (row + 0.84) / TILE_ROWS, v1 = 1 - (row + 0.16) / TILE_ROWS;
  return [u0, v0, u1, v0, u1, v1, u0, v1];
}

function sideDecal(x: number, y0: number, y1: number, z0: number, z1: number, name: keyof typeof DECAL_TILE): THREE.BufferGeometry {
  const uv = tileUv(name);
  return x < 0
    ? quad([x, y0, z1], [x, y0, z0], [x, y1, z0], [x, y1, z1], uv)
    : quad([x, y0, z0], [x, y0, z1], [x, y1, z1], [x, y1, z0], uv);
}

function endDecal(z: number, y0: number, y1: number, x0: number, x1: number, name: keyof typeof DECAL_TILE): THREE.BufferGeometry {
  const uv = tileUv(name);
  return z > 0
    ? quad([x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z], uv)
    : quad([x1, y0, z], [x0, y0, z], [x0, y1, z], [x1, y1, z], uv);
}

function addWheels(details: TaggedPart[], width: number, radius: number, tireWidth: number, axles: readonly number[]): void {
  for (let ai = 0; ai < axles.length; ai++) {
    const z = axles[ai];
    const wheelCode = ai === axles.length - 1 ? 1 : 2;
    for (const x of [-width * 0.49, width * 0.49]) {
      details.push({ geometry: cyl(radius, tireWidth, x, radius, z, Math.PI / 2, 12), color: 0x111315, zone: 0, wheel: wheelCode, wheelX: x, wheelY: radius, wheelZ: z });
      details.push({ geometry: cyl(radius * 0.56, tireWidth + 0.018, x, radius, z, Math.PI / 2, 10), color: 0x9ba2a7, zone: 2, wheel: wheelCode, wheelX: x, wheelY: radius, wheelZ: z });
      const arch = transformed(new THREE.TorusGeometry(radius * 1.08, 0.035, 4, 12), x + Math.sign(x) * tireWidth * 0.55, radius * 1.04, z, 0, Math.PI / 2, 0);
      details.push({ geometry: arch, color: 0x202326, zone: 0 });
    }
  }
}

function addLights(lights: TaggedPart[], width: number, length: number, y: number): void {
  for (const x of [-width * 0.29, width * 0.29]) {
    lights.push({ geometry: box(width * 0.18, 0.13, 0.045, x, y, length * 0.485), color: 0xffe4b0, signal: 1 });
    lights.push({ geometry: box(width * 0.16, 0.14, 0.045, x, y, -length * 0.485), color: 0xff170a, signal: 2 });
  }
  const z0 = length * 0.48, z1 = z0 + Math.min(8, length * 1.5);
  const pool = quad([-width * 0.44, 0.025, z0], [width * 0.44, 0.025, z0], [width * 1.08, 0.025, z1], [-width * 1.08, 0.025, z1]);
  lights.push({ geometry: pool, color: 0xffe9bd, signal: 5, fade: [1, 1, 0, 1, 0, 0] });
}

function addBumpers(details: TaggedPart[], width: number, length: number, y: number, chrome = false): void {
  const color = chrome ? 0xaeb5ba : 0x202326, zone = chrome ? 2 : 0;
  details.push({ geometry: box(width * 0.92, 0.14, 0.14, 0, y, length * 0.49), color, zone });
  details.push({ geometry: box(width * 0.92, 0.14, 0.14, 0, y, -length * 0.49), color, zone });
}

function addMirrors(details: TaggedPart[], width: number, y: number, z: number): void {
  for (const x of [-width * 0.56, width * 0.56]) {
    details.push({ geometry: box(0.18, 0.1, 0.25, x, y, z, 0, 0, Math.sign(x) * 0.08), color: 0x222529, zone: 0 });
    details.push({ geometry: box(0.13, 0.065, 0.02, x, y + 0.01, z + 0.13), color: 0x738793, zone: 1 });
  }
}

function addCarGlass(details: TaggedPart[], width: number, baseY: number, topY: number, rearZ: number, frontZ: number): void {
  const x = width * 0.405;
  const rake = (frontZ - rearZ) * 0.19;
  for (const side of [-1, 1]) {
    const xx = x * side;
    details.push({ geometry: sideDecal(xx, baseY, topY - 0.08, rearZ + 0.13, frontZ - 0.13, 'grille'), color: 0x20313b, zone: 1 });
    // black B pillar gives the long dark pane readable window structure
    details.push({ geometry: box(0.025, topY - baseY, 0.085, xx + side * 0.012, (baseY + topY) * 0.5, (rearZ + frontZ) * 0.5), color: 0x141719, zone: 0 });
  }
  const glassH = Math.hypot(topY - baseY, rake);
  const glassY = (baseY + topY) * 0.5;
  const glassAngle = Math.atan2(rake, topY - baseY);
  details.push({ geometry: box(width * 0.64, glassH * 0.86, 0.035, 0, glassY, frontZ - rake * 0.5 + 0.045, -glassAngle), color: 0x263d49, zone: 1 });
  details.push({ geometry: box(width * 0.61, glassH * 0.84, 0.035, 0, glassY, rearZ + rake * 0.5 - 0.045, glassAngle), color: 0x263d49, zone: 1 });
}

function addEmergencyBar(details: TaggedPart[], lights: TaggedPart[], width: number, y: number, z: number): void {
  details.push({ geometry: box(width * 0.66, 0.055, 0.23, 0, y - 0.05, z), color: 0x202326, zone: 0 });
  lights.push({ geometry: box(width * 0.29, 0.12, 0.2, -width * 0.17, y, z), color: 0xff1021, signal: 3 });
  lights.push({ geometry: box(width * 0.29, 0.12, 0.2, width * 0.17, y, z), color: 0x176dff, signal: 4 });
}

function baseCar(kind: VehicleKind, s: VehicleDimensions, shell: THREE.BufferGeometry[], details: TaggedPart[], lights: TaggedPart[]): number {
  const tall = kind === 'suv' || kind === 'minivan' || kind === 'vwBus';
  const r = tall ? 0.41 : 0.35;
  const lower = r * 0.68;
  shell.push(loft([
    { z: -s.length * 0.48, bottom: lower, top: r + 0.43, half: s.width * 0.44, roof: s.width * 0.38 },
    { z: -s.length * 0.38, bottom: lower, top: r + 0.56, half: s.width * 0.48, roof: s.width * 0.42 },
    { z: s.length * 0.22, bottom: lower, top: r + 0.54, half: s.width * 0.48, roof: s.width * 0.42 },
    { z: s.length * 0.47, bottom: lower, top: r + 0.34, half: s.width * 0.43, roof: s.width * 0.36 },
  ]));
  const cabRear = kind === 'hatchback' ? -s.length * 0.33 : kind === 'minivan' ? -s.length * 0.38 : -s.length * 0.27;
  const cabFront = kind === 'minivan' ? s.length * 0.34 : s.length * 0.27;
  const shoulder = r + 0.48, roof = s.height - 0.08;
  shell.push(loft([
    { z: cabRear, bottom: shoulder, top: shoulder + 0.08, half: s.width * 0.39, roof: s.width * 0.34 },
    { z: cabRear + s.length * 0.09, bottom: shoulder, top: roof, half: s.width * 0.4, roof: s.width * 0.33 },
    { z: cabFront - s.length * 0.1, bottom: shoulder, top: roof, half: s.width * 0.4, roof: s.width * 0.33 },
    { z: cabFront, bottom: shoulder, top: shoulder + 0.09, half: s.width * 0.39, roof: s.width * 0.32 },
  ]));
  addCarGlass(details, s.width, shoulder + 0.06, roof - 0.07, cabRear + s.length * 0.06, cabFront - s.length * 0.06);
  addWheels(details, s.width, r, tall ? 0.31 : 0.27, [-s.length * 0.31, s.length * 0.31]);
  addBumpers(details, s.width, s.length, lower + 0.05, kind === 'sedan' || kind === 'police');
  addMirrors(details, s.width, shoulder + 0.37, cabFront - s.length * 0.1);
  addLights(lights, s.width, s.length, r + 0.27);
  for (const side of [-1, 1]) {
    const x = side * s.width * 0.486;
    details.push({ geometry: sideDecal(x, r + 0.15, r + 0.58, -s.length * 0.18, s.length * 0.2, 'stripe'), color: 0xffffff, zone: 4 });
  }
  details.push({ geometry: endDecal(-s.length * 0.492, r + 0.12, r + 0.28, -0.36, 0.36, 'plate'), color: 0xffffff, zone: 4 });
  details.push({ geometry: endDecal(s.length * 0.492, r + 0.16, r + 0.36, -s.width * 0.3, s.width * 0.3, 'grille'), color: 0xffffff, zone: 4 });
  return r;
}

function addPickup(kind: VehicleKind, s: VehicleDimensions, shell: THREE.BufferGeometry[], details: TaggedPart[], lights: TaggedPart[], lifted: boolean): number {
  const r = lifted ? 0.64 : 0.44, lower = r * 0.68;
  shell.push(loft([
    { z: -s.length * 0.48, bottom: lower, top: r + 0.52, half: s.width * 0.46, roof: s.width * 0.4 },
    { z: s.length * 0.2, bottom: lower, top: r + 0.55, half: s.width * 0.48, roof: s.width * 0.42 },
    { z: s.length * 0.47, bottom: lower, top: r + 0.35, half: s.width * 0.43, roof: s.width * 0.37 },
  ]));
  const shoulder = r + 0.48, top = Math.min(s.height - 0.12, shoulder + (lifted ? 0.82 : 0.72));
  shell.push(loft([
    { z: s.length * 0.02, bottom: shoulder, top: shoulder + 0.08, half: s.width * 0.4, roof: s.width * 0.34 },
    { z: s.length * 0.09, bottom: shoulder, top, half: s.width * 0.41, roof: s.width * 0.34 },
    { z: s.length * 0.32, bottom: shoulder, top, half: s.width * 0.41, roof: s.width * 0.34 },
    { z: s.length * 0.39, bottom: shoulder, top: shoulder + 0.08, half: s.width * 0.39, roof: s.width * 0.33 },
  ]));
  // Open bed with a ribbed dark floor and painted rails.
  details.push({ geometry: box(s.width * 0.76, 0.07, s.length * 0.38, 0, r + 0.55, -s.length * 0.27), color: 0x222629, zone: 0 });
  for (const x of [-s.width * 0.43, s.width * 0.43]) details.push({ geometry: box(0.09, 0.38, s.length * 0.39, x, r + 0.7, -s.length * 0.27), color: 0x394046, zone: 0 });
  addCarGlass(details, s.width, shoulder + 0.05, top - 0.07, s.length * 0.07, s.length * 0.35);
  addWheels(details, s.width, r, lifted ? 0.42 : 0.32, [-s.length * 0.32, s.length * 0.31]);
  addBumpers(details, s.width, s.length, lower + 0.07, true);
  addMirrors(details, s.width, shoulder + 0.35, s.length * 0.3);
  addLights(lights, s.width, s.length, r + 0.27);
  if (lifted) {
    details.push({ geometry: cyl(0.035, 2.0, s.width * 0.32, r + 1.35, -s.length * 0.35), color: 0xadb4b9, zone: 2 });
    details.push({ geometry: quad([s.width * 0.34, r + 2.3, -s.length * 0.35], [s.width * 0.34, r + 1.72, -s.length * 0.35], [-0.25, r + 1.72, -s.length * 0.35], [-0.25, r + 2.3, -s.length * 0.35]), color: 0x9f222b, zone: 3 });
    details.push({ geometry: sideDecal(-s.width * 0.491, r + 0.42, r + 0.7, -1.2, 0.2, 'propane'), color: 0xffffff, zone: 4 });
  }
  return r;
}

function addCyber(s: VehicleDimensions, shell: THREE.BufferGeometry[], details: TaggedPart[], lights: TaggedPart[]): number {
  const r = 0.43;
  shell.push(loft([
    { z: -s.length * 0.49, bottom: 0.28, top: 0.75, half: s.width * 0.45, roof: s.width * 0.38 },
    { z: -s.length * 0.27, bottom: 0.28, top: s.height - 0.08, half: s.width * 0.47, roof: s.width * 0.3 },
    { z: s.length * 0.12, bottom: 0.28, top: s.height - 0.32, half: s.width * 0.45, roof: s.width * 0.32 },
    { z: s.length * 0.49, bottom: 0.28, top: 0.62, half: s.width * 0.41, roof: s.width * 0.35 },
  ]));
  details.push({ geometry: quad([-s.width * 0.3, 0.84, s.length * 0.12], [s.width * 0.3, 0.84, s.length * 0.12], [s.width * 0.25, s.height - 0.35, -s.length * 0.22], [-s.width * 0.25, s.height - 0.35, -s.length * 0.22]), color: 0x24343d, zone: 1 });
  addWheels(details, s.width, r, 0.32, [-s.length * 0.31, s.length * 0.31]);
  addBumpers(details, s.width, s.length, 0.48, true);
  addLights(lights, s.width, s.length, 0.68);
  details.push({ geometry: sideDecal(s.width * 0.471, 0.65, 0.92, -1.2, 1.0, 'stroad'), color: 0xffffff, zone: 4 });
  return r;
}

function addBoxVehicle(kind: VehicleKind, s: VehicleDimensions, shell: THREE.BufferGeometry[], details: TaggedPart[], lights: TaggedPart[]): number {
  const r = kind === 'semi' ? 0.54 : 0.47;
  const cabFront = s.length * 0.46;
  const cabRear = kind === 'semi' ? s.length * 0.17 : s.length * 0.13;
  shell.push(loft([
    { z: cabRear, bottom: r * 0.65, top: r + 0.58, half: s.width * 0.43, roof: s.width * 0.37 },
    { z: cabRear + 0.25, bottom: r * 0.65, top: kind === 'semi' ? 3.05 : 2.2, half: s.width * 0.45, roof: s.width * 0.37 },
    { z: cabFront - 0.32, bottom: r * 0.65, top: kind === 'semi' ? 3.05 : 2.2, half: s.width * 0.45, roof: s.width * 0.37 },
    { z: cabFront, bottom: r * 0.65, top: r + 0.7, half: s.width * 0.42, roof: s.width * 0.35 },
  ]));
  const cargoL = kind === 'semi' ? s.length * 0.63 : s.length * 0.6;
  const cargoZ = -s.length * 0.19;
  details.push({ geometry: box(s.width * 0.94, s.height - 0.7, cargoL, 0, (s.height + 0.45) * 0.5, cargoZ), color: kind === 'ambulance' ? 0xe8e7df : 0xd7d9d8, zone: 3 });
  details.push({ geometry: quad([-s.width * 0.33, 1.45, cabFront + 0.01], [s.width * 0.33, 1.45, cabFront + 0.01], [s.width * 0.3, kind === 'semi' ? 2.68 : 2.02, cabFront - 0.24], [-s.width * 0.3, kind === 'semi' ? 2.68 : 2.02, cabFront - 0.24]), color: 0x263b47, zone: 1 });
  const axles = kind === 'semi' ? [-s.length * 0.38, -s.length * 0.31, s.length * 0.27, s.length * 0.39] : [-s.length * 0.3, s.length * 0.32];
  addWheels(details, s.width, r, kind === 'semi' ? 0.4 : 0.34, axles);
  addBumpers(details, s.width, s.length, r + 0.04, true);
  addLights(lights, s.width, s.length, r + 0.33);
  if (kind === 'ambulance') {
    for (const x of [-s.width * 0.476, s.width * 0.476]) details.push({ geometry: sideDecal(x, 1.25, 2.3, -2.4, 0.2, 'ambulance'), color: 0xffffff, zone: 4 });
    addEmergencyBar(details, lights, s.width, s.height + 0.08, cargoZ + cargoL * 0.22);
  } else {
    const name = kind === 'semi' ? 'stroad' : 'slop';
    details.push({ geometry: sideDecal(s.width * 0.476, 1.2, 2.35, cargoZ - cargoL * 0.32, cargoZ + cargoL * 0.32, name), color: 0xffffff, zone: 4 });
  }
  return r;
}

function addFiretruck(s: VehicleDimensions, shell: THREE.BufferGeometry[], details: TaggedPart[], lights: TaggedPart[]): number {
  const r = 0.54;
  shell.push(loft([
    { z: -s.length * 0.47, bottom: 0.35, top: 1.45, half: s.width * 0.46, roof: s.width * 0.4 },
    { z: s.length * 0.2, bottom: 0.35, top: 1.55, half: s.width * 0.48, roof: s.width * 0.42 },
    { z: s.length * 0.46, bottom: 0.35, top: 1.1, half: s.width * 0.44, roof: s.width * 0.38 },
  ]));
  shell.push(loft([
    { z: s.length * 0.15, bottom: 1.35, top: 1.45, half: s.width * 0.43, roof: s.width * 0.37 },
    { z: s.length * 0.2, bottom: 1.35, top: 2.75, half: s.width * 0.44, roof: s.width * 0.36 },
    { z: s.length * 0.42, bottom: 1.35, top: 2.72, half: s.width * 0.44, roof: s.width * 0.36 },
    { z: s.length * 0.46, bottom: 1.35, top: 1.5, half: s.width * 0.42, roof: s.width * 0.35 },
  ]));
  details.push({ geometry: box(s.width * 0.82, 0.92, s.length * 0.47, 0, 1.95, -s.length * 0.18), color: 0xd7d8d3, zone: 2 });
  details.push({ geometry: quad([-s.width * 0.33, 1.72, s.length * 0.462], [s.width * 0.33, 1.72, s.length * 0.462], [s.width * 0.31, 2.54, s.length * 0.41], [-s.width * 0.31, 2.54, s.length * 0.41]), color: 0x263b47, zone: 1 });
  // Ladder rails and rungs, recognizable even from medium zoom.
  for (const x of [-0.44, 0.44]) details.push({ geometry: box(0.09, 0.09, s.length * 0.59, x, 2.91, -0.25, 0.02), color: 0xbcc2c5, zone: 2 });
  for (let z = -2.9; z < 2.3; z += 0.55) details.push({ geometry: box(0.96, 0.07, 0.08, 0, 2.94, z), color: 0xbcc2c5, zone: 2 });
  addWheels(details, s.width, r, 0.38, [-s.length * 0.31, s.length * 0.31]);
  addBumpers(details, s.width, s.length, r + 0.06, true);
  addLights(lights, s.width, s.length, r + 0.35);
  addEmergencyBar(details, lights, s.width, 2.93, s.length * 0.31);
  for (const x of [-s.width * 0.487, s.width * 0.487]) details.push({ geometry: sideDecal(x, 1.0, 1.65, -1.7, 1.4, 'fire'), color: 0xffffff, zone: 4 });
  return r;
}

function addGolfCart(s: VehicleDimensions, shell: THREE.BufferGeometry[], details: TaggedPart[], lights: TaggedPart[]): number {
  const r = 0.27;
  shell.push(loft([
    { z: -s.length * 0.42, bottom: 0.25, top: 0.64, half: s.width * 0.4, roof: s.width * 0.34 },
    { z: s.length * 0.42, bottom: 0.25, top: 0.62, half: s.width * 0.43, roof: s.width * 0.36 },
  ]));
  details.push({ geometry: box(s.width * 0.9, 0.1, s.length * 0.78, 0, s.height, 0), color: 0xe9e2c9, zone: 3 });
  details.push({ geometry: box(s.width * 0.68, 0.42, 0.25, 0, 0.88, -0.24), color: 0xe2d5b7, zone: 3 });
  for (const x of [-s.width * 0.38, s.width * 0.38]) for (const z of [-s.length * 0.31, s.length * 0.31]) details.push({ geometry: box(0.045, 1.16, 0.045, x, 1.2, z), color: 0x34383a, zone: 0 });
  addWheels(details, s.width, r, 0.19, [-s.length * 0.3, s.length * 0.3]);
  addLights(lights, s.width, s.length, 0.56);
  details.push({ geometry: sideDecal(s.width * 0.446, 0.38, 0.6, -0.85, 0.15, 'propane'), color: 0xffffff, zone: 4 });
  return r;
}

function addVanSpecial(kind: 'vwBus' | 'slopVan', s: VehicleDimensions, shell: THREE.BufferGeometry[], details: TaggedPart[], lights: TaggedPart[]): number {
  const r = kind === 'vwBus' ? 0.35 : 0.43;
  shell.push(loft([
    { z: -s.length * 0.47, bottom: r * 0.66, top: s.height - 0.12, half: s.width * 0.45, roof: s.width * 0.37 },
    { z: s.length * 0.31, bottom: r * 0.66, top: s.height - 0.08, half: s.width * 0.47, roof: s.width * 0.39 },
    { z: s.length * 0.47, bottom: r * 0.66, top: r + 0.85, half: s.width * 0.43, roof: s.width * 0.35 },
  ]));
  details.push({ geometry: quad([-s.width * 0.32, 1.14, s.length * 0.472], [s.width * 0.32, 1.14, s.length * 0.472], [s.width * 0.3, s.height - 0.25, s.length * 0.33], [-s.width * 0.3, s.height - 0.25, s.length * 0.33]), color: 0x263b47, zone: 1 });
  for (const side of [-1, 1]) {
    const x = side * s.width * 0.476;
    for (let z = -s.length * 0.3; z <= s.length * 0.18; z += s.length * 0.2) details.push({ geometry: sideDecal(x, 1.2, s.height - 0.22, z - 0.32, z + 0.32, 'grille'), color: 0x263b47, zone: 1 });
    details.push({ geometry: sideDecal(x + side * 0.006, 0.72, 1.48, -s.length * 0.28, s.length * 0.12, kind === 'vwBus' ? 'bus' : 'slop'), color: 0xffffff, zone: 4 });
  }
  if (kind === 'vwBus') {
    details.push({ geometry: endDecal(s.length * 0.478, 0.72, 1.12, -0.38, 0.38, 'peace'), color: 0xffffff, zone: 4 });
    details.push({ geometry: box(s.width * 0.94, 0.12, s.length * 0.89, 0, 1.04, 0), color: 0xe5dbc1, zone: 3 });
  }
  addWheels(details, s.width, r, 0.27, [-s.length * 0.3, s.length * 0.3]);
  addBumpers(details, s.width, s.length, r + 0.06, true);
  addLights(lights, s.width, s.length, r + 0.32);
  return r;
}

function addMotorcycle(s: VehicleDimensions, shell: THREE.BufferGeometry[], details: TaggedPart[], lights: TaggedPart[]): number {
  const r = 0.36;
  shell.push(sphere(0.3, 0, 0.62, 0.14, 0.68, 0.68, 1.55));
  addWheels(details, s.width, r, 0.12, [-s.length * 0.38, s.length * 0.38]);
  details.push({ geometry: box(0.36, 0.13, 0.72, 0, 0.82, -0.15), color: 0x16191b, zone: 0 });
  details.push({ geometry: box(0.055, 0.86, 0.055, 0, 0.79, 0.66, -0.35), color: 0xa9b0b4, zone: 2 });
  details.push({ geometry: box(0.7, 0.055, 0.055, 0, 1.11, 0.69), color: 0xa9b0b4, zone: 2 });
  // Low-poly rider: boots, legs, jacket, arms, and helmet.
  details.push({ geometry: sphere(0.23, 0, 1.46, -0.03, 0.85, 1.05, 0.9), color: 0x25292d, zone: 0 });
  details.push({ geometry: sphere(0.16, 0, 1.79, 0.08, 1, 1, 1), color: 0xd04a34, zone: 3 });
  for (const x of [-0.16, 0.16]) {
    details.push({ geometry: box(0.1, 0.58, 0.1, x, 1.19, 0.16, -0.45), color: 0x20252a, zone: 0 });
    details.push({ geometry: box(0.09, 0.5, 0.09, x, 1.43, 0.38, -0.75), color: 0x25292d, zone: 0 });
  }
  lights.push({ geometry: cyl(0.14, 0.08, 0, 0.87, s.length * 0.48, Math.PI / 2, 10), color: 0xffe4ad, signal: 1 });
  lights.push({ geometry: box(0.18, 0.12, 0.045, 0, 0.68, -s.length * 0.48), color: 0xff160a, signal: 2 });
  return r;
}

function addTow(s: VehicleDimensions, shell: THREE.BufferGeometry[], details: TaggedPart[], lights: TaggedPart[]): number {
  const r = 0.49;
  shell.push(loft([
    { z: -s.length * 0.46, bottom: 0.32, top: 1.15, half: s.width * 0.45, roof: s.width * 0.39 },
    { z: s.length * 0.47, bottom: 0.32, top: 1.02, half: s.width * 0.43, roof: s.width * 0.36 },
  ]));
  shell.push(loft([
    { z: s.length * 0.12, bottom: 1.0, top: 1.1, half: s.width * 0.4, roof: s.width * 0.34 },
    { z: s.length * 0.17, bottom: 1.0, top: 2.42, half: s.width * 0.41, roof: s.width * 0.34 },
    { z: s.length * 0.4, bottom: 1.0, top: 2.38, half: s.width * 0.41, roof: s.width * 0.34 },
    { z: s.length * 0.45, bottom: 1.0, top: 1.08, half: s.width * 0.39, roof: s.width * 0.33 },
  ]));
  details.push({ geometry: quad([-s.width * 0.32, 1.42, s.length * 0.452], [s.width * 0.32, 1.42, s.length * 0.452], [s.width * 0.29, 2.18, s.length * 0.38], [-s.width * 0.29, 2.18, s.length * 0.38]), color: 0x263b47, zone: 1 });
  details.push({ geometry: box(s.width * 0.8, 0.12, s.length * 0.49, 0, 1.37, -s.length * 0.2, -0.08), color: 0x2a2e31, zone: 0 });
  details.push({ geometry: box(0.17, 0.17, s.length * 0.55, 0, 1.98, -s.length * 0.1, -0.43), color: 0xe2b52e, zone: 3 });
  details.push({ geometry: box(s.width * 0.68, 0.13, 0.13, 0, 1.63, -s.length * 0.42), color: 0xe2b52e, zone: 3 });
  details.push({ geometry: cyl(0.05, 0.75, 0, 1.27, -s.length * 0.45), color: 0xadb4b9, zone: 2 });
  addWheels(details, s.width, r, 0.35, [-s.length * 0.31, s.length * 0.31]);
  addBumpers(details, s.width, s.length, r + 0.06, true);
  addLights(lights, s.width, s.length, r + 0.33);
  addEmergencyBar(details, lights, s.width, 2.55, s.length * 0.25);
  details.push({ geometry: sideDecal(s.width * 0.476, 1.0, 1.45, -1.5, 0.3, 'tow'), color: 0xffffff, zone: 4 });
  return r;
}

function makeFar(kind: VehicleKind, s: VehicleDimensions, wheelRadius: number): VehicleLodGeometry {
  const shell = loft([
    { z: -s.length * 0.48, bottom: wheelRadius * 0.55, top: Math.min(s.height * 0.58, wheelRadius + 0.58), half: s.width * 0.45, roof: s.width * 0.38 },
    { z: s.length * 0.28, bottom: wheelRadius * 0.55, top: Math.min(s.height * 0.66, wheelRadius + 0.62), half: s.width * 0.47, roof: s.width * 0.4 },
    { z: s.length * 0.48, bottom: wheelRadius * 0.55, top: wheelRadius + 0.34, half: s.width * 0.42, roof: s.width * 0.35 },
  ]);
  const details: TaggedPart[] = [];
  const cabH = kind === 'semi' || kind === 'firetruck' ? s.height * 0.75 : s.height * 0.9;
  const cabL = kind === 'pickup' || kind === 'liftedTruck' || kind === 'towTruck' ? s.length * 0.34 : s.length * 0.55;
  details.push({ geometry: box(s.width * 0.7, Math.max(0.3, cabH * 0.33), cabL, 0, Math.min(s.height - 0.3, cabH * 0.75), s.length * 0.08), color: 0x263b47, zone: 1 });
  for (const z of [-s.length * 0.3, s.length * 0.3]) for (const x of [-s.width * 0.47, s.width * 0.47]) details.push({ geometry: cyl(wheelRadius, Math.min(0.25, s.width * 0.15), x, wheelRadius, z, Math.PI / 2, 6), color: 0x141719, zone: 0 });
  if (kind === 'semi' || kind === 'boxTruck' || kind === 'ambulance') details.push({ geometry: box(s.width * 0.91, s.height * 0.64, s.length * 0.57, 0, s.height * 0.53, -s.length * 0.18), color: kind === 'ambulance' ? 0xe7e5dd : 0xd4d7d7, zone: 3 });
  return { shell, detail: mergeTagged(details, 'detail') };
}

export function buildVehicleModel(kind: VehicleKind, s: VehicleDimensions): VehicleModelGeometry {
  const shell: THREE.BufferGeometry[] = [];
  const details: TaggedPart[] = [];
  const lights: TaggedPart[] = [];
  let wheelRadius: number;
  switch (kind) {
    case 'sedan': case 'hatchback': case 'suv': case 'minivan':
      wheelRadius = baseCar(kind, s, shell, details, lights); break;
    case 'police':
      wheelRadius = baseCar(kind, s, shell, details, lights);
      for (const x of [-s.width * 0.487, s.width * 0.487]) details.push({ geometry: sideDecal(x, 0.72, 1.12, -1.25, 1.05, 'sheriff'), color: 0xffffff, zone: 4 });
      addEmergencyBar(details, lights, s.width, s.height + 0.08, -0.12); break;
    case 'pickup': wheelRadius = addPickup(kind, s, shell, details, lights, false); break;
    case 'liftedTruck': wheelRadius = addPickup(kind, s, shell, details, lights, true); break;
    case 'cyberslop': wheelRadius = addCyber(s, shell, details, lights); break;
    case 'semi': case 'boxTruck': case 'ambulance': wheelRadius = addBoxVehicle(kind, s, shell, details, lights); break;
    case 'firetruck': wheelRadius = addFiretruck(s, shell, details, lights); break;
    case 'golfCart': wheelRadius = addGolfCart(s, shell, details, lights); break;
    case 'vwBus': case 'slopVan': wheelRadius = addVanSpecial(kind, s, shell, details, lights); break;
    case 'motorcycle': wheelRadius = addMotorcycle(s, shell, details, lights); break;
    case 'towTruck': wheelRadius = addTow(s, shell, details, lights); break;
  }
  const near: VehicleLodGeometry = {
    shell: mergeShell(shell),
    detail: mergeTagged(details, 'detail'),
    lights: mergeTagged(lights, 'light'),
  };
  const far = makeFar(kind, s, wheelRadius);
  return {
    near,
    far,
    wheelRadius,
    nearTriangles: triCount(near.shell) + triCount(near.detail) + triCount(near.lights!),
    farTriangles: triCount(far.shell) + triCount(far.detail),
  };
}
