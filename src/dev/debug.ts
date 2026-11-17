// Debug helpers for headless testing (window.__dbg).
import type { Game } from '../game';
import { lineCubic, quadCubic } from '../core/math';
import type { RoadTypeId } from '../roads/roadTypes';
import type { ZoneType } from '../contracts';
import { saveGame, snapshot } from '../sim/save';
import { refsFor } from '../sim/state';
import { EXT } from '../ext/registry';
import { CUSTOM_BUILDINGS } from '../sim/buildings';
import { kitMaterial } from '../buildings/kitGenerator';
import * as THREE from 'three';
import { buildingMaterial, generateBuilding, generateLandmark, landmarkFootprint } from '../buildings/generator';
import type { LandmarkId } from '../contracts';

export function debugApi(g: Game) {
  (window as unknown as { __ext: typeof EXT }).__ext = EXT;
  let keep: Record<string, string[]> | null = null;
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
    /** every milestone's unlocks now (no grants): for checks that aren't about progression */
    unlockAll() {
      g.sim.unlockAll();
    },
    /** `days` game days, as whole fixed steps: the very steps live play takes, with no frames between (then one, undrawn, so what is shown is current) */
    run(days: number) {
      const speed = g.sim.speed;
      g.sim.speed = 3;
      g.runSteps(g.stepsFor(days));
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
    /** The city as a save file's text, whole, without writing it anywhere (a big city's save can be more than the browser's storage holds). */
    snapshot() {
      return JSON.stringify(snapshot(g));
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
    /** Every service building in a row (for eyeballing the models). */
    serviceShowcase(x: number, z: number) {
      const grp = new THREE.Group();
      const y = g.terrain.h(x, z);
      let cx = x;
      const defs = [...CUSTOM_BUILDINGS.entries()];
      defs.forEach(([, def], i) => {
        const m = def.model();
        const mesh = new THREE.Mesh(m.geometry, kitMaterial());
        const w = def.w * 8;
        const row = i < 9 ? 0 : 1;
        if (i === 9) cx = x;
        mesh.position.set(cx + w / 2, y, z + row * 70);
        cx += w + 10;
        mesh.castShadow = mesh.receiveShadow = true;
        grp.add(mesh);
      });
      g.scene.add(grp);
      g.trees.cut(x - 20, z - 40, x + 460, z + 120, () => true);
      return defs.length;
    },
    /**
     * A fingerprint of everything the simulation holds, one hash per system (and a few counts to read it by). Two runs of the same
     * seed with the same inputs must agree on every line, whatever the frame rate, the graphics preset or the number of saves and
     * reloads on the way (scripts/determinism.mjs). Numbers are hashed at full precision: "nearly the same" is a different city.
     */
    fingerprint() {
      const str = (p: unknown) => (typeof p === 'number' ? (Object.is(p, -0) ? '0' : String(p)) : p === undefined ? '_' : typeof p === 'string' ? p : JSON.stringify(p));
      const fnv = (h: number, s: string) => { for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0; return h; };
      const H = (name: string, parts: unknown[]) => fnv(2166136261, (keep ? (keep[name] = parts.map(str)) : parts.map(str)).join('|')).toString(16).padStart(8, '0');
      const s = g.sim, T = g.traffic as unknown as { cars: Record<string, unknown>[]; signals: Map<number, { t: number; lead?: { seg: number; left: number } }> };
      const out: Record<string, string | number> = {};
      out.day = s.day;
      out.sim = H('sim', [s.day, g.hour, s.money, s.population, s.taxRate, s.loans, s.demand, s.jobsFilled, s.naturePct, s.sprawlPct, s.serializeExtra()]);
      const B: unknown[] = [];
      for (const b of g.buildings.list.values()) B.push(b.id, b.zone, b.kind, b.landmark, b.level, b.w, b.d, b.x, b.z, b.y, b.yaw, b.seg, b.label, b.brand, b.state, b.progress, b.buildDays, b.cap, b.occ, b.lv, b.levelProgress, b.born, b.abandoned, b.offNet, b.model.spots?.length ?? 0);
      out.buildings = H('buildings', B); out.nBuildings = g.buildings.list.size;
      const R: unknown[] = [];
      for (const n of g.net.nodes.values()) R.push(n.id, n.x, n.z, n.segs.join(','));
      for (const q of g.net.segs.values()) R.push(q.id, q.a, q.b, q.type, q.length, q.builtDay, q.vc, q.blocked, q.load[0], q.load[1], q.name);
      out.roads = H('roads', R); out.nSegs = g.net.segs.size;
      const Z: unknown[] = [];
      for (const c of g.zones.cells.values()) Z.push(c.id, c.seg, c.side, c.col, c.row, c.valid, c.zone, c.bld);
      out.zones = H('zones', Z);
      const C: unknown[] = [];
      for (const c of T.cars) {
        const j = c.junction as { node: number; t: number } | null, path = c.path as { seg: number; dir: number }[];
        // (a car on a lot is drawn in whichever stall the parking picked: a look, chosen per frame near the camera, that the simulation never
        // reads. The drawn heading is left out everywhere for the same reason: it eases from wherever the stall had it, a whole turn apart at times.)
        const inLot = (c.dep as number) > 0 || (c.arr as number) >= 0 || !!c.thru;
        C.push(c.id, c.kind, c.pi, c.s, c.v, c.lane, c.crashed, c.dep, c.arr, c.drunk, c.reckless, c.wob, c.laneCd, inLot ? 0 : c.x, inLot ? 0 : c.z, j ? j.node : 0, j ? j.t : 0, path.length, path.length ? path[path.length - 1].seg : 0, (c.destB as { id: number } | null)?.id ?? 0, c.purpose);
      }
      for (const [id, sg] of T.signals) C.push(id, sg.t, sg.lead ? sg.lead.seg : 0, sg.lead ? sg.lead.left : 0);
      out.traffic = H('traffic', C); out.nCars = T.cars.length;
      const P: unknown[] = [];
      for (const p of g.peds.peds) P.push(p.id, p.kind, p.seg, p.dir, p.s, p.side, p.x, p.z, p.life, p.arch);
      out.people = H('people', P); out.nPeople = g.peds.peds.length;
      out.communes = H('communes', g.communes.list.map((c) => [c.id, c.state, c.stubborn, c.suitDays, c.suitOdds, c.nextProtest]));
      out.weather = H('weather', [g.climate.save(), g.climate.wind.x, g.climate.wind.y, g.climate.season]);
      // (the exact state where a system has one: its plain save rounds things off)
      const refs = refsFor(g);
      for (const x of EXT.systems) if (x.save || x.saveExact) out[`ext.${x.id}`] = H(`ext.${x.id}`, [x.saveExact ? x.saveExact(g, refs) : x.save!(g)]);
      out.nature = H('nature', [g.trees.naturePct, g.trees.alive]);
      return out;
    },
    /** What the fingerprint is made of, system by system, unhashed: to see which value differs between two runs (scripts/determinism.mjs). */
    dump(): Record<string, string[]> {
      keep = {};
      api.fingerprint();
      const k = keep;
      keep = null;
      return k;
    },
    info() {
      return { segs: g.net.segs.size, nodes: g.net.nodes.size, cells: g.zones.cells.size, counts: g.zones.counts(), trees: g.trees.alive, communes: g.communes.list.map((c) => [c.name, Math.round(c.x), Math.round(c.z)]) };
    },
  };
  Object.assign(api, agentShowcase(g));
  return api;
}

import { agentShowcase } from './agentShowcase';
