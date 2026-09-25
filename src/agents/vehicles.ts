import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { VehicleKind } from '../contracts';

export interface VehicleSpec {
  length: number; // meters
  width: number;
  height: number;
  maxSpeed: number; // m/s
  label: string;
}

export const VEHICLE_SPECS: Record<VehicleKind, VehicleSpec> = {
  sedan: { length: 4.6, width: 1.8, height: 1.4, maxSpeed: 38, label: 'Sedan' },
  hatchback: { length: 4.0, width: 1.75, height: 1.45, maxSpeed: 36, label: 'Hatchback' },
  suv: { length: 4.9, width: 1.95, height: 1.8, maxSpeed: 36, label: 'SUV' },
  minivan: { length: 5.1, width: 1.95, height: 1.8, maxSpeed: 34, label: 'Minivan' },
  pickup: { length: 5.8, width: 2.0, height: 1.9, maxSpeed: 38, label: 'Pickup' },
  liftedTruck: { length: 6.0, width: 2.2, height: 2.6, maxSpeed: 40, label: 'Lifted Truck' },
  cyberslop: { length: 5.7, width: 2.1, height: 1.9, maxSpeed: 44, label: 'Cyberslop' },
  semi: { length: 16, width: 2.5, height: 4, maxSpeed: 30, label: 'Semi' },
  boxTruck: { length: 8, width: 2.4, height: 3.4, maxSpeed: 30, label: 'Box Truck' },
  police: { length: 5.0, width: 1.95, height: 1.5, maxSpeed: 45, label: 'Sheriff' },
  ambulance: { length: 6.5, width: 2.3, height: 2.8, maxSpeed: 40, label: 'Ambulance' },
  firetruck: { length: 10, width: 2.5, height: 3.2, maxSpeed: 34, label: 'Fire Truck' },
  golfCart: { length: 2.4, width: 1.2, height: 1.8, maxSpeed: 9, label: 'Golf Cart' },
  vwBus: { length: 4.5, width: 1.8, height: 2.0, maxSpeed: 26, label: 'Hippie Bus' },
  slopVan: { length: 5.4, width: 2.0, height: 2.4, maxSpeed: 32, label: 'SLOP Van' },
  motorcycle: { length: 2.2, width: 0.8, height: 1.3, maxSpeed: 48, label: 'Motorcycle' },
  towTruck: { length: 7, width: 2.4, height: 3, maxSpeed: 32, label: 'Tow Truck' },
};

const KINDS = Object.keys(VEHICLE_SPECS) as VehicleKind[];

/** Traffic mix for normal civilian trips. */
export function randomVehicleKind(rnd: () => number): VehicleKind {
  const r = rnd();
  if (r < 0.28) return 'pickup';
  if (r < 0.46) return 'sedan';
  if (r < 0.62) return 'suv';
  if (r < 0.7) return 'liftedTruck';
  if (r < 0.78) return 'minivan';
  if (r < 0.84) return 'hatchback';
  if (r < 0.88) return 'cyberslop';
  if (r < 0.92) return 'boxTruck';
  if (r < 0.95) return 'semi';
  if (r < 0.97) return 'motorcycle';
  return 'slopVan';
}

type PartStyle =
  | 'body' | 'dark' | 'glass' | 'chrome' | 'cream' | 'lime' | 'red' | 'yellow' | 'teal' | 'slopLogo'
  | 'headlight' | 'brake' | 'redBeacon' | 'blueBeacon';
type ModelParts = Partial<Record<PartStyle, THREE.BufferGeometry[]>>;

interface KindBatch {
  meshes: THREE.InstancedMesh[];
  body: THREE.InstancedMesh;
  pickMesh: THREE.InstancedMesh;
  headlight?: THREE.InstancedMesh;
  brake?: THREE.InstancedMesh;
  redBeacon?: THREE.InstancedMesh;
  blueBeacon?: THREE.InstancedMesh;
  free: number[];
  used: number;
  handleByInstance: Int32Array;
  braking: Uint8Array;
  emergency: boolean;
}

interface Slot { kind: VehicleKind; instance: number }

const MATERIALS: Record<PartStyle, THREE.Material> = {
  body: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.46, metalness: 0.22 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x17191b, roughness: 0.72, metalness: 0.08 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x8aa9b7, roughness: 0.18, metalness: 0.38 }),
  chrome: new THREE.MeshStandardMaterial({ color: 0xb9bec0, roughness: 0.24, metalness: 0.82 }),
  cream: new THREE.MeshStandardMaterial({ color: 0xefe6cf, roughness: 0.58, metalness: 0.05 }),
  lime: new THREE.MeshStandardMaterial({ color: 0xc6f432, roughness: 0.5, metalness: 0.05 }),
  red: new THREE.MeshStandardMaterial({ color: 0xb3202a, roughness: 0.55, metalness: 0.05 }),
  yellow: new THREE.MeshStandardMaterial({ color: 0xf1c743, roughness: 0.55, metalness: 0.05 }),
  teal: new THREE.MeshStandardMaterial({ color: 0x35b9a6, roughness: 0.55, metalness: 0.05 }),
  slopLogo: makeSlopLogoMaterial(),
  headlight: new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
  brake: new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
  redBeacon: new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
  blueBeacon: new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
};
const LIGHT_STYLES = new Set<PartStyle>(['headlight', 'brake', 'redBeacon', 'blueBeacon']);
const PICK_MATERIAL = new THREE.MeshBasicMaterial();

function makeSlopLogoMaterial(): THREE.MeshStandardMaterial {
  if (typeof document === 'undefined') {
    return new THREE.MeshStandardMaterial({ color: 0xefe6cf, roughness: 0.6, side: THREE.DoubleSide });
  }
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 192;
  const ctx = canvas.getContext('2d')!;
  const draw = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#111111';
    ctx.beginPath();
    ctx.roundRect(4, 4, 504, 184, 30);
    ctx.fill();
    ctx.fillStyle = '#efe6cf';
    ctx.font = '112px Yellowtail, cursive';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Slop', 246, 87);
    ctx.strokeStyle = '#c6f432';
    ctx.lineWidth = 13;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(96, 146);
    ctx.bezierCurveTo(196, 168, 350, 161, 448, 124);
    ctx.stroke();
  };
  draw();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  void document.fonts?.load('112px Yellowtail').then(() => {
    draw();
    texture.needsUpdate = true;
  }).catch(() => { /* The cursive fallback remains readable offline. */ });
  return new THREE.MeshStandardMaterial({
    map: texture,
    transparent: true,
    alphaTest: 0.08,
    roughness: 0.58,
    metalness: 0.02,
    side: THREE.DoubleSide,
  });
}

function put(parts: ModelParts, style: PartStyle, geometry: THREE.BufferGeometry): void {
  (parts[style] ??= []).push(geometry);
}

function box(w: number, h: number, l: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, l);
  g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
  g.translate(x, y, z);
  return g;
}

function cylinder(r: number, depth: number, x: number, y: number, z: number, rz = 0, segments = 10): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, depth, segments, 1, false);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  return g;
}

function addWheels(p: ModelParts, width: number, axles: readonly number[], radius: number, tireWidth: number): void {
  for (const z of axles) {
    for (const x of [-width / 2 + tireWidth * 0.12, width / 2 - tireWidth * 0.12]) {
      put(p, 'dark', cylinder(radius, tireWidth, x, radius, z, Math.PI / 2));
      put(p, 'chrome', cylinder(radius * 0.42, tireWidth + 0.012, x, radius, z, Math.PI / 2, 8));
    }
  }
}

function addBumpers(p: ModelParts, width: number, length: number, y: number, chrome = false): void {
  const style: PartStyle = chrome ? 'chrome' : 'dark';
  put(p, style, box(width * 0.96, 0.14, 0.18, 0, y, length / 2 - 0.06));
  put(p, style, box(width * 0.96, 0.14, 0.18, 0, y, -length / 2 + 0.06));
}

function addLights(p: ModelParts, width: number, length: number, y: number): void {
  for (const x of [-width * 0.31, width * 0.31]) {
    put(p, 'headlight', box(width * 0.18, 0.14, 0.055, x, y, length / 2 + 0.008));
    put(p, 'brake', box(width * 0.17, 0.14, 0.055, x, y, -length / 2 - 0.008));
  }
}

function addCarWindows(p: ModelParts, width: number, cabinLength: number, y: number, z: number): void {
  put(p, 'glass', box(width * 0.77, 0.48, 0.045, 0, y, z + cabinLength * 0.46, -0.14));
  put(p, 'glass', box(width * 0.77, 0.43, 0.045, 0, y - 0.02, z - cabinLength * 0.46, 0.1));
  for (const x of [-width * 0.405, width * 0.405]) put(p, 'glass', box(0.035, 0.38, cabinLength * 0.72, x, y - 0.02, z));
}

function addLightbar(p: ModelParts, width: number, y: number, z: number): void {
  put(p, 'dark', box(width * 0.62, 0.055, 0.22, 0, y - 0.055, z));
  put(p, 'redBeacon', box(width * 0.27, 0.11, 0.18, -width * 0.16, y, z));
  put(p, 'blueBeacon', box(width * 0.27, 0.11, 0.18, width * 0.16, y, z));
}

function basicCar(kind: 'sedan' | 'hatchback' | 'suv' | 'minivan' | 'police'): ModelParts {
  const s = VEHICLE_SPECS[kind];
  const p: ModelParts = {};
  const wheelR = kind === 'suv' || kind === 'minivan' ? 0.39 : 0.35;
  const bodyY = wheelR + 0.27;
  const bodyH = kind === 'suv' ? 0.63 : kind === 'minivan' ? 0.7 : 0.52;
  const cabinH = Math.max(0.52, s.height - (bodyY + bodyH * 0.4));
  const cabinLength = kind === 'hatchback' ? s.length * 0.58 : kind === 'minivan' ? s.length * 0.68 : s.length * 0.52;
  const cabinZ = kind === 'hatchback' ? -s.length * 0.05 : kind === 'minivan' ? -s.length * 0.03 : -s.length * 0.05;
  put(p, 'body', box(s.width * 0.94, bodyH, s.length * 0.9, 0, bodyY, 0));
  put(p, 'body', box(s.width * 0.81, cabinH, cabinLength, 0, bodyY + bodyH * 0.48 + cabinH * 0.48, cabinZ));
  addCarWindows(p, s.width, cabinLength, bodyY + bodyH * 0.5 + cabinH * 0.55, cabinZ);
  addWheels(p, s.width, [-s.length * 0.31, s.length * 0.31], wheelR, 0.28);
  addBumpers(p, s.width, s.length * 0.92, bodyY - 0.06, kind === 'sedan');
  addLights(p, s.width, s.length * 0.91, bodyY + 0.08);
  return p;
}

function pickup(lifted: boolean): ModelParts {
  const s = VEHICLE_SPECS[lifted ? 'liftedTruck' : 'pickup'];
  const p: ModelParts = {};
  const wheelR = lifted ? 0.62 : 0.43;
  const bodyY = wheelR + (lifted ? 0.35 : 0.25);
  put(p, 'body', box(s.width * 0.94, 0.58, s.length * 0.91, 0, bodyY, 0));
  put(p, 'body', box(s.width * 0.84, lifted ? 0.88 : 0.72, s.length * 0.4, 0, bodyY + 0.62, s.length * 0.18));
  for (const x of [-s.width * 0.42, s.width * 0.42]) put(p, 'body', box(0.1, 0.45, s.length * 0.38, x, bodyY + 0.4, -s.length * 0.25));
  put(p, 'body', box(s.width * 0.84, 0.45, 0.1, 0, bodyY + 0.4, -s.length * 0.44));
  addCarWindows(p, s.width, s.length * 0.37, bodyY + (lifted ? 0.93 : 0.79), s.length * 0.18);
  addWheels(p, s.width, [-s.length * 0.31, s.length * 0.29], wheelR, lifted ? 0.4 : 0.32);
  addBumpers(p, s.width, s.length * 0.94, bodyY - 0.05, true);
  addLights(p, s.width, s.length * 0.93, bodyY + 0.08);
  if (lifted) {
    put(p, 'chrome', cylinder(0.035, 2.15, s.width * 0.29, bodyY + 1.28, -s.length * 0.34));
    put(p, 'red', box(0.72, 0.5, 0.035, -0.02, bodyY + 2.08, -s.length * 0.34));
    put(p, 'cream', box(0.72, 0.07, 0.04, -0.02, bodyY + 2.08, -s.length * 0.365));
    put(p, 'teal', box(0.27, 0.22, 0.045, -0.245, bodyY + 2.21, -s.length * 0.37));
  }
  return p;
}

function cyberslop(): ModelParts {
  const s = VEHICLE_SPECS.cyberslop;
  const p: ModelParts = {};
  const profile: Array<[number, number]> = [[0.42, -s.length * 0.47], [1.62, -s.length * 0.29], [1.26, s.length * 0.43], [0.42, s.length * 0.48]];
  const positions: number[] = [];
  const halfW = s.width * 0.46;
  for (let i = 1; i < profile.length - 1; i++) for (const x of [-halfW, halfW]) {
    positions.push(x, profile[0][0], profile[0][1], x, profile[i][0], profile[i][1], x, profile[i + 1][0], profile[i + 1][1]);
  }
  for (let i = 0; i < profile.length; i++) {
    const j = (i + 1) % profile.length;
    positions.push(-halfW, profile[i][0], profile[i][1], halfW, profile[i][0], profile[i][1], halfW, profile[j][0], profile[j][1], -halfW, profile[i][0], profile[i][1], halfW, profile[j][0], profile[j][1], -halfW, profile[j][0], profile[j][1]);
  }
  const wedge = new THREE.BufferGeometry();
  wedge.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  wedge.computeVertexNormals();
  put(p, 'body', wedge);
  put(p, 'glass', box(s.width * 0.78, 0.52, 0.04, 0, 1.3, s.length * 0.18, -0.48));
  addWheels(p, s.width, [-s.length * 0.31, s.length * 0.31], 0.43, 0.31);
  addBumpers(p, s.width, s.length * 0.98, 0.48, true);
  addLights(p, s.width, s.length * 0.965, 0.68);
  return p;
}

function semi(): ModelParts {
  const s = VEHICLE_SPECS.semi;
  const p: ModelParts = {};
  put(p, 'cream', box(s.width * 0.96, 3.25, 10.3, 0, 2.05, -2.68));
  put(p, 'body', box(s.width * 0.94, 1.4, 4.45, 0, 1.14, 5.45));
  put(p, 'body', box(s.width * 0.9, 2.72, 2.25, 0, 2.05, 4.62));
  put(p, 'glass', box(s.width * 0.7, 0.62, 0.05, 0, 2.66, 5.77, -0.12));
  for (const x of [-s.width * 0.43, s.width * 0.43]) put(p, 'glass', box(0.035, 0.58, 1.0, x, 2.61, 4.72));
  addWheels(p, s.width, [-6.15, -5.1, 3.92, 5.66], 0.52, 0.38);
  addBumpers(p, s.width, s.length * 0.98, 0.65, true);
  addLights(p, s.width, s.length * 0.98, 0.88);
  return p;
}

function makeBoxTruck(kind: 'boxTruck' | 'ambulance'): ModelParts {
  const s = VEHICLE_SPECS[kind];
  const p: ModelParts = {};
  const emergency = kind === 'ambulance';
  put(p, emergency ? 'cream' : 'body', box(s.width * 0.96, s.height - 0.62, s.length * 0.62, 0, (s.height + 0.38) / 2, -s.length * 0.16));
  put(p, 'body', box(s.width * 0.9, 0.82, s.length * 0.34, 0, 0.86, s.length * 0.3));
  put(p, 'body', box(s.width * 0.86, 1.48, s.length * 0.22, 0, 1.62, s.length * 0.23));
  put(p, 'glass', box(s.width * 0.67, 0.47, 0.045, 0, 1.86, s.length * 0.35, -0.08));
  for (const x of [-s.width * 0.4, s.width * 0.4]) put(p, 'glass', box(0.035, 0.43, s.length * 0.62, x, 1.82, s.length * 0.07));
  if (emergency) {
    put(p, 'red', box(s.width * 0.99, 0.17, s.length * 0.52, 0, 1.63, -s.length * 0.15));
    addLightbar(p, s.width, s.height + 0.07, -s.length * 0.22);
  }
  addWheels(p, s.width, [-s.length * 0.31, s.length * 0.3], 0.47, 0.34);
  addBumpers(p, s.width, s.length * 0.97, 0.52, true);
  addLights(p, s.width, s.length * 0.965, 0.76);
  return p;
}

function police(): ModelParts {
  const p = basicCar('police');
  const s = VEHICLE_SPECS.police;
  put(p, 'cream', box(s.width * 0.955, 0.2, s.length * 0.54, 0, 0.77, -0.05));
  put(p, 'dark', box(s.width * 0.97, 0.16, s.length * 0.12, 0, 0.78, -0.15));
  addLightbar(p, s.width, s.height + 0.08, -0.18);
  return p;
}

function firetruck(): ModelParts {
  const s = VEHICLE_SPECS.firetruck;
  const p: ModelParts = {};
  put(p, 'red', box(s.width * 0.96, 1.25, s.length * 0.91, 0, 1.05, 0));
  put(p, 'body', box(s.width * 0.9, 1.45, s.length * 0.27, 0, 2.18, s.length * 0.29));
  put(p, 'cream', box(s.width * 0.82, 0.86, s.length * 0.45, 0, 1.91, -s.length * 0.19));
  put(p, 'glass', box(s.width * 0.69, 0.48, 0.05, 0, 2.38, s.length * 0.435, -0.06));
  put(p, 'chrome', box(0.18, 0.16, s.length * 0.58, 0, 2.83, -s.length * 0.11, 0, 0, -0.03));
  for (let z = -2.6; z < 1.3; z += 0.58) put(p, 'chrome', box(s.width * 0.72, 0.07, 0.09, 0, 2.88, z));
  addLightbar(p, s.width, 3.02, s.length * 0.31);
  addWheels(p, s.width, [-s.length * 0.31, s.length * 0.31], 0.53, 0.37);
  addBumpers(p, s.width, s.length * 0.95, 0.62, true);
  addLights(p, s.width, s.length * 0.94, 0.86);
  return p;
}

function golfCart(): ModelParts {
  const s = VEHICLE_SPECS.golfCart;
  const p: ModelParts = {};
  put(p, 'body', box(s.width * 0.88, 0.3, s.length * 0.8, 0, 0.48, 0));
  put(p, 'cream', box(s.width * 0.9, 0.09, s.length * 0.76, 0, s.height, 0));
  put(p, 'cream', box(s.width * 0.72, 0.38, 0.24, 0, 0.91, -0.28));
  for (const x of [-s.width * 0.37, s.width * 0.37]) for (const z of [-s.length * 0.29, s.length * 0.29]) put(p, 'dark', box(0.045, 1.12, 0.045, x, 1.21, z));
  addWheels(p, s.width, [-s.length * 0.3, s.length * 0.3], 0.27, 0.2);
  addBumpers(p, s.width, s.length * 0.84, 0.38);
  addLights(p, s.width, s.length * 0.82, 0.56);
  return p;
}

function vwBus(): ModelParts {
  const s = VEHICLE_SPECS.vwBus;
  const p: ModelParts = {};
  put(p, 'body', box(s.width * 0.94, 1.46, s.length * 0.9, 0, 1.12, 0));
  put(p, 'cream', box(s.width * 0.945, 0.58, s.length * 0.9, 0, 1.62, 0));
  put(p, 'teal', box(s.width * 0.955, 0.18, s.length * 0.91, 0, 0.91, 0));
  put(p, 'yellow', box(s.width * 0.965, 0.14, s.length * 0.56, 0, 0.69, -0.18));
  put(p, 'glass', box(s.width * 0.68, 0.52, 0.045, 0, 1.58, s.length * 0.455));
  put(p, 'glass', box(s.width * 0.68, 0.48, 0.045, 0, 1.56, -s.length * 0.455));
  for (const x of [-s.width * 0.475, s.width * 0.475]) {
    for (const z of [-1.18, -0.38, 0.42, 1.22]) put(p, 'glass', box(0.035, 0.43, 0.61, x, 1.55, z));
    put(p, 'red', cylinder(0.16, 0.025, x, 1.03, -0.3, Math.PI / 2, 8));
    put(p, 'lime', cylinder(0.07, 0.03, x, 1.03, -0.3, Math.PI / 2, 8));
  }
  addWheels(p, s.width, [-s.length * 0.3, s.length * 0.3], 0.35, 0.27);
  addBumpers(p, s.width, s.length * 0.93, 0.44, true);
  addLights(p, s.width, s.length * 0.92, 0.7);
  return p;
}

function slopVan(): ModelParts {
  const s = VEHICLE_SPECS.slopVan;
  const p: ModelParts = {};
  put(p, 'body', box(s.width * 0.95, 1.75, s.length * 0.9, 0, 1.26, -0.12));
  put(p, 'body', box(s.width * 0.9, 0.75, s.length * 0.24, 0, 0.8, s.length * 0.35));
  put(p, 'glass', box(s.width * 0.69, 0.5, 0.045, 0, 1.72, s.length * 0.456, -0.08));
  for (const x of [-s.width * 0.48, s.width * 0.48]) {
    put(p, 'glass', box(0.035, 0.48, 0.78, x, 1.7, s.length * 0.27));
    const logo = new THREE.PlaneGeometry(2.45, 0.92);
    logo.rotateY(x > 0 ? Math.PI / 2 : -Math.PI / 2);
    logo.translate(x + Math.sign(x) * 0.012, 1.35, -0.44);
    put(p, 'slopLogo', logo);
  }
  addWheels(p, s.width, [-s.length * 0.31, s.length * 0.31], 0.43, 0.32);
  addBumpers(p, s.width, s.length * 0.94, 0.5, true);
  addLights(p, s.width, s.length * 0.93, 0.76);
  return p;
}

function motorcycle(): ModelParts {
  const s = VEHICLE_SPECS.motorcycle;
  const p: ModelParts = {};
  addWheels(p, s.width, [-s.length * 0.38, s.length * 0.38], 0.36, 0.12);
  put(p, 'body', box(0.32, 0.35, 0.92, 0, 0.57, 0.04, -0.16));
  put(p, 'dark', box(0.35, 0.12, 0.68, 0, 0.83, -0.18));
  put(p, 'chrome', box(0.05, 0.9, 0.05, 0, 0.78, 0.62, -0.35));
  put(p, 'chrome', box(0.72, 0.05, 0.05, 0, 1.14, 0.66));
  put(p, 'headlight', cylinder(0.13, 0.08, 0, 0.83, s.length * 0.47, Math.PI / 2, 8));
  put(p, 'brake', box(0.19, 0.12, 0.05, 0, 0.65, -s.length * 0.48));
  return p;
}

function towTruck(): ModelParts {
  const s = VEHICLE_SPECS.towTruck;
  const p: ModelParts = {};
  put(p, 'body', box(s.width * 0.95, 0.88, s.length * 0.88, 0, 0.9, 0));
  put(p, 'body', box(s.width * 0.88, 1.55, s.length * 0.3, 0, 1.65, s.length * 0.28));
  put(p, 'dark', box(s.width * 0.82, 0.13, s.length * 0.49, 0, 1.36, -s.length * 0.22, -0.08));
  put(p, 'yellow', box(0.17, 0.17, s.length * 0.55, 0, 2.0, -s.length * 0.12, -0.43));
  put(p, 'yellow', box(s.width * 0.68, 0.14, 0.14, 0, 1.67, -s.length * 0.4));
  put(p, 'chrome', cylinder(0.055, 0.72, 0, 1.31, -s.length * 0.45));
  put(p, 'glass', box(s.width * 0.67, 0.49, 0.045, 0, 1.94, s.length * 0.435, -0.08));
  addLightbar(p, s.width, 2.49, s.length * 0.2);
  addWheels(p, s.width, [-s.length * 0.31, s.length * 0.31], 0.48, 0.35);
  addBumpers(p, s.width, s.length * 0.93, 0.56, true);
  addLights(p, s.width, s.length * 0.92, 0.8);
  return p;
}

function makeModel(kind: VehicleKind): ModelParts {
  switch (kind) {
    case 'sedan': case 'hatchback': case 'suv': case 'minivan': return basicCar(kind);
    case 'pickup': return pickup(false);
    case 'liftedTruck': return pickup(true);
    case 'cyberslop': return cyberslop();
    case 'semi': return semi();
    case 'boxTruck': return makeBoxTruck(kind);
    case 'police': return police();
    case 'ambulance': return makeBoxTruck(kind);
    case 'firetruck': return firetruck();
    case 'golfCart': return golfCart();
    case 'vwBus': return vwBus();
    case 'slopVan': return slopVan();
    case 'motorcycle': return motorcycle();
    case 'towTruck': return towTruck();
  }
}

function merged(gs: THREE.BufferGeometry[]): THREE.BufferGeometry {
  if (gs.length === 1) return gs[0];
  const g = mergeGeometries(gs, false);
  if (!g) throw new Error('Could not merge vehicle geometry');
  for (const source of gs) source.dispose();
  return g;
}

export class VehicleRenderer {
  readonly object = new THREE.Group();
  private batches = new Map<VehicleKind, KindBatch>();
  private slots: Array<Slot | undefined> = [];
  private freeHandles: number[] = [];
  private readonly matrix = new THREE.Matrix4();
  private readonly euler = new THREE.Euler();
  private readonly quaternion = new THREE.Quaternion();
  private readonly hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  private readonly color = new THREE.Color();
  private readonly perKind: number;
  private readonly maxTotal: number;
  private activeTotal = 0;
  private night = 0;
  private flashPhase = -1;

  constructor(scene: THREE.Scene, maxTotal: number) {
    this.maxTotal = Math.max(0, Math.floor(maxTotal));
    this.perKind = Math.max(16, Math.ceil(this.maxTotal / 3));
    for (const kind of KINDS) {
      const model = makeModel(kind);
      const meshes: THREE.InstancedMesh[] = [];
      const batch = {
        meshes, free: [], used: 0,
        handleByInstance: new Int32Array(this.perKind).fill(-1),
        braking: new Uint8Array(this.perKind),
        emergency: kind === 'police' || kind === 'ambulance',
      } as unknown as KindBatch;
      let body: THREE.InstancedMesh | undefined;
      for (const style of Object.keys(model) as PartStyle[]) {
        const sources = model[style];
        if (!sources?.length) continue;
        const mesh = new THREE.InstancedMesh(merged(sources), MATERIALS[style], this.perKind);
        mesh.name = `vehicle-${kind}-${style}`;
        mesh.count = 0;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.frustumCulled = false;
        mesh.castShadow = !LIGHT_STYLES.has(style);
        mesh.receiveShadow = style === 'body' || style === 'cream' || style === 'red';
        for (let i = 0; i < this.perKind; i++) mesh.setMatrixAt(i, this.hidden);
        if (style === 'body') body = mesh;
        else if (style === 'headlight') batch.headlight = mesh;
        else if (style === 'brake') batch.brake = mesh;
        else if (style === 'redBeacon') batch.redBeacon = mesh;
        else if (style === 'blueBeacon') batch.blueBeacon = mesh;
        meshes.push(mesh);
        this.object.add(mesh);
      }
      if (!body) throw new Error(`Vehicle ${kind} has no paintable body`);
      batch.body = body;
      // A non-rendered full-envelope instance makes trailers and ambulance boxes
      // selectable too. Raycaster still tests invisible objects when called directly.
      const spec = VEHICLE_SPECS[kind];
      const pickGeometry = new THREE.BoxGeometry(spec.width, spec.height, spec.length);
      pickGeometry.translate(0, spec.height / 2, 0);
      const pickMesh = new THREE.InstancedMesh(pickGeometry, PICK_MATERIAL, this.perKind);
      pickMesh.name = `vehicle-${kind}-pick`;
      pickMesh.count = 0;
      pickMesh.visible = false;
      pickMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < this.perKind; i++) pickMesh.setMatrixAt(i, this.hidden);
      meshes.push(pickMesh);
      this.object.add(pickMesh);
      batch.pickMesh = pickMesh;
      this.batches.set(kind, batch);
    }
    scene.add(this.object);
  }

  /** Returns a handle, or -1 if the pool for that kind is full. Model faces +Z. */
  add(kind: VehicleKind, color: number): number {
    if (this.activeTotal >= this.maxTotal) return -1;
    const batch = this.batches.get(kind)!;
    const reused = batch.free.length > 0;
    const instance = reused ? batch.free.pop()! : batch.used < this.perKind ? batch.used++ : -1;
    if (instance < 0) return -1;
    if (!reused) for (const mesh of batch.meshes) mesh.count = batch.used;
    const handle = this.freeHandles.length > 0 ? this.freeHandles.pop()! : this.slots.length;
    this.slots[handle] = { kind, instance };
    batch.handleByInstance[instance] = handle;
    batch.braking[instance] = 0;
    batch.body.setColorAt(instance, this.color.setHex(color));
    this.updateLights(batch, instance, performance.now() * 0.001);
    this.activeTotal++;
    return handle;
  }

  remove(handle: number): void {
    const slot = this.slots[handle];
    if (!slot) return;
    const batch = this.batches.get(slot.kind)!;
    for (const mesh of batch.meshes) mesh.setMatrixAt(slot.instance, this.hidden);
    batch.handleByInstance[slot.instance] = -1;
    batch.braking[slot.instance] = 0;
    batch.free.push(slot.instance);
    this.slots[handle] = undefined;
    this.freeHandles.push(handle);
    this.activeTotal--;
  }

  /** yaw: rotation about +Y (0 = facing +Z). pitch/roll for hills and crashes. */
  set(handle: number, x: number, y: number, z: number, yaw: number, pitch = 0, roll = 0): void {
    const slot = this.slots[handle];
    if (!slot) return;
    this.euler.set(pitch, yaw, roll, 'YXZ');
    this.quaternion.setFromEuler(this.euler);
    this.matrix.makeRotationFromQuaternion(this.quaternion).setPosition(x, y, z);
    for (const mesh of this.batches.get(slot.kind)!.meshes) mesh.setMatrixAt(slot.instance, this.matrix);
  }

  setBraking(handle: number, on: boolean): void {
    const slot = this.slots[handle];
    if (!slot) return;
    const batch = this.batches.get(slot.kind)!;
    const value = on ? 1 : 0;
    if (batch.braking[slot.instance] === value) return;
    batch.braking[slot.instance] = value;
    this.updateLights(batch, slot.instance, performance.now() * 0.001);
    if (batch.brake?.instanceColor) batch.brake.instanceColor.needsUpdate = true;
  }

  /** `night` is 0 in daylight and 1 at full night. */
  setNight(night: number): void {
    this.night = THREE.MathUtils.clamp(night, 0, 1);
    const now = performance.now() * 0.001;
    for (const batch of this.batches.values()) this.updateBatchLights(batch, now, false);
  }

  private updateLights(batch: KindBatch, instance: number, now: number): void {
    if (batch.headlight) {
      const intensity = 0.22 + this.night * 1.9;
      batch.headlight.setColorAt(instance, this.color.setRGB(intensity, intensity * 0.9, intensity * 0.66));
    }
    if (batch.brake) {
      const intensity = batch.braking[instance] ? 2.4 : 0.22 + this.night * 0.45;
      batch.brake.setColorAt(instance, this.color.setRGB(intensity, 0.012, 0.006));
    }
    if (batch.emergency) {
      const phase = Math.floor(now * 3.2) & 1;
      if (batch.redBeacon) batch.redBeacon.setColorAt(instance, this.color.setRGB(phase === 0 ? 2.8 : 0.12, 0.006, 0.004));
      if (batch.blueBeacon) batch.blueBeacon.setColorAt(instance, this.color.setRGB(0.004, 0.04, phase === 1 ? 2.8 : 0.12));
    } else {
      if (batch.redBeacon) batch.redBeacon.setColorAt(instance, this.color.setRGB(0.75, 0.01, 0.006));
      if (batch.blueBeacon) batch.blueBeacon.setColorAt(instance, this.color.setRGB(0.006, 0.04, 0.75));
    }
  }

  private updateBatchLights(batch: KindBatch, now: number, emergencyOnly: boolean): void {
    if (emergencyOnly && !batch.emergency) return;
    for (let instance = 0; instance < batch.used; instance++) {
      if (batch.handleByInstance[instance] >= 0) this.updateLights(batch, instance, now);
    }
    if (!emergencyOnly) {
      if (batch.headlight?.instanceColor) batch.headlight.instanceColor.needsUpdate = true;
      if (batch.brake?.instanceColor) batch.brake.instanceColor.needsUpdate = true;
    }
    if (batch.redBeacon?.instanceColor) batch.redBeacon.instanceColor.needsUpdate = true;
    if (batch.blueBeacon?.instanceColor) batch.blueBeacon.instanceColor.needsUpdate = true;
  }

  flush(): void {
    const now = performance.now() * 0.001;
    const phase = Math.floor(now * 3.2) & 1;
    if (phase !== this.flashPhase) {
      this.flashPhase = phase;
      for (const batch of this.batches.values()) this.updateBatchLights(batch, now, true);
    }
    for (const batch of this.batches.values()) for (const mesh of batch.meshes) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  pick(ray: THREE.Raycaster): number | null {
    let nearestHandle: number | null = null;
    let nearestDistance = Infinity;
    for (const batch of this.batches.values()) {
      const hit = ray.intersectObject(batch.pickMesh, false)[0];
      if (!hit || hit.instanceId === undefined || hit.distance >= nearestDistance) continue;
      const handle = batch.handleByInstance[hit.instanceId];
      if (handle >= 0) {
        nearestHandle = handle;
        nearestDistance = hit.distance;
      }
    }
    return nearestHandle;
  }
}
