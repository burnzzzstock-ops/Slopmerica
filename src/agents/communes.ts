// Hippie communes: scattered opposition. Pay them off, sue them, or (rarely)
// learn to live with them forever.
import * as THREE from 'three';
import { HALF, WATER } from '../config';
import { clamp } from '../core/math';
import { Rng } from '../core/rng';
import type { MapId } from '../world/maps';
import type { Terrain } from '../world/terrain';
import { Paint } from '../world/terrain';
import type { Emitter } from '../contracts';
import { kitMaterial } from '../buildings/kitGenerator';
import { Kit, col } from '../buildings/kit';
import { T } from '../buildings/atlas';
import { buildCommune } from './communeBuilder';
import type { Trees } from '../world/trees';
import { COMMUNE_NAMES as NAMES } from '../art/communeNames';

export interface Commune {
  id: number;
  name: string;
  x: number;
  z: number;
  r: number;
  members: number;
  stubborn: number; // 0..1
  forever: boolean;
  vibe: string;
  demand: string;
  founded: number;
  state: 'active' | 'suing' | 'leaving' | 'gone';
  suitDays: number;
  suitOdds: number;
  nextProtest: number; // game day
  protestSeg: number; // segment currently blocked by a protest (0 = none)
  protestUntil: number;
  group: THREE.Group;
  fire: THREE.PointLight;
  flameMesh: THREE.Mesh | null;
  bulbMesh: THREE.Mesh | null;
  remains: THREE.Mesh | null;
  baseY: number;
  /** Smoke / fire emitters in commune-local space. */
  emitters: Emitter[];
  leaveT: number;
}

const VIBES = [
  'Immaculate', 'Patchouli-forward', 'Aggressively peaceful', 'Mercury is in retrograde', 'Kombucha-scented',
  'Drum circle since 1969', 'Vibing, suspiciously', 'Off-grid and extremely online', 'Crunchy', 'Barefoot, litigious',
];
const DEMANDS = [
  'Tear down the stroad and plant a food forest', 'Free kombucha on tap for all residents', 'Return the land to the salamanders',
  'Ban leaf blowers, Dollar Colonels and pants', 'A bike lane (they know, they know)', 'Legalize literally everything',
  'Rename the county "Gaia"', 'Stop cutting the trees, man', 'Fluoride out, crystals in', 'A 4-day week. Weeks are a construct.',
];

export class Communes {
  list: Commune[] = [];
  readonly group = new THREE.Group();

  constructor(private terrain: Terrain, private trees: Trees, mapId: MapId, count: number, seed: number, foreverChance: number, avoid: { x: number; z: number; r: number }[]) {
    const rng = new Rng(seed);
    const names = rng.float() < 2 ? [...NAMES[mapId], ...NAMES.any] : NAMES.any;
    let tries = 0;
    while (this.list.length < count && tries < 4000) {
      tries++;
      const x = rng.range(-HALF + 150, HALF - 150), z = rng.range(-HALF + 150, HALF - 150);
      const h = terrain.h(x, z);
      if (h < WATER + 1.2 || terrain.slope(x, z) > 0.22) continue;
      if (this.list.some((c) => Math.hypot(c.x - x, c.z - z) < 380)) continue;
      if (avoid.some((a) => Math.hypot(a.x - x, a.z - z) < a.r)) continue;
      let flat = true;
      for (let k = 0; k < 8 && flat; k++) {
        const a = (k / 8) * Math.PI * 2;
        const hh = terrain.h(x + Math.cos(a) * 30, z + Math.sin(a) * 30);
        if (hh < WATER + 0.8 || Math.abs(hh - h) > 6) flat = false;
      }
      if (!flat) continue;
      const name = names.splice(rng.int(0, Math.max(0, names.length - 1)), 1)[0] ?? `Commune #${this.list.length + 1}`;
      const members = rng.int(8, 40);
      const c: Commune = {
        id: this.list.length + 1, name, x, z, r: 30 + members * 0.8, members, stubborn: rng.range(0.1, 0.7), forever: rng.chance(foreverChance),
        vibe: rng.pick(VIBES), demand: rng.pick(DEMANDS), founded: rng.int(1967, 2019), state: 'active', suitDays: 0, suitOdds: 0,
        nextProtest: rng.range(20, 70), protestSeg: 0, protestUntil: 0, group: new THREE.Group(), fire: new THREE.PointLight(0xff8a3a, 0, 38, 2),
        flameMesh: null, bulbMesh: null, remains: null, baseY: 0, leaveT: 0, emitters: [],
      };
      if (c.forever) { c.founded = 1969; c.stubborn = 1; }
      this.build(c, rng, mapId);
      this.list.push(c);
      this.group.add(c.group);
    }
  }

  private build(c: Commune, rng: Rng, mapId: MapId) {
    const y0 = this.terrain.h(c.x, c.z);
    c.baseY = y0;
    const ground = (lx: number, lz: number) => this.terrain.h(c.x + lx, c.z + lz) - y0;
    const leveled: { x: number; z: number; r: number }[] = [];
    const level = (lx: number, lz: number, radius: number) => {
      const x = c.x + lx, z = c.z + lz, h = this.terrain.h(x, z);
      const r = radius * 0.86;
      this.terrain.flattenLot([{ x: x - r, z: z - r }, { x: x + r, z: z - r }, { x: x + r, z: z + r }, { x: x - r, z: z + r }], h, Paint.Dirt);
      leveled.push({ x, z, r: r + 6 }); // terrain's six metre feather also moves tree roots
      return this.terrain.h(x, z) - y0;
    };
    const L = buildCommune(c.name, c.r, c.members, rng.int(1, 1e9), ground, mapId, level,
      (lx, lz) => this.terrain.coverAt(c.x + lx, c.z + lz));
    const mesh = new THREE.Mesh(L.geometry, kitMaterial());
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    c.group.add(mesh);
    c.flameMesh = new THREE.Mesh(L.flameGeometry, kitMaterial());
    c.flameMesh.castShadow = false;
    c.group.add(c.flameMesh);
    c.bulbMesh = new THREE.Mesh(L.bulbGeometry, kitMaterial());
    c.bulbMesh.castShadow = false;
    c.group.add(c.bulbMesh);
    c.emitters = L.emitters;
    // clear trees out of the structures, trample paths into the grass
    for (const f of L.clear) {
      const fx = c.x + f.x, fz = c.z + f.z;
      this.trees.cut(fx - f.r, fz - f.r, fx + f.r, fz + f.r, (x, z) => (x - fx) ** 2 + (z - fz) ** 2 < f.r * f.r);
    }
    for (const f of leveled) {
      this.trees.cut(f.x - f.r, f.z - f.r, f.x + f.r, f.z + f.r,
        (x, z) => Math.abs(x - f.x) <= f.r && Math.abs(z - f.z) <= f.r);
    }
    for (const d of L.dirt) this.terrain.paintCircle(c.x + d.x, c.z + d.z, d.r, Paint.Dirt);
    c.fire.position.set(L.fire[0], L.fire[1] + 0.8, L.fire[2]);
    c.group.add(c.fire);
    c.group.position.set(c.x, y0, c.z);
    c.remains = new THREE.Mesh(this.remainsGeometry(L.fire[1] - 1.2), kitMaterial());
    c.remains.position.set(c.x, y0, c.z);
    c.remains.receiveShadow = true;
  }

  private remainsGeometry(y: number) {
    const k = new Kit();
    for (let i = 0; i < 11; i++) {
      const a = i * Math.PI * 2 / 11;
      k.at(Math.cos(a) * 1.5, Math.sin(a) * 1.5, a, () =>
        k.box(0, 0, 0.5, 0.37, y - 0.08, y + 0.23, T.STONE, col(0x655f59), T.STONE));
    }
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 4;
      k.tube([Math.cos(a) * 0.72, y + 0.08, Math.sin(a) * 0.72], [-Math.cos(a) * 0.72, y + 0.1, -Math.sin(a) * 0.72], 0.09, 5, col(0x292421), T.WOOD);
    }
    k.at(3.4, 2.2, 0.35, () => {
      const steel = col(0x77766d), fabric = col(0x757f62);
      for (const x of [-0.34, 0.34]) {
        k.tube([x, y, -0.32], [x, y + 0.47, 0.22], 0.025, 4, steel);
        k.tube([x, y, 0.38], [x, y + 0.47, 0.22], 0.025, 4, steel);
      }
      k.box(0, 0.16, 0.75, 0.65, y + 0.44, y + 0.49, T.CANVAS, fabric, T.CANVAS);
      k.quad([-0.36, y + 0.46, -0.12], [0.36, y + 0.46, -0.12], [0.36, y + 1.12, -0.45], [-0.36, y + 1.12, -0.45], [[0, 0], [1, 0], [1, 1], [0, 1]], fabric, T.CANVAS);
    });
    return k.build();
  }

  blockers() {
    return this.list.filter((c) => c.state !== 'gone').map((c) => ({ x: c.x, z: c.z, r: c.r + 6, name: c.name }));
  }

  /** Land value drag near communes (drum circles, patchouli). */
  penalty(x: number, z: number): number {
    let p = 0;
    for (const c of this.list) {
      if (c.state === 'gone') continue;
      const d = Math.hypot(c.x - x, c.z - z);
      if (d < 260) p += (1 - d / 260) * (c.forever ? 30 : 20);
    }
    return p;
  }

  at(x: number, z: number): Commune | null {
    for (const c of this.list) if (c.state !== 'gone' && Math.hypot(c.x - x, c.z - z) < c.r + 8) return c;
    return null;
  }

  bribeCost(c: Commune) {
    return Math.round((c.members * 1400 * (1 + c.stubborn)) / 100) * 100;
  }
  suitCost(c: Commune) {
    return Math.round((6000 + c.members * 250) / 100) * 100;
  }
  suitOdds(c: Commune) {
    return c.forever ? 0 : clamp(0.62 - c.stubborn * 0.35, 0.12, 0.8);
  }
  bribeOdds(c: Commune) {
    return c.forever ? 0 : clamp(0.9 - c.stubborn * 0.6, 0.2, 0.9);
  }

  /** Animate: flicker fires; leaving communes sink and fade. */
  update(dt: number, night: number, time: number, camera: THREE.Vector3) {
    for (const c of this.list) {
      if (c.state === 'gone') continue;
      const flicker = 0.88 + Math.sin(time * 13 + c.id) * 0.09 + Math.sin(time * 23.7 + c.id * 4) * 0.035;
      c.fire.intensity = night * 25 * flicker;
      // Distant campfires remain visible through emissive geometry; their point
      // lights need only shade the nearby ground and props.
      c.fire.visible = night > 0.05 && Math.abs(c.x - camera.x) < 420 && Math.abs(c.z - camera.z) < 420;
      if (c.flameMesh) {
        c.flameMesh.scale.set(1 + Math.sin(time * 9 + c.id) * 0.028, 0.94 + flicker * 0.07, 1 + Math.cos(time * 7.1 + c.id) * 0.025);
        c.flameMesh.rotation.y = Math.sin(time * 3.7 + c.id) * 0.045;
      }
      if (c.bulbMesh) {
        c.bulbMesh.position.y = Math.sin(time * 1.15 + c.id) * 0.045;
        c.bulbMesh.rotation.y = Math.sin(time * 0.8 + c.id) * 0.0018;
      }
      if (c.state === 'leaving') {
        c.leaveT += dt;
        c.group.position.y = c.baseY - Math.min(4, c.leaveT) * 2;
        if (c.leaveT > 4) {
          c.state = 'gone';
          this.group.remove(c.group);
          if (c.remains) this.group.add(c.remains);
          this.terrain.paintCircle(c.x, c.z, 7.5, Paint.Scorched);
        }
      }
    }
  }

  countActive() {
    return this.list.filter((c) => c.state !== 'gone').length;
  }
}
