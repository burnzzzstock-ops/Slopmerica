// Motorcycles (with their riders) and golf carts: vehicles with no hull, built from a few primitives.
import { def } from './vehicleRegistry';
import { addWheel, boxG, cylG, loftG, ModelBuilder, planeG, quadG, sphereG, ZONE, type V3, type WheelSpec } from './vehicleKit';
import { beamG } from './vehicleBody';
import { sideDecalG } from './vehicleDecals';

const RIDER_SKIN = 0xd9a582;

/** The rider: boots, legs, a jacket, arms to the bars and a helmet; `lean` tips the torso forward (a sport bike's crouch). */
function rider(mb: ModelBuilder, o: { seatY: number; seatZ: number; lean: number; pegZ: number; pegY: number; barZ: number; barY: number; jacket: number; helmet: number; upright?: boolean }): void {
  if (mb.lod === 2) {
    mb.add(boxG(0.34, 0.6, 0.3, 0, o.seatY + 0.35, o.seatZ + 0.05), o.jacket, ZONE.PANEL, 0);
    mb.add(sphereG(0.13, 0, o.seatY + 0.8, o.seatZ + 0.15 + o.lean * 0.3, 1, 1, 1, 5, 3), o.helmet, ZONE.PANEL, 0);
    return;
  }
  const hip: V3 = [0, o.seatY + 0.08, o.seatZ];
  const chestZ = o.seatZ + o.lean * 0.55, chestY = o.seatY + 0.5 - o.lean * 0.1;
  for (const s of [-1, 1]) {
    // thigh (hip to knee) and shin (knee to boot on the peg)
    const knee: V3 = [s * 0.2, o.seatY - 0.02, o.seatZ + 0.32];
    const boot: V3 = [s * 0.22, o.pegY, o.pegZ];
    mb.add(beamG([s * 0.14, hip[1], hip[2]], knee, 0.14, 0.13), 0x1f242a, ZONE.PANEL, 0);
    mb.add(beamG(knee, boot, 0.11, 0.11), 0x1f242a, ZONE.PANEL, 0);
    mb.add(boxG(0.1, 0.09, 0.24, s * 0.22, o.pegY - 0.02, o.pegZ + 0.05), 0x141516, ZONE.PLASTIC, 0);
    // upper arm and forearm to the grip
    const shoulder: V3 = [s * 0.22, chestY + 0.22, chestZ + 0.05], elbow: V3 = [s * 0.34, chestY + 0.02, (chestZ + o.barZ) / 2], grip: V3 = [s * 0.36, o.barY, o.barZ];
    mb.add(beamG(shoulder, elbow, 0.1, 0.1), o.jacket, ZONE.PANEL, 0);
    mb.add(beamG(elbow, grip, 0.085, 0.085), o.jacket, ZONE.PANEL, 0);
    mb.add(sphereG(0.06, s * 0.36, o.barY, o.barZ, 1, 1, 1, 5, 3), 0x1b1c1d, ZONE.PLASTIC, 0);
  }
  mb.add(boxG(0.4, 0.5, 0.26, 0, chestY, chestZ - 0.02, o.lean * 0.9, 0, 0), o.jacket, ZONE.PANEL, 0);            // torso
  mb.add(boxG(0.3, 0.16, 0.24, 0, o.seatY + 0.1, o.seatZ), 0x1f242a, ZONE.PANEL, 0);                            // hips
  mb.add(sphereG(0.135, 0, chestY + 0.37 - o.lean * 0.04, chestZ + 0.1 + o.lean * 0.16, 1, 1.05, 1.12, mb.seg(10, 8), mb.seg(7, 5)), o.helmet, ZONE.PAINT, 0.0); // helmet
  if (mb.close) mb.add(boxG(0.2, 0.07, 0.03, 0, chestY + 0.38 - o.lean * 0.04, chestZ + 0.25 + o.lean * 0.16), 0x151f26, ZONE.GLASS, 0);                                // visor
}

/** A motorcycle built from a 2D side view: frame, tank, seat, forks, exhaust, engine, lamp. */
function bike(o: { wheelR: number; rearR: number; tw: number; rearTw: number; wheelbase: number; tankY: number; seatY: number; seatZ: number; bars: 'ape' | 'clip' | 'flat'; fairing: boolean; bags: boolean; engineBlock: number; rider: Parameters<typeof rider>[1]; scooter?: boolean; dirt?: boolean }): (mb: ModelBuilder) => number {
  return (mb) => {
    const zf = o.wheelbase / 2 - 0.1, zr = -o.wheelbase / 2 - 0.05;
    const spec = (r: number, tw: number): WheelSpec => ({ r, tw, rim: 0.7, style: 'spoke', spokes: 10, rimColor: 0xaeb4b8, both: true });
    addWheel(mb, 0, o.wheelR, zf, spec(o.wheelR, o.tw), true);
    addWheel(mb, 0, o.rearR, zr, spec(o.rearR, o.rearTw), false);
    if (mb.lod === 2) {
      // far: a body lump, the rider as two blocks and a helmet, a lamp chip at each end
      mb.add(boxG(0.22, 0.34, o.wheelbase * 0.8, 0, o.tankY - 0.08, 0), [1, 1, 1], ZONE.PAINT, 1);
      rider(mb, o.rider);
      mb.lamps.head.push([0, o.wheelR + 0.5, zf + 0.1]); mb.lamps.tail.push([0, o.seatY - 0.04, zr - 0.05]);
      mb.lamps.nose = [1.1, 0.4]; mb.lamps.tailZ = -1.1; mb.lamps.height = 0.8;
      return o.wheelR;
    }
    // frame and swing arm
    const frame = 0x1b1d20;
    if (!o.scooter) {
      mb.add(beamG([0, o.wheelR + 0.15, zf], [0, o.tankY, zf - 0.55], 0.06, 0.06), 0xb9bec2, ZONE.CHROME, 0);   // fork
      mb.add(beamG([0, o.wheelR + 0.15, zf - 0.02], [0, o.wheelR + 0.15, zf + 0.02], 0.2, 0.06), 0xb9bec2, ZONE.CHROME, 0);
      mb.add(beamG([0, o.rearR, zr], [0, o.seatY - 0.15, zr + 0.4], 0.08, 0.08), frame, ZONE.STEEL, 0);          // swing arm / rear frame
      mb.add(boxG(0.16, 0.26, o.wheelbase * 0.5, 0, o.tankY - 0.1, 0.05), frame, ZONE.STEEL, 0);                  // frame spine
      // engine
      mb.add(boxG(0.34, o.engineBlock, 0.4, 0, o.wheelR + 0.12, 0.05), 0x2a2d30, ZONE.STEEL, 0);
      if (mb.close) for (let i = 0; i < 4; i++) mb.add(boxG(0.36, 0.015, 0.42, 0, o.wheelR + 0.12 + o.engineBlock / 2 + 0.01 + i * 0.03, 0.05), 0x565a5d, ZONE.STEEL, 0);
    } else {
      // scooter: a floor board, a leg shield and a small body over the rear wheel
      mb.add(boxG(0.36, 0.06, 0.8, 0, 0.3, 0.15), 0x1a1b1c, ZONE.PLASTIC, 0);
      mb.add(beamG([0, 0.3, zf - 0.22], [0, 0.98, zf - 0.1], 0.34, 0.06), 1 as unknown as number, ZONE.PAINT, 1);
      mb.add(beamG([0, o.wheelR, zf], [0, 0.98, zf - 0.1], 0.06, 0.06), 0xb9bec2, ZONE.CHROME, 0);
    }
    // tank / body in paint
    if (!o.scooter) {
      mb.add(sphereG(0.22, 0, o.tankY, 0.32, 0.72, 0.68, 1.55, mb.seg(12, 8), mb.seg(8, 5)), [1, 1, 1], ZONE.PAINT, 1);
      mb.add(sphereG(0.17, 0, o.seatY - 0.08, zr + 0.35, 0.8, 0.5, 1.6, mb.seg(10, 6), mb.seg(6, 4)), [1, 1, 1], ZONE.PAINT, 1);        // rear fender / cowl
      if (o.fairing) mb.add(sphereG(0.26, 0, o.tankY + 0.04, zf - 0.28, 0.7, 0.85, 1.05, mb.seg(12, 8), mb.seg(8, 5)), [1, 1, 1], ZONE.PAINT, 1);
    } else {
      mb.add(sphereG(0.28, 0, 0.55, zr + 0.35, 0.66, 0.9, 1.9, mb.seg(12, 8), mb.seg(8, 5)), [1, 1, 1], ZONE.PAINT, 1);
      mb.add(sphereG(0.2, 0, 0.98, zf - 0.08, 0.9, 0.55, 0.9, mb.seg(10, 6), mb.seg(6, 4)), [1, 1, 1], ZONE.PAINT, 1);
    }
    // seat
    mb.add(boxG(0.3, 0.09, o.scooter ? 0.65 : 0.55, 0, o.seatY, o.seatZ - (o.scooter ? 0.1 : 0)), 0x16191b, ZONE.PLASTIC, 0);
    // handlebars
    const barY = o.rider.barY, barZ = o.rider.barZ;
    mb.add(boxG(o.bars === 'clip' ? 0.5 : 0.7, 0.04, 0.04, 0, barY, barZ), 0xb9bec2, ZONE.CHROME, 0);
    if (o.bars === 'ape') for (const s of [-1, 1]) mb.add(beamG([s * 0.3, barY - 0.12, barZ], [s * 0.34, barY + 0.08, barZ], 0.035, 0.035), 0xb9bec2, ZONE.CHROME, 0);
    // headlamp (round) and tail lamp
    const lampZ = zf + 0.03;
    mb.add(cylG(0.13, 0.13, 0.1, mb.seg(12, 8), 'z', 0, o.wheelR + (o.scooter ? 0.62 : 0.5), lampZ), 0xf4f0e2, ZONE.HEAD, 0);
    mb.add(cylG(0.15, 0.15, 0.06, mb.seg(12, 8), 'z', 0, o.wheelR + (o.scooter ? 0.62 : 0.5), lampZ - 0.06), 0xb9bec2, ZONE.CHROME, 0);
    if (mb.lod < 2) for (const s of [-1, 1]) mb.add(boxG(0.06, 0.05, 0.05, s * 0.33, o.wheelR + (o.scooter ? 0.62 : 0.5), lampZ - 0.03), 0xffa317, ZONE.TURN, 0);
    mb.add(boxG(0.2, 0.09, 0.05, 0, o.seatY - 0.04, zr - 0.08 + 0.06), 0xc0121a, ZONE.TAIL, 0);
    if (mb.lod < 2) for (const s of [-1, 1]) mb.add(boxG(0.05, 0.05, 0.05, s * 0.16, o.seatY - 0.04, zr - 0.06 + 0.06), 0xffa317, ZONE.TURN, 0);
    // exhaust
    for (const s of [-1, 1]) if (mb.lod < 2 && !o.scooter) mb.add(cylG(0.045, 0.06, 0.9, mb.seg(8, 5), 'z', s * 0.2, o.wheelR + 0.05, zr + 0.5), 0xa7adb2, ZONE.CHROME, 0);
    if (o.bags && mb.lod < 2) for (const s of [-1, 1]) mb.add(boxG(0.16, 0.3, 0.6, s * 0.28, o.seatY - 0.1, zr + 0.3), 0x18191b, ZONE.PLASTIC, 0);
    // mirrors
    if (mb.lod < 2) for (const s of [-1, 1]) mb.add(boxG(0.1, 0.06, 0.03, s * 0.34, barY + 0.13, barZ - 0.02), 0x18191b, ZONE.PLASTIC, 0);
    rider(mb, o.rider);
    mb.lamps.head.push([0, o.wheelR + 0.5, lampZ + 0.05]);
    mb.lamps.tail.push([0, o.seatY - 0.04, zr - 0.05]);
    mb.lamps.turnLeft.push([0.33, o.wheelR + 0.5, lampZ], [0.16, o.seatY - 0.04, zr]); mb.lamps.turnRight.push([-0.33, o.wheelR + 0.5, lampZ], [-0.16, o.seatY - 0.04, zr]);
    mb.lamps.nose = [1.1, 0.4]; mb.lamps.tailZ = -1.1; mb.lamps.height = 0.8;
    return o.wheelR;
  };
}
def('motorcycle', 'motorcycle', 'Motorcycle', 1, bike({
  wheelR: 0.34, rearR: 0.34, tw: 0.13, rearTw: 0.17, wheelbase: 1.55, tankY: 0.86, seatY: 0.74, seatZ: -0.22, bars: 'ape', fairing: false, bags: true, engineBlock: 0.34,
  rider: { seatY: 0.74, seatZ: -0.22, lean: 0.2, pegZ: 0.28, pegY: 0.3, barZ: 0.55, barY: 1.1, jacket: 0x25292d, helmet: 0xd04a34 },
}));
def('motorcycle.sport', 'motorcycle', 'Sport bike', 0.6, bike({
  wheelR: 0.3, rearR: 0.31, tw: 0.13, rearTw: 0.2, wheelbase: 1.42, tankY: 0.84, seatY: 0.79, seatZ: -0.32, bars: 'clip', fairing: true, bags: false, engineBlock: 0.3,
  rider: { seatY: 0.79, seatZ: -0.32, lean: 0.8, pegZ: -0.02, pegY: 0.36, barZ: 0.45, barY: 0.98, jacket: 0x203f78, helmet: 0xf0f0ec },
}));
def('motorcycle.scooter', 'motorcycle', 'Scooter', 0.6, bike({
  wheelR: 0.22, rearR: 0.22, tw: 0.11, rearTw: 0.12, wheelbase: 1.2, tankY: 0.6, seatY: 0.75, seatZ: -0.35, bars: 'flat', fairing: false, bags: false, engineBlock: 0.2, scooter: true,
  rider: { seatY: 0.75, seatZ: -0.35, lean: 0.05, pegZ: 0.45, pegY: 0.36, barZ: 0.5, barY: 1.05, jacket: 0x8a6d4a, helmet: 0x66c5d9 },
}));

// -------------------------------------------------------------------------------------------------------------- golf carts
function cart(utility: boolean): (mb: ModelBuilder) => number {
  return (mb) => {
    const r = 0.26, hw = 0.5, zf = 0.78, zr = -0.78, L = 1.2;
    const spec: WheelSpec = { r, tw: 0.19, rim: 0.66, style: 'cover', rimColor: 0xb8bdc0 };
    for (const s of [-1, 1]) { addWheel(mb, s * (hw - 0.03), r, zf, spec, true); addWheel(mb, s * (hw - 0.03), r, zr, spec, false); }
    // floor pan and the body shell: a nose cowl, side sills, a rear body
    const cowl = loftG([
      [[0.46, 0.3, L - 0.2], [0.5, 0.52, L - 0.2], [0.42, 0.72, L - 0.35], [-0.42, 0.72, L - 0.35], [-0.5, 0.52, L - 0.2], [-0.46, 0.3, L - 0.2]],
      [[0.5, 0.28, 0.7], [0.55, 0.6, 0.7], [0.5, 0.84, 0.6], [-0.5, 0.84, 0.6], [-0.55, 0.6, 0.7], [-0.5, 0.28, 0.7]],
    ], { closeFirst: true, closeLast: false, crease: 0.4 });
    mb.body(cowl);
    mb.body(boxG(hw * 2, 0.07, 1.0, 0, 0.34, 0.15));                                        // floor
    for (const s of [-1, 1]) mb.body(boxG(0.06, 0.16, 1.5, s * (hw + 0.02), 0.4, -0.05));     // side sills
    if (utility) {
      // a cargo bed behind the seat
      mb.body(boxG(hw * 2, 0.06, 0.8, 0, 0.42, -0.85));
      for (const s of [-1, 1]) mb.body(boxG(0.05, 0.28, 0.8, s * (hw - 0.02), 0.56, -0.85));
      mb.body(boxG(hw * 2, 0.28, 0.05, 0, 0.56, -1.22));
      mb.add(boxG(0.86, 0.02, 0.7, 0, 0.46, -0.85), 0x222629, ZONE.PLASTIC, 0);
    } else {
      mb.body(boxG(hw * 2, 0.4, 0.35, 0, 0.55, -1.0));                                      // rear body with the seat back
      mb.add(boxG(0.9, 0.09, 0.5, 0, 0.62, -0.7), 0xe4d9bd, ZONE.PANEL, 0);                  // rear seat
    }
    // seat and back
    mb.add(boxG(0.92, 0.1, 0.45, 0, 0.6, -0.15), 0xe4d9bd, ZONE.PANEL, 0);
    mb.add(boxG(0.92, 0.42, 0.08, 0, 0.84, -0.4), 0xe4d9bd, ZONE.PANEL, 0);
    // canopy roof on four posts
    for (const s of [-1, 1]) for (const z of [0.52, -0.82]) mb.add(boxG(0.045, 1.18, 0.045, s * 0.46, 1.25, z), 0x2e3236, ZONE.PLASTIC, 0);
    mb.add(boxG(1.08, 0.07, 1.62, 0, 1.87, -0.15), 0xf0ecdf, ZONE.PANEL, 0);
    if (mb.lod < 2) mb.add(boxG(1.12, 0.03, 1.66, 0, 1.83, -0.15), 0x2a2d30, ZONE.PLASTIC, 0);
    // windshield and steering
    mb.add(quadG([0.44, 0.9, 0.55], [-0.44, 0.9, 0.55], [-0.44, 1.62, 0.5], [0.44, 1.62, 0.5]), 0x2a3a44, ZONE.GLASS, 0);
    if (mb.lod < 2) {
      mb.add(boxG(0.36, 0.02, 0.36, -0.22, 0.98, 0.32, 0.6, 0, 0), 0x1b1c1d, ZONE.PLASTIC, 0);
      mb.add(beamG([-0.22, 0.6, 0.42], [-0.22, 0.98, 0.34], 0.03, 0.03), 0x1b1c1d, ZONE.PLASTIC, 0);
    }
    // lamps: two round headlamps low on the cowl, small red taillights
    for (const s of [-1, 1]) {
      mb.add(planeG(0.14, 0.12, s * 0.33, 0.62, L - 0.19), 0xf4f0e2, ZONE.HEAD, 0);
      mb.add(planeG(0.12, 0.08, s * 0.4, 0.5, L - 0.16), 0xffa317, ZONE.TURN, 0);
      mb.add(planeG(0.14, 0.1, s * 0.38, utility ? 0.6 : 0.6, -1.23, 0, true), 0xc0121a, ZONE.TAIL, 0);
    }
    mb.lamps.head.push([0.33, 0.62, L - 0.19], [-0.33, 0.62, L - 0.19]);
    mb.lamps.tail.push([0.38, 0.6, -1.23], [-0.38, 0.6, -1.23]);
    mb.lamps.turnLeft.push([0.4, 0.5, L - 0.16]); mb.lamps.turnRight.push([-0.4, 0.5, L - 0.16]);
    mb.lamps.nose = [L - 0.1, 0.4]; mb.lamps.tailZ = -1.23; mb.lamps.height = 0.6;
    // the bumper sticker on the sill: I ♥ PROPANE, as before (this cart is a joke)
    if (mb.lod < 2) for (const sgn of [-1, 1]) mb.add(sideDecalG(sgn * (hw + 0.105), 0.31, 0.5, -0.75, 0.2, 'propane'), 0xffffff, ZONE.DECAL, 0);
    return r;
  };
}
def('golfCart', 'golfCart', 'Golf cart', 1, cart(false));
def('golfCart.utility', 'golfCart', 'Utility cart', 0.5, cart(true));
