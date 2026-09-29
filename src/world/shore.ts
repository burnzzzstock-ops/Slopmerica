// Reeds and stones along the water's edge (docs/GRAPHICS_HANDOFF.md, item 6). GRAPHICS ONLY: nothing here is read by the
// simulation, the terrain heights are not touched, and nothing draws a random number from the game's generators (every
// choice below is a hash of the ground position, so the same bank looks the same on every preset and every visit).
//
// A bank used to be a bare grey or white strip ending in a ruler-straight waterline. Two instanced meshes (two draw calls
// for the whole map, however long the shore) break it up:
//   - reed clumps (rushes, sedge, cordgrass, sawgrass) standing in the shallows and on the wet margin, in patches, denser
//     and taller on the Florida marsh;
//   - stones (cobbles and a few boulders) in bands along the waterline, on the steeper and rockier banks.
// Both are placed from the terrain alone, by the height above the water level and the slope: on a gentle bank (1:50 to
// 1:8: 28% of the sampled waterline on Florida, none on Appalachia, whose banks are 1:8 or steeper) the band where a reed
// or stone can stand is ten metres wide; on the steep ones (most of the shore on all three maps) it is a strip a metre or
// two wide at the foot of the bank, and it gets them too. They are streamed around the camera like the trees (a preset draws the ones within its own
// range, a share of them by its tree density), built lazily one 64 m cell at a time (nothing at load), and rebuilt for the
// cells a road, a lot or terraforming reshapes.
import * as THREE from 'three';
import { HALF, HM_N, HM_STEP, Quality, WATER, WORLD } from '../config';
import { hash2 } from '../core/rng';
import type { MapData, MapId } from './maps';
import type { Terrain } from './terrain';
import { bindAtmos, CLOUD_GLSL, cloudShadowChunk } from './atmos';
import type { SeasonLook } from './seasons';

const CELL = 64;
const GN = Math.ceil(WORLD / CELL);
const CQ = CELL / HM_STEP; // height samples per cell side
const REED_STRIDE = 8; // x, y, z, scale, rotation, tone, weight, width
const ROCK_STRIDE = 10; // x, y, z, sx, sy, sz, rotation, tone, weight, tilt

function smooth(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
/** smooth value noise in [0, 1] */
function vnoise(x: number, z: number, cell: number, salt: number): number {
  const fx = x / cell, fz = z / cell, ix = Math.floor(fx), iz = Math.floor(fz);
  const tx = fx - ix, tz = fz - iz, sx = tx * tx * (3 - 2 * tx), sz = tz * tz * (3 - 2 * tz);
  const a = hash2(ix, iz, salt), b = hash2(ix + 1, iz, salt), c = hash2(ix, iz + 1, salt), d = hash2(ix + 1, iz + 1, salt);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

interface Bin { reed: number[]; rock: number[]; built: boolean }

/** what grows and lies on each map's banks */
interface Look {
  /** share of the emergent zone (the shallows and the wet margin) that reeds take, 0 to 1 */
  reeds: number;
  /** patch noise thresholds: below the low one no reeds, above the high one a full bed */
  patch: [number, number];
  /** clump height range, metres (the clump model is 1 m tall) */
  size: [number, number];
  /** height above the waterline the reeds reach on the dry side, metres */
  reach: number;
  /** stones: chance in a band, and the size scale */
  rocks: number;
  rockSize: number;
  /** stone albedo (linear rgb), mixed with the map's own rock colour */
  stone: [number, number, number];
}
const LOOKS: Record<MapId, Look> = {
  appalachia: { reeds: 0.95, patch: [0.4, 0.66], size: [0.9, 1.6], reach: 0.5, rocks: 1, rockSize: 1, stone: [0.14, 0.12, 0.10] },
  norcal: { reeds: 0.8, patch: [0.46, 0.7], size: [0.8, 1.45], reach: 0.42, rocks: 0.9, rockSize: 1, stone: [0.105, 0.09, 0.075] },
  florida: { reeds: 1, patch: [0.32, 0.56], size: [1.1, 2.0], reach: 0.6, rocks: 0.22, rockSize: 0.7, stone: [0.36, 0.32, 0.25] },
};

// ---------------------------------------------------------------------------------------------------- the two models
/** a reed clump, 1 m tall: nine tapering blades leaning outward from the middle, in three segments (27 triangles) */
function reedGeometry(): THREE.BufferGeometry {
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const blades = 9;
  for (let k = 0; k < blades; k++) {
    const a = k * 2.399 + 0.4;
    const r = 0.04 + 0.16 * hash2(k, 3, 71);
    const bx = Math.cos(a) * r, bz = Math.sin(a) * r;
    const h = 0.72 + 0.28 * hash2(k, 5, 72);
    const lean = 0.16 + 0.34 * hash2(k, 7, 73);
    const la = a + (hash2(k, 9, 74) - 0.5) * 1.2;
    const lx = Math.cos(la), lz = Math.sin(la);
    // the flat of the blade faces along its lean, so a blade seen from the side is narrow and from the front wide
    const wx = -lz, wz = lx;
    const w0 = 0.04 + 0.022 * hash2(k, 11, 75);
    const base = pos.length / 3;
    const rows: [number, number, number][] = [[0, w0, 0.42], [0.5, w0 * 0.72, 0.72], [1, 0, 1.0]];
    for (const [t, w, shade] of rows) {
      // a blade bends over as it rises: the lean grows with the square of the height
      const off = lean * t * t * h;
      const cx = bx + lx * off, cz = bz + lz * off, cy = t * h;
      if (w > 0) {
        pos.push(cx - wx * w, cy, cz - wz * w, cx + wx * w, cy, cz + wz * w);
        for (let s = 0; s < 2; s++) col.push(shade * 0.92, shade * 1.0, shade * 0.8);
      } else {
        pos.push(cx, cy, cz);
        col.push(shade * 1.0, shade * 1.0, shade * 0.86);
      }
    }
    idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2, base + 2, base + 3, base + 4);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // blades are flat: lighting them by their own (view-flipped) normal makes each one flicker from light to dark as the
  // camera moves; a normal pointing mostly up, tilted a little outward, reads as a tuft
  const nor = g.getAttribute('normal') as THREE.BufferAttribute;
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < nor.count; i++) {
    const x = p.getX(i), z = p.getZ(i), l = Math.hypot(x, z) || 1;
    nor.setXYZ(i, (x / l) * 0.35, 0.94, (z / l) * 0.35);
  }
  return g;
}

/** a stone: a rounded lump (icosahedron, detail 1, every vertex moved by a hash of where it is, so shared corners stay shared) */
function rockGeometry(): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const col: number[] = [];
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = (v: number) => Math.round(v * 200);
    const s = 0.78 + 0.4 * hash2(k(x) * 131 + k(y) * 7, k(z), 91);
    x *= s; y *= s; z *= s;
    p.setXYZ(i, x, y, z);
    // darker on the wet underside, lighter on top
    const t = 0.6 + 0.4 * smooth(-0.9, 0.8, y);
    col.push(t, t, t);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------------------------------------- the shore
export class Shore {
  readonly group = new THREE.Group();
  private bins: (Bin | null)[] = new Array(GN * GN).fill(null);
  private reeds: THREE.InstancedMesh;
  private rocks: THREE.InstancedMesh;
  private reedCap: number;
  private rockCap: number;
  private look: Look;
  private range: number;
  private density: number;
  private uTime = { value: 0 };
  private lastFocus = new THREE.Vector3(1e9, 0, 1e9);
  private lastR = 0;
  private dirty = true;
  private tint = { r: 0.3, g: 0.42, b: 0.16 };
  private tintKey = '';
  private mapId: MapId;

  constructor(private terrain: Terrain, map: MapData, q: Quality) {
    this.mapId = map.def.id;
    this.look = LOOKS[this.mapId];
    // the ranges and shares follow the tree presets: a phone on Low keeps a short strip of shore around the camera
    this.range = q.treeNear * 0.42;
    this.density = Math.min(1, q.treeDensity / 1.15);
    this.reedCap = Math.round(q.treeNearCap * 0.12);
    this.rockCap = Math.round(q.treeNearCap * 0.07);

    const reedMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    reedMat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.uTime;
      bindAtmos(sh);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime, uWind;\nvarying vec3 vSWPos;\nvarying float vSTip;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
vSTip = clamp(position.y, 0.0, 1.0);
#ifdef USE_INSTANCING
{
  // a slow sway that grows with the height, out of step from clump to clump
  vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
  float sw = sin(uTime * (1.5 + uWind * 0.5) + ip.x * 0.9 + ip.z * 0.7) + 0.5 * sin(uTime * 3.3 + ip.z * 1.7);
  transformed.x += sw * 0.045 * uWind * vSTip * vSTip;
  transformed.z += sw * 0.03 * uWind * vSTip * vSTip;
}
#endif`)
        .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
{
  vec4 swp = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
  swp = instanceMatrix * swp;
#endif
  vSWPos = (modelMatrix * swp).xyz;
}`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>\nuniform float uSnow, uSnowLine;\nvarying vec3 vSWPos;\nvarying float vSTip;\n${CLOUD_GLSL}`)
        .replace('#include <color_fragment>', `#include <color_fragment>
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.88, 0.93), uSnow * 0.5 * vSTip * smoothstep(uSnowLine - 30.0, uSnowLine + 60.0, vSWPos.y));`)
        .replace('#include <lights_fragment_end>', cloudShadowChunk('vSWPos'))
        // a blade is lit by its own upward-tilted normal from both sides (a back face would flip it and go black)
        .replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''));
    };
    this.reeds = new THREE.InstancedMesh(reedGeometry(), reedMat, this.reedCap);
    const rockMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    rockMat.onBeforeCompile = (sh) => {
      bindAtmos(sh);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vSWPos;')
        .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
{
  vec4 swp = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
  swp = instanceMatrix * swp;
#endif
  vSWPos = (modelMatrix * swp).xyz;
}`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>\nuniform float uSnow, uSnowLine;\nvarying vec3 vSWPos;\n${CLOUD_GLSL}`)
        .replace('#include <color_fragment>', `#include <color_fragment>
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.88, 0.9, 0.95), uSnow * 0.45 * smoothstep(uSnowLine - 30.0, uSnowLine + 60.0, vSWPos.y));`)
        .replace('#include <lights_fragment_end>', cloudShadowChunk('vSWPos'));
    };
    this.rocks = new THREE.InstancedMesh(rockGeometry(), rockMat, this.rockCap);
    for (const im of [this.reeds, this.rocks]) {
      im.count = 0;
      im.frustumCulled = false;
      im.receiveShadow = true;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.setColorAt(0, new THREE.Color());
      (im.instanceColor as THREE.InstancedBufferAttribute).setUsage(THREE.DynamicDrawUsage);
      this.group.add(im);
    }
  }

  // ------------------------------------------------------------------------------------------------------ placement
  private bin(ci: number, cj: number): Bin {
    const k = cj * GN + ci;
    return (this.bins[k] ??= this.build(ci, cj));
  }

  /** Every reed clump and stone of one 64 m cell, from the ground alone. Candidates sit on a 1 m lattice (one per lattice cell, moved by a hash). */
  private build(ci: number, cj: number): Bin {
    const bin: Bin = { reed: [], rock: [], built: true };
    const T = this.terrain, H = T.heights, L = this.look;
    const i0 = ci * CQ, j0 = cj * CQ, i1 = Math.min(HM_N - 1, i0 + CQ), j1 = Math.min(HM_N - 1, j0 + CQ);
    // any water within reach of this cell at all?
    let wet = false;
    const P = 4;
    for (let j = Math.max(0, j0 - P); j <= Math.min(HM_N - 1, j1 + P) && !wet; j++)
      for (let i = Math.max(0, i0 - P); i <= Math.min(HM_N - 1, i1 + P); i++) if (H[j * HM_N + i] < WATER - 0.05) { wet = true; break; }
    if (!wet) return bin;
    const sand = T.map.sand;
    const seed = this.mapId === 'appalachia' ? 5 : this.mapId === 'norcal' ? 17 : 29;
    for (let j = j0; j < j1; j++)
      for (let i = i0; i < i1; i++) {
        const c = j * HM_N + i;
        // the four corners of this height cell: is the waterline within a short walk of it (the reed zone is +-0.6 m of height)?
        const lo = Math.min(H[c], H[c + 1], H[c + HM_N], H[c + HM_N + 1]), hi = Math.max(H[c], H[c + 1], H[c + HM_N], H[c + HM_N + 1]);
        if (hi < WATER - 0.55 || lo > WATER + 0.9) continue;
        let near = lo < WATER - 0.05;
        for (let dj = -3; dj <= 3 && !near; dj++) {
          const jj = j + dj;
          if (jj < 0 || jj >= HM_N) continue;
          for (let di = -3; di <= 3; di++) {
            const ii = i + di;
            if (ii < 0 || ii >= HM_N) continue;
            if (H[jj * HM_N + ii] < WATER - 0.05) { near = true; break; }
          }
        }
        if (!near) continue;
        // this height cell holds the 1 m lattice cells a = 4i - 3072 + {0, 1, 2, 3}, b likewise
        for (let sb = 0; sb < 4; sb++)
          for (let sa = 0; sa < 4; sa++) {
            const a = 4 * i - HALF + sa, b = 4 * j - HALF + sb;
            const x = a + hash2(a, b, seed + 1), z = b + hash2(a, b, seed + 2);
            const h = T.h(x, z);
            if (h < WATER - 0.5 || h > WATER + 0.9) continue;
            if (T.roadMask[c] || T.paint[c] !== 0 /* Paint.None */) continue;
            const gx = T.h(x + 1.5, z) - T.h(x - 1.5, z), gz = T.h(x, z + 1.5) - T.h(x, z - 1.5);
            const sl = Math.hypot(gx, gz) / 3;
            const bch = sand ? sand(x, z) : 0;
            const roll = hash2(a, b, seed + 3);
            // ------ stones: a band along the waterline, on the steeper and rockier ground
            const zoneR = smooth(-0.32, -0.06, h) * (1 - smooth(0.3, 0.85, h));
            if (zoneR > 0.01 && L.rocks > 0) {
              const nb = vnoise(x, z, 19, seed + 8) * 0.7 + vnoise(x, z, 6, seed + 9) * 0.3;
              const band = smooth(0.5, 0.74, nb);
              const steep = smooth(0.04, 0.2, sl);
              const p = zoneR * (band * (0.3 + 0.7 * steep) + 0.05 * steep) * (1 - 0.92 * bch) * L.rocks;
              if (roll < p * 0.32) {
                const n = 1 + (hash2(a, b, seed + 4) < 0.55 ? 1 : 0) + (hash2(a, b, seed + 5) < 0.3 ? 1 : 0);
                for (let r = 0; r < n; r++) {
                  const q = hash2(a, b + r * 977, seed + 6);
                  const size = (0.16 + 0.75 * q * q * q + 0.12 * hash2(a + r, b, seed + 7)) * L.rockSize;
                  const rx = x + (r ? (hash2(a, b, seed + 10 + r) - 0.5) * 1.6 : 0), rz = z + (r ? (hash2(a, b, seed + 12 + r) - 0.5) * 1.6 : 0);
                  const flat = 0.5 + 0.25 * hash2(a, b + r, seed + 14);
                  const ry = T.h(rx, rz);
                  bin.rock.push(rx, ry - size * flat * 0.35, rz, size * (0.9 + 0.5 * hash2(a, b, seed + 15 + r)), size * flat, size * (0.8 + 0.5 * hash2(a, b, seed + 17 + r)),
                    hash2(a, b, seed + 19 + r) * 6.283, hash2(a, b, seed + 21 + r), hash2(a, b + r, seed + 23), (hash2(a, b, seed + 25 + r) - 0.5) * 0.5);
                }
                continue;
              }
            }
            // ------ reeds: in patches, standing in the shallows and on the wet margin, not on beaches, steep banks or paving
            // (on a steep bank the strip a reed can stand in is a metre or two wide, so it is let climb a little higher)
            const reach = L.reach + 0.55 * smooth(0.12, 0.5, sl);
            const zoneE = smooth(-0.4, -0.1, h) * (1 - smooth(0.12, reach + 0.1, h));
            if (zoneE > 0.01) {
              const nb = vnoise(x, z, 23, seed + 30) * 0.65 + vnoise(x, z, 7, seed + 31) * 0.35;
              const patch = smooth(L.patch[0], L.patch[1], nb);
              const slopeF = 1 - 0.92 * smooth(0.3, 1.1, sl);
              const p = zoneE * patch * slopeF * (1 - 0.85 * bch) * L.reeds;
              if (roll < p * 0.36) {
                const size = L.size[0] + (L.size[1] - L.size[0]) * hash2(a, b, seed + 32);
                const ny = h - 0.06;
                bin.reed.push(x, ny, z, size, hash2(a, b, seed + 33) * 6.283, hash2(a, b, seed + 34), hash2(a, b, seed + 35), 1.0 + 0.5 * hash2(a, b, seed + 36));
                // most clumps have a neighbour close by: beds, not single tufts
                if (hash2(a, b, seed + 37) < 0.7) {
                  const ang = hash2(a, b, seed + 38) * 6.283, d = 0.5 + 0.7 * hash2(a, b, seed + 39);
                  const x2 = x + Math.cos(ang) * d, z2 = z + Math.sin(ang) * d, h2 = T.h(x2, z2);
                  if (h2 > WATER - 0.5 && h2 < WATER + reach + 0.2)
                    bin.reed.push(x2, h2 - 0.06, z2, size * (0.7 + 0.4 * hash2(a, b, seed + 40)), hash2(a, b, seed + 41) * 6.283, hash2(a, b, seed + 42), hash2(a, b, seed + 43), 0.95 + 0.5 * hash2(a, b, seed + 44));
                }
              }
            }
          }
      }
    return bin;
  }

  // ----------------------------------------------------------------------------------------- the hooks Trees forwards
  /** Colours for the season: green in summer, straw in autumn and in a dry season, tan through the winter. */
  setSeason(look: SeasonLook, day: number) {
    const key = `${this.mapId}:${look.fall.toFixed(2)}:${look.dormant.toFixed(2)}:${look.dry.toFixed(2)}:${look.fresh.toFixed(2)}`;
    if (key === this.tintKey) return;
    this.tintKey = key;
    void day;
    const green = new THREE.Color(this.mapId === 'florida' ? 0x53672a : 0x3e5a20), fresh = new THREE.Color(0x587a26);
    const straw = new THREE.Color(0x957835), tan = new THREE.Color(0x85704a);
    const c = green.clone().lerp(fresh, Math.min(1, look.fresh * 0.6));
    c.lerp(straw, Math.min(1, Math.max(look.fall, look.dry * (this.mapId === 'norcal' ? 0.3 : 0.5)) * 0.9));
    c.lerp(tan, Math.min(1, look.dormant * 0.85));
    this.tint = { r: c.r, g: c.g, b: c.b };
    this.dirty = true;
  }

  /** Reeds and stones inside the predicate go (a road, a lot). They stay gone until the cell is rebuilt by a reshape. */
  cut(minX: number, minZ: number, maxX: number, maxZ: number, inside: (x: number, z: number) => boolean) {
    const c0 = Math.max(0, Math.floor((minX + HALF) / CELL)), c1 = Math.min(GN - 1, Math.floor((maxX + HALF) / CELL));
    const r0 = Math.max(0, Math.floor((minZ + HALF) / CELL)), r1 = Math.min(GN - 1, Math.floor((maxZ + HALF) / CELL));
    let any = false;
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        const bin = this.bins[r * GN + c];
        if (!bin) continue;
        for (const [arr, stride] of [[bin.reed, REED_STRIDE], [bin.rock, ROCK_STRIDE]] as const) {
          let w = 0;
          for (let k = 0; k < arr.length; k += stride) {
            if (arr[k] >= minX && arr[k] <= maxX && arr[k + 2] >= minZ && arr[k + 2] <= maxZ && inside(arr[k], arr[k + 2])) { any = true; continue; }
            if (w !== k) for (let s = 0; s < stride; s++) arr[w + s] = arr[k + s];
            w += stride;
          }
          arr.length = w;
        }
      }
    if (any) this.dirty = true;
  }

  /** The ground in this box changed (a road's grading, terraforming): the cells around it are built again from the new ground. */
  resettle(minX: number, minZ: number, maxX: number, maxZ: number) {
    const pad = 8;
    const c0 = Math.max(0, Math.floor((minX - pad + HALF) / CELL)), c1 = Math.min(GN - 1, Math.floor((maxX + pad + HALF) / CELL));
    const r0 = Math.max(0, Math.floor((minZ - pad + HALF) / CELL)), r1 = Math.min(GN - 1, Math.floor((maxZ + pad + HALF) / CELL));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) this.bins[r * GN + c] = null;
    this.dirty = true;
  }

  // ------------------------------------------------------------------------------------------------------ streaming
  update(time: number, focus: THREE.Vector3, camDist: number) {
    this.uTime.value = time;
    // the camera hangs camDist from the focus, so the strip has to reach that far and a bit past it
    const R = Math.min(this.range, Math.max(90, camDist * 1.15 + 60));
    const moved = Math.hypot(focus.x - this.lastFocus.x, focus.z - this.lastFocus.z);
    if (!this.dirty && moved < R * 0.15 && Math.abs(R - this.lastR) < this.lastR * 0.2) return;
    this.dirty = false;
    this.lastFocus.copy(focus);
    this.lastR = R;
    const c0 = Math.max(0, Math.floor((focus.x - R + HALF) / CELL)), c1 = Math.min(GN - 1, Math.floor((focus.x + R + HALF) / CELL));
    const r0 = Math.max(0, Math.floor((focus.z - R + HALF) / CELL)), r1 = Math.min(GN - 1, Math.floor((focus.z + R + HALF) / CELL));
    // nearest cells first: when the batch fills it is the far ones that go without
    const order: number[] = [];
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) order.push(r * GN + c);
    const cx = (k: number) => (k % GN) * CELL - HALF + CELL / 2, cz = (k: number) => Math.floor(k / GN) * CELL - HALF + CELL / 2;
    order.sort((p, q) => Math.hypot(cx(p) - focus.x, cz(p) - focus.z) - Math.hypot(cx(q) - focus.x, cz(q) - focus.z));
    const dens = this.density, R2 = R * R;
    const mR = this.reeds.instanceMatrix.array as Float32Array, cR = (this.reeds.instanceColor as THREE.InstancedBufferAttribute).array as Float32Array;
    const mK = this.rocks.instanceMatrix.array as Float32Array, cK = (this.rocks.instanceColor as THREE.InstancedBufferAttribute).array as Float32Array;
    const st = this.terrain.map.def.palette.rock;
    const base = new THREE.Color(st);
    const L = this.look;
    let nR = 0, nK = 0;
    const t = this.tint;
    for (const k of order) {
      const bin = this.bin(k % GN, Math.floor(k / GN));
      const rd = bin.reed, rk = bin.rock;
      for (let p = 0; p < rd.length && nR < this.reedCap; p += REED_STRIDE) {
        const w = rd[p + 6];
        if (w > dens) continue;
        const dx = rd[p] - focus.x, dz = rd[p + 2] - focus.z;
        // each clump gives out at its own distance, so the strip's end is ragged and not a ring
        if (dx * dx + dz * dz > R2 * (0.6 + 0.4 * ((w * 13.7) % 1)) ** 2) continue;
        const s = rd[p + 3], wd = rd[p + 7], rot = rd[p + 4], cs = Math.cos(rot), sn = Math.sin(rot);
        const o = nR * 16;
        mR[o] = cs * s * wd; mR[o + 1] = 0; mR[o + 2] = -sn * s * wd; mR[o + 3] = 0;
        mR[o + 4] = 0; mR[o + 5] = s; mR[o + 6] = 0; mR[o + 7] = 0;
        mR[o + 8] = sn * s * wd; mR[o + 9] = 0; mR[o + 10] = cs * s * wd; mR[o + 11] = 0;
        mR[o + 12] = rd[p]; mR[o + 13] = rd[p + 1]; mR[o + 14] = rd[p + 2]; mR[o + 15] = 1;
        const tone = 0.8 + 0.4 * rd[p + 5];
        cR[nR * 3] = t.r * tone; cR[nR * 3 + 1] = t.g * tone; cR[nR * 3 + 2] = t.b * (0.9 + 0.2 * rd[p + 5]) * tone;
        nR++;
      }
      for (let p = 0; p < rk.length && nK < this.rockCap; p += ROCK_STRIDE) {
        const w = rk[p + 8];
        if (w > dens) continue;
        const dx = rk[p] - focus.x, dz = rk[p + 2] - focus.z;
        if (dx * dx + dz * dz > R2 * (0.6 + 0.4 * ((w * 11.3) % 1)) ** 2) continue;
        const sx = rk[p + 3], sy = rk[p + 4], sz = rk[p + 5], rot = rk[p + 6], tl = rk[p + 9];
        const cs = Math.cos(rot), sn = Math.sin(rot), ct = Math.cos(tl), st2 = Math.sin(tl);
        // Ry(rot) * Rz(tilt) * S
        const o = nK * 16;
        mK[o] = cs * ct * sx; mK[o + 1] = st2 * sx; mK[o + 2] = -sn * ct * sx; mK[o + 3] = 0;
        mK[o + 4] = -cs * st2 * sy; mK[o + 5] = ct * sy; mK[o + 6] = sn * st2 * sy; mK[o + 7] = 0;
        mK[o + 8] = sn * sz; mK[o + 9] = 0; mK[o + 10] = cs * sz; mK[o + 11] = 0;
        mK[o + 12] = rk[p]; mK[o + 13] = rk[p + 1] + sy * 0.4; mK[o + 14] = rk[p + 2]; mK[o + 15] = 1;
        const tone = 0.75 + 0.5 * rk[p + 7];
        // the map's rock palette, pulled toward this map's stone tone
        cK[nK * 3] = (base.r * 0.15 + L.stone[0] * 0.85) * tone; cK[nK * 3 + 1] = (base.g * 0.15 + L.stone[1] * 0.85) * tone; cK[nK * 3 + 2] = (base.b * 0.15 + L.stone[2] * 0.85) * tone;
        nK++;
      }
    }
    this.reeds.count = nR;
    this.rocks.count = nK;
    this.reeds.instanceMatrix.needsUpdate = true;
    this.rocks.instanceMatrix.needsUpdate = true;
    (this.reeds.instanceColor as THREE.InstancedBufferAttribute).needsUpdate = true;
    (this.rocks.instanceColor as THREE.InstancedBufferAttribute).needsUpdate = true;
    this.reeds.visible = nR > 0;
    this.rocks.visible = nK > 0;
  }

  /** every reed clump and stone within r of a point, drawn or not (for the tests) */
  countNear(x: number, z: number, r: number) {
    let reeds = 0, rocks = 0;
    const c0 = Math.max(0, Math.floor((x - r + HALF) / CELL)), c1 = Math.min(GN - 1, Math.floor((x + r + HALF) / CELL));
    const r0 = Math.max(0, Math.floor((z - r + HALF) / CELL)), r1 = Math.min(GN - 1, Math.floor((z + r + HALF) / CELL));
    for (let j = r0; j <= r1; j++)
      for (let i = c0; i <= c1; i++) {
        const b = this.bin(i, j);
        for (let k = 0; k < b.reed.length; k += REED_STRIDE) if ((b.reed[k] - x) ** 2 + (b.reed[k + 2] - z) ** 2 < r * r) reeds++;
        for (let k = 0; k < b.rock.length; k += ROCK_STRIDE) if ((b.rock[k] - x) ** 2 + (b.rock[k + 2] - z) ** 2 < r * r) rocks++;
      }
    return { reeds, rocks };
  }

  /** what is drawn now (for the tests) */
  get drawn() { return { reeds: this.reeds.count, rocks: this.rocks.count }; }
}
