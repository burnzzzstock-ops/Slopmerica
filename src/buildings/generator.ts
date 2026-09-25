// STUB — owned by the Buildings & Brands workstream (replace wholesale).
// Contract: every returned geometry is NON-INDEXED with attributes
// position(3), normal(3), uv(2), color(3), in lot-local space (road on +Z).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { BuildingModel, LandmarkId, LotSpec, ZoneType } from '../contracts';
import { CELL } from '../config';

let material: THREE.MeshStandardMaterial | null = null;
const nightUniform = { value: 0 };

/** The single shared material for every building, landmark and billboard. */
export function buildingMaterial(): THREE.Material {
  if (!material) material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.05 });
  return material;
}

/** 0 = day, 1 = night (window glow, sign glow). */
export function setBuildingNight(n: number) {
  nightUniform.value = n;
}

/** Generate fonts/atlases. Call once before generating buildings. */
export async function loadArt(): Promise<void> {}

const ZONE_COLOR: Record<ZoneType, number> = {
  resLow: 0xd9c9a8, resHigh: 0xc98a6a, comLow: 0x6fa8dc, comHigh: 0x3d6fb0, industry: 0xc9a13a, office: 0x9a7ad0,
};

function box(w: number, h: number, d: number, x: number, y: number, z: number, color: number) {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  g.translate(x, y + h / 2, z);
  const c = new THREE.Color(color);
  const n = g.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

export function generateBuilding(spec: LotSpec): BuildingModel {
  const W = spec.widthCells * CELL, D = spec.depthCells * CELL;
  const tall = { resLow: 5, resHigh: 10, comLow: 5, comHigh: 9, industry: 7, office: 12 }[spec.zone];
  const h = tall * (0.6 + spec.level * 0.5) * (spec.zone === 'resHigh' || spec.zone === 'office' ? spec.level : 1);
  const g = box(W * 0.7, h, D * 0.6, 0, 0, -D * 0.1, ZONE_COLOR[spec.zone]);
  return { geometry: g, height: h, label: `${spec.zone} L${spec.level}`, emitters: [] };
}

export function landmarkFootprint(id: LandmarkId): { widthCells: number; depthCells: number } {
  return { widthCells: 4, depthCells: 4 };
}

export function generateLandmark(id: LandmarkId, seed: number): BuildingModel {
  const g = box(24, 20, 24, 0, 0, 0, 0xff3ea5);
  return { geometry: g, height: 20, label: id, emitters: [] };
}

/** Roadside billboard on a pole, facing +Z. merch=true shows an Imagine Supply Co. ad. */
export function generateBillboard(seed: number, merch = false): BuildingModel {
  const g = mergeGeometries([box(0.6, 9, 0.6, 0, 0, 0, 0x777777), box(10, 4, 0.4, 0, 9, 0, merch ? 0x111111 : 0xeeeeee)], false)!;
  return { geometry: g, height: 13, label: merch ? 'Slop billboard' : 'Billboard', emitters: [] };
}
