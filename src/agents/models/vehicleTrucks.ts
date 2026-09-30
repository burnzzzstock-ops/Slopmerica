// Pickups, the lifted truck and the Cyberslop. A pickup is a cab (the same hull and greenhouse as a car, ending behind the doors) and
// a bed: two side walls with the rear wheel arches cut out of them, a ribbed floor, wheel wells, a front wall and a tailgate.
import * as THREE from 'three';
import { buildCar, type CarBuild, type CarPlan } from './vehicleBody';
import { def } from './vehicleRegistry';
import { addWheel, boxG, cylG, extrudeG, loftG, ModelBuilder, planeG, quadG, ZONE, clamp, type V3, type WheelSpec } from './vehicleKit';
import { lightBar, roofRack, sideDecalG, stacks } from './vehicleParts';
import { endDecalG } from './vehicleDecals';

const W = (r: number, tw: number, rim: number, style: WheelSpec['style'] = 'star', spokes = 5, rimColor?: number, dual = false): WheelSpec => ({ r, tw, rim, style, spokes, rimColor, dual });
type Over = Omit<Partial<CarPlan>, 'cab'> & { cab?: Partial<CarPlan['cab']> };
const derive = (base: CarPlan, over: Over): CarPlan => ({ ...base, ...over, cab: { ...base.cab, ...(over.cab ?? {}) } });

interface BedSpec {
  z0: number; z1: number;           // front (against the cab) and rear (the tailgate) of the bed
  floorY: number; railY: number; sillY: number;
  hw: number;                       // half width of the walls' outer face
  archR: number; wheelZ: number; wheelR: number;
  style?: 'open' | 'flat';          // flat: a flatbed with low stake sides instead of walls
  tailLamps?: boolean;
  deckColor?: number;
}

/** The pickup bed. */
function addBed(mb: ModelBuilder, b: BedSpec): void {
  const wallT = 0.07;
  const x = b.hw - wallT / 2;
  if (mb.lod === 2) {
    // far: a shell of boxes
    const len = b.z0 - b.z1, zc = (b.z0 + b.z1) / 2;
    if (b.style === 'flat') { mb.add(boxG(b.hw * 2, 0.12, len, 0, b.floorY, zc), b.deckColor ?? 0x7a5c37, ZONE.PANEL, 0); return; }
    for (const s of [-1, 1]) mb.body(boxG(wallT, b.railY - b.sillY, len, s * x, (b.railY + b.sillY) / 2, zc));
    mb.body(boxG(b.hw * 2, b.railY - b.sillY, wallT, 0, (b.railY + b.sillY) / 2, b.z1 + wallT / 2));
    mb.add(boxG(b.hw * 2, 0.06, len, 0, b.floorY, zc), 0x1e2124, ZONE.PLASTIC, 0);
    return;
  }
  if (b.style === 'flat') {
    mb.add(boxG(b.hw * 2 - 0.02, 0.09, b.z0 - b.z1, 0, b.floorY, (b.z0 + b.z1) / 2), b.deckColor ?? 0x7a5c37, ZONE.PANEL, 0);
    if (mb.lod < 2) {
      // stake pockets and a low rail
      for (const s of [-1, 1]) {
        mb.add(boxG(0.05, 0.28, b.z0 - b.z1, s * (b.hw - 0.03), b.floorY + 0.17, (b.z0 + b.z1) / 2), 0xffffff, ZONE.PAINT, 0.9);
        if (mb.close) for (let z = b.z1 + 0.15; z < b.z0; z += 0.6) mb.add(boxG(0.07, 0.5, 0.07, s * (b.hw - 0.03), b.floorY + 0.3, z), 0x2a2d30, ZONE.PLASTIC, 0);
      }
      mb.add(boxG(b.hw * 2, 0.5, 0.06, 0, b.floorY + 0.3, b.z1 + 0.03), 0xffffff, ZONE.PAINT, 0.9);
    }
    // frame rails under the deck
    mb.add(boxG(b.hw * 1.3, 0.16, b.z0 - b.z1, 0, b.floorY - 0.14, (b.z0 + b.z1) / 2), 0x18191b, ZONE.DARK, 0);
    return;
  }
  // wall outline in (z, y): bottom edge with the arch cut out, up the front, along the rail, down the tailgate end
  const pts: Array<[number, number]> = [[b.z1, b.sillY]];
  const steps = mb.lod === 0 ? 10 : mb.lod === 1 ? 6 : 2;
  const zr0 = b.wheelZ - b.archR, zr1 = b.wheelZ + b.archR;
  if (zr0 > b.z1) pts.push([zr0, b.sillY]);
  else pts.push([b.z1, b.sillY]);
  for (let k = 0; k <= steps; k++) {
    const a = Math.PI - (k / steps) * Math.PI;                    // from the rear side of the arch over the top to the front side
    const zz = b.wheelZ + Math.cos(a) * b.archR, yy = b.wheelR + Math.sin(a) * b.archR;
    if (zz >= b.z1 && zz <= b.z0) pts.push([zz, Math.max(b.sillY, yy)]);
  }
  if (zr1 < b.z0) pts.push([zr1, b.sillY]);
  pts.push([b.z0, b.sillY], [b.z0, b.railY], [b.z1, b.railY]);
  // (the arch runs rear-to-front, so the polygon is z1 -> ... -> z0: keep it counter-clockwise for the extrusion)
  const wall = extrudeG(pts.map(([z, y]) => [z, y] as [number, number]), wallT, 'yz', [x, 0, 0]);
  mb.body(wall);
  mb.body(extrudeG(pts.map(([z, y]) => [z, y] as [number, number]), wallT, 'yz', [-x, 0, 0]));
  // rail caps
  if (mb.lod < 2) for (const s of [-1, 1]) mb.add(boxG(0.1, 0.035, b.z0 - b.z1, s * (b.hw - 0.05), b.railY + 0.012, (b.z0 + b.z1) / 2), 0x1a1b1c, ZONE.PLASTIC, 0);
  // floor, a dark ribbed liner
  mb.add(boxG(b.hw * 2 - wallT * 2, 0.05, b.z0 - b.z1, 0, b.floorY, (b.z0 + b.z1) / 2), 0x1e2124, ZONE.PLASTIC, 0);
  if (mb.close) for (let z = b.z1 + 0.12; z < b.z0 - 0.05; z += 0.14) mb.add(boxG(b.hw * 2 - wallT * 2 - 0.2, 0.012, 0.04, 0, b.floorY + 0.03, z), 0x2b2f33, ZONE.PLASTIC, 0);
  // inner wheel wells
  if (mb.lod < 2) for (const s of [-1, 1]) mb.add(boxG(0.26, b.wheelR + b.archR - b.floorY - 0.05, b.archR * 1.5, s * (b.hw - wallT - 0.13), (b.floorY + b.wheelR + b.archR) / 2 - 0.02, b.wheelZ), 0x24272a, ZONE.PLASTIC, 0);
  // bed front wall (above the cab back) and the tailgate
  mb.body(boxG(b.hw * 2 - 0.02, b.railY - b.floorY, wallT, 0, (b.railY + b.floorY) / 2, b.z0 - wallT / 2));
  mb.body(boxG(b.hw * 2 - 0.02, b.railY - b.sillY - 0.02, wallT, 0, (b.railY + b.sillY) / 2, b.z1 + wallT / 2));
  if (mb.close) {
    mb.add(boxG(b.hw * 1.5, 0.04, 0.02, 0, b.railY - 0.16, b.z1 - 0.005), 0x121314, ZONE.PLASTIC, 0);       // tailgate handle recess
    mb.add(boxG(b.hw * 2 - 0.06, 0.02, 0.02, 0, (b.railY + b.sillY) / 2, b.z1 - 0.004), 0x1a1b1c, ZONE.PLASTIC, 0); // tailgate seam
  }
  // frame under the bed
  mb.add(boxG(b.hw * 1.35, 0.18, b.z0 - b.z1 - 0.1, 0, b.floorY - 0.15, (b.z0 + b.z1) / 2), 0x18191b, ZONE.DARK, 0);
}

/** Rear bumper, tail lamps, plate and hitch of a pickup or flatbed. */
function pickupRear(mb: ModelBuilder, hw: number, z1: number, lampY: number, bumperY: number, opts: { chrome?: boolean; plateY?: number } = {}): void {
  if (mb.lod === 2) { for (const s of [-1, 1]) mb.add(planeG(0.14, 0.3, s * (hw - 0.16), lampY, z1 - 0.01, 0, true), 0xc0121a, ZONE.TAIL, 0); return; }
  mb.add(boxG(hw * 2 - 0.05, 0.16, 0.14, 0, bumperY, z1 - 0.08), opts.chrome === false ? 0x1a1b1c : 0xb9bec2, opts.chrome === false ? ZONE.PLASTIC : ZONE.CHROME, 0);
  if (mb.lod < 2) mb.add(boxG(0.1, 0.09, 0.2, 0, bumperY - 0.03, z1 - 0.14), 0x151617, ZONE.STEEL, 0); // hitch receiver
  const c = mb.close;
  for (const s of [-1, 1]) {
    const x = s * (hw - 0.16);
    if (c) mb.add(boxG(0.16, 0.34, 0.04, x, lampY, z1 - 0.005), 0x0d0e0f, ZONE.PLASTIC, 0);
    if (c) {
      mb.add(boxG(0.12, 0.17, 0.03, x, lampY + 0.07, z1 - 0.02), 0xc0121a, ZONE.TAIL, 0);
      mb.add(boxG(0.12, 0.08, 0.03, x, lampY - 0.07, z1 - 0.02), 0xffa317, ZONE.TURN, 0);
      mb.add(boxG(0.12, 0.07, 0.03, x, lampY - 0.15, z1 - 0.02), 0xf3f3ef, ZONE.REVERSE, 0);
    } else {
      mb.add(planeG(0.14, 0.3, x, lampY, z1 - 0.01, 0, true), 0xc0121a, ZONE.TAIL, 0);
      mb.add(planeG(0.14, 0.09, x, lampY - 0.13, z1 - 0.012, 0, true), 0xffa317, ZONE.TURN, 0);
    }
  }
  mb.lamps.tail.length = 0; mb.lamps.reverse.length = 0;
  mb.lamps.tail.push([hw - 0.16, lampY, z1], [-(hw - 0.16), lampY, z1]);
  mb.lamps.reverse.push([hw - 0.16, lampY - 0.15, z1], [-(hw - 0.16), lampY - 0.15, z1]);
  mb.lamps.turnLeft.push([hw - 0.16, lampY - 0.13, z1]); mb.lamps.turnRight.push([-(hw - 0.16), lampY - 0.13, z1]);
  mb.lamps.tailZ = z1;
  if (mb.lod < 2) mb.add(quadG([0.26, opts.plateY ?? bumperY + 0.34, z1 - 0.02], [-0.26, opts.plateY ?? bumperY + 0.34, z1 - 0.02], [-0.26, (opts.plateY ?? bumperY + 0.34) + 0.13, z1 - 0.02], [0.26, (opts.plateY ?? bumperY + 0.34) + 0.13, z1 - 0.02], PLATE), 0xffffff, ZONE.DECAL, 0);
}
import { tileUv } from './vehicleDecals';
const PLATE = tileUv('plate');

// ------------------------------------------------------------------------------------------------------------------ pickups
const PICKUP_CAB: CarPlan = {
  wheels: W(0.4, 0.27, 0.6, 'star', 6),
  zNose: 2.9, zTail: -0.55, zF: 1.9, zR: -1.8, ride: 0.3, hw: 0.95, belt: 1.3, trim: 0.22, flare: true, cornerR: 0.36, noseTaper: 0.08,
  noRear: true, bumperF: 'chrome', grille: 'tall', exhaust: 'none', tailTaper: 0,
  top: [[-0.55, 1.3], [-0.4, 1.31], [0.6, 1.31], [1.05, 1.31], [1.35, 1.25], [2.0, 1.18], [2.6, 1.13], [2.9, 1.06]],
  cab: { ws0: 1.25, ws1: 0.6, y1: 1.87, rf1: -0.22, y2: 1.87, bl: -0.5, roofHW: 0.8, beltHW: 0.9, pillars: [0.35], pillarW: 0.09 },
  doors: [1.1, 0.35, -0.45], mirror: { y: 1.62, z: 1.08, big: true },
  lampF: { y: 1.02, w: 0.36, h: 0.14, x: 0.62 },
};
const BED_BASE: BedSpec = { z0: -0.55, z1: -2.9, floorY: 0.85, railY: 1.25, sillY: 0.38, hw: 0.97, archR: 0.47, wheelZ: -1.8, wheelR: 0.4, tailLamps: true };

/** A pickup: cab plan + bed. */
function pickup(id: string, label: string, weight: number, cab: CarPlan, bed: BedSpec, extras?: (mb: ModelBuilder, b: CarBuild) => void, kind: 'pickup' | 'liftedTruck' = 'pickup', rear = { lampY: 1.02, bumperY: 0.55 }): void {
  def(id, kind, label, weight, (mb) => {
    const b = buildCar(mb, cab);
    addBed(mb, bed);
    pickupRear(mb, bed.hw, bed.z1, rear.lampY, rear.bumperY);
    extras?.(mb, b);
    return cab.wheels.r;
  });
}

pickup('pickup', 'Pickup', 1, PICKUP_CAB, BED_BASE);
pickup('pickup.ext', 'Extended-cab pickup', 0.6, derive(PICKUP_CAB, {
  zTail: -0.05, cab: { rf1: 0.3, bl: 0.02, pillars: [0.4], y1: 1.87, y2: 1.87 }, doors: [1.1, 0.4, 0.0], wheels: W(0.395, 0.26, 0.6, 'star', 5), bumperF: 'black',
  top: [[-0.05, 1.3], [0.1, 1.31], [0.6, 1.31], [1.05, 1.31], [1.35, 1.25], [2.0, 1.18], [2.6, 1.13], [2.9, 1.06]],
}), { ...BED_BASE, z0: -0.05, wheelZ: -1.85 });
pickup('pickup.single', 'Regular-cab pickup', 0.6, derive(PICKUP_CAB, {
  zTail: 0.3, cab: { ws1: 0.85, rf1: 0.45, bl: 0.28, pillars: [], y1: 1.85, y2: 1.85 }, doors: [1.1, 0.32], wheels: W(0.385, 0.25, 0.62, 'steel', 5, 0x8a8f93), bumperF: 'black', trim: 0.12,
  top: [[0.3, 1.3], [0.4, 1.31], [0.8, 1.31], [1.1, 1.3], [1.4, 1.24], [2.0, 1.17], [2.6, 1.12], [2.9, 1.05]],
}), { ...BED_BASE, z0: 0.3, wheelZ: -1.8, floorY: 0.82, railY: 1.2 });
pickup('pickup.work', 'Work truck', 0.5, derive(PICKUP_CAB, {
  zTail: 0.3, cab: { ws1: 0.85, rf1: 0.45, bl: 0.28, pillars: [], y1: 1.85, y2: 1.85 }, doors: [1.1, 0.32], wheels: W(0.385, 0.25, 0.62, 'steel', 5, 0x8a8f93), bumperF: 'black', flare: false, trim: 0.1,
  top: [[0.3, 1.3], [0.4, 1.31], [0.8, 1.31], [1.1, 1.3], [1.4, 1.24], [2.0, 1.17], [2.6, 1.12], [2.9, 1.05]],
}), { ...BED_BASE, z0: 0.3, floorY: 0.82, railY: 1.2 }, (mb, b) => {
  // a ladder rack over the cab and the bed, a side toolbox, an amber beacon
  roofRack(mb, 1.98, 0.55, -2.8, 0.85, 'ladder');
  if (mb.lod < 2) for (const s of [-1, 1]) mb.body(boxG(0.16, 0.36, 1.25, s * 0.92, 1.36, -0.6));
  if (mb.lod < 2) mb.add(boxG(0.16, 0.08, 0.16, 0.5, 1.93, 0.15), 0xffb020, ZONE.BEACON, 0);
  mb.lamps.beacon.push([0.5, 1.95, 0.15]);
  void b;
});
pickup('pickup.flatbed', 'Farm truck', 0.45, derive(PICKUP_CAB, {
  zTail: 0.3, cab: { ws1: 0.85, rf1: 0.45, bl: 0.28, pillars: [], y1: 1.86, y2: 1.86 }, doors: [1.1, 0.32], wheels: W(0.4, 0.26, 0.62, 'steel', 5, 0x7a4f2c), bumperF: 'black', trim: 0.05, flare: false, ride: 0.34,
  top: [[0.3, 1.32], [0.4, 1.33], [0.8, 1.33], [1.1, 1.32], [1.4, 1.26], [2.0, 1.19], [2.6, 1.14], [2.9, 1.07]],
}), { ...BED_BASE, z0: 0.15, style: 'flat', floorY: 0.98 }, (mb, b) => {
  // headache rack behind the cab
  if (mb.lod < 2) { mb.add(boxG(1.7, 0.08, 0.06, 0, 1.75, 0.1), 0x24272a, ZONE.STEEL, 0); for (const s of [-1, 1]) mb.add(boxG(0.07, 0.75, 0.06, s * 0.82, 1.4, 0.1), 0x24272a, ZONE.STEEL, 0); }
  void b;
});
pickup('pickup.hd', 'Heavy-duty pickup', 0.5, derive(PICKUP_CAB, {
  ride: 0.36, hw: 0.98, belt: 1.42, wheels: W(0.44, 0.28, 0.58, 'star', 8, undefined, true), bumperF: 'chrome', trim: 0.28,
  top: [[-0.55, 1.42], [-0.4, 1.43], [0.6, 1.43], [1.05, 1.43], [1.35, 1.37], [2.0, 1.3], [2.6, 1.24], [2.9, 1.16]],
  cab: { y1: 1.9, y2: 1.9, ws0: 1.25, ws1: 0.62 }, lampF: { y: 1.15, w: 0.38, h: 0.14, x: 0.64 },
}), { ...BED_BASE, hw: 1.0, floorY: 0.94, railY: 1.36, sillY: 0.42, wheelR: 0.44, archR: 0.52 }, (mb) => {
  if (mb.lod < 2) stacks(mb, 0.98, 1.35, 2.05, -0.62);
}, 'pickup', { lampY: 1.1, bumperY: 0.6 });

// ---------------------------------------------------------------------------------------------------------- lifted truck
const LIFTED_CAB: CarPlan = derive(PICKUP_CAB, {
  wheels: W(0.6, 0.38, 0.5, 'mud', 6, 0x3a3d40), ride: 0.62, hw: 1.03, belt: 1.72, trim: 0.32, zNose: 3.0, zTail: -0.6, zF: 2.0, zR: -1.9, cornerR: 0.4,
  top: [[-0.6, 1.72], [-0.45, 1.73], [0.6, 1.73], [1.1, 1.73], [1.4, 1.67], [2.0, 1.62], [2.6, 1.58], [3.0, 1.52]],
  cab: { ws0: 1.3, ws1: 0.66, y1: 2.42, rf1: -0.3, y2: 2.42, bl: -0.55, roofHW: 0.84, beltHW: 0.96, pillars: [0.38] }, doors: [1.15, 0.38, -0.5],
  lampF: { y: 1.42, w: 0.4, h: 0.16, x: 0.7 }, mirror: { y: 2.1, z: 1.12, big: true }, bumperF: 'black', grille: 'tall',
});
const LIFTED_BED: BedSpec = { z0: -0.6, z1: -3.0, floorY: 1.24, railY: 1.66, sillY: 0.8, hw: 1.05, archR: 0.66, wheelZ: -1.9, wheelR: 0.6 };
/** The lift: axle beams, leaf springs and shocks you can see under the body; the joke flag and the light bar go on top. */
function liftExtras(mb: ModelBuilder, plan: CarPlan): void {
  const r = plan.wheels.r;
  if (mb.lod < 2) for (const z of [plan.zF, plan.zR]) {
    mb.add(boxG(plan.hw * 1.8, 0.22, 0.24, 0, r, z), 0x1b1c1e, ZONE.STEEL, 0);
    mb.add(cylG(0.14, 0.14, 0.26, mb.seg(8, 6), 'z', 0, r, z, false), 0x2a2d30, ZONE.STEEL, 0);
    if (mb.close) for (const s of [-1, 1]) {
      mb.add(boxG(0.05, 0.05, 0.05, s * 0.72, r + 0.42, z), 0xd8b62c, ZONE.STEEL, 0);       // a yellow shock body
      mb.add(cylG(0.045, 0.045, 0.5, 6, 'y', s * 0.72, r + 0.36, z + 0.15), 0xd6b12a, ZONE.STEEL, 0);
    }
  }
  const c = plan.cab;
  // the roof light bar: a row of white lamps, glowing at night
  if (mb.lod < 2) {
    mb.add(boxG(1.2, 0.09, 0.1, 0, c.y1 + 0.08, c.ws1 + 0.05), 0x151617, ZONE.PLASTIC, 0);
    mb.add(boxG(1.14, 0.06, 0.03, 0, c.y1 + 0.08, c.ws1 + 0.105), 0xfff6dc, ZONE.WORKLIGHT, 0);
  }
  // the flag: a chrome pole with a red flag, as before (this truck is a joke)
  mb.add(cylG(0.035, 0.035, 1.15, mb.seg(6, 4), 'y', 0.36 * plan.hw, LIFTED_BED.railY + 0.575, -2.35, false), 0xadb4b9, ZONE.CHROME, 0);
  mb.add(quadG([0.36 * plan.hw + 0.02, LIFTED_BED.railY + 1.1, -2.35], [0.36 * plan.hw + 0.02, LIFTED_BED.railY + 0.6, -2.35], [-0.35, LIFTED_BED.railY + 0.6, -2.35], [-0.35, LIFTED_BED.railY + 1.1, -2.35]), 0x9f222b, ZONE.PANEL, 0);
  mb.add(quadG([-0.35, LIFTED_BED.railY + 1.1, -2.35], [-0.35, LIFTED_BED.railY + 0.6, -2.35], [0.36 * plan.hw + 0.02, LIFTED_BED.railY + 0.6, -2.35], [0.36 * plan.hw + 0.02, LIFTED_BED.railY + 1.1, -2.35]), 0x9f222b, ZONE.PANEL, 0);
  if (mb.lod < 2) mb.add(sideDecalG(-(LIFTED_BED.hw + 0.004), 1.0, 1.4, -2.7, -1.0, 'propane'), 0xffffff, ZONE.DECAL, 0);
  if (mb.lod < 2) stacks(mb, plan.hw * 0.93, 1.6, 2.7, -0.7);
}
pickup('liftedTruck', 'Lifted truck', 1, LIFTED_CAB, LIFTED_BED, (mb) => liftExtras(mb, LIFTED_CAB), 'liftedTruck', { lampY: 1.5, bumperY: 0.95 });
const DUALLY = derive(LIFTED_CAB, { wheels: W(0.62, 0.34, 0.5, 'mud', 6, 0x3a3d40, true), hw: 1.06, ride: 0.66, zR: -1.95 });
pickup('liftedTruck.dually', 'Lifted dually', 0.5, DUALLY, { ...LIFTED_BED, hw: 1.08, wheelZ: -1.95, wheelR: 0.62, archR: 0.68 }, (mb) => liftExtras(mb, DUALLY), 'liftedTruck', { lampY: 1.5, bumperY: 0.95 });
const ROCK = derive(LIFTED_CAB, {
  zTail: 0.25, cab: { ws1: 0.9, rf1: 0.5, bl: 0.22, pillars: [], y1: 2.4, y2: 2.4 }, doors: [1.15, 0.28], wheels: W(0.62, 0.38, 0.5, 'mud', 5, 0x2b2e31),
  top: [[0.25, 1.72], [0.4, 1.73], [0.8, 1.73], [1.1, 1.73], [1.4, 1.67], [2.0, 1.62], [2.6, 1.58], [3.0, 1.52]],
});
pickup('liftedTruck.rock', 'Lifted rock crawler', 0.4, ROCK, { ...LIFTED_BED, z0: 0.25 }, (mb) => {
  liftExtras(mb, ROCK);
  // a roll cage over the bed and a spare wheel on top
  if (mb.lod < 2) {
    for (const s of [-1, 1]) { mb.add(boxG(0.06, 0.9, 0.06, s * 0.95, 2.1, -0.4), 0x1a1b1c, ZONE.STEEL, 0); mb.add(boxG(0.06, 0.9, 0.06, s * 0.95, 2.1, -2.7), 0x1a1b1c, ZONE.STEEL, 0); mb.add(boxG(0.06, 0.06, 2.3, s * 0.95, 2.55, -1.55), 0x1a1b1c, ZONE.STEEL, 0); }
    mb.add(boxG(1.9, 0.06, 0.06, 0, 2.55, -0.4), 0x1a1b1c, ZONE.STEEL, 0);
  }
}, 'liftedTruck', { lampY: 1.5, bumperY: 0.95 });

// ---------------------------------------------------------------------------------------------------------------- cyberslop
/** The Cyberslop is a joke: an unpainted stainless wedge of flat panels, a light bar the full width of the nose and of the tail. */
def('cyberslop', 'cyberslop', 'Cyberslop', 1, (mb) => {
  const hw = 1.02, r = 0.46, ride = 0.34, R = r + 0.06, zf = 1.85, zr = -1.75;
  // the top line is straight lines: up the windscreen to the peak, down the roof, then a flat bed cover
  const topAt = (z: number): number => z > 0.45 ? 1.88 - (z - 0.45) / 2.4 * 0.96 : z > -0.35 ? 1.88 + (0.45 - z) / 0.8 * 0.02 : z > -1.5 ? 1.9 - (-0.35 - z) / 1.15 * 0.5 : 1.4 - (-1.5 - z) / 1.35 * 0.08;
  const topW = (z: number) => z > 0.45 ? 0.72 + (z - 0.45) / 2.4 * 0.05 : z > -1.5 ? 0.66 : 0.78;
  const under = (z: number): number => {
    let yb = ride;
    for (const a of [zf, zr]) { const dz = z - a; if (Math.abs(dz) < R) yb = Math.max(yb, r + Math.sqrt(R * R - dz * dz)); }
    return yb;
  };
  const zs = new Set<number>([-2.85, -1.5, -0.35, 0.45, 2.85]);
  const steps = mb.lod === 0 ? 6 : mb.lod === 1 ? 4 : 0;
  for (const a of [zf, zr]) { if (steps) for (let k = 0; k <= steps; k++) zs.add(Math.round((a + R * Math.cos((k / steps) * Math.PI)) * 1000) / 1000); else { zs.add(a - R); zs.add(a + R); } }
  const rings: V3[][] = [];
  for (const z of [...zs].sort((a, b) => a - b)) {
    const t = topAt(z), tw = topW(z), yb = under(z);
    const x = z > 2.0 ? hw * (1 - 0.1 * ((z - 2.0) / 0.85)) : hw;      // the nose narrows into a blade
    const ys = Math.min(t, Math.max(yb + 0.25, 1.05));
    rings.push([[x, yb, z], [x, ys, z], [Math.min(tw, x), t, z], [-Math.min(tw, x), t, z], [-x, ys, z], [-x, yb, z]]);
  }
  mb.add(loftG(rings, { closeFirst: true, closeLast: true, crease: 0.05 }), 0xb9bdc0, ZONE.STEEL, 0);
  // the windscreen and the side glass are flat dark panes on the wedge
  const gz = (z: number) => topAt(z) + 0.006;
  mb.add(quadG([-topW(1.7) * 0.92, gz(1.7), 1.7], [topW(1.7) * 0.92, gz(1.7), 1.7], [topW(-0.05) * 0.92, gz(-0.05), -0.05], [-topW(-0.05) * 0.92, gz(-0.05), -0.05]), 0x1b2a33, ZONE.GLASS, 0);
  if (mb.lod < 2) for (const s of [-1, 1]) {
    // side window: a slanted quad between the door line and the roof edge
    const x0 = s * (hw + 0.004), x1 = s * (topW(0.2) + 0.03);
    const p = [[x0, 1.06, 1.35], [x0, 1.06, -1.15], [x1, 1.72, -0.3], [x1, 1.6, 1.0]] as V3[];
    mb.add(s > 0 ? quadG(p[0], p[1], p[2], p[3]) : quadG(p[1], p[0], p[3], p[2]), 0x1b2a33, ZONE.GLASS, 0);
  }
  // wheels: flush covers
  const spec: WheelSpec = { r, tw: 0.3, rim: 0.7, style: 'cover', rimColor: 0x3a3d40 };
  for (const z of [zf, zr]) for (const s of [-1, 1]) addWheel(mb, s * (hw - 0.19), r, z, spec, z > 0);
  // the light bars: the full width of the nose, and of the tail
  mb.add(boxG(hw * 1.7, 0.05, 0.03, 0, 0.96, 2.85), 0xf4f0e2, ZONE.HEAD, 0);
  mb.add(boxG(hw * 1.6, 0.05, 0.03, 0, 1.34, -2.86), 0xc0121a, ZONE.TAIL, 0);
  mb.add(boxG(0.3, 0.04, 0.03, hw * 0.72, 0.82, 2.85), 0xffa317, ZONE.TURN, 0);
  mb.add(boxG(0.3, 0.04, 0.03, -hw * 0.72, 0.82, 2.85), 0xffa317, ZONE.TURN, 0);
  mb.add(boxG(0.22, 0.05, 0.03, hw * 0.5, 1.22, -2.87), 0xf3f3ef, ZONE.REVERSE, 0);
  mb.add(boxG(0.22, 0.05, 0.03, -hw * 0.5, 1.22, -2.87), 0xf3f3ef, ZONE.REVERSE, 0);
  mb.lamps.head.push([0.7, 0.96, 2.85], [-0.7, 0.96, 2.85]);
  mb.lamps.tail.push([0.7, 1.34, -2.86], [-0.7, 1.34, -2.86]);
  mb.lamps.reverse.push([0.5, 1.22, -2.87], [-0.5, 1.22, -2.87]);
  mb.lamps.turnLeft.push([hw * 0.72, 0.82, 2.85], [hw * 0.72, 1.3, -2.86]); mb.lamps.turnRight.push([-hw * 0.72, 0.82, 2.85], [-hw * 0.72, 1.3, -2.86]);
  mb.lamps.nose = [2.86, 0.8]; mb.lamps.tailZ = -2.86; mb.lamps.height = 0.96;
  if (mb.lod < 2) for (const s of [-1, 1]) mb.add(sideDecalG(s * (hw + 0.006), 0.5, 0.8, -1.0, 0.6, 'stroad'), 0xffffff, ZONE.DECAL, 0);
  if (mb.lod < 2) mb.add(endDecalG(-2.87, 0.5, 0.63, -0.26, 0.26, 'plate'), 0xffffff, ZONE.DECAL, 0);
  return r;
});
void clamp; void extrudeG; void lightBar; void THREE;
