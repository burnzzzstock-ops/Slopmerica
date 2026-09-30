// The passenger cars: sedans, hatchbacks, SUVs, minivans and the sheriff's cars, each a CarPlan (vehicleBody.ts) and a few extras.
// Sizes: every plan fits inside VEHICLE_SPECS for its kind (length, width, height); mirrors and tyres are the only things that
// stand outside the body width. z runs +front, -rear, in metres from the middle of the car.
import { buildCar, type CarBuild, type CarPlan } from './vehicleBody';
import { def } from './vehicleRegistry';
import { boxG, ModelBuilder, ZONE, type WheelSpec } from './vehicleKit';
import { lightBar, roofRack, sideDecalG } from './vehicleParts';

const W = (r: number, tw: number, rim: number, style: WheelSpec['style'] = 'star', spokes = 5, rimColor?: number): WheelSpec => ({ r, tw, rim, style, spokes, rimColor });

/** Build a plan into a model; `extras` adds what makes this one itself (a light bar, a rack, a decal). */
function car(id: string, kind: Parameters<typeof def>[1], label: string, weight: number, plan: CarPlan, extras?: (mb: ModelBuilder, b: CarBuild) => void): void {
  def(id, kind, label, weight, (mb) => { const b = buildCar(mb, plan); extras?.(mb, b); return plan.wheels.r; });
}
const derive = (base: CarPlan, over: Omit<Partial<CarPlan>, 'cab'> & { cab?: Partial<CarPlan['cab']> }): CarPlan => ({ ...base, ...over, cab: { ...base.cab, ...(over.cab ?? {}) } });

// ------------------------------------------------------------------------------------------------------------- sedans
export const SEDAN_PLAN: CarPlan = {
  wheels: W(0.32, 0.205, 0.68, 'star'),
  zF: 1.42, zR: -1.3, ride: 0.15, hw: 0.885, belt: 0.9,
  top: [[-2.3, 0.88], [-2.2, 0.94], [-1.85, 0.972], [-1.45, 0.958], [-1.2, 0.94], [0.9, 0.94], [1.15, 0.965], [1.65, 0.92], [2.1, 0.82], [2.3, 0.74]],
  cab: { ws0: 0.95, ws1: 0.12, y1: 1.385, rf1: -0.82, y2: 1.36, bl: -1.48, roofHW: 0.6, beltHW: 0.79, pillars: [-0.38], pillarW: 0.08 },
  doors: [0.62, -0.38, -1.15], bumperF: 'body', bumperR: 'body', grille: 'slim', exhaust: 'single',
};
car('sedan', 'sedan', 'Sedan', 1, SEDAN_PLAN);

const FASTBACK = derive(SEDAN_PLAN, {
  top: [[-2.3, 0.86], [-2.2, 0.92], [-1.95, 0.955], [-1.5, 0.95], [-1.2, 0.94], [0.9, 0.94], [1.15, 0.965], [1.65, 0.92], [2.1, 0.82], [2.3, 0.74]],
  cab: { rf1: -0.9, y2: 1.33, bl: -1.95 }, spoiler: 0.02, wheels: W(0.325, 0.215, 0.7, 'star', 5),
});
car('sedan.fastback', 'sedan', 'Liftback', 0.5, FASTBACK);

const COUPE = derive(SEDAN_PLAN, {
  hw: 0.89, ride: 0.13, wheels: W(0.33, 0.225, 0.72, 'star', 5), zF: 1.4, zR: -1.28,
  top: [[-2.3, 0.86], [-2.2, 0.93], [-1.9, 0.955], [-1.55, 0.945], [-1.3, 0.93], [1.0, 0.93], [1.25, 0.95], [1.7, 0.88], [2.1, 0.79], [2.3, 0.7]],
  cab: { ws0: 1.05, ws1: 0.3, y1: 1.34, rf1: -0.85, y2: 1.3, bl: -1.55, roofHW: 0.57, beltHW: 0.78, pillars: [-0.98] },
  doors: [0.9, -0.85], spoiler: 0.05, exhaust: 'dual', grille: 'wide',
});
car('sedan.coupe', 'sedan', 'Coupe', 0.4, COUPE);

const WAGON = derive(SEDAN_PLAN, {
  top: [[-2.3, 0.96], [-2.24, 0.99], [-2.0, 0.99], [-1.6, 0.97], [-1.2, 0.95], [0.9, 0.94], [1.15, 0.965], [1.65, 0.92], [2.1, 0.82], [2.3, 0.74]],
  cab: { y1: 1.39, rf1: -1.95, y2: 1.38, bl: -2.2, pillars: [-0.38, -1.25], rails: true }, doors: [0.62, -0.38, -1.2],
});
car('sedan.wagon', 'sedan', 'Wagon', 0.45, WAGON);

const COMPACT = derive(SEDAN_PLAN, {
  zNose: 2.2, zTail: -2.2, zF: 1.28, zR: -1.2, hw: 0.84, wheels: W(0.29, 0.18, 0.7, 'cover'), ride: 0.16,
  top: [[-2.2, 0.82], [-2.1, 0.9], [-1.8, 0.95], [-1.4, 0.94], [-1.1, 0.93], [0.75, 0.93], [1.0, 0.95], [1.5, 0.88], [2.0, 0.8], [2.2, 0.72]],
  cab: { ws0: 0.8, ws1: 0.05, y1: 1.39, rf1: -0.85, y2: 1.37, bl: -1.4, roofHW: 0.58, beltHW: 0.76, pillars: [-0.35] }, doors: [0.55, -0.35, -1.0], exhaust: 'single',
});
car('sedan.compact', 'sedan', 'Compact', 0.7, COMPACT);

const LUXURY = derive(SEDAN_PLAN, {
  hw: 0.9, wheels: W(0.335, 0.225, 0.72, 'star', 7), bumperF: 'chrome', bumperR: 'chrome', grille: 'wide', exhaust: 'dual',
  top: [[-2.3, 0.93], [-2.2, 0.985], [-1.85, 1.0], [-1.5, 0.99], [-1.25, 0.97], [0.55, 0.96], [0.85, 0.985], [1.5, 0.96], [2.0, 0.88], [2.3, 0.78]],
  cab: { ws0: 0.62, ws1: -0.14, y1: 1.385, rf1: -0.95, y2: 1.36, bl: -1.5, pillars: [-0.5] }, doors: [0.45, -0.5, -1.25],
  lampR: { y: 0.96, w: 0.46, h: 0.075, x: 0.6, bar: true },
});
car('sedan.luxury', 'sedan', 'Executive sedan', 0.4, LUXURY);

// --------------------------------------------------------------------------------------------------------- hatchbacks
export const HATCH_PLAN: CarPlan = {
  wheels: W(0.3, 0.19, 0.7, 'cover'),
  zF: 1.2, zR: -1.15, ride: 0.15, hw: 0.86, belt: 0.9,
  top: [[-2.0, 0.92], [-1.95, 0.96], [-1.75, 0.97], [-1.4, 0.95], [0.72, 0.935], [1.05, 0.955], [1.5, 0.9], [1.8, 0.82], [2.0, 0.74]],
  cab: { ws0: 0.78, ws1: 0.02, y1: 1.4, rf1: -1.5, y2: 1.39, bl: -1.92, roofHW: 0.58, beltHW: 0.77, pillars: [-0.42], pillarW: 0.075 },
  doors: [0.55, -0.42, -1.1], bumperF: 'body', bumperR: 'body', grille: 'slim', exhaust: 'single', cornerR: 0.36,
  lampR: { y: 0.76, w: 0.14, h: 0.3, x: 0.66 },
};
car('hatchback', 'hatchback', 'Hatchback', 1, HATCH_PLAN);
car('hatchback.hot', 'hatchback', 'Hot hatch', 0.4, derive(HATCH_PLAN, { hw: 0.87, ride: 0.12, wheels: W(0.31, 0.21, 0.74, 'star', 6), spoiler: 0.12, exhaust: 'dual', grille: 'wide', cab: { y1: 1.38 } }));
car('hatchback.kei', 'hatchback', 'City car', 0.5, derive(HATCH_PLAN, {
  zNose: 1.9, zTail: -1.9, zF: 1.12, zR: -1.08, hw: 0.8, wheels: W(0.27, 0.16, 0.72, 'cover'),
  top: [[-1.9, 0.9], [-1.85, 0.96], [-1.65, 0.98], [-1.3, 0.96], [0.9, 0.95], [1.2, 0.97], [1.6, 0.92], [1.9, 0.78]],
  cab: { ws0: 0.95, ws1: 0.42, y1: 1.43, rf1: -1.5, y2: 1.42, bl: -1.78, roofHW: 0.62, beltHW: 0.74, pillars: [-0.4] }, doors: [0.7, -0.4, -1.0],
}));
car('hatchback.cross', 'hatchback', 'Crossover hatch', 0.45, derive(HATCH_PLAN, {
  ride: 0.2, wheels: W(0.33, 0.21, 0.66, 'star', 5), trim: 0.2, flare: true, hw: 0.87, cab: { y1: 1.44, y2: 1.43, rails: true },
  top: [[-2.0, 0.98], [-1.95, 1.02], [-1.75, 1.03], [-1.4, 1.01], [0.72, 0.99], [1.05, 1.01], [1.5, 0.95], [1.8, 0.88], [2.0, 0.8]], bumperF: 'black', bumperR: 'black',
}));

// ------------------------------------------------------------------------------------------------------------------ SUVs
export const SUV_PLAN: CarPlan = {
  wheels: W(0.375, 0.245, 0.6, 'star', 5),
  zF: 1.55, zR: -1.35, ride: 0.22, hw: 0.96, belt: 1.1, trim: 0.22, flare: true, cornerR: 0.4,
  top: [[-2.45, 1.05], [-2.38, 1.1], [-2.0, 1.11], [-1.0, 1.1], [0.75, 1.1], [1.2, 1.12], [1.7, 1.08], [2.2, 1.02], [2.45, 0.96]],
  cab: { ws0: 0.82, ws1: 0.22, y1: 1.74, rf1: -2.15, y2: 1.74, bl: -2.3, roofHW: 0.82, beltHW: 0.91, pillars: [-0.42, -1.28], pillarW: 0.09, rails: true },
  doors: [0.7, -0.42, -1.28, -2.2], bumperF: 'black', bumperR: 'black', grille: 'tall', exhaust: 'single', noseTaper: 0.1, tailTaper: 0.08,
  lampR: { y: 1.0, w: 0.14, h: 0.34, x: 0.82 }, mirror: { y: 1.24, z: 0.7, big: true },
};
car('suv', 'suv', 'SUV', 1, SUV_PLAN);
car('suv.crossover', 'suv', 'Crossover', 0.9, derive(SUV_PLAN, {
  wheels: W(0.36, 0.235, 0.66, 'star', 5), trim: 0.14, flare: false, hw: 0.95,
  top: [[-2.45, 1.02], [-2.38, 1.06], [-2.0, 1.07], [-1.0, 1.08], [0.85, 1.09], [1.3, 1.1], [1.75, 1.03], [2.2, 0.95], [2.45, 0.88]],
  cab: { ws0: 0.9, ws1: 0.1, y1: 1.72, rf1: -1.7, y2: 1.62, bl: -2.3, roofHW: 0.78 }, grille: 'wide',
}));
car('suv.threerow', 'suv', 'Three-row SUV', 0.55, derive(SUV_PLAN, {
  cab: { pillars: [-0.42, -1.2, -1.95], y1: 1.76, y2: 1.75, rf1: -2.18 }, doors: [0.7, -0.42, -1.2, -2.2], wheels: W(0.385, 0.25, 0.6, 'star', 6), bumperF: 'chrome', bumperR: 'chrome',
}));
car('suv.compact', 'suv', 'Compact SUV', 0.7, derive(SUV_PLAN, {
  zNose: 2.25, zTail: -2.25, zF: 1.4, zR: -1.25, hw: 0.9, wheels: W(0.35, 0.22, 0.64, 'star', 5), trim: 0.16,
  top: [[-2.25, 1.02], [-2.18, 1.07], [-1.8, 1.08], [-0.9, 1.07], [0.7, 1.08], [1.1, 1.1], [1.6, 1.04], [2.0, 0.98], [2.25, 0.9]],
  cab: { ws0: 0.78, ws1: 0.2, y1: 1.7, rf1: -1.8, y2: 1.7, bl: -2.08, pillars: [-0.4], roofHW: 0.78, beltHW: 0.85 }, doors: [0.65, -0.4, -1.55],
}));

// --------------------------------------------------------------------------------------------------------------- minivans
export const MINIVAN_PLAN: CarPlan = {
  wheels: W(0.35, 0.215, 0.66, 'star', 5),
  zF: 1.5, zR: -1.45, ride: 0.17, hw: 0.95, belt: 1.0, cornerR: 0.42, noseTaper: 0.14,
  top: [[-2.55, 0.98], [-2.48, 1.05], [-2.0, 1.06], [0, 1.05], [1.2, 1.05], [1.8, 0.95], [2.3, 0.82], [2.55, 0.72]],
  cab: { ws0: 1.25, ws1: 0.35, y1: 1.74, rf1: -2.2, y2: 1.72, bl: -2.42, roofHW: 0.8, beltHW: 0.89, pillars: [0.05, -0.85, -1.6], pillarW: 0.08 },
  doors: [1.0, 0.05, -0.85], slideDoor: true, bumperF: 'body', bumperR: 'body', grille: 'wide', exhaust: 'none',
  lampR: { y: 1.0, w: 0.14, h: 0.36, x: 0.8 }, mirror: { y: 1.2, z: 1.05 },
};
car('minivan', 'minivan', 'Minivan', 1, MINIVAN_PLAN, (mb) => {
  // the sliding door: a long seam and a rail along the lower side
  if (!mb.close) return;
  for (const s of [-1, 1]) {
    mb.add(boxG(0.02, 0.03, 1.55, s * 0.955, 0.42, -0.9), 0x1a1b1c, ZONE.PLASTIC, 0);
  }
});
car('minivan.cargo', 'minivan', 'Cargo minivan', 0.5, derive(MINIVAN_PLAN, { cab: { pillars: [0.05, -0.9], solidFrom: -0.4 }, doors: [1.0, 0.05, -0.85] }));
car('minivan.tall', 'minivan', 'Tall minivan', 0.55, derive(MINIVAN_PLAN, {
  ride: 0.2, hw: 0.94, top: [[-2.55, 1.0], [-2.48, 1.08], [-2.0, 1.09], [0, 1.08], [1.4, 1.08], [1.9, 1.02], [2.3, 0.94], [2.55, 0.86]],
  cab: { ws0: 1.4, ws1: 0.75, y1: 1.79, y2: 1.79, rails: true }, wheels: W(0.34, 0.2, 0.66, 'cover'), grille: 'tall',
}));

// ---------------------------------------------------------------------------------------------------------------- sheriff
export const POLICE_PLAN: CarPlan = {
  wheels: W(0.34, 0.225, 0.62, 'steel', 5, 0x2b2e31),
  zF: 1.5, zR: -1.35, ride: 0.16, hw: 0.945, belt: 0.95,
  top: [[-2.5, 0.9], [-2.4, 0.96], [-2.0, 0.985], [-1.55, 0.965], [-1.3, 0.95], [0.85, 0.95], [1.2, 0.985], [1.8, 0.93], [2.25, 0.86], [2.5, 0.78]],
  cab: { ws0: 0.95, ws1: 0.2, y1: 1.44, rf1: -0.95, y2: 1.42, bl: -1.55, roofHW: 0.65, beltHW: 0.83, pillars: [-0.4], pillarW: 0.085 },
  doors: [0.68, -0.4, -1.2], bumperF: 'bull', bumperR: 'black', grille: 'wide', exhaust: 'dual',
};
function sheriffExtras(mb: ModelBuilder, b: CarBuild): void {
  const c = b.plan.cab;
  lightBar(mb, c.y1 + 0.04, (c.ws1 + c.rf1) / 2 + 0.05, c.roofHW * 0.82);
  if (mb.lod < 2) for (const s of [-1, 1]) mb.add(sideDecalG(s * (b.plan.hw + 0.006), 0.42, 0.86, -1.15, 0.45, 'sheriff'), 0xffffff, ZONE.DECAL, 0);
  // door-mounted spotlight
  if (mb.close) mb.add(boxG(0.09, 0.08, 0.1, c.beltHW + 0.03, 1.02, c.ws0 - 0.14), 0xc9ced2, ZONE.CHROME, 0);
}
car('police', 'police', 'Sheriff', 1, POLICE_PLAN, sheriffExtras);
car('police.charger', 'police', 'Sheriff interceptor', 0.5, derive(POLICE_PLAN, {
  hw: 0.95, ride: 0.13, wheels: W(0.345, 0.235, 0.7, 'star', 5), zF: 1.55, zR: -1.4,
  top: [[-2.5, 0.88], [-2.4, 0.95], [-2.0, 0.97], [-1.6, 0.955], [-1.3, 0.94], [0.9, 0.94], [1.3, 0.96], [1.85, 0.88], [2.25, 0.8], [2.5, 0.72]],
  cab: { ws0: 1.05, ws1: 0.25, y1: 1.4, rf1: -0.9, y2: 1.36, bl: -1.75, roofHW: 0.62, beltHW: 0.83 }, bumperF: 'body', bumperR: 'body', spoiler: 0.04,
}), sheriffExtras);
void roofRack;
