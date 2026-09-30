// Vans, box trucks, the emergency vehicles, garbage trucks, the transit bus, tow trucks and semis. Most are one hull whose top line is
// the height of the box behind a low cab (vehicleBody.ts), with the cab's windows, doors, lamps and livery added on top.
import * as THREE from 'three';
import { buildCar, type CarBuild, type CarPlan } from './vehicleBody';
import { def } from './vehicleRegistry';
import { addWheel, boxG, cylG, endQuadG, extrudeG, loftG, ModelBuilder, planeG, quadG, sideQuadG, ZONE, type V3, type WheelSpec } from './vehicleKit';
import { lightBar, roofRack, stacks } from './vehicleParts';
import { endDecalG, sideDecalG } from './vehicleDecals';

const W = (r: number, tw: number, rim: number, style: WheelSpec['style'] = 'steel', spokes = 5, rimColor?: number, dual = false): WheelSpec => ({ r, tw, rim, style, spokes, rimColor, dual });
type Over = Omit<Partial<CarPlan>, 'cab'> & { cab?: Partial<CarPlan['cab']> };
const derive = (base: CarPlan, over: Over): CarPlan => ({ ...base, ...over, cab: { ...base.cab, ...(over.cab ?? {}) } });
type Kind = Parameters<typeof def>[1];
function model(id: string, kind: Kind, label: string, weight: number, plan: CarPlan, extras?: (mb: ModelBuilder, b: CarBuild) => void): void {
  def(id, kind, label, weight, (mb) => { const b = buildCar(mb, plan); extras?.(mb, b); return plan.wheels.r; });
}
const solid = (mb: ModelBuilder, g: THREE.BufferGeometry, color: number, zone: number = ZONE.PANEL) => mb.add(g, color, zone, 0);
/** A flat coloured strip on a side of the vehicle, centred at (y, z) and h x len big: two triangles. */
const strip = (mb: ModelBuilder, x: number, y: number, z: number, h: number, len: number, color: number, zone: number = ZONE.PANEL) => mb.add(sideQuadG(x, y - h / 2, y + h / 2, z - len / 2, z + len / 2), color, zone, 0);

/** Rear doors of a box or van: a centre seam, the door frame, two handles and (close range) a window in each leaf. */
function rearDoors(mb: ModelBuilder, z: number, hw: number, y0: number, y1: number, windows = false): void {
  if (mb.lod === 2) return;
  const zz = z - 0.006;
  mb.add(boxG(0.025, y1 - y0, 0.02, 0, (y0 + y1) / 2, zz), 0x141516, ZONE.PLASTIC, 0);
  if (mb.close) {
    for (const s of [-1, 1]) {
      mb.add(boxG(0.04, 0.22, 0.03, s * 0.09, (y0 + y1) / 2, zz - 0.01), 0xa9afb3, ZONE.CHROME, 0);
      mb.add(boxG(0.02, y1 - y0, 0.02, s * (hw - 0.09), (y0 + y1) / 2, zz), 0x141516, ZONE.PLASTIC, 0);
      if (windows) mb.add(quadG([s * 0.14, y1 - 0.75, zz - 0.004], [s * 0.7, y1 - 0.75, zz - 0.004], [s * 0.7, y1 - 0.2, zz - 0.004], [s * 0.14, y1 - 0.2, zz - 0.004]), 0x1a2830, ZONE.GLASS, 0);
    }
    mb.add(boxG(hw * 2 - 0.16, 0.02, 0.02, 0, y0, zz), 0x141516, ZONE.PLASTIC, 0);
  }
}
/** A bumper across the tail, and mud flaps behind the rear wheels. */
function tailBumper(mb: ModelBuilder, hw: number, z: number, y: number, chrome = false): void {
  mb.add(boxG(hw * 2 - 0.1, 0.14, 0.14, 0, y, z - 0.07), chrome ? 0xb9bec2 : 0x18191b, chrome ? ZONE.CHROME : ZONE.PLASTIC, 0);
}
function mudFlaps(mb: ModelBuilder, x: number, z: number, y: number, h = 0.4): void {
  if (!mb.close) return;
  for (const s of [-1, 1]) mb.add(boxG(0.02, h, 0.34, s * x, y, z), 0x141516, ZONE.PLASTIC, 0);
}

// ---------------------------------------------------------------------------------------------------------- SLOP vans
const SLOPVAN: CarPlan = {
  wheels: W(0.38, 0.225, 0.62, 'cover'),
  zF: 1.65, zR: -1.55, ride: 0.2, hw: 0.97, belt: 1.5, cornerR: 0.4, noseTaper: 0.12, tailTaper: 0.06,
  top: [[-2.7, 1.9], [-2.62, 2.18], [-2.0, 2.2], [0.3, 2.2], [0.55, 1.5], [1.75, 1.5], [2.12, 1.28], [2.45, 1.02], [2.7, 0.86]],
  cab: { ws0: 2.05, ws1: 1.15, y1: 2.08, rf1: 0.62, y2: 2.18, bl: 0.5, roofHW: 0.83, beltHW: 0.93, pillars: [0.85], pillarW: 0.085, noRear: true, solidFrom: 0.9, header: 0.3 },
  doors: [1.95, 0.85], bumperF: 'body', bumperR: 'black', grille: 'wide', exhaust: 'none',
  lampR: { y: 0.95, w: 0.13, h: 0.5, x: 0.83 }, mirror: { y: 1.65, z: 1.85, big: true },
};
function slopExtras(mb: ModelBuilder, b: CarBuild): void {
  const p = b.plan, hw = p.hw + 0.005;
  rearDoors(mb, -2.7, p.hw, 0.35, 1.95);
  if (mb.lod < 2) for (const s of [-1, 1]) mb.add(sideDecalG(s * hw, 0.62, 1.78, -2.4, -0.55, 'slop'), 0xffffff, ZONE.DECAL, 0);
  if (mb.close) for (const s of [-1, 1]) mb.add(boxG(0.02, 1.4, 0.03, s * hw, 1.15, 0.45), 0x141516, ZONE.PLASTIC, 0); // the seam behind the cab
}
model('slopVan', 'slopVan', 'SLOP van', 1, SLOPVAN, slopExtras);
model('slopVan.cargo', 'slopVan', 'Cargo van', 0.7, derive(SLOPVAN, {
  top: [[-2.7, 1.7], [-2.62, 1.95], [-2.0, 1.97], [0.3, 1.97], [0.55, 1.5], [1.75, 1.5], [2.12, 1.28], [2.45, 1.02], [2.7, 0.86]], cab: { y1: 1.9, y2: 1.96, header: 0.2 }, wheels: W(0.36, 0.215, 0.62, 'cover'),
}), slopExtras);
model('slopVan.sprinter', 'slopVan', 'High-roof van', 0.6, derive(SLOPVAN, {
  ride: 0.24, top: [[-2.7, 2.05], [-2.62, 2.35], [-2.0, 2.38], [0.3, 2.38], [0.55, 1.55], [1.75, 1.55], [2.12, 1.32], [2.45, 1.05], [2.7, 0.88]],
  cab: { y1: 2.25, y2: 2.36, header: 0.4 }, wheels: W(0.38, 0.22, 0.62, 'steel', 5, 0x8d9296, true), zR: -1.6,
}), slopExtras);

// ---------------------------------------------------------------------------------------------------------- hippie bus
const VW: CarPlan = {
  wheels: W(0.34, 0.19, 0.66, 'cover'), zF: 1.45, zR: -1.2, ride: 0.2, hw: 0.885, belt: 1.05, cornerR: 0.5, noseTaper: 0.2, tailTaper: 0.16,
  top: [[-2.25, 0.95], [-2.15, 1.05], [-1.5, 1.06], [0, 1.06], [1.9, 1.06], [2.15, 1.02], [2.25, 0.92]],
  cab: { ws0: 2.2, ws1: 1.94, y1: 1.94, rf1: -2.05, y2: 1.94, bl: -2.18, roofHW: 0.8, beltHW: 0.87, pillars: [1.05, 0.15, -0.75, -1.5], pillarW: 0.07, roofColor: 0xebe2c8 },
  doors: [1.75, 1.05, -0.9], bumperF: 'chrome', bumperR: 'chrome', grille: 'none', exhaust: 'single', roundLamps: true,
  lampF: { y: 0.66, w: 0.26, h: 0.2, x: 0.6 }, lampR: { y: 0.82, w: 0.12, h: 0.22, x: 0.78, bar: true }, mirror: { y: 1.3, z: 1.95 },
};
function vwExtras(mb: ModelBuilder, b: CarBuild): void {
  const c = b.plan.cab;
  if (mb.lod < 2) {
    // the split windscreen's centre bar, the chrome waist trim and the V on the nose
    mb.add(boxG(0.04, 0.9, 0.035, 0, 1.5, c.ws0 - 0.1), 0xe5dcc4, ZONE.PANEL, 0);
    for (const s of [-1, 1]) mb.add(boxG(0.012, 0.035, 3.9, s * (b.plan.hw + 0.004), 1.0, -0.1), 0xb9bec2, ZONE.CHROME, 0);
    mb.add(endDecalG(2.256, 0.32, 0.62, -0.32, 0.32, 'peace'), 0xffffff, ZONE.DECAL, 0);
    for (const s of [-1, 1]) mb.add(boxG(0.03, 0.34, 0.03, s * 0.13, 0.88, 2.27, 0, 0, s * 0.42), 0xb9bec2, ZONE.CHROME, 0);
    for (const s of [-1, 1]) mb.add(sideDecalG(s * (b.plan.hw + 0.006), 0.3, 0.95, -1.3, 0.05, 'bus'), 0xffffff, ZONE.DECAL, 0);
  }
}
model('vwBus', 'vwBus', 'Hippie bus', 1, VW, vwExtras);
model('vwBus.samba', 'vwBus', 'Camper with surfboard', 0.6, derive(VW, { wheels: W(0.34, 0.19, 0.66, 'cover'), cab: { roofColor: 0xf4f1e6, pillars: [1.05, 0.3, -0.45, -1.2, -1.75] } }), (mb, b) => {
  vwExtras(mb, b);
  if (mb.lod < 2) {
    // a pop-top and a roof rack with a surfboard
    solid(mb, boxG(1.5, 0.16, 2.7, 0, 2.0, -0.25), 0xf4f1e6);
    for (const z of [-1.4, 0.9]) solid(mb, boxG(1.6, 0.03, 0.05, 0, 2.11, z), 0x2a2d30, ZONE.PLASTIC);
    solid(mb, boxG(0.42, 0.06, 2.6, 0.2, 2.16, -0.3, 0, 0.04, 0), 0x66c5d9);
    solid(mb, boxG(0.42, 0.065, 0.5, 0.2, 2.16, 0.95, 0, 0.04, 0), 0x66c5d9);
  }
});

// -------------------------------------------------------------------------------------------------------- box trucks
const BOX: CarPlan = {
  wheels: W(0.46, 0.26, 0.6, 'steel', 5, 0x9aa0a4, true),
  axles: [-2.35, 2.55], zF: 2.55, zR: -2.35, ride: 0.55, hw: 1.0, hwAt: [[-4, 1.18], [0.55, 1.18], [0.75, 0.99], [4, 0.99]], belt: 1.55, cornerR: 0.3, noseTaper: 0.08, tailTaper: 0.03,
  top: [[-4.0, 3.0], [-3.94, 3.3], [-3.4, 3.34], [0.5, 3.34], [0.72, 1.6], [3.3, 1.6], [3.8, 1.5], [4.0, 1.32]],
  cab: { ws0: 3.72, ws1: 3.38, y1: 2.52, rf1: 0.85, y2: 2.52, bl: 0.75, roofHW: 0.88, beltHW: 0.95, pillars: [2.75], pillarW: 0.09, noRear: true, solidFrom: 2.0, header: 0.3 },
  doors: [3.55, 2.75], bumperF: 'black', bumperR: 'black', grille: 'wide', exhaust: 'none', trim: 0.14, frontFace: 'flat',
  lampF: { y: 1.02, w: 0.36, h: 0.16, x: 0.62 }, lampR: { y: 1.05, w: 0.16, h: 0.42, x: 1.06 }, mirror: { y: 2.0, z: 3.55, big: true },
  split: { z: 0.62, color: 0xf2f3f1, zone: 12 },
};
function boxExtras(mb: ModelBuilder, b: CarBuild): void {
  const p = b.plan;
  // rear roll-up door: horizontal ribs, a frame and a lift handle
  if (mb.lod < 2) {
    mb.add(endQuadG(-4.006, -1.05, 1.05, 1.02, 3.08), 0xdfe1e0, ZONE.PANEL, 0);
    if (mb.close) for (let y = 1.1; y < 3.05; y += 0.16) mb.add(endQuadG(-4.012, -1.04, 1.04, y, y + 0.03), 0xa4a9ac, ZONE.PANEL, 0);
    solid(mb, boxG(0.5, 0.05, 0.03, 0, 1.2, -4.02), 0x2a2d30, ZONE.PLASTIC);
  }
  tailBumper(mb, 1.18, -4.0, 0.72);
  mudFlaps(mb, 1.15, -2.9, 0.5);
  if (mb.lod < 2) for (const s of [-1, 1]) mb.add(sideDecalG(s * (1.19), 1.15, 2.6, -3.3, -1.2, 'slop'), 0xffffff, ZONE.DECAL, 0);
  if (mb.close) { // a ladder step at the rear, and the fuel tank under the frame
    for (const s of [-1, 1]) mb.add(cylG(0.2, 0.2, 0.8, 10, 'z', s * 0.62, 0.62, 0.3), 0xb9bec2, ZONE.CHROME, 0);
    mb.add(boxG(0.06, 1.6, 0.02, 1.0, 1.9, -4.02), 0x2a2d30, ZONE.STEEL, 0);
  }
  void p;
}
model('boxTruck', 'boxTruck', 'Box truck', 1, BOX, boxExtras);
model('boxTruck.stepvan', 'boxTruck', 'Step van', 0.6, derive(BOX, {
  ride: 0.45, hw: 1.16, hwAt: undefined, axles: [-2.0, 2.6], zF: 2.6, zR: -2.0, wheels: W(0.44, 0.24, 0.6, 'steel', 5, 0x9aa0a4),
  top: [[-4.0, 3.0], [-3.94, 3.2], [-3.4, 3.24], [2.9, 3.24], [3.15, 1.7], [3.8, 1.6], [4.0, 1.35]],
  cab: { ws0: 3.9, ws1: 3.2, y1: 3.14, rf1: 2.9, y2: 3.14, bl: 2.85, pillars: [3.5], roofHW: 1.0, beltHW: 1.1, header: 0.4, solidFrom: 0 }, doors: [3.8, 3.5],
  split: { z: 2.95, color: 0xf2f3f1, zone: 12 }, lampF: { y: 1.1, w: 0.4, h: 0.2, x: 0.72 }, lampR: { y: 1.05, w: 0.16, h: 0.42, x: 1.04 },
}), boxExtras);
model('boxTruck.moving', 'boxTruck', 'Moving truck', 0.7, derive(BOX, { ride: 0.5, wheels: W(0.44, 0.25, 0.6, 'steel', 5, 0x9aa0a4) }), (mb, b) => {
  boxExtras(mb, b);
  // the over-cab bulge of a rental truck, and stripes down the side
  solid(mb, boxG(2.3, 0.9, 1.8, 0, 2.95, 1.7), 0xf2f3f1);
  if (mb.lod < 2) for (const s of [-1, 1]) { strip(mb, s * 1.185, 1.5, -1.8, 0.16, 3.6, 0xd3202b); strip(mb, s * 1.185, 1.25, -1.8, 0.08, 3.6, 0x203f78); }
});
model('boxTruck.bev', 'boxTruck', 'Beverage truck', 0.5, derive(BOX, { wheels: W(0.46, 0.26, 0.6, 'steel', 5, 0x9aa0a4, true) }), (mb, b) => {
  boxExtras(mb, b);
  // roll-up bays down both sides: dark ribbed panels
  if (mb.lod < 2) for (const s of [-1, 1]) for (const z of [-3.1, -1.9, -0.7]) {
    strip(mb, s * 1.19, 1.6, z, 1.25, 1.0, 0x40454a);
    if (mb.close) for (let y = 1.05; y < 2.2; y += 0.13) strip(mb, s * 1.192, y, z, 0.02, 0.96, 0x2a2d30, ZONE.PLASTIC);
  }
});

// -------------------------------------------------------------------------------------------------------- ambulances
const AMB: CarPlan = {
  wheels: W(0.42, 0.25, 0.6, 'cover'),
  zF: 2.15, zR: -1.95, ride: 0.4, hw: 1.0, hwAt: [[-3.25, 1.12], [1.35, 1.12], [1.5, 0.98], [3.25, 0.98]], belt: 1.4, cornerR: 0.3, noseTaper: 0.1, tailTaper: 0.03,
  top: [[-3.25, 2.4], [-3.2, 2.72], [-2.6, 2.75], [1.4, 2.75], [1.58, 1.42], [2.6, 1.42], [2.95, 1.2], [3.25, 0.95]],
  cab: { ws0: 2.65, ws1: 2.05, y1: 2.2, rf1: 1.62, y2: 2.2, bl: 1.55, roofHW: 0.85, beltHW: 0.94, pillars: [2.0], pillarW: 0.09, noRear: true, solidFrom: 1.9, header: 0.28 },
  doors: [2.55, 2.0], bumperF: 'body', bumperR: 'black', grille: 'wide', exhaust: 'none',
  lampR: { y: 1.0, w: 0.14, h: 0.4, x: 1.02 }, mirror: { y: 1.7, z: 2.5, big: true },
  split: { z: 1.5, color: 0xf3f2ec, zone: 12 },
};
function ambulanceExtras(mb: ModelBuilder, b: CarBuild): void {
  const hw = 1.13;
  lightBar(mb, 2.28, 1.85, 0.7);
  rearDoors(mb, -3.25, 1.12, 0.6, 2.5, true);
  if (mb.lod < 2) {
    for (const s of [-1, 1]) {
      strip(mb, s * (hw + 0.002), 1.0, -0.8, 0.2, 4.4, 0xc21f2c);          // the red stripes
      strip(mb, s * (hw + 0.002), 1.28, -0.8, 0.09, 4.4, 0xc21f2c);
      mb.add(sideDecalG(s * (hw + 0.008), 1.4, 2.5, -2.6, 0.2, 'ambulance'), 0xffffff, ZONE.DECAL, 0);
      mb.add(boxG(0.1, 0.1, 0.1, s * 1.08, 2.8, -3.05), 0xd0141f, ZONE.SIREN_RED, 0);
      mb.lamps.siren.push([s * 1.08, 2.8, -3.05]);
    }
  }
  tailBumper(mb, 1.12, -3.25, 0.62);
  void b;
}
model('ambulance', 'ambulance', 'Ambulance', 1, AMB, ambulanceExtras);
model('ambulance.van', 'ambulance', 'Van ambulance', 0.5, derive(SLOPVAN, {
  hw: 1.03, ride: 0.26, wheels: W(0.39, 0.235, 0.62, 'cover'),
  top: [[-3.25, 2.1], [-3.18, 2.5], [-2.6, 2.6], [0.6, 2.6], [0.88, 1.55], [2.1, 1.55], [2.55, 1.32], [2.95, 1.05], [3.25, 0.9]],
  zF: 2.05, zR: -1.9, cab: { ws0: 2.5, ws1: 1.6, y1: 2.35, rf1: 0.95, y2: 2.52, bl: 0.85, pillars: [1.2], solidFrom: 1.2, header: 0.4, roofHW: 0.88, beltHW: 0.98 },
  split: { z: 0.9, color: 0xf3f2ec, zone: 12 },
}), (mb) => {
  lightBar(mb, 2.55, 1.75, 0.68);
  rearDoors(mb, -3.25, 1.03, 0.4, 2.2, true);
  if (mb.lod < 2) for (const s of [-1, 1]) {
    strip(mb, s * 1.035, 0.95, -1.4, 0.2, 3.6, 0xc21f2c);
    mb.add(sideDecalG(s * 1.04, 1.2, 2.2, -2.8, -0.5, 'ambulance'), 0xffffff, ZONE.DECAL, 0);
  }
});

// ---------------------------------------------------------------------------------------------------------- fire trucks
const FIRE: CarPlan = {
  wheels: W(0.5, 0.32, 0.62, 'steel', 5, 0xc9ced2),
  axles: [-3.6, -2.35, 3.3], zF: 3.3, zR: -2.35, ride: 0.5, hw: 1.2, belt: 1.75, trim: 0.2, cornerR: 0.35, noseTaper: 0.06, tailTaper: 0.03,
  top: [[-5.0, 2.3], [-4.93, 2.56], [-4.0, 2.58], [1.7, 2.58], [2.0, 1.85], [4.4, 1.8], [4.75, 1.65], [5.0, 1.32]],
  cab: { ws0: 4.55, ws1: 3.8, y1: 3.06, rf1: 2.2, y2: 3.06, bl: 2.1, roofHW: 1.02, beltHW: 1.14, pillars: [3.4, 2.8], pillarW: 0.1, noRear: true, solidFrom: 2.45, header: 0.3 },
  doors: [4.35, 3.4, 2.8], bumperF: 'chrome', bumperR: 'chrome', grille: 'wide', exhaust: 'none',
  lampF: { y: 1.25, w: 0.34, h: 0.16, x: 0.85 }, lampR: { y: 1.1, w: 0.16, h: 0.4, x: 1.05 }, mirror: { y: 2.3, z: 4.35, big: true },
  split: { z: 1.9, color: 0xb3151d, zone: 12 },
};
function fireCommon(mb: ModelBuilder): void {
  const hw = 1.21;
  lightBar(mb, 3.14, 3.6, 0.72);
  if (mb.lod < 2) {
    for (const s of [-1, 1]) {
      strip(mb, s * (hw + 0.002), 1.66, -1.0, 0.09, 6.9, 0xf3eee0);                                // the white stripe
      mb.add(sideDecalG(s * (hw + 0.008), 0.95, 1.6, 2.85, 4.25, 'fire'), 0xffffff, ZONE.DECAL, 0);
      if (mb.close) for (const z of [-3.6, -2.0, -0.4, 1.0]) {                                     // roll-up compartment doors
        strip(mb, s * (hw + 0.004), 1.05, z, 1.05, 1.2, 0xb0b4b7, ZONE.CHROME);
        for (let y = 0.6; y < 1.6; y += 0.14) strip(mb, s * (hw + 0.006), y, z, 0.02, 1.15, 0x6d7276, ZONE.CHROME);
      }
    }
    // rear: chevron warning stripes
    for (let i = -4; i < 4; i++) mb.add(endQuadG(-5.005, i * 0.3, i * 0.3 + 0.3, 0.55, 1.45), i % 2 ? 0xe6c82a : 0xb3151d, ZONE.PANEL, 0);
  }
  tailBumper(mb, 1.2, -5.0, 0.62, true);
}
model('firetruck', 'firetruck', 'Ladder truck', 1, FIRE, (mb) => {
  fireCommon(mb);
  // the ladder: rails and rungs along the roof of the body, and the turntable at the tail
  if (mb.lod < 2) {
    for (const x of [-0.42, 0.42]) solid(mb, boxG(0.09, 0.09, 6.3, x, 2.9, -1.9), 0xc7ccd0, ZONE.CHROME);
    if (mb.close) for (let z = -4.9; z < 1.2; z += 0.5) solid(mb, boxG(0.9, 0.06, 0.07, 0, 2.93, z), 0xc7ccd0, ZONE.CHROME);
    solid(mb, boxG(1.6, 0.35, 1.4, 0, 2.72, -4.2), 0x2b2e31, ZONE.STEEL);
  }
});
model('firetruck.pumper', 'firetruck', 'Pumper', 0.7, derive(FIRE, {
  axles: [-2.4, 3.3], zR: -2.4, top: [[-5.0, 2.2], [-4.93, 2.42], [-4.0, 2.44], [1.7, 2.44], [2.0, 1.85], [4.4, 1.8], [4.75, 1.65], [5.0, 1.32]],
}), (mb) => {
  fireCommon(mb);
  // the hose bed: coils of yellow hose along the top, a deck gun, and the pump panel on the side
  if (mb.lod < 2) {
    solid(mb, boxG(1.7, 0.16, 5.0, 0, 2.5, -2.3), 0x24272a, ZONE.STEEL);
    for (let z = -4.4; z < 0.2; z += 0.55) mb.add(cylG(0.24, 0.24, 1.55, mb.seg(8, 6), 'x', 0, 2.72, z), 0xd8b23a, ZONE.PANEL, 0);
    solid(mb, boxG(0.3, 0.3, 0.3, 0, 2.7, -0.6), 0xb9bec2, ZONE.CHROME);
    for (const s of [-1, 1]) solid(mb, boxG(0.03, 0.6, 1.0, s * 1.215, 1.2, 0.3), 0xc0c5c9, ZONE.CHROME);
  }
});
model('firetruck.rescue', 'firetruck', 'Rescue truck', 0.45, derive(FIRE, {
  axles: [-2.4, 3.3], zR: -2.4, top: [[-5.0, 2.7], [-4.93, 2.9], [-4.0, 2.92], [1.7, 2.92], [2.0, 1.85], [4.4, 1.8], [4.75, 1.65], [5.0, 1.32]], hw: 1.22,
}), (mb) => {
  fireCommon(mb);
  if (mb.lod < 2) { solid(mb, boxG(1.9, 0.14, 3.6, 0, 3.0, -2.8), 0x24272a, ZONE.STEEL); for (const z of [-4.4, -1.4]) solid(mb, boxG(0.9, 0.5, 0.45, 0, 3.3, z), 0xf2c331); }
});

// ---------------------------------------------------------------------------------------------------------- garbage trucks
const GARB: CarPlan = {
  wheels: W(0.5, 0.31, 0.6, 'steel', 5, 0x8b9094),
  axles: [-2.6, -1.3, 2.7], zF: 2.7, zR: -2.6, ride: 0.5, hw: 1.0, hwAt: [[-4.5, 1.22], [0.75, 1.22], [0.95, 1.0], [4.5, 1.0]], belt: 1.6, cornerR: 0.3, noseTaper: 0.08, tailTaper: 0.03,
  top: [[-4.5, 3.05], [-4.44, 3.3], [-3.9, 3.36], [0.7, 3.36], [0.95, 1.65], [3.7, 1.65], [4.2, 1.5], [4.5, 1.3]],
  cab: { ws0: 4.05, ws1: 3.65, y1: 2.62, rf1: 1.05, y2: 2.62, bl: 0.98, roofHW: 0.9, beltHW: 0.96, pillars: [3.05], pillarW: 0.09, noRear: true, solidFrom: 2.2, header: 0.3 },
  doors: [3.85, 3.05], bumperF: 'black', bumperR: 'black', grille: 'wide', exhaust: 'none', trim: 0.14, frontFace: 'flat',
  lampF: { y: 1.08, w: 0.36, h: 0.16, x: 0.62 }, lampR: { y: 1.4, w: 0.16, h: 0.4, x: 1.08 }, mirror: { y: 2.1, z: 3.9, big: true },
  split: { z: 0.85, color: 0x2f6b3a, zone: 12 },
};
function garbageCommon(mb: ModelBuilder): void {
  if (mb.lod < 2) {
    for (const s of [-1, 1]) {
      mb.add(sideDecalG(s * 1.235, 1.35, 2.7, -3.6, -1.6, 'trash'), 0xffffff, ZONE.DECAL, 0);
      if (mb.close) for (let z = -4.2; z < 0.4; z += 0.9) strip(mb, s * 1.225, 2.35, z, 1.9, 0.09, 0x265a31);
    }
    solid(mb, boxG(0.5, 0.16, 0.5, 0.35, 2.75, 3.2), 0xffb020, ZONE.BEACON);      // amber beacon on the cab roof
    mb.lamps.beacon.push([0.35, 2.83, 3.2]);
  }
  mudFlaps(mb, 1.15, -3.15, 0.5);
}
model('garbageTruck', 'garbageTruck', 'Garbage truck', 1, GARB, (mb) => {
  garbageCommon(mb);
  // rear hopper and the side arm (an automated lifter reaching out on the right)
  if (mb.lod < 2) {
    solid(mb, boxG(2.2, 1.7, 0.9, 0, 1.95, -4.1, -0.3, 0, 0), 0x3a4145, ZONE.STEEL);
    solid(mb, boxG(1.7, 0.4, 0.2, 0, 0.95, -4.45), 0x111315, ZONE.PLASTIC);
    for (const s of [-1]) {                                    // folded against the body: the arm folds in when the truck drives
      solid(mb, boxG(0.16, 1.3, 0.16, s * 1.36, 1.5, 0.9, 0, 0, s * 0.08), 0xa9afb3, ZONE.CHROME);
      solid(mb, boxG(0.3, 0.16, 0.16, s * 1.42, 1.0, 0.9), 0xa9afb3, ZONE.CHROME);
      solid(mb, boxG(0.1, 0.5, 0.5, s * 1.58, 1.0, 0.9), 0x2a2d30, ZONE.STEEL);
    }
  }
  tailBumper(mb, 1.2, -4.45, 0.6);
});
model('garbageTruck.front', 'garbageTruck', 'Front-loader', 0.6, derive(GARB, { axles: [-2.3, 2.7], zR: -2.3, top: [[-4.5, 3.15], [-4.44, 3.3], [-3.9, 3.36], [0.7, 3.36], [0.95, 1.65], [3.7, 1.65], [4.2, 1.5], [4.5, 1.3]] }), (mb) => {
  garbageCommon(mb);
  // two forks over the cab and the lift arms running down the sides
  if (mb.lod < 2) {
    for (const s of [-1, 1]) {
      solid(mb, boxG(0.12, 0.12, 4.2, s * 0.85, 3.5, 2.3), 0xd8b23a, ZONE.STEEL);
      solid(mb, boxG(0.16, 0.16, 5.6, s * 1.32, 2.85, -1.3), 0xd8b23a, ZONE.STEEL);
      solid(mb, boxG(0.1, 0.1, 0.8, s * 0.85, 3.5, 4.3), 0x24272a, ZONE.STEEL);
    }
    solid(mb, boxG(2.0, 0.16, 0.16, 0, 3.5, 3.2), 0xd8b23a, ZONE.STEEL);
  }
  tailBumper(mb, 1.2, -4.5, 0.6);
});
model('garbageTruck.rear', 'garbageTruck', 'Rear-loader', 0.6, derive(GARB, { axles: [-2.4, 2.7], zR: -2.4, top: [[-4.5, 2.9], [-4.44, 3.1], [-3.9, 3.14], [0.7, 3.14], [0.95, 1.65], [3.7, 1.65], [4.2, 1.5], [4.5, 1.3]] }), (mb) => {
  garbageCommon(mb);
  // the open hopper at the tail: a dark mouth, a lip and two riding steps
  if (mb.lod < 2) {
    solid(mb, boxG(2.3, 1.3, 0.9, 0, 1.75, -4.1), 0x3a4145, ZONE.STEEL);
    solid(mb, boxG(1.9, 0.5, 0.1, 0, 2.0, -4.58), 0x0d0e0f, ZONE.DARK);
    for (const s of [-1, 1]) solid(mb, boxG(0.5, 0.06, 0.3, s * 0.85, 0.6, -4.6), 0x2a2d30, ZONE.STEEL);
  }
});

// ---------------------------------------------------------------------------------------------------------------- bus
const BUS: CarPlan = {
  wheels: W(0.5, 0.3, 0.6, 'steel', 5, 0xc9ced2),
  axles: [-3.1, 3.6], zF: 3.6, zR: -3.1, ride: 0.32, hw: 1.25, belt: 1.1, cornerR: 0.5, noseTaper: 0.06, tailTaper: 0.03,
  top: [[-6.0, 1.55], [-5.9, 1.62], [-4.6, 1.62], [-4.3, 1.12], [5.2, 1.12], [5.7, 1.0], [6.0, 0.72]],
  cab: { ws0: 5.95, ws1: 5.85, y1: 3.06, rf1: -5.85, y2: 3.08, bl: -5.92, roofHW: 1.19, beltHW: 1.26, pillars: [4.4, 3.0, 1.6, 0.2, -1.2, -2.6, -4.0], pillarW: 0.08, header: 0.5 },
  doors: [], bumperF: 'black', bumperR: 'black', grille: 'wide', exhaust: 'none', trim: 0.12,
  lampF: { y: 0.6, w: 0.34, h: 0.15, x: 0.9 }, lampR: { y: 0.95, w: 0.16, h: 0.4, x: 1.05 }, mirror: { y: 2.2, z: 5.6, big: true },
};
function busExtras(mb: ModelBuilder): void {
  if (mb.lod === 2) return;
  const hw = 1.265;
  for (const s of [-1, 1]) {
    // the lime stripe under the windows and the SLOP TRANSIT sign
    strip(mb, s * (hw + 0.004), 0.82, 0, 0.14, 11.4, 0xc6f432);
    mb.add(sideDecalG(s * (hw + 0.008), 0.3, 0.98, -3.8, -1.4, 'transit'), 0xffffff, ZONE.DECAL, 0);
  }
  // doors on the right (-x): front and middle, dark with a lighter window
  for (const z of [4.9, 0.9]) {
    mb.add(quadG([-hw - 0.012, 0.42, z - 0.55], [-hw - 0.012, 0.42, z + 0.55], [-hw - 0.012, 2.55, z + 0.55], [-hw - 0.012, 2.55, z - 0.55]), 0x22343f, ZONE.GLASS, 0);
    if (mb.close) solid(mb, boxG(0.03, 2.1, 0.03, -hw - 0.012, 1.5, z), 0x2a2d30, ZONE.PLASTIC);
  }
  // the destination sign over the windscreen and the roof air-conditioning pod
  mb.add(boxG(2.0, 0.26, 0.05, 0, 2.92, 5.99), 0xffb640, ZONE.MARKER, 0);
  solid(mb, boxG(1.9, 0.34, 2.4, 0, 3.22, -1.6), 0xd4d8d4, ZONE.CHROME);
  tailBumper(mb, 1.25, -6.0, 0.55);
}
model('cityBus', 'cityBus', 'SLOP Transit bus', 1, BUS, busExtras);
model('cityBus.electric', 'cityBus', 'Electric bus', 0.5, derive(BUS, { wheels: W(0.5, 0.3, 0.6, 'steel', 5, 0x8b9094) }), (mb) => {
  busExtras(mb);
  // no engine pod: a battery box on the roof and a charging pantograph
  if (mb.lod < 2) { solid(mb, boxG(2.1, 0.3, 5.4, 0, 3.24, -1.4), 0xc3c8cb, ZONE.CHROME); solid(mb, boxG(0.9, 0.07, 1.6, 0, 3.44, 1.6), 0x2a2d30, ZONE.STEEL); }
});

// ---------------------------------------------------------------------------------------------------------------- tow trucks
const TOW: CarPlan = {
  wheels: W(0.5, 0.3, 0.6, 'steel', 5, 0x9aa0a4, true),
  zNose: 3.5, zTail: 0.85, zF: 2.2, zR: -2.1, axles: [-2.1, 2.2], ride: 0.42, hw: 1.0, belt: 1.5, trim: 0.18, cornerR: 0.35, noseTaper: 0.08, noRear: true,
  top: [[0.85, 1.5], [1.0, 1.52], [1.9, 1.52], [2.2, 1.46], [2.9, 1.34], [3.5, 1.24]],
  cab: { ws0: 2.05, ws1: 1.35, y1: 2.2, rf1: 0.95, y2: 2.2, bl: 0.9, roofHW: 0.85, beltHW: 0.95, pillars: [], pillarW: 0.1, header: 0.25 }, doors: [1.9, 0.95],
  bumperF: 'chrome', grille: 'tall', exhaust: 'none', mirror: { y: 1.9, z: 2.0, big: true }, lampF: { y: 1.16, w: 0.38, h: 0.15, x: 0.66 },
};
function towDeck(mb: ModelBuilder, flat: boolean): void {
  // the working deck behind the cab: side rails, tool boxes, amber strobes and the winch
  const z0 = 0.85, z1 = -3.5;
  solid(mb, boxG(2.3, 0.14, z0 - z1, 0, 1.0, (z0 + z1) / 2), 0x2b2e31, ZONE.STEEL);
  if (mb.lod < 2) {
    for (const s of [-1, 1]) {
      solid(mb, boxG(0.16, 0.5, 1.3, s * 1.05, 1.32, -0.3), 0xc7ccd0, ZONE.CHROME);              // tool boxes
      solid(mb, boxG(0.05, 0.12, z0 - z1, s * 1.14, 1.1, (z0 + z1) / 2), 0x1a1b1c, ZONE.STEEL);
    }
    solid(mb, boxG(2.2, 0.2, 0.4, 0, 1.0, z1 + 0.2), 0xe6c82a);                                   // hazard-yellow tail
  }
  if (flat) {
    solid(mb, boxG(2.1, 0.06, 3.9, 0, 1.11, (z0 + z1) / 2 - 0.1, 0.03), 0x9aa0a4, ZONE.STEEL);
    if (mb.close) for (let z = -3.2; z < 0.7; z += 0.4) solid(mb, boxG(2.0, 0.012, 0.05, 0, 1.15, z), 0x5d6266, ZONE.STEEL);
  } else if (mb.lod < 2) {
    // the wrecker boom: a yellow arm angled up and back, a cross-bar, cable and hook
    solid(mb, boxG(0.22, 0.22, 3.2, 0, 1.9, -1.4, -0.45), 0xe2b52e);
    solid(mb, boxG(1.5, 0.14, 0.14, 0, 2.55, -2.6), 0xe2b52e);
    mb.add(cylG(0.03, 0.03, 0.9, 5, 'y', 0, 2.05, -2.7), 0x1a1b1c, ZONE.STEEL, 0);
    solid(mb, boxG(0.12, 0.18, 0.12, 0, 1.55, -2.7), 0xa9afb3, ZONE.CHROME);
  }
  lightBar(mb, 2.28, 1.35, 0.62, { amber: true });
  mb.add(boxG(2.1, 0.16, 0.05, 0, 1.13, z1 - 0.02), 0x1a1b1c, ZONE.PLASTIC, 0);
  for (const s of [-1, 1]) {
    mb.add(planeG(0.16, 0.14, s * 0.98, 1.16, z1 - 0.03, 0, true), 0xc0121a, ZONE.TAIL, 0);
    mb.add(planeG(0.16, 0.1, s * 0.98, 1.0, z1 - 0.03, 0, true), 0xffa317, ZONE.TURN, 0);
  }
  mb.lamps.tail.length = 0; mb.lamps.tail.push([0.98, 1.16, z1], [-0.98, 1.16, z1]); mb.lamps.tailZ = z1;
  mb.lamps.reverse.length = 0; mb.lamps.reverse.push([0.9, 1.05, z1], [-0.9, 1.05, z1]);
}
model('towTruck', 'towTruck', 'Tow truck', 1, TOW, (mb, b) => {
  towDeck(mb, false);
  if (mb.lod < 2) for (const s of [-1, 1]) mb.add(sideDecalG(s * (1.0 + 0.01), 0.75, 1.3, 1.0, 2.0, 'tow'), 0xffffff, ZONE.DECAL, 0);
  void b;
});
model('towTruck.flatbed', 'towTruck', 'Rollback tow truck', 0.5, derive(TOW, { wheels: W(0.48, 0.3, 0.6, 'steel', 5, 0x9aa0a4, true) }), (mb) => {
  towDeck(mb, true);
  if (mb.lod < 2) for (const s of [-1, 1]) mb.add(sideDecalG(s * (1.0 + 0.01), 0.75, 1.3, 1.0, 2.0, 'tow'), 0xffffff, ZONE.DECAL, 0);
});

// ----------------------------------------------------------------------------------------------------------------- semis
const SEMI: CarPlan = {
  wheels: W(0.52, 0.4, 0.58, 'truck', 5, 0xb9bec2),
  axles: [-7.4, -6.1, 0.9, 2.2, 6.3], zF: 6.3, zR: 2.2, ride: 0.55, hw: 1.2, belt: 1.95, trim: 0.2, zNose: 7.9, zTail: 2.6, cornerR: 0.5, noseTaper: 0.1, noRear: true,
  top: [[2.6, 3.2], [2.7, 3.36], [3.6, 3.38], [3.85, 1.98], [5.6, 1.98], [6.5, 1.9], [7.4, 1.72], [7.9, 1.5]],
  cab: { ws0: 5.5, ws1: 4.9, y1: 3.2, rf1: 3.95, y2: 3.3, bl: 3.9, roofHW: 1.0, beltHW: 1.1, pillars: [4.5], pillarW: 0.1, noRear: true, solidFrom: 4.2, header: 0.3 },
  doors: [5.3, 4.5], bumperF: 'chrome', grille: 'tall', exhaust: 'none', mirror: { y: 2.5, z: 5.3, big: true }, lampF: { y: 1.3, w: 0.42, h: 0.18, x: 0.86 },
};
function semiTractor(mb: ModelBuilder): void {
  // the roof fairing: an air deflector that rises over the sleeper to the height of the trailer (what makes a tractor look like one)
  if (mb.lod < 2) mb.body(extrudeG([[5.15, 3.22], [4.0, 3.5], [2.65, 3.95], [2.55, 3.95], [2.55, 3.3], [3.6, 3.32]], 1.9, 'yz', [0, 0, 0]));
  if (mb.lod < 2) for (const sx of [-1, 1]) mb.body(boxG(0.05, 0.8, 1.6, sx * 1.1, 2.7, 3.2)); // cab-side extenders
  if (mb.lod < 2) stacks(mb, 1.0, 1.9, 3.7, 3.85);
  mb.lamps.exhaust.push([1.0, 3.75, 3.85], [-1.0, 3.75, 3.85]);
  // fuel tanks and the frame between the cab and the trailer, the fifth wheel
  for (const s of [-1, 1]) if (mb.lod < 2) mb.add(cylG(0.32, 0.32, 1.6, mb.seg(10, 6), 'z', s * 1.05, 0.85, 4.8), 0xc7ccd0, ZONE.CHROME, 0);
  solid(mb, boxG(1.0, 0.3, 4.6, 0, 0.85, 1.5), 0x18191b, ZONE.DARK);
  solid(mb, boxG(1.5, 0.14, 1.4, 0, 1.15, 1.6), 0x26292c, ZONE.STEEL);
}
/** The trailer: a box on a frame, skirts and two axles at the back (the wheels are the plan's). */
function trailer(mb: ModelBuilder, kind: 'van' | 'reefer' | 'tanker' | 'flat'): void {
  const z0 = 2.35, z1 = -7.85, len = z0 - z1, zc = (z0 + z1) / 2, hw = 1.22;
  if (kind === 'tanker') {
    const seg = mb.seg(16, 10, 6);
    mb.add(cylG(1.05, 1.05, len - 0.4, seg, 'z', 0, 2.25, zc), 0xc7ccd0, ZONE.CHROME, 0);
    if (mb.lod < 2) {
      for (const z of [z0 - 0.3, z1 + 0.3]) mb.add(cylG(0.9, 1.06, 0.3, seg, 'z', 0, 2.25, z), 0xc7ccd0, ZONE.CHROME, 0);
      if (mb.close) for (let z = z1 + 1; z < z0 - 0.5; z += 1.6) mb.add(cylG(1.07, 1.07, 0.06, 16, 'z', 0, 2.25, z), 0x9aa0a4, ZONE.CHROME, 0);
      solid(mb, boxG(0.7, 0.28, 0.7, 0, 3.4, zc + 1), 0x2a2d30, ZONE.STEEL);                     // the manhole hatch
      solid(mb, boxG(0.5, 0.07, len - 1, 0, 3.32, zc), 0x2a2d30, ZONE.STEEL);                    // catwalk
    }
    solid(mb, boxG(hw * 1.4, 0.3, len - 0.4, 0, 1.0, zc), 0x18191b, ZONE.DARK);
    mb.add(sideDecalG(1.07, 1.75, 2.75, -3.6, 0.4, 'stroad'), 0xffffff, ZONE.DECAL, 0);
    return;
  }
  if (kind === 'flat') {
    solid(mb, boxG(hw * 2, 0.14, len, 0, 1.2, zc), 0x7a5c37);
    solid(mb, boxG(hw * 1.5, 0.3, len, 0, 1.0, zc), 0x18191b, ZONE.DARK);
    if (mb.lod < 2) {
      // a load: three stacked crates of pipe-like bundles and a SLOP crate
      for (const [z, y, h] of [[-1, 1.9, 1.3], [-4.6, 1.9, 1.3], [-6.6, 1.75, 1.0]] as const) solid(mb, boxG(2.2, h, 2.2, 0, y, z), z === -4.6 ? 0x2b2d30 : 0xc99a5a, ZONE.PANEL);
      mb.add(sideDecalG(1.12, 1.4, 2.4, -5.4, -3.8, 'slop'), 0xffffff, ZONE.DECAL, 0);
    }
    return;
  }
  // van or reefer: a big box, painted (the trailer wears the fleet's colour)
  mb.body(boxG(hw * 2, 2.85, len, 0, 2.55, zc));
  solid(mb, boxG(hw * 1.5, 0.3, len, 0, 1.0, zc), 0x18191b, ZONE.DARK);
  if (mb.lod < 2) {
    if (mb.close) for (let z = z1 + 0.4; z < z0 - 0.2; z += 0.9) for (const s of [-1, 1]) strip(mb, s * (hw + 0.006), 2.55, z, 2.7, 0.08, 0xc9cdce);
    for (const s of [-1, 1]) {
      mb.add(sideDecalG(s * (hw + 0.012), 1.35, 2.6, -5.2, -1.7, kind === 'reefer' ? 'slop' : 'stroad'), 0xffffff, ZONE.DECAL, 0);
      strip(mb, s * (hw + 0.004), 0.95, zc, 0.3, len - 0.4, 0x2a2d30, ZONE.PLASTIC);                    // side skirts
    }
    rearDoors(mb, z1, hw, 1.15, 3.85);
    solid(mb, boxG(hw * 2 - 0.1, 0.16, 0.16, 0, 0.72, z1 - 0.08), 0x2a2d30, ZONE.STEEL);               // the underride bar
    mudFlaps(mb, 1.15, -7.95, 0.45);
    for (const s of [-1, 1]) { mb.add(planeG(0.18, 0.34, s * 1.02, 1.0, z1 - 0.012, 0, true), 0xc0121a, ZONE.TAIL, 0); mb.add(planeG(0.14, 0.1, s * 1.02, 0.76, z1 - 0.014, 0, true), 0xffa317, ZONE.TURN, 0); }
    mb.lamps.tail.push([1.02, 1.0, z1], [-1.02, 1.0, z1]); mb.lamps.tailZ = z1;
    mb.lamps.turnLeft.push([1.02, 0.76, z1]); mb.lamps.turnRight.push([-1.02, 0.76, z1]);
    mb.lamps.reverse.push([0.85, 0.9, z1], [-0.85, 0.9, z1]);
  }
  if (kind === 'reefer' && mb.lod < 2) {
    solid(mb, boxG(1.9, 1.5, 0.45, 0, 3.4, z0 + 0.08), 0xd8dbdd, ZONE.CHROME);
    mb.add(boxG(1.3, 0.9, 0.04, 0, 3.4, z0 + 0.31), 0x1a1c1e, ZONE.DARK, 0);
  }
  if (mb.lod === 2) return;
  solid(mb, boxG(0.9, 0.9, 0.5, 0, 0.5, z0 - 0.5), 0x26292c, ZONE.STEEL); // landing gear
}
function semi(id: string, label: string, weight: number, kind: 'van' | 'reefer' | 'tanker' | 'flat'): void {
  model(id, 'semi', label, weight, derive(SEMI, {}), (mb) => { semiTractor(mb); trailer(mb, kind); });
}
semi('semi', 'Semi', 1, 'van');
semi('semi.reefer', 'Refrigerated semi', 0.6, 'reefer');
semi('semi.tanker', 'Tanker', 0.4, 'tanker');
semi('semi.flatbed', 'Flatbed semi', 0.5, 'flat');
void loftG; void roofRack; void addWheel;
