// Hippie communes: scattered opposition. Pay them off, sue them, or (rarely)
// learn to live with them forever.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { HALF, WATER } from '../config';
import { clamp } from '../core/math';
import { Rng } from '../core/rng';
import type { MapId } from '../world/maps';
import type { Terrain } from '../world/terrain';
import type { Trees } from '../world/trees';

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
  leaveT: number;
}

const NAMES: Record<MapId | 'any', string[]> = {
  any: [
    'Sunflower Collective', 'Mother Earth Commune', 'The Vibe Zone', 'Camp Kombucha', 'Free Love Acres', 'Crystal Healing Co-op',
    'Harmony Hollow', 'Moonchild Ranch', 'Tofu Ridge', 'Sprout Nation', 'Hemp Haven', 'Granola Gulch', 'Solstice Village',
    'The Drum Circle That Never Ends', 'Woodstock Forever', 'Birkenstock Bluffs', 'Vegan Vortex', 'Cosmic Yurt Collective',
    'Mushroom Meadow', 'Patchouli Pines', 'Third Eye Estates', 'Dandelion Nation',
  ],
  appalachia: ['Dreadlock Holler', 'Moonshine & Mantras', 'Banjo Buddha Farm', 'Ramp Festival Forever'],
  norcal: ['Big Sur-render', 'Redwood Rainbow Tribe', 'Humboldt Harmony', 'Esalen-ish Institute', 'Burning Mini'],
  florida: ['Swamp Shaman Co-op', 'Gator Gaia', 'Manatee Mindfulness', 'Everglade Energy Healing'],
};
const VIBES = [
  'Immaculate', 'Patchouli-forward', 'Aggressively peaceful', 'Mercury is in retrograde', 'Kombucha-scented',
  'Drum circle since 1969', 'Vibing, suspiciously', 'Off-grid and extremely online', 'Crunchy', 'Barefoot, litigious',
];
const DEMANDS = [
  'Tear down the stroad and plant a food forest', 'Free kombucha on tap for all residents', 'Return the land to the salamanders',
  'Ban leaf blowers, Dollar Colonels and pants', 'A bike lane (they know, they know)', 'Legalize literally everything',
  'Rename the county "Gaia"', 'Stop cutting the trees, man', 'Fluoride out, crystals in', 'A 4-day week. Weeks are a construct.',
];

function colorGeo(g: THREE.BufferGeometry, hex: number) {
  const gg = g.index ? g.toNonIndexed() : g;
  gg.deleteAttribute('uv');
  const c = new THREE.Color(hex);
  const n = gg.getAttribute('position').count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  gg.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return gg;
}

function signTexture(name: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 192;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 512, 0);
  ['#ff4d6d', '#ffb347', '#fff275', '#7dff8a', '#5ec8ff', '#b388ff'].forEach((col, i) => g.addColorStop(i / 5, col));
  ctx.fillStyle = '#6b4a2b';
  ctx.fillRect(0, 0, 512, 192);
  ctx.fillStyle = g;
  ctx.fillRect(10, 10, 492, 172);
  ctx.fillStyle = '#2a1a0a';
  ctx.font = '44px "Permanent Marker", "Comic Sans MS", cursive';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const words = name.split(' ');
  if (name.length > 18 && words.length > 1) {
    const h = Math.ceil(words.length / 2);
    ctx.fillText(words.slice(0, h).join(' '), 256, 70);
    ctx.fillText(words.slice(h).join(' '), 256, 128);
  } else ctx.fillText(name, 256, 96);
  ctx.font = '26px "Permanent Marker", cursive';
  ctx.fillText('☮ NO STROADS ☮', 256, 170);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Communes {
  list: Commune[] = [];
  readonly group = new THREE.Group();
  private mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  private fireMat = new THREE.MeshBasicMaterial({ color: 0xff8a2a });

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
        nextProtest: rng.range(20, 70), protestSeg: 0, protestUntil: 0, group: new THREE.Group(), fire: new THREE.PointLight(0xff8a3a, 0, 60, 2), leaveT: 0,
      };
      if (c.forever) { c.founded = 1969; c.stubborn = 1; }
      this.build(c, rng);
      this.list.push(c);
      this.group.add(c.group);
    }
  }

  private build(c: Commune, rng: Rng) {
    const parts: THREE.BufferGeometry[] = [];
    const y0 = this.terrain.h(c.x, c.z);
    const place = (g: THREE.BufferGeometry, lx: number, lz: number, rot = 0) => {
      g.rotateY(rot);
      g.translate(lx, this.terrain.h(c.x + lx, c.z + lz) - y0, lz);
      parts.push(g);
    };
    const yurtColors = [0xe8d8b8, 0xd96c4a, 0x6a9a5b, 0xe0b04a, 0x7a5aa8, 0x4a8ab8];
    const n = 3 + Math.floor(c.members / 8);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + rng.range(-0.3, 0.3);
      const d = c.r * rng.range(0.35, 0.75);
      const r = rng.range(2.6, 3.8);
      const wall = colorGeo(new THREE.CylinderGeometry(r, r, 2.4, 12).translate(0, 1.2, 0), rng.pick(yurtColors));
      const roof = colorGeo(new THREE.ConeGeometry(r * 1.08, 1.8, 12).translate(0, 3.3, 0), 0xc9b48a);
      place(mergeGeometries([wall, roof])!, Math.cos(a) * d, Math.sin(a) * d);
    }
    // geodesic dome
    const dome = colorGeo(new THREE.IcosahedronGeometry(6, 1), 0xf2f2ee);
    dome.scale(1, 0.85, 1);
    place(dome, rng.range(-6, 6), rng.range(-6, 6));
    // VW buses (two-tone)
    for (let k = 0; k < 2; k++) {
      const a = rng.range(0, Math.PI * 2);
      const body = colorGeo(new THREE.BoxGeometry(1.9, 1.3, 4.4).translate(0, 1.15, 0), rng.pick([0x5ec8ff, 0xff8a3a, 0x7dff8a, 0xffd23a]));
      const top = colorGeo(new THREE.BoxGeometry(1.9, 0.8, 4.4).translate(0, 2.2, 0), 0xf5f0e0);
      const w1 = colorGeo(new THREE.CylinderGeometry(0.38, 0.38, 2.0, 8).rotateZ(Math.PI / 2).translate(0, 0.38, 1.4), 0x222222);
      const w2 = colorGeo(new THREE.CylinderGeometry(0.38, 0.38, 2.0, 8).rotateZ(Math.PI / 2).translate(0, 0.38, -1.4), 0x222222);
      place(mergeGeometries([body, top, w1, w2])!, Math.cos(a) * c.r * 0.9, Math.sin(a) * c.r * 0.9, rng.range(0, 6));
    }
    // garden beds
    for (let k = 0; k < 4; k++) {
      place(colorGeo(new THREE.BoxGeometry(8, 0.5, 1.4).translate(0, 0.25, 0), 0x4a7a2a), -c.r * 0.3 + k * 2.2, c.r * 0.45, 0.2);
    }
    // campfire logs + ring
    place(colorGeo(new THREE.CylinderGeometry(2.2, 2.4, 0.4, 10).translate(0, 0.2, 0), 0x6d6a66), 8, -4);
    // prayer flag poles
    for (let k = 0; k < 3; k++) place(colorGeo(new THREE.CylinderGeometry(0.12, 0.12, 7, 5).translate(0, 3.5, 0), 0x8a6a4a), rng.range(-c.r * 0.6, c.r * 0.6), rng.range(-c.r * 0.6, c.r * 0.6));
    const merged = mergeGeometries(parts)!;
    const mesh = new THREE.Mesh(merged, this.mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    c.group.add(mesh);
    // flames
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.9, 2.2, 6), this.fireMat);
    flame.position.set(8, this.terrain.h(c.x + 8, c.z - 4) - y0 + 1.3, -4);
    flame.name = 'flame';
    c.group.add(flame);
    c.fire.position.set(8, flame.position.y + 2, -4);
    c.group.add(c.fire);
    // prayer flags string (colored quads)
    const flagCols = [0x2a6ad8, 0xf2f2f2, 0xd83a2a, 0x2ab04a, 0xf2d23a];
    const flags: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 14; k++) {
      const q = colorGeo(new THREE.PlaneGeometry(0.8, 1).translate(-c.r * 0.5 + k * (c.r / 14), 5.5 - Math.sin((k / 13) * Math.PI) * 1.2, 0), flagCols[k % 5]);
      flags.push(q);
    }
    const fm = new THREE.Mesh(mergeGeometries(flags)!, new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    c.group.add(fm);
    // hand-painted sign facing outward
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(9, 3.4), new THREE.MeshStandardMaterial({ map: signTexture(c.name), side: THREE.DoubleSide }));
    const sa = rng.range(0, Math.PI * 2);
    sign.position.set(Math.cos(sa) * (c.r + 2), this.terrain.h(c.x + Math.cos(sa) * (c.r + 2), c.z + Math.sin(sa) * (c.r + 2)) - y0 + 3.2, Math.sin(sa) * (c.r + 2));
    sign.lookAt(Math.cos(sa) * (c.r + 30), sign.position.y, Math.sin(sa) * (c.r + 30));
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3.2, 0.3), new THREE.MeshStandardMaterial({ color: 0x6b4a2b }));
    post.position.copy(sign.position).setY(sign.position.y - 2.4);
    c.group.add(sign, post);
    c.group.position.set(c.x, y0, c.z);
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
  update(dt: number, night: number, time: number) {
    for (const c of this.list) {
      if (c.state === 'gone') continue;
      c.fire.intensity = night * 40 * (0.8 + Math.sin(time * 13 + c.id) * 0.2);
      c.fire.visible = night > 0.05;
      const f = c.group.getObjectByName('flame');
      if (f) f.scale.setScalar(0.85 + Math.sin(time * 11 + c.id * 3) * 0.15);
      if (c.state === 'leaving') {
        c.leaveT += dt;
        c.group.position.y -= dt * 2;
        if (c.leaveT > 4) {
          c.state = 'gone';
          this.group.remove(c.group);
        }
      }
    }
  }

  countActive() {
    return this.list.filter((c) => c.state !== 'gone').length;
  }
}
