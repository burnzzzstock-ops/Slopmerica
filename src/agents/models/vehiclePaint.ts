// A realistic paint mix for the town's cars (audit #9: "colours are drawn at random from 14 paints; real US traffic is about
// three-quarters white, black, grey and silver"), with the finish, age and dirt that make a pickup look used.
//
// Finish codes (read by the vehicle shader): 0 solid, 1 metallic, 2 matte, 3 pearl.
// Special codes: 0 none; 1 primer hood; 2 primer fender; 3 door from another car; 4 primer rear quarter; 5 mismatched door (right);
// + 8 when the car is caked in mud.
import * as THREE from 'three';
import type { VehicleKind } from '../../contracts';

export interface Look { rgb: [number, number, number]; finish: number; age: number; dirt: number; special: number }

interface Paint { hex: number; w: number; finish: [number, number, number] } // finish weights: solid, metallic, matte/pearl

const P = (hex: number, w: number, finish: [number, number, number] = [0.35, 0.6, 0.05]): Paint => ({ hex, w, finish });

/** What US roads look like: white, black, grey and silver are about three-quarters; then blue and red; then the rest. */
const CARS: Paint[] = [
  P(0xf0f0ec, 14, [0.55, 0.15, 0.3]), P(0xe4e5e2, 6, [0.5, 0.3, 0.2]), P(0xf6f6f2, 4, [0.1, 0.2, 0.7]), // white, pearl white
  P(0x141518, 13, [0.4, 0.58, 0.02]), P(0x25272b, 6, [0.3, 0.65, 0.05]),                                   // black, near-black
  P(0x5b6066, 7, [0.25, 0.7, 0.05]), P(0x3d4247, 5, [0.2, 0.75, 0.05]), P(0x7c8288, 5, [0.3, 0.65, 0.05]), // greys
  P(0xb7bbbf, 6, [0.15, 0.83, 0.02]), P(0xc9ccce, 5, [0.15, 0.83, 0.02]),                                   // silvers
  P(0x203f78, 4, [0.3, 0.65, 0.05]), P(0x3b6aa8, 3, [0.3, 0.65, 0.05]), P(0x14264a, 2, [0.3, 0.65, 0.05]),  // blues
  P(0xa11f28, 4, [0.4, 0.55, 0.05]), P(0xc42a30, 2, [0.5, 0.45, 0.05]), P(0x6e1a22, 2, [0.3, 0.65, 0.05]),  // reds
  P(0x25503a, 1.2, [0.3, 0.65, 0.05]), P(0x4a5b45, 0.8, [0.4, 0.5, 0.1]),                                   // greens
  P(0x87694a, 1, [0.3, 0.65, 0.05]), P(0xc7b48c, 1.2, [0.3, 0.65, 0.05]),                                   // brown, champagne
  P(0xd9762b, 0.7, [0.6, 0.35, 0.05]), P(0xd8b62c, 0.7, [0.7, 0.25, 0.05]),                                  // orange, yellow
  // the satire accents: SLOP lime, a purple, a teal, a hot pink, a cannon red
  P(0xc6f432, 0.35, [0.9, 0.1, 0]), P(0x5b2d8a, 0.4, [0.3, 0.6, 0.1]), P(0x2a9d8f, 0.4, [0.4, 0.5, 0.1]), P(0xd94f9d, 0.25, [0.6, 0.3, 0.1]), P(0xb3202a, 0.4, [0.6, 0.35, 0.05]),
];
const TRUCKS: Paint[] = [
  P(0xf0f0ec, 16, [0.7, 0.2, 0.1]), P(0x141518, 20, [0.4, 0.58, 0.02]), P(0x5b6066, 9, [0.3, 0.65, 0.05]), P(0x3d4247, 6, [0.3, 0.65, 0.05]),
  P(0xb7bbbf, 6, [0.2, 0.78, 0.02]), P(0xa11f28, 8, [0.5, 0.45, 0.05]), P(0x203f78, 6, [0.4, 0.55, 0.05]), P(0x6e1a22, 3, [0.4, 0.55, 0.05]),
  P(0x25503a, 3, [0.5, 0.45, 0.05]), P(0x4b5a3a, 2, [0.3, 0.2, 0.5]), P(0x87694a, 2, [0.4, 0.55, 0.05]), P(0xd9762b, 1.5, [0.6, 0.35, 0.05]),
  P(0xc6f432, 0.5, [0.9, 0.1, 0]), P(0xd8b62c, 1, [0.7, 0.25, 0.05]),
];
const WORK: Paint[] = [
  P(0xf1f1ee, 70, [0.9, 0.05, 0.05]), P(0xd8dad8, 8, [0.9, 0.05, 0.05]), P(0x203f78, 5, [0.9, 0.1, 0]), P(0xa11f28, 5, [0.9, 0.1, 0]),
  P(0xd8b62c, 4, [0.9, 0.1, 0]), P(0x25503a, 3, [0.9, 0.1, 0]), P(0x141518, 3, [0.9, 0.1, 0]),
];
const VW: Paint[] = [P(0x3aa89b, 3, [1, 0, 0]), P(0xd9b13a, 3, [1, 0, 0]), P(0xd9762b, 2, [1, 0, 0]), P(0x8fb8a4, 2, [1, 0, 0]), P(0x8dc4e0, 2, [1, 0, 0]), P(0xe07a6a, 1.5, [1, 0, 0]), P(0x5a8f5a, 1, [1, 0, 0])];
const CART: Paint[] = [P(0xf1efe6, 4, [1, 0, 0]), P(0x2f6b3a, 3, [1, 0, 0]), P(0x203f78, 2, [1, 0, 0]), P(0xc7b48c, 2, [1, 0, 0]), P(0xc42a30, 1.5, [1, 0, 0]), P(0x3aa89b, 1, [1, 0, 0])];
const BIKE: Paint[] = [P(0x141518, 8, [0.4, 0.5, 0.1]), P(0xa11f28, 6, [0.4, 0.6, 0]), P(0x203f78, 4, [0.4, 0.6, 0]), P(0xd9762b, 2, [0.5, 0.5, 0]), P(0xf0f0ec, 3, [0.7, 0.3, 0]), P(0x5b6066, 4, [0.3, 0.3, 0.4])];

function poolFor(kind: VehicleKind): Paint[] {
  switch (kind) {
    case 'pickup': case 'liftedTruck': return TRUCKS;
    case 'boxTruck': case 'semi': case 'slopVan': case 'towTruck': return WORK;
    case 'vwBus': return VW;
    case 'golfCart': return CART;
    case 'motorcycle': return BIKE;
    default: return CARS;
  }
}

function weighted<T extends { w: number }>(list: T[], r: number): T {
  let total = 0; for (const p of list) total += p.w;
  let t = r * total;
  for (const p of list) { t -= p.w; if (t <= 0) return p; }
  return list[list.length - 1];
}

const C = new THREE.Color();
function linear(hex: number): [number, number, number] { C.setHex(hex); return [C.r, C.g, C.b]; }

/**
 * A car's look. `color` is used as given (solid paint) when `exact`; otherwise the paint comes from the mix, or, if `color`
 * is undefined... : the mix. Age and dirt: most cars are fairly new and fairly clean; about one in six is a beater (faded roof,
 * rust at the sills, a primer panel or a door from another car); pickups are dirtier; lifted trucks wear mud.
 */
export function pickLook(kind: VehicleKind, color: number | undefined, exact: boolean, rnd: () => number): Look {
  if (kind === 'cyberslop') {
    // brushed stainless: the paint is only what the metal reflects; it stays clean, it's brand-new money
    return { rgb: [0.62, 0.64, 0.66], finish: 3, age: 0, dirt: 0.05 + rnd() * 0.25, special: 0 };
  }
  if (exact || color !== undefined) {
    return { rgb: linear(color ?? 0xffffff), finish: 0, age: exact ? 0 : rnd() * 0.25, dirt: exact ? 0.1 : 0.05 + rnd() * 0.35, special: 0 };
  }
  const paint = weighted(poolFor(kind), rnd());
  const f = paint.finish, fr = rnd() * (f[0] + f[1] + f[2]);
  const finish = fr < f[0] ? 0 : fr < f[0] + f[1] ? 1 : (f[2] > 0.5 && paint.hex > 0xeeeeee ? 3 : 2);
  const beater = rnd() < 0.16;
  const truck = kind === 'pickup' || kind === 'liftedTruck' || kind === 'boxTruck' || kind === 'semi' || kind === 'towTruck';
  const age = beater ? 0.6 + rnd() * 0.4 : Math.pow(rnd(), 2.2) * 0.5;
  let dirt = 0.06 + rnd() * 0.34 + (beater ? 0.25 : 0) + (truck ? 0.15 : 0);
  let special = 0;
  if (beater ? rnd() < 0.6 : age > 0.3 && rnd() < 0.12) special = 1 + Math.floor(rnd() * 5);
  if (kind === 'liftedTruck' && rnd() < 0.85) { special += 8; dirt = 0.6 + rnd() * 0.4; }
  else if (kind === 'pickup' && rnd() < 0.18) { special += 8; dirt = 0.45 + rnd() * 0.4; }
  if (finish === 2) special = special; // matte cars stay as they are
  return { rgb: linear(paint.hex), finish, age, dirt: Math.min(1, dirt), special };
}
