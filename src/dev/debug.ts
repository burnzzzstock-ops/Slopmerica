// Debug helpers for headless testing (window.__dbg).
import type { Game } from '../game';
import { lineCubic, quadCubic } from '../core/math';
import type { RoadTypeId } from '../roads/roadTypes';
import type { ZoneType } from '../contracts';
import { saveGame } from '../sim/save';
import * as THREE from 'three';
import { buildingMaterial, generateBuilding, generateLandmark, landmarkFootprint } from '../buildings/generator';
import type { LandmarkId } from '../contracts';

export function debugApi(g: Game) {
  const api = {
    road(x1: number, z1: number, x2: number, z2: number, type: RoadTypeId = 'twoLane', cx?: number, cz?: number) {
      const a = g.net.snap(x1, z1);
      const b = g.net.snap(x2, z2);
      const c = cx !== undefined && cz !== undefined ? quadCubic({ x: a.x, z: a.z }, { x: cx, z: cz }, { x: b.x, z: b.z }) : lineCubic({ x: a.x, z: a.z }, { x: b.x, z: b.z });
      const plan = g.net.plan(a, c, type);
      if (!plan.ok) return plan.reason;
      return g.net.build(a, b, c, type).length;
    },
    zone(x: number, z: number, r: number, zone: ZoneType) {
      g.zones.update();
      return g.zones.paint(x, z, r, zone);
    },
    run(days: number) {
      const speed = g.sim.speed;
      g.sim.speed = 3;
      const steps = Math.ceil((days * 2.5) / 4 / 0.1);
      for (let i = 0; i < steps; i++) g.frame(0.1, false);
      g.sim.speed = speed;
      return { pop: g.sim.population, bld: g.buildings.list.size, cars: g.traffic.count, money: g.sim.money, demand: g.sim.demand, day: g.sim.day };
    },
    view(x: number, z: number, dist: number, yaw?: number, pitch?: number) {
      g.rts.setView(x, z, dist, yaw, pitch, true);
      g.frame(0.016);
    },
    hour(h: number) {
      g.hour = h;
      g.frame(0.016);
    },
    save() {
      return saveGame(g);
    },
    /** Lay out every zone x level (and the landmarks) in a grid for eyeballing. */
    showcase(x: number, z: number, variant = 0) {
      const zones: ZoneType[] = ['resLow', 'resHigh', 'comLow', 'comHigh', 'industry', 'office'];
      const dims: Record<ZoneType, [number, number]> = { resLow: [2, 3], resHigh: [3, 3], comLow: [4, 3], comHigh: [4, 4], industry: [4, 4], office: [3, 3] };
      const grp = new THREE.Group();
      const y = g.terrain.h(x, z);
      zones.forEach((zone, zi) => {
        for (let lv = 1; lv <= 5; lv++) {
          const [w, d] = dims[zone];
          const m = generateBuilding({ zone, level: lv, widthCells: w, depthCells: d, seed: 11 + variant * 7 + lv * 3 + zi });
          const mesh = new THREE.Mesh(m.geometry, buildingMaterial());
          mesh.position.set(x + (lv - 3) * 42, y, z + (zi - 2.5) * 44);
          mesh.castShadow = mesh.receiveShadow = true;
          grp.add(mesh);
        }
      });
      const lms: LandmarkId[] = ['slopCannon', 'slop69Field', 'pigCabanaResort', 'neuralFlyDatacenter', 'propaneParadise', 'fillErUpMegaStation', 'megachurch', 'waterTower'];
      lms.forEach((id, i) => {
        const m = generateLandmark(id, 1);
        const mesh = new THREE.Mesh(m.geometry, buildingMaterial());
        const fp = landmarkFootprint(id);
        mesh.position.set(x - 130 + i * 62, y, z + 3.5 * 44 + fp.depthCells * 4);
        mesh.castShadow = mesh.receiveShadow = true;
        grp.add(mesh);
      });
      g.scene.add(grp);
      g.trees.cut(x - 180, z - 150, x + 340, z + 260, () => true);
      return grp.children.length;
    },
    info() {
      return { segs: g.net.segs.size, nodes: g.net.nodes.size, cells: g.zones.cells.size, counts: g.zones.counts(), trees: g.trees.alive, communes: g.communes.list.map((c) => [c.name, Math.round(c.x), Math.round(c.z)]) };
    },
  };
  Object.assign(api, agentShowcase(g));
  return api;
}

import { agentShowcase } from './agentShowcase';
