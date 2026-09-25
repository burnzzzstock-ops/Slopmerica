// Pedestrians near the camera: sidewalk walkers, smokers and drinkers loitering
// outside businesses, commune drum circles, and protesters blocking roads.
import * as THREE from 'three';
import type { PersonAction } from '../contracts';
import { clamp, lerp, locate, norm, sub } from '../core/math';
import type { RoadNetwork, RSeg } from '../roads/network';
import { ROAD_TYPES } from '../roads/roadTypes';
import type { Buildings } from '../sim/buildings';
import type { Terrain } from '../world/terrain';
import { ARCHETYPES, PeopleRenderer } from './people';
import type { Communes } from './communes';

export interface Ped {
  h: number;
  arch: number;
  kind: 'walk' | 'loiter' | 'commune' | 'protest' | 'wait';
  action: PersonAction;
  seg: number;
  dir: 1 | -1;
  s: number;
  side: 1 | -1;
  speed: number;
  life: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  phase: number;
  communeId?: number;
  transitStopId?: number;
  targetS?: number;
  label: string;
}

const hippies = () => ARCHETYPES.map((a, i) => (a.hippie ? i : -1)).filter((i) => i >= 0);
const normies = () => ARCHETYPES.map((a, i) => (!a.hippie ? i : -1)).filter((i) => i >= 0);
const merchHeads = () => ARCHETYPES.map((a, i) => (a.merch ? i : -1)).filter((i) => i >= 0);

export class Pedestrians {
  peds: Ped[] = [];
  readonly renderer: PeopleRenderer;
  private hip: number[];
  private norm: number[];
  private merch: number[];
  private spawnT = 0;
  // codex:transit begin - visible riders waiting at registered curb stops
  transitStops?: () => { id: number; seg: number; s: number; side: 1 | -1; label: string; riders: number }[];
  // codex:transit end
  outdoorMul = 1;
  // codex:policies begin -- separate from the weather multiplier reset by Game.frame
  policyOutdoorMul = 1;
  policySmokingAllowedAt?: (x: number, z: number) => boolean;
  // codex:policies end
  /** scales the crowd with the city: nobody walks in a town of 50 */
  population = 0;

  constructor(scene: THREE.Scene, private net: RoadNetwork, private b: Buildings, private terrain: Terrain, private communes: Communes, private max: number) {
    this.renderer = new PeopleRenderer(scene, max);
    this.hip = hippies();
    this.norm = normies();
    this.merch = merchHeads();
    if (!this.hip.length) this.hip = [0];
    if (!this.norm.length) this.norm = [0];
  }

  private archFor(kind: Ped['kind'], brand?: string) {
    if (kind === 'commune' || (kind === 'protest' && Math.random() < 0.8)) return this.hip[Math.floor(Math.random() * this.hip.length)];
    if (brand === 'slop' && this.merch.length && Math.random() < 0.7) return this.merch[Math.floor(Math.random() * this.merch.length)];
    return this.norm[Math.floor(Math.random() * this.norm.length)];
  }

  private add(p: Omit<Ped, 'h'>) {
    const h = this.renderer.add(p.arch, Math.floor(Math.random() * 1e6));
    if (h < 0) return;
    this.peds.push({ ...p, h });
  }

  update(dtReal: number, simSpeed: number, cam: THREE.Vector3, camDist: number, time: number) {
    const near = camDist < 900;
    const R = Math.min(520, camDist * 0.9 + 120);
    // despawn far or expired
    for (let i = this.peds.length - 1; i >= 0; i--) {
      const p = this.peds[i];
      p.life -= dtReal * Math.max(0.5, simSpeed);
      const far = Math.abs(p.x - cam.x) > R * 1.3 || Math.abs(p.z - cam.z) > R * 1.3;
      const communeGone = p.kind === 'commune' && this.communes.list.find((c) => c.id === p.communeId)?.state === 'gone';
      if (p.life <= 0 || far || !near || communeGone || (p.kind !== 'commune' && p.kind !== 'loiter' && !this.net.segs.get(p.seg))) {
        this.renderer.remove(p.h);
        this.peds[i] = this.peds[this.peds.length - 1];
        this.peds.pop();
      }
    }
    if (near) {
      this.spawnT -= dtReal;
      if (this.spawnT <= 0) {
        this.spawnT = 0.08;
        // codex:policies begin -- Ban Bikes visibly reduces ambient walking
        const budget = Math.floor(Math.min(this.max, 12 + this.population * 0.35 + this.communes.list.filter((c) => c.state !== 'gone').length * 6) * clamp(this.outdoorMul * this.policyOutdoorMul, 0.1, 1.2));
        // codex:policies end
        for (let k = 0; k < 4 && this.peds.length < budget; k++) this.trySpawn(cam, R);
      }
    }
    const dt = dtReal * Math.max(0.0001, simSpeed);
    for (const p of this.peds) {
      p.phase += dtReal * (p.kind === 'walk' ? p.speed * 1.6 : 1) * Math.max(0.3, Math.min(simSpeed, 3));
      if (p.kind === 'walk') {
        const seg = this.net.segs.get(p.seg);
        if (!seg) continue;
        p.s += p.speed * dt * p.dir;
        if (p.targetS !== undefined && ((p.dir > 0 && p.s >= p.targetS) || (p.dir < 0 && p.s <= p.targetS))) {
          p.s = p.targetS;
          p.kind = 'wait';
          p.action = Math.random() < 0.55 ? 'phone' : 'idle';
          p.speed = 0;
          p.life = 22 + Math.random() * 30;
          delete p.targetS;
          this.placeOnSidewalk(p);
          this.renderer.set(p.h, p.x, p.y, p.z, p.yaw, p.action, p.phase);
          continue;
        }
        if (p.s < 0 || p.s > seg.length) {
          // hop to a connected segment at the node
          const nodeId = p.s > seg.length ? seg.b : seg.a;
          const node = this.net.nodes.get(nodeId);
          const opts = node ? node.segs.filter((id) => id !== seg.id) : [];
          if (!opts.length) { p.dir = -p.dir as 1 | -1; p.s = clamp(p.s, 0, seg.length); }
          else {
            const nid = opts[Math.floor(Math.random() * opts.length)];
            const ns = this.net.segs.get(nid)!;
            p.seg = nid;
            p.dir = ns.a === nodeId ? 1 : -1;
            p.s = p.dir > 0 ? 0.5 : ns.length - 0.5;
          }
        }
        this.placeOnSidewalk(p);
      } else if (p.kind === 'protest') {
        const seg = this.net.segs.get(p.seg);
        if (!seg || seg.blocked <= 0) { p.life = 0; continue; }
      }
      this.renderer.set(p.h, p.x, p.y, p.z, p.yaw, p.action, p.phase);
    }
    this.renderer.flush();
  }

  private placeOnSidewalk(p: Ped) {
    const seg = this.net.segs.get(p.seg)!;
    const t = ROAD_TYPES[seg.type];
    const { i, f } = locate(seg.samp, clamp(p.s, 0, seg.length));
    const a = seg.samp.pts[i], b = seg.samp.pts[i + 1];
    const tan = norm(sub(b, a));
    const r = { x: -tan.z, z: tan.x };
    const off = t.sidewalk > 0 ? t.width / 2 - t.sidewalk / 2 : t.width / 2 + 1.3; // no sidewalk: walk in the grass
    p.x = lerp(a.x, b.x, f) + r.x * off * p.side;
    p.z = lerp(a.z, b.z, f) + r.z * off * p.side;
    p.y = t.sidewalk > 0 ? lerp(seg.hs[i], seg.hs[i + 1], f) + 0.08 : this.terrain.h(p.x, p.z);
    p.yaw = Math.atan2(tan.x * p.dir, tan.z * p.dir);
  }

  private trySpawn(cam: THREE.Vector3, R: number) {
    const r = Math.random();
    // codex:transit begin - turn simulated boardings into small visible waiting crowds
    if (r < 0.16 && this.transitStops) {
      const atStop = new Map<number, number>();
      for (const p of this.peds) if (p.transitStopId !== undefined) atStop.set(p.transitStopId, (atStop.get(p.transitStopId) ?? 0) + 1);
      const stops = this.transitStops().filter((s) => {
        const seg = this.net.segs.get(s.seg);
        if (!seg) return false;
        const p = seg.samp.pts[Math.min(seg.samp.pts.length - 1, Math.round((s.s / seg.length) * (seg.samp.pts.length - 1)))];
        return Math.abs(p.x - cam.x) < R && Math.abs(p.z - cam.z) < R && (atStop.get(s.id) ?? 0) < Math.min(8, Math.ceil(s.riders / 8));
      });
      const stop = stops[Math.floor(Math.random() * stops.length)];
      const seg = stop && this.net.segs.get(stop.seg);
      if (stop && seg) {
        const approach = 18 + Math.random() * 34;
        const dir: 1 | -1 = stop.s > seg.length / 2 ? -1 : 1;
        const startS = clamp(stop.s - approach * dir, 0, seg.length);
        const p: Omit<Ped, 'h'> = { arch: this.archFor('wait'), kind: 'walk', action: 'walk', seg: stop.seg, dir, s: startS, side: stop.side, speed: 1.05 + Math.random() * 0.35, life: 65, x: 0, y: 0, z: 0, yaw: 0, phase: Math.random() * 10, label: stop.label, transitStopId: stop.id, targetS: stop.s };
        this.add(p);
        const last = this.peds[this.peds.length - 1];
        if (last) this.placeOnSidewalk(last);
        return;
      }
    }
    // codex:transit end
    // commune folks
    if (r < 0.2) {
      const c = this.communes.list.find((c) => c.state !== 'gone' && Math.abs(c.x - cam.x) < R && Math.abs(c.z - cam.z) < R && this.peds.filter((p) => p.communeId === c.id).length < Math.min(24, c.members));
      if (c) {
        const a = Math.random() * Math.PI * 2, d = Math.random() * c.r * 0.7;
        const x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d;
        const acts: PersonAction[] = ['drum', 'dance', 'yoga', 'smoke', 'idle', 'dance', 'drum', 'sit'];
        // codex:policies begin -- smoke-free districts suppress visible smoking actions
        let action = acts[Math.floor(Math.random() * acts.length)];
        if (action === 'smoke' && this.policySmokingAllowedAt?.(x, z) === false) action = 'idle';
        // codex:policies end
        this.add({ arch: this.archFor('commune'), kind: 'commune', action, seg: 0, dir: 1, s: 0, side: 1, speed: 0, life: 60 + Math.random() * 90, x, y: this.terrain.h(x, z), z, yaw: Math.atan2(c.x + 8 - x, c.z - 4 - z), phase: Math.random() * 10, communeId: c.id, label: c.name });
        return;
      }
    }
    // protesters on blocked segments
    if (r < 0.32) {
      for (const seg of this.net.segsNear(cam.x - R, cam.z - R, cam.x + R, cam.z + R)) {
        if (seg.blocked <= 0 || !seg.name.startsWith('')) continue;
        const protestors = this.peds.filter((p) => p.kind === 'protest' && p.seg === seg.id).length;
        if (protestors > 14) continue;
        const { i, f } = locate(seg.samp, seg.length / 2 + (Math.random() - 0.5) * 16);
        const a = seg.samp.pts[i], b = seg.samp.pts[i + 1];
        const tan = norm(sub(b, a));
        const w = (Math.random() - 0.5) * ROAD_TYPES[seg.type].width * 0.8;
        const x = lerp(a.x, b.x, f) - tan.z * w, z = lerp(a.z, b.z, f) + tan.x * w;
        this.add({ arch: this.archFor('protest'), kind: 'protest', action: 'protest', seg: seg.id, dir: 1, s: 0, side: 1, speed: 0, life: 200, x, y: lerp(seg.hs[i], seg.hs[i + 1], f) + 0.1, z, yaw: Math.atan2(tan.x, tan.z) + (Math.random() < 0.5 ? 0 : Math.PI), phase: Math.random() * 10, label: 'Protester' });
        return;
      }
    }
    // loiterers outside businesses
    if (r < 0.55) {
      const list = this.b.near(cam.x, cam.z, R).filter((b) => b.state === 'active' && (b.zone === 'comLow' || b.zone === 'comHigh' || b.zone === 'office' || b.zone === 'resHigh'));
      if (list.length) {
        const bld = list[Math.floor(Math.random() * list.length)];
        const c = Math.cos(bld.yaw), s = Math.sin(bld.yaw);
        const lx = (Math.random() - 0.5) * bld.hw * 1.6, lz = bld.hd - 2 - Math.random() * 3;
        const x = bld.x + lx * c + lz * s, z = bld.z - lx * s + lz * c;
        const arch = this.archFor('loiter', bld.brand);
        // codex:policies begin -- smoke-free districts remove smoke/vape loiter actions
        let vices = ARCHETYPES[arch]?.vices?.length ? [...ARCHETYPES[arch].vices] : (['smoke', 'phone', 'drink', 'vape'] as PersonAction[]);
        if (this.policySmokingAllowedAt?.(x, z) === false) vices = vices.filter((a) => a !== 'smoke' && a !== 'vape');
        if (!vices.length) vices = ['phone'];
        // codex:policies end
        this.add({ arch, kind: 'loiter', action: vices[Math.floor(Math.random() * vices.length)], seg: 0, dir: 1, s: 0, side: 1, speed: 0, life: 25 + Math.random() * 40, x, y: bld.y + 0.05, z, yaw: bld.yaw + (Math.random() - 0.5) * 1.5, phase: Math.random() * 10, label: bld.label });
        return;
      }
    }
    // sidewalk walkers
    const segs = this.net.segsNear(cam.x - R, cam.z - R, cam.x + R, cam.z + R);
    if (!segs.length) return;
    const seg: RSeg = segs[Math.floor(Math.random() * segs.length)];
    if (seg.type === 'highway') return;
    const p: Omit<Ped, 'h'> = { arch: this.archFor('walk'), kind: 'walk', action: Math.random() < 0.1 ? 'run' : 'walk', seg: seg.id, dir: Math.random() < 0.5 ? 1 : -1, s: Math.random() * seg.length, side: Math.random() < 0.5 ? 1 : -1, speed: 1.1 + Math.random() * 0.6, life: 40 + Math.random() * 60, x: 0, y: 0, z: 0, yaw: 0, phase: Math.random() * 10, label: seg.name };
    if (p.action === 'run') p.speed = 3;
    this.add(p);
    const last = this.peds[this.peds.length - 1];
    if (last) this.placeOnSidewalk(last);
  }

  pick(ray: THREE.Raycaster): Ped | null {
    const h = this.renderer.pick(ray);
    if (h === null) return null;
    return this.peds.find((p) => p.h === h) ?? null;
  }

  setNight(n: number) {
    this.renderer.setNight(n);
  }
}
