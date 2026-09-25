// City service buildings (power, water, sewage, garbage, fire, police, health,
// education, parks), built with the same Kit + facade atlas as everything else
// so they batch into the shared building mesh. Front (+Z) faces the road.
import type { BuildingModel } from '../contracts';
import { T } from './atlas';
import { col, Kit, type Col } from './kit';
import { registerSigns } from './signRegistry';

registerSigns(
  { id: 'svc:coal', text: 'CLEAN COAL™', colors: ['#1b1b1d', '#f5f5f0'], font: 'Anton' },
  { id: 'svc:frack', text: 'FRACK YEAH GAS', colors: ['#f2a900', '#111111'], font: 'Bungee' },
  { id: 'svc:solar', text: 'FREEDOM SOLAR', colors: ['#1d3a8a', '#ffd23f'], font: 'Bungee' },
  { id: 'svc:nuke', text: 'THREE MILE ISLAND JR', colors: ['#ffd400', '#111111'], font: 'Anton' },
  { id: 'svc:water', text: 'ARTESIAN TAP', colors: ['#0b4f8a', '#e8f6ff'], font: 'Overpass' },
  { id: 'svc:boil', text: 'BOIL NOTICE PENDING', colors: ['#ffffff', '#1d3a8a'], font: 'Anton' },
  { id: 'svc:poop', text: 'POOP PALACE', colors: ['#5a3a1a', '#ffe7b0'], font: 'Titan One' },
  { id: 'svc:trash', text: 'MT. TRASHMORE', colors: ['#2f6b3a', '#f2eee2'], font: 'Bungee' },
  { id: 'svc:burn', text: 'WE BURN IT ALL', colors: ['#111111', '#ff6a00'], font: 'Bungee' },
  { id: 'svc:fire', text: 'VOLUNTEER FIRE DEPT', colors: ['#b3151d', '#ffffff'], font: 'Anton' },
  { id: 'svc:sheriff', text: 'SHERIFF', colors: ['#1a2233', '#e8c15a'], font: 'Anton' },
  { id: 'svc:qi', text: 'QUALIFIED IMMUNITY INCLUDED', colors: ['#e8c15a', '#1a2233'], font: 'Overpass' },
  { id: 'svc:urgent', text: 'URGENT CARE', colors: ['#ffffff', '#c8102e'], font: 'Anton' },
  { id: 'svc:oon', text: 'OUT OF NETWORK', colors: ['#c8102e', '#ffffff'], font: 'Overpass' },
  { id: 'svc:hospital', text: "ST. DEDUCTIBLE'S", colors: ['#0b3d6b', '#ffffff'], font: 'Anton' },
  { id: 'svc:er', text: 'EMERGENCY ($$$)', colors: ['#c8102e', '#ffffff'], font: 'Bungee' },
  { id: 'svc:school', text: 'CHARTER SCHOOL OF EXCELLENCE', colors: ['#6b1d1d', '#f5e6c8'], font: 'Overpass' },
  { id: 'svc:college', text: 'PROSPERITY GOSPEL U', colors: ['#1b2a4a', '#e8c15a'], font: 'Titan One' },
  { id: 'svc:park', text: 'NO SKATEBOARDING', colors: ['#2a6a3a', '#ffffff'], font: 'Overpass' },
);

export type ServiceModelId =
  | 'coalPlant' | 'gasPeaker' | 'solarFarm' | 'nuclearPlant'
  | 'waterPump' | 'wellTower' | 'sewageOutfall' | 'treatmentPlant'
  | 'landfill' | 'incinerator'
  | 'fireStation' | 'sheriff' | 'clinic' | 'hospital' | 'school' | 'college' | 'park';

const CONCRETE = col(0xb9b6ad), STEEL = col(0x8e959c), DARK = col(0x2b2e33), WHITE = col(0xf1f0ea);
const BRICK = col(0x9a4c34), RED = col(0xb3151d), GRASS = col(0x6f9a4a), ASPH = col(0x3a3c40);

function lot(k: Kit, W: number, D: number, tile: number = T.CONCRETE, c: Col = col(0xffffff)) {
  k.slab(-W / 2 + 0.2, -D / 2 + 0.2, W / 2 - 0.2, D / 2 - 0.2, 0.045, tile, c);
}

/** Chain-link perimeter fence with a front gate gap. */
function perimeter(k: Kit, W: number, D: number, gate = 10) {
  const c = col(0x8c9196), h = 2.2, x0 = -W / 2 + 0.6, x1 = W / 2 - 0.6, z0 = -D / 2 + 0.6, z1 = D / 2 - 0.6;
  k.box(x0, 0, 0.06, D - 1.2, 0, h, T.METAL, c, null);
  k.box(x1, 0, 0.06, D - 1.2, 0, h, T.METAL, c, null);
  k.box(0, z0, W - 1.2, 0.06, 0, h, T.METAL, c, null);
  const side = (W - 1.2 - gate) / 2;
  k.box(x0 + side / 2, z1, side, 0.06, 0, h, T.METAL, c, null);
  k.box(x1 - side / 2, z1, side, 0.06, 0, h, T.METAL, c, null);
  for (const x of [x0, x1, -gate / 2, gate / 2]) k.cyl(x, z1, 0.08, 0, h + 0.1, 6, T.SOLID, DARK);
}

/** Tall stack with warning bands; emits smoke at the top. */
function stack(k: Kit, x: number, z: number, r: number, h: number, smoke: 'smoke' | 'steam' = 'smoke') {
  k.cyl(x, z, r * 1.25, 0, 3, 12, T.CONCRETE, CONCRETE);
  k.cyl(x, z, r, 3, h, 12, T.CONCRETE, col(0xd8d4ca), null, r * 0.82);
  for (const y of [h - 6, h - 2.5]) k.cyl(x, z, r * 0.86, y, y + 1.6, 12, T.SOLID, RED, null, r * 0.84);
  k.cyl(x, z, r * 0.84, h - 0.9, h, 12, T.SOLID, DARK, DARK, r * 0.84);
  k.emit(smoke, x, h + 1, z);
}

/** Hyperbolic cooling tower (stacked conical rings). */
function coolingTower(k: Kit, x: number, z: number, r: number, h: number) {
  const rings = [[0, 1], [0.35, 0.72], [0.7, 0.66], [0.88, 0.7], [1, 0.76]];
  const c = col(0xcfcbc2);
  for (let i = 0; i < rings.length - 1; i++) {
    const [y0, r0] = rings[i], [y1, r1] = rings[i + 1];
    k.cyl(x, z, r * r0, y0 * h, y1 * h, 20, T.CONCRETE, c, null, r * r1);
  }
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    k.tube([x + Math.sin(a) * r * 1.02, 0, z + Math.cos(a) * r * 1.02], [x + Math.sin(a + 0.3) * r * 0.97, 3, z + Math.cos(a + 0.3) * r * 0.97], 0.35, 5, CONCRETE);
  }
  k.emit('steam', x, h + 2, z);
  k.emit('steam', x + r * 0.3, h + 1, z - r * 0.2);
}

function transformerYard(k: Kit, cx: number, cz: number, w: number, d: number) {
  k.slab(cx - w / 2, cz - d / 2, cx + w / 2, cz + d / 2, 0.07, T.DIRT, col(0x9a948a));
  for (let i = 0; i < 3; i++) {
    const x = cx - w / 2 + 2 + i * ((w - 4) / 2);
    k.box(x, cz - 1, 2.2, 1.8, 0, 2.4, T.METAL, col(0x6e7a6a), T.SOLID, DARK);
    for (const dx of [-0.6, 0, 0.6]) k.cyl(x + dx, cz - 1, 0.12, 2.4, 3.4, 6, T.SOLID, col(0x8a5a3a));
  }
  // gantry
  for (const x of [cx - w / 2 + 0.6, cx + w / 2 - 0.6]) k.box(x, cz + d / 2 - 1, 0.35, 0.35, 0, 9, T.METAL, STEEL, T.SOLID);
  k.box(cx, cz + d / 2 - 1, w - 1.2, 0.35, 8.6, 9, T.METAL, STEEL, T.SOLID);
}

function flagpole(k: Kit, x: number, z: number, h = 9) {
  k.cyl(x, z, 0.09, 0, h, 6, T.SOLID, col(0xcfd3d6));
  k.box(x + 0.9, z, 1.6, 0.03, h - 1.1, h - 0.1, [T.SOLID, T.SOLID, T.SOLID, T.SOLID], col(0xb22234), null);
  k.box(x + 0.45, z, 0.7, 0.035, h - 0.55, h - 0.1, T.SOLID, col(0x3c3b6e), null);
}

function tree(k: Kit, x: number, z: number, h: number, c: Col) {
  k.cyl(x, z, 0.16, 0, h * 0.45, 5, T.WOOD, col(0x4a3524));
  k.cyl(x, z, h * 0.28, h * 0.35, h * 0.75, 7, T.SOLID, c, null, h * 0.22);
  k.cyl(x, z, h * 0.22, h * 0.75, h, 7, T.SOLID, c, c, 0.02);
}

function parkedTruck(k: Kit, x: number, z: number, yaw: number, body: Col, cab: Col, L = 8) {
  k.at(x, z, yaw, () => {
    k.box(0, -L * 0.12, 2.3, L * 0.7, 0.9, 3.2, T.METAL, body, T.SOLID);
    k.box(0, L * 0.34, 2.3, L * 0.26, 0.6, 2.7, T.SOLID, cab, T.SOLID);
    k.quad([-1.0, 1.6, L * 0.47 + 0.02], [1.0, 1.6, L * 0.47 + 0.02], [0.95, 2.45, L * 0.47 + 0.02], [-0.95, 2.45, L * 0.47 + 0.02], [[0, 0], [1, 0], [1, 1], [0, 1]], col(0xffffff), T.CAR_GLASS);
    for (const zz of [-L * 0.3, L * 0.3]) for (const s of [-1, 1]) k.box(s * 1.17, zz, 0.12, 1.0, 0.05, 1.0, T.SOLID, DARK, null);
  });
}

function garageDoors(k: Kit, x0: number, x1: number, z: number, h: number, n: number, doorColor: Col) {
  const w = (x1 - x0) / n;
  for (let i = 0; i < n; i++) {
    const cx = x0 + w * (i + 0.5);
    k.quad([cx - w * 0.4, 0.05, z], [cx + w * 0.4, 0.05, z], [cx + w * 0.4, h, z], [cx - w * 0.4, h, z], [[0, 0], [w * 0.8 / 3, 0], [w * 0.8 / 3, h / 2.4], [0, h / 2.4]], doorColor, T.GARAGE);
  }
}

export function serviceModel(id: ServiceModelId, w: number, d: number): BuildingModel {
  const k = new Kit();
  const W = w * 8, D = d * 8;
  let height = 10;
  let label = '';
  switch (id) {
    // ------------------------------------------------------------ power
    case 'coalPlant': {
      lot(k, W, D);
      perimeter(k, W, D, 12);
      // boiler house + turbine hall
      k.box(-6, -4, 18, 20, 0, 30, [T.BRICK, T.BRICK, T.BRICK, T.BRICK], col(0x7a4a36), T.ROOF_FLAT, DARK, { floors: 6 });
      k.box(8, 0, 14, 26, 0, 16, [T.METAL, T.METAL, T.METAL, T.METAL], col(0x6d7780), T.ROOF_FLAT, col(0x55595e));
      k.gable(8, 0, 14, 26, 16, 3, false, col(0x55595e), col(0x6d7780), T.METAL, 0.3, T.METAL);
      stack(k, -12, -16, 2.6, 62);
      stack(k, -4, -17, 2.2, 54);
      coolingTower(k, 15, -15, 7.5, 34);
      // coal pile + conveyor
      k.hip(-12, 14, 12, 10, 0, 5, col(0x1d1c1b), 0.2, T.DIRT);
      k.tube([-12, 4.5, 11], [-6, 22, 6], 0.9, 6, col(0x6a6e72), T.METAL);
      transformerYard(k, 12, 17, 14, 10);
      k.sign(-6, 26, 6.06, 14, 3.2, 'svc:coal', 0, false);
      height = 62;
      label = 'Clean Coal™ Power Plant';
      break;
    }
    case 'gasPeaker': {
      lot(k, W, D);
      perimeter(k, W, D, 8);
      for (let i = 0; i < 3; i++) {
        const x = -W / 2 + 6 + i * 7.5;
        k.box(x, -2, 5.5, 12, 0, 6.5, T.METAL, col(0xc9ccc6), T.ROOF_FLAT, col(0x9ea3a6));
        k.box(x, -9.5, 3.2, 3.2, 0, 9, T.METAL, col(0xa3a8ab), T.SOLID, DARK);
        stack(k, x, -9.5, 1.1, 16, 'steam');
      }
      k.hcyl(9, 2.2, 6, 2, 9, 12, WHITE);
      k.hcyl(9, 2.2, 1, 2, 9, 12, WHITE);
      k.tube([4.5, 3, 6], [-2, 3, 6], 0.35, 6, col(0xe0b000));
      k.tube([-2, 3, 6], [-2, 3, 1], 0.35, 6, col(0xe0b000));
      k.sign(-3, 5.4, 4.06, 12, 2.2, 'svc:frack', 0, false);
      height = 16;
      label = 'Frack Yeah Gas Peaker Plant';
      break;
    }
    case 'solarFarm': {
      lot(k, W, D, T.DIRT, col(0xb9b08e));
      perimeter(k, W, D, 6);
      const rows = Math.floor((D - 10) / 5.2);
      for (let r = 0; r < rows; r++) {
        const z = -D / 2 + 4 + r * 5.2;
        for (let x = -W / 2 + 3; x < W / 2 - 6; x += 7) {
          // tilted panel table facing +Z (south-ish), on two posts
          k.quad([x, 0.9, z + 1.6], [x + 6.4, 0.9, z + 1.6], [x + 6.4, 2.6, z - 0.4], [x, 2.6, z - 0.4], [[0, 0], [6.4, 0], [6.4, 1.6], [0, 1.6]], col(0xffffff), T.SOLAR);
          k.quad([x + 6.4, 0.9, z + 1.6], [x, 0.9, z + 1.6], [x, 2.6, z - 0.4], [x + 6.4, 2.6, z - 0.4], [[0, 0], [1, 0], [1, 1], [0, 1]], col(0x55595e), T.SOLID);
          for (const px of [x + 1, x + 5.4]) k.box(px, z + 0.6, 0.12, 0.12, 0, 1.8, T.SOLID, STEEL, null);
        }
      }
      k.box(W / 2 - 3.5, D / 2 - 4, 3, 2.4, 0, 2.6, T.METAL, col(0xdcdcd6), T.SOLID);
      k.sign(W / 2 - 3.5, 3.4, D / 2 - 1, 6, 1.4, 'svc:solar', 0);
      height = 4;
      label = 'Freedom Solar Farm (Panels Made Overseas)';
      break;
    }
    case 'nuclearPlant': {
      lot(k, W, D);
      perimeter(k, W, D, 12);
      coolingTower(k, -14, -12, 11, 52);
      coolingTower(k, 14, -12, 11, 52);
      // containment dome
      k.cyl(-6, 14, 9, 0, 18, 20, T.CONCRETE, col(0xd6d2c8), null);
      k.cyl(-6, 14, 9, 18, 24, 20, T.CONCRETE, col(0xd6d2c8), null, 6.5);
      k.cyl(-6, 14, 6.5, 24, 27, 20, T.CONCRETE, col(0xd6d2c8), col(0xd6d2c8), 0.5);
      k.box(12, 14, 14, 12, 0, 14, T.METAL, col(0x7c8791), T.ROOF_FLAT, col(0x55595e));
      stack(k, 22, 22, 1.4, 40, 'steam');
      transformerYard(k, 0, 25, 14, 6);
      k.sign(12, 11, 20.06, 13, 2.4, 'svc:nuke', 0, false);
      height = 52;
      label = 'Three Mile Island Jr. Nuclear Plant';
      break;
    }
    // ------------------------------------------------------------ water & sewage
    case 'waterPump': {
      lot(k, W, D);
      k.box(-1.5, -1.5, 8, 7, 0, 4.2, T.BRICK, BRICK, null);
      k.gable(-1.5, -1.5, 8, 7, 4.2, 2.2, true, col(0x3e4a5a), BRICK, T.BRICK, 0.4, T.METAL);
      k.cyl(4.6, -3.5, 1.6, 0, 5.5, 12, T.METAL, col(0x7ea3c4), col(0x5d7f9c));
      k.tube([-6, 0.6, -5], [-6, 0.6, -8.5], 0.55, 8, col(0x3a6ea5));
      k.tube([2.5, 0.8, -1.5], [3.2, 0.8, -3.5], 0.4, 8, col(0x3a6ea5));
      k.sign(-1.5, 3.2, 2.06, 6, 1.1, 'svc:water', 0, false);
      height = 7;
      label = 'Artesian Tap Pumping Station';
      break;
    }
    case 'wellTower': {
      lot(k, W, D);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        k.tube([Math.cos(a) * 3.4, 0, Math.sin(a) * 3.4], [Math.cos(a) * 2.2, 17, Math.sin(a) * 2.2], 0.22, 6, col(0x8f969c));
      }
      k.cyl(0, 0, 0.5, 0, 17, 8, T.SOLID, col(0x8f969c));
      k.cyl(0, 0, 3.8, 17, 19, 16, T.SOLID, col(0x5b8fb9), null, 4.2);
      k.cyl(0, 0, 4.2, 19, 23, 16, T.SOLID, col(0x5b8fb9), null);
      k.cyl(0, 0, 4.2, 23, 25.5, 16, T.SOLID, col(0x5b8fb9), col(0x5b8fb9), 0.3);
      k.sign(0, 21, 4.25, 6.4, 1.6, 'svc:boil', 0, false);
      k.sign(0, 21, -4.25, 6.4, 1.6, 'svc:boil', Math.PI, false);
      k.box(4.5, 3, 3, 3, 0, 2.6, T.BRICK, BRICK, T.ROOF_FLAT);
      height = 26;
      label = 'Groundwater Well & Tower';
      break;
    }
    case 'sewageOutfall': {
      lot(k, W, D, T.DIRT, col(0x8b7d62));
      k.box(0, -5, 12, 2, 0, 3.2, T.CONCRETE, CONCRETE, T.CONCRETE);
      k.cyl(0, -5.2, 1.3, 0.8, 1.1, 14, T.SOLID, DARK, DARK);
      k.tube([0, 1.2, -4], [0, 1.2, -7.6], 1.2, 12, col(0x777b7f), T.CONCRETE);
      k.slab(-5, 0, 5, 5.5, 0.35, T.WATER, col(0x6a5a2a));
      k.box(-5, 2.75, 0.3, 5.5, 0, 0.8, T.CONCRETE, CONCRETE, T.CONCRETE);
      k.box(5, 2.75, 0.3, 5.5, 0, 0.8, T.CONCRETE, CONCRETE, T.CONCRETE);
      k.box(0, 5.5, 10.3, 0.3, 0, 0.8, T.CONCRETE, CONCRETE, T.CONCRETE);
      k.sign(4.5, 2.2, 7, 5, 1.1, 'svc:poop', 0);
      height = 4;
      label = 'Sewage Outfall (Straight to the River)';
      break;
    }
    case 'treatmentPlant': {
      lot(k, W, D);
      perimeter(k, W, D, 8);
      for (const [x, z] of [[-11, -6], [0, -6], [11, -6]]) {
        k.cyl(x, z, 5, 0, 2.4, 20, T.CONCRETE, CONCRETE, null);
        k.cyl(x, z, 4.7, 2.2, 2.25, 20, T.SOLID, col(0x5a6a3a), col(0x5a6a3a));
        k.box(x, z, 9.6, 0.4, 2.4, 2.8, T.METAL, STEEL, T.SOLID);
      }
      k.slab(-W / 2 + 3, 3, 4, 10, 0.4, T.WATER, col(0x6d7a4a));
      k.box(12, 7, 10, 8, 0, 6, T.BRICK, col(0xb49a7a), T.ROOF_FLAT);
      k.sign(12, 4.8, 11.06, 8, 1.6, 'svc:poop', 0, false);
      height = 7;
      label = 'Poop Palace Sewage Treatment';
      break;
    }
    // ------------------------------------------------------------ garbage
    case 'landfill': {
      lot(k, W, D, T.DIRT, col(0x8a7a5a));
      perimeter(k, W, D, 10);
      // Mt. Trashmore: terraced hip mounds (no walls) so it reads as a heap, not a building
      const hx = -5, hz = -6;
      const tiers: [number, number, number, number, number][] = [[34, 30, 0, 3.2, 0x7d735f], [26, 22, 3.2, 3.4, 0x857a63], [18, 15, 6.6, 3.4, 0x8d8068], [10, 8, 10, 3.6, 0x958770]];
      for (const [ww, dd, y, rise, c] of tiers) k.hip(hx, hz, ww, dd, y, rise, col(c), 0, T.DIRT);
      // colorful bags and junk strewn on the slopes (height follows the mound)
      const bag = [0x2a2a2a, 0x3d6b2d, 0x8a8a8a, 0xd6c34a, 0x2b4f8a, 0xb33a2a, 0xe8e2d0];
      const surf = (x: number, z: number) => {
        let y = 0;
        for (const [ww, dd, y0, rise] of tiers) {
          const u = Math.max(Math.abs(x - hx) / (ww / 2), Math.abs(z - hz) / (dd / 2));
          if (u < 1) y = Math.max(y, y0 + rise * (1 - u));
        }
        return y;
      };
      for (let i = 0; i < 90; i++) {
        const a = i * 2.39996, rr = 2 + ((i * 37) % 100) / 100 * 15;
        const x = hx + Math.cos(a) * rr * 1.1, z = hz + Math.sin(a) * rr * 0.95;
        const y = surf(x, z);
        const sz = 0.7 + ((i * 13) % 7) / 10;
        k.box(x, z, sz * 1.3, sz, y - 0.2, y + sz * 0.6, T.SOLID, col(bag[i % bag.length]), T.SOLID);
      }
      // a couch and a mattress, obviously
      k.box(hx + 6, hz + 4, 2.4, 1, surf(hx + 6, hz + 4), surf(hx + 6, hz + 4) + 0.9, T.SOLID, col(0x7a3e2a), T.SOLID);
      k.box(hx - 7, hz + 5, 2, 1.4, surf(hx - 7, hz + 5), surf(hx - 7, hz + 5) + 0.35, T.SOLID, col(0xe8e2d0), T.SOLID);
      // bulldozer working the top
      k.at(hx + 3, hz - 2, 0.6, () => {
        const y = surf(hx + 3, hz - 2);
        k.box(0, 0, 3, 4.5, y, y + 1.4, T.SOLID, col(0xe0a800), T.SOLID);
        k.box(0, -0.6, 1.8, 2, y + 1.4, y + 2.8, T.SOLID, col(0xe0a800), T.SOLID, DARK);
        k.box(0, 2.7, 3.6, 0.3, y - 0.2, y + 1.2, T.METAL, STEEL, T.SOLID);
      });
      // circling gulls would be nice; settle for a scale house, trucks and the sign
      k.box(W / 2 - 6, D / 2 - 5, 6, 4, 0, 3, T.SIDING, col(0xd8d2c0), T.ROOF_FLAT);
      parkedTruck(k, W / 2 - 14, D / 2 - 6, 0, col(0x2f6b3a), WHITE, 9);
      parkedTruck(k, W / 2 - 18, D / 2 - 6, 0, col(0x2f6b3a), WHITE, 9);
      k.pylon(-W / 2 + 4, D / 2 - 2, 6, 9, 1.8, 'svc:trash', 0);
      k.emit('smoke', hx - 2, 12, hz - 1);
      height = 15;
      label = 'Mt. Trashmore Landfill';
      break;
    }
    case 'incinerator': {
      lot(k, W, D);
      k.box(-3, -2, 20, 18, 0, 17, [T.METAL, T.METAL, T.METAL, T.METAL], col(0x4e5358), T.ROOF_FLAT, DARK);
      k.box(-3, 8.5, 12, 3, 0, 7, T.GARAGE, col(0x6a7076), T.ROOF_FLAT, DARK);
      stack(k, 10, -9, 1.8, 44);
      k.box(10, 5, 6, 8, 0, 9, T.METAL, col(0x6d7780), T.SOLID, DARK);
      k.flame(10, 44, -9, 3, 1.2, 5);
      k.sign(-3, 13.5, 7.06, 14, 2.6, 'svc:burn', 0, false);
      parkedTruck(k, 10, 12, Math.PI, col(0x2f6b3a), WHITE, 9);
      height = 44;
      label = 'Freedom Incinerator (Burns Everything)';
      break;
    }
    // ------------------------------------------------------------ safety & health
    case 'fireStation': {
      lot(k, W, D);
      k.box(-1, -3, 18, 12, 0, 6.5, [T.BRICK, T.BRICK, T.BRICK, T.BRICK], BRICK, T.ROOF_FLAT, DARK);
      garageDoors(k, -9.6, 5, 3.02, 4.6, 3, RED);
      k.box(9, -5, 3.5, 3.5, 0, 13, T.BRICK, BRICK, T.ROOF_FLAT, DARK); // hose tower
      k.box(-1, 3.4, 18, 0.5, 6.5, 7.2, T.SOLID, WHITE, T.SOLID);
      k.sign(-1, 5.6, 3.36, 11, 1.3, 'svc:fire', 0, false);
      flagpole(k, 10, 9);
      k.slab(-10, 3.2, 6, 11.8, 0.06, T.CONCRETE, col(0xd8d6cc));
      k.cyl(8, 10, 0.3, 0, 0.9, 8, T.SOLID, RED, col(0xd0a000)); // hydrant
      height = 13;
      label = 'Volunteer Fire Dept. (Donations Welcome)';
      break;
    }
    case 'sheriff': {
      lot(k, W, D);
      k.box(0, -3, 18, 12, 0, 7, [T.STORE, T.BRICK, T.BRICK, T.BRICK], col(0xc9b99a), T.ROOF_FLAT, DARK, { fit: true });
      k.box(0, 3.3, 7, 0.6, 5.2, 7.4, T.SOLID, col(0x1a2233), T.SOLID);
      k.sign(0, 6.3, 3.65, 6.4, 1.6, 'svc:sheriff', 0, false);
      k.sign(0, 4.4, 3.08, 12, 0.8, 'svc:qi', 0, false);
      flagpole(k, -8, 6);
      flagpole(k, -6.6, 6, 8);
      for (let i = 0; i < 4; i++) k.car(-3 + i * 3.2, 8.5, Math.PI / 2, i % 2 ? col(0x1b1b1d) : WHITE, 'sedan');
      height = 9;
      label = "Sheriff's Office (Qualified Immunity Included)";
      break;
    }
    case 'clinic': {
      lot(k, W, D);
      k.box(-2, -3, 16, 12, 0, 5.5, [T.STORE, T.STUCCO, T.STUCCO, T.STUCCO], col(0xece8df), T.ROOF_FLAT, col(0xa8a8a6), { fit: true });
      k.box(7.5, 5, 7, 7, 4.2, 4.6, T.SOLID, WHITE, T.SOLID); // ambulance canopy
      for (const x of [4.3, 10.7]) k.cyl(x, 8.2, 0.15, 0, 4.2, 6, T.SOLID, STEEL);
      k.sign(-2, 4.5, 3.06, 9, 1.4, 'svc:urgent', 0, false);
      k.sign(-2, 3.4, 3.07, 7, 0.7, 'svc:oon', 0, false);
      k.box(-7, 3.3, 1.8, 0.3, 4.2, 6.2, T.SOLID, col(0xc8102e), T.SOLID); // cross
      k.box(-7, 3.3, 0.6, 0.35, 4.8, 5.6, T.SOLID, WHITE, T.SOLID);
      k.box(-7, 3.3, 1.4, 0.35, 5.0, 5.4, T.SOLID, WHITE, T.SOLID);
      for (let i = 0; i < 3; i++) k.car(-8 + i * 3, 9, Math.PI / 2, col([0xa8adb3, 0x1d3a8a, 0x9b1b1b][i]), i === 1 ? 'suv' : 'sedan');
      height = 7;
      label = 'Urgent Care (Out of Network)';
      break;
    }
    case 'hospital': {
      lot(k, W, D);
      k.box(-4, -4, 24, 16, 0, 24, [T.OFFICE_WIN, T.APT_WIN, T.APT_WIN, T.APT_WIN], col(0xe7e3da), T.ROOF_FLAT, col(0x9ea3a6), { floors: 6 });
      k.box(8, 6, 14, 12, 0, 8, [T.STORE, T.STUCCO, T.STUCCO, T.STUCCO], col(0xe7e3da), T.ROOF_FLAT, col(0x9ea3a6), { fit: true });
      k.box(8, 13.5, 12, 3, 4, 4.5, T.SOLID, col(0xc8102e), T.SOLID);
      k.sign(8, 6, 12.06, 10, 1.6, 'svc:er', 0, false);
      k.sign(-4, 21, 4.06, 16, 2.6, 'svc:hospital', 0, false);
      // helipad
      k.cyl(-8, -6, 5, 24, 24.3, 16, T.SOLID, col(0x505358), col(0x505358));
      k.box(-8, -6, 0.6, 4, 24.3, 24.35, T.SOLID, WHITE, T.SOLID);
      k.box(-9.3, -6, 0.6, 0.4, 24.3, 24.36, T.SOLID, WHITE, T.SOLID);
      k.box(-6.7, -6, 0.6, 0.4, 24.3, 24.36, T.SOLID, WHITE, T.SOLID);
      k.box(-8, -6, 2, 0.5, 24.3, 24.36, T.SOLID, WHITE, T.SOLID);
      for (let i = 0; i < 6; i++) k.car(-18 + i * 2.8, 13, Math.PI / 2, col([0xf2f2f2, 0x1b1b1d, 0xa8adb3, 0x5a5f66, 0x9b1b1b, 0x355c7d][i]), 'sedan');
      height = 25;
      label = "St. Deductible's Hospital";
      break;
    }
    // ------------------------------------------------------------ education & parks
    case 'school': {
      lot(k, W, D);
      k.box(-4, -5, 20, 12, 0, 7.5, [T.HOUSE_WIN, T.BRICK, T.HOUSE_WIN, T.BRICK], col(0xa45a3c), T.ROOF_FLAT, DARK, { floors: 2 });
      k.box(9, -6, 10, 14, 0, 9, T.BRICK, col(0x8e4a32), T.ROOF_FLAT, DARK); // gym
      k.gable(9, -6, 10, 14, 9, 1.6, false, col(0x5a5f66), col(0x8e4a32), T.BRICK, 0.2, T.METAL);
      k.box(-4, 1.3, 5, 0.8, 0, 3.6, T.SOLID, WHITE, T.SOLID);
      k.sign(-4, 5.6, 1.06, 16, 1.7, 'svc:school', 0, false);
      flagpole(k, -13, 7);
      // field + playground
      k.slab(-W / 2 + 1, 4, 2, D / 2 - 1, 0.06, T.LAWN, GRASS);
      k.box(-7, 10, 3, 0.1, 0, 2.2, T.SOLID, col(0xd8d8d8), null);
      k.box(9, 9.5, 4, 3, 0.0, 2.4, T.SOLID, col(0xd83a2a), T.SOLID, col(0xf2c200));
      parkedTruck(k, 10, 13.5, Math.PI / 2, col(0xf2b705), col(0xf2b705), 10);
      height = 10;
      label = 'Charter School of Excellence™';
      break;
    }
    case 'college': {
      lot(k, W, D, T.LAWN, GRASS);
      const hall = (x: number, z: number, w2: number, d2: number, h: number, yaw: number) => k.at(x, z, yaw, () => {
        k.box(0, 0, w2, d2, 0, h, [T.HOUSE_WIN, T.BRICK, T.HOUSE_WIN, T.BRICK], col(0x9e5236), null, undefined, { floors: 3 });
        k.gable(0, 0, w2, d2, h, 3.5, true, col(0x3e4a4a), col(0x9e5236), T.BRICK, 0.4, T.SHINGLE);
        for (let i = 0; i < 4; i++) k.cyl(-3 + i * 2, d2 / 2 + 1.4, 0.35, 0, h - 1, 10, T.SOLID, WHITE);
        k.box(0, d2 / 2 + 1.4, 7.5, 2.8, h - 1, h - 0.3, T.SOLID, WHITE, T.SOLID);
      });
      hall(0, -12, 26, 10, 11, 0);
      hall(-17, 3, 18, 9, 10, Math.PI / 2);
      hall(17, 3, 18, 9, 10, -Math.PI / 2);
      // bell tower
      k.box(0, 8, 4, 4, 0, 20, T.BRICK, col(0x9e5236), null);
      k.box(0, 8, 4.4, 4.4, 20, 23, T.SOLID, WHITE, null);
      k.hip(0, 8, 4.4, 4.4, 23, 5, col(0x2f5a4a), 0.2, T.METAL);
      k.slab(-2, 8, 2, D / 2 - 0.5, 0.07, T.CONCRETE, col(0xd8d4c8));
      k.sign(0, 3, D / 2 - 1, 12, 1.6, 'svc:college', 0);
      for (const [x, z] of [[-9, 12], [9, 12], [-9, -2], [9, -2]]) tree(k, x, z, 9, col(0x3f6b2a));
      height = 28;
      label = 'Prosperity Gospel University';
      break;
    }
    case 'park': {
      lot(k, W, D, T.LAWN, GRASS);
      k.slab(-1, -D / 2 + 0.5, 1, D / 2 - 0.5, 0.07, T.CONCRETE, col(0xd6d0c0));
      k.slab(-W / 2 + 0.5, -1, W / 2 - 0.5, 1, 0.071, T.CONCRETE, col(0xd6d0c0));
      k.cyl(0, 0, 2.2, 0, 0.6, 16, T.CONCRETE, CONCRETE, col(0x4a7aa0));
      k.cyl(0, 0, 0.3, 0.6, 2.2, 8, T.CONCRETE, CONCRETE);
      k.emit('sparkle', 0, 2.4, 0);
      for (const [x, z, h] of [[-4.5, -4.5, 8], [4.8, -4.2, 7], [-4.2, 4.6, 7.5], [4.4, 4.8, 8.5]]) tree(k, x, z, h, col(0x3f6b2a));
      for (const [x, z, yaw] of [[-2.2, 3.5, 0], [2.2, -3.5, Math.PI]]) k.at(x, z, yaw, () => {
        k.box(0, 0, 1.8, 0.5, 0.45, 0.55, T.WOOD, col(0x7a5a3a), T.WOOD);
        k.box(0, -0.25, 1.8, 0.08, 0.55, 1.0, T.WOOD, col(0x7a5a3a), T.SOLID);
      });
      k.sign(W / 2 - 2, 1.6, D / 2 - 0.6, 3, 0.7, 'svc:park', 0);
      height = 9;
      label = 'Pocket Park (No Skateboarding)';
      break;
    }
  }
  return { geometry: k.build(), height, label, emitters: k.emitters };
}
