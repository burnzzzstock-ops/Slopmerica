// Passenger-vehicle bodies from a plan: a lofted hull (the sheet metal, with real wheel arches cut into its lower edge, a
// crowned hood and deck, a sill and bumper shaded dark) and a greenhouse of separate pillars, roof and inset glass panes.
// A sedan, a hatch, an SUV, a minivan, a pickup cab and a van differ by a few dozen numbers in a CarPlan, not by code.
import * as THREE from 'three';
import { tileUv } from './vehicleDecals';
import { addWheel, boxG, clamp, curve, cylG, extrudeG, lerp, loftG, mirrorX, ModelBuilder, planeG, quadG, smooth, sphereG, triG, ZONE, type V3, type WheelSpec } from './vehicleKit';

export interface CabPlan {
  ws0: number; ws1: number; y1: number;      // windshield base z, top z, roof height at the top of the windshield
  rf1: number; y2: number;                   // roof rear end z and height
  bl: number;                                // backlight base z (at the deck)
  roofHW: number; beltHW: number;            // greenhouse half width at the roof / at the belt
  pillars: number[];                         // z of the interior (B, C ...) pillars, front to rear
  pillarW?: number;                          // pillar width (m)
  noRear?: boolean;                          // vans: no separate backlight pane (a solid tailgate panel with a window)
  solidFrom?: number;                        // side panes behind this z are solid panels, not glass (a cargo van)
  header?: number;                           // a solid band this tall between the top of the glass and the roof edge (buses, cabs, vans)
  roofColor?: number;                        // roof and pillars in a fixed colour instead of the car's paint (a two-tone van)
  vent?: boolean;                            // add a small vent/quarter window
  glassTint?: number;
  rails?: boolean;                           // roof rails
  visorFront?: boolean;
}

export interface CarPlan {
  wheels: WheelSpec;
  zF: number; zR: number;
  axles?: number[];                          // every axle z, rear to front (default [zR, zF]); the front-most steers
  hwAt?: Array<[number, number]>;            // half width along the body [z, hw] (a box wider than its cab); overrides hw
  ride: number; archGap?: number;
  top: Array<[number, number]>;              // top-centre profile, rear to front: [z, y]
  crown?: number;                            // how much the top centre stands above the side edge
  hw: number;                                // body half width
  noseTaper?: number; tailTaper?: number;    // how much the corners narrow at the very end (0..1)
  cornerR?: number;                          // length of the rounded plan corners (m)
  belt: number;
  cab: CabPlan;
  flare?: boolean;                           // black plastic arch flares
  trim?: number;                             // sill / lower cladding height (dark)
  claddingColor?: number;
  bumperF?: 'body' | 'black' | 'chrome' | 'bull';
  bumperR?: 'body' | 'black' | 'chrome';
  grille?: 'slim' | 'wide' | 'tall' | 'vw' | 'none';
  plateRear?: number;                        // plate height
  lampF?: { y: number; w: number; h: number; x: number };
  lampR?: { y: number; w: number; h: number; x: number; bar?: boolean };
  mirror?: { y: number; z: number; big?: boolean };
  split?: { z: number; color?: number; zone?: number }; // behind this z the hull is a fixed colour (a green compactor, a white box) or, without a colour, plain paint again
  handles?: boolean;
  roundLamps?: boolean;                      // round headlamps (the hippie bus)
  frontFace?: 'flat';                         // a cab-over or van nose: no lamps drawn as a hood corner
  doors?: number[];                          // z of door cut lines (front to rear)
  slideDoor?: boolean;                       // a minivan's sliding door (rail + long door gap)
  exhaust?: 'single' | 'dual' | 'none';
  spoiler?: number;                          // trunk lip / wing height above deck (0 none)
  fastbackDeck?: boolean;
  zNose?: number; zTail?: number;            // where the hull ends front and rear (default +-L/2): a truck cab ends behind the doors
  noRear?: boolean;                          // no tail lamps, plate or bumper (the hull is only a cab; a bed or body follows)
}

/** A box between two points (pillars, rails): w across the beam, t through it. */
export function beamG(a: V3, b: V3, w: number, t: number): THREE.BufferGeometry {
  const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = d.length(); d.divideScalar(len || 1);
  const ref = Math.abs(d.x) > 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
  const zAxis = new THREE.Vector3().crossVectors(ref, d).normalize();
  const xAxis = new THREE.Vector3().crossVectors(d, zAxis).normalize();
  const g = new THREE.BoxGeometry(w, len, t).toNonIndexed();
  g.applyMatrix4(new THREE.Matrix4().makeBasis(xAxis, d, zAxis).setPosition((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2));
  return g;
}

/** Move each corner of a quad toward the middle of it, so a pane sits inside its frame. */
function inset(q: [V3, V3, V3, V3], amt: number): [V3, V3, V3, V3] {
  const c = [0, 1, 2].map((k) => (q[0][k] + q[1][k] + q[2][k] + q[3][k]) / 4);
  return q.map((p) => {
    const d = [c[0] - p[0], c[1] - p[1], c[2] - p[2]], l = Math.hypot(d[0], d[1], d[2]) || 1, s = Math.min(amt, l * 0.45) / l;
    return [p[0] + d[0] * s, p[1] + d[1] * s, p[2] + d[2] * s] as V3;
  }) as [V3, V3, V3, V3];
}

const DARK = [0.06, 0.065, 0.07] as const;

export interface CarBuild { hw: (z: number) => number; top: (z: number) => number; under: (z: number) => number; plan: CarPlan; L: number; W: number; H: number }

export function buildCar(mb: ModelBuilder, plan: CarPlan): CarBuild {
  const { L, W, H } = mb;
  const close = mb.close, near = mb.lod <= 1;
  const w = plan.wheels, r = w.r;
  const gap = plan.archGap ?? 0.055, R = r + gap;
  const crown = plan.crown ?? 0.045;
  const topAt = curve(plan.top);
  const nz = plan.zNose ?? L / 2, tz = plan.zTail ?? -L / 2;
  const hwBase = plan.hwAt ? curve(plan.hwAt) : () => plan.hw;
  const axleZs = plan.axles ?? [plan.zR, plan.zF];
  const frontAxle = Math.max(...axleZs);
  // plan view: full width along the body, the corners rounded off over the last `rc` metres (a quarter-ellipse, not a ramp)
  const widthAt = (z: number): number => {
    const nt = plan.noseTaper ?? 0.16, tt = plan.tailTaper ?? 0.14, rc = plan.cornerR ?? 0.42;
    const front = z > (nz + tz) / 2;
    const u = front ? Math.max(0, (z - (nz - rc)) / rc) : Math.max(0, ((tz + rc) - z) / rc);
    const k = front ? nt : tt;
    return hwBase(z) * (1 - k * (1 - Math.sqrt(Math.max(0, 1 - u * u))));
  };
  const arches = axleZs.filter((z) => z > tz - R && z < nz + R).map((z) => ({ z, yc: r }));
  const under = (z: number): number => {
    let yb = plan.ride;
    for (const a of arches) { const dz = z - a.z; if (Math.abs(dz) < R) yb = Math.max(yb, a.yc + Math.sqrt(R * R - dz * dz)); }
    return yb;
  };
  // stations along the body: arch samples, the top-line control points, and a few near each end to round the plan view
  const zs = new Set<number>();
  const put = (z: number) => zs.add(Math.round(clamp(z, tz, nz) * 1000) / 1000);
  const archSteps = mb.lod === 0 ? 6 : mb.lod === 1 ? 4 : 0;
  for (const a of arches) { if (archSteps) for (let k = 0; k <= archSteps; k++) put(a.z + R * Math.cos((k / archSteps) * Math.PI)); else { put(a.z - R); put(a.z + R); } }
  if (mb.lod < 2) for (const [z] of plan.top) put(z);
  else for (const z of [plan.top[0][0], plan.top[plan.top.length - 1][0]]) put(z);
  const endSteps = mb.lod === 0 ? [0, 0.06, 0.16, 0.34] : mb.lod === 1 ? [0, 0.1, 0.34] : [0];
  for (const e of endSteps) { put(nz - e); put(tz + e); }
  const cab = plan.cab;
  for (const z of [cab.ws0, cab.bl]) put(z);
  if (plan.split) put(plan.split.z);
  let list = [...zs].sort((a, b) => a - b);
  const minGap = mb.lod === 0 ? 0.05 : mb.lod === 1 ? 0.09 : 0.5;
  const splitZ = plan.split ? Math.round(clamp(plan.split.z, tz, nz) * 1000) / 1000 : NaN;
  list = list.filter((z, i) => i === 0 || i === list.length - 1 || z === splitZ || z - list[i - 1] >= minGap);

  const claddingDark = plan.claddingColor ?? 0x18191b;
  const cl = [((claddingDark >> 16) & 255) / 255, ((claddingDark >> 8) & 255) / 255, (claddingDark & 255) / 255];
  const trimH = plan.trim ?? 0.07;
  // half-ring tint: chassis, rocker, then paint
  // nine half-ring points, bottom to top centre: chassis, rocker, the crisp top edge of the dark trim, then paint
  const halfTint: Array<[number, number, number, number]> = [
    [DARK[0], DARK[1], DARK[2], 0], [cl[0], cl[1], cl[2], 0.15], [cl[0], cl[1], cl[2], 0.15], [1, 1, 1, 1], [1, 1, 1, 1], [1, 1, 1, 1], [1, 1, 1, 1], [1, 1, 1, 1], [1, 1, 1, 1],
  ];
  // which of the eight half-ring points each level of detail keeps
  const keep = mb.lod === 0 ? [0, 2, 3, 4, 6, 7, 8] : mb.lod === 1 ? [0, 2, 3, 6, 8] : [0, 3, 6, 8];
  const tintHalf = keep.map((k) => halfTint[k]);
  const ringTint = [...tintHalf, ...tintHalf.slice(0, -1).reverse()];
  // a dark bumper valance: the lower edge of the nose and tail is shaded plastic, so the bumper belongs to the body
  const valance = (z: number): number => plan.bumperF === 'chrome' && z > 0 || plan.bumperR === 'chrome' && z < 0 ? 0 : 0.11 * (1 - smooth(0.02, 0.4, Math.min(nz - z, z - tz)));
  const rings: V3[][] = [];
  for (const z of list) {
    const hwz = widthAt(z), yTop = topAt(z), yb = under(z);
    const ys = yTop - crown;
    const dh = Math.max(0.25, ys - yb);
    const hb = hwz - 0.1;
    const yMid = yb + dh * 0.5;
    const trimTop = yb + trimH + valance(z);
    const all: V3[] = [
      [hb, yb, z], [hwz - 0.02, yb + 0.02, z], [hwz, trimTop - 0.012, z], [hwz, trimTop, z], [hwz, yMid, z], [hwz * 0.985, Math.max(yMid + 0.05, ys - dh * 0.14), z],
      [hwz * 0.94, ys, z], [hwz * 0.6, yTop - crown * 0.25, z], [0, yTop, z],
    ];
    const half = keep.map((k) => all[k]);
    const ring = [...half, ...half.slice(0, -1).reverse().map(([x, y, zz]) => [-x, y, zz] as V3)];
    rings.push(ring);
  }
  if (plan.split) {
    // two lofts sharing the ring at the split: the cab (front) in the car's paint, the body (rear) in its own colour
    const k = list.findIndex((z) => z === splitZ);
    const front = loftG(rings.slice(k), { tint: ringTint, closeLast: true, crease: 0.42 });
    const rear = loftG(rings.slice(0, k + 1), { tint: ringTint, closeFirst: true, crease: 0.42 });
    mb.add(front, [1, 1, 1], ZONE.PAINT, 1);
    if (plan.split.color !== undefined) mb.add(rear, plan.split.color, plan.split.zone ?? ZONE.PANEL, 0); else mb.add(rear, [1, 1, 1], ZONE.PAINT, 1);
  } else mb.add(loftG(rings, { tint: ringTint, closeFirst: true, closeLast: true, crease: 0.42 }), [1, 1, 1], ZONE.PAINT, 1);

  // wheel-arch flares: a dark plastic ribbon round the arch edge (close range, or any range for a flared truck)
  const archTrim = (side: number, zc: number) => {
    const n = mb.lod === 0 ? 10 : 6, pos: number[] = [];
    const wd = plan.flare ? 0.075 : 0.03, x = side * (widthAt(zc) + 0.008);
    const pts: number[][] = [];
    for (let k = 0; k <= n; k++) {
      const a = (k / n) * Math.PI, cz = Math.cos(a), cy = Math.sin(a);
      pts.push([zc + cz * (R + 0.003), r + cy * (R + 0.003), zc + cz * (R + wd), r + cy * (R + wd)]);
    }
    for (let k = 0; k < n; k++) {
      const a = pts[k], b = pts[k + 1];
      const p = (z: number, y: number): V3 => [x + (plan.flare ? side * 0.028 * (0.5 + 0.5 * Math.sin(((k + 0.5) / n) * Math.PI)) : 0), y, z];
      pos.push(...(side > 0 ? [...p(a[0], a[1]), ...p(b[0], b[1]), ...p(b[2], b[3]), ...p(a[0], a[1]), ...p(b[2], b[3]), ...p(a[2], a[3])]
        : [...p(a[0], a[1]), ...p(b[2], b[3]), ...p(b[0], b[1]), ...p(a[0], a[1]), ...p(a[2], a[3]), ...p(b[2], b[3])]));
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
    mb.add(g, 0x141516, ZONE.PLASTIC, 0);
  };
  if (plan.flare ? mb.lod <= 1 : close) for (const side of [1, -1]) for (const a of arches) archTrim(side, a.z);

  // wheels (an axle beyond the hull, under a bed or a body, sits at the full body width)
  for (const az of axleZs) for (const side of [1, -1]) {
    const inside = az > tz + 0.3 && az < nz - 0.3;
    const x = side * ((inside ? widthAt(az) : hwBase(az)) - w.tw / 2 - 0.035);
    addWheel(mb, x, r, az, w, az === frontAxle);
    if (w.dual && mb.lod < 2 && az !== frontAxle) addWheel(mb, x - side * (w.tw + 0.03), r, az, { ...w, style: w.style === 'mud' ? 'steel' : w.style }, false, true);
  }

  // --------------------------------------------------------------------------------------------------- greenhouse
  const beltTop = topAt((cab.ws0 + cab.bl) / 2);
  const pw = cab.pillarW ?? 0.075;
  const bHW = cab.beltHW, rHW = cab.roofHW;
  const roofAt = (z: number) => lerp(cab.y1, cab.y2, clamp((cab.ws1 - z) / (cab.ws1 - cab.rf1), 0, 1));
  const deckAt = topAt(cab.bl);
  // roof panel
  const rf = (z: number): V3[] => { const y = roofAt(z), hwz = rHW + 0.012; return [[hwz, y - 0.04, z], [hwz, y, z], [0, y + 0.014, z], [-hwz, y, z], [-hwz, y - 0.04, z]]; };
  const roofRings = [rf(cab.ws1), rf((cab.ws1 + cab.rf1) / 2), rf(cab.rf1)];
  const roofGeo = loftG(close ? roofRings : [roofRings[0], roofRings[2]], { tint: [[1, 1, 1, 1], [1, 1, 1, 1], [1, 1, 1, 1], [1, 1, 1, 1], [1, 1, 1, 1]], closeFirst: true, closeLast: true });
  const fixedRoof = cab.roofColor !== undefined;
  if (fixedRoof) mb.add(roofGeo, cab.roofColor!, ZONE.PANEL, 0); else mb.add(roofGeo, [1, 1, 1], ZONE.PAINT, 1);
  const pillar = (g: THREE.BufferGeometry) => { if (fixedRoof) mb.add(g, cab.roofColor!, ZONE.PANEL, 0); else mb.body(g); };
  // pillars: A (windshield), interior, C (backlight)
  const beltPt = (z: number, side: number): V3 => [side * bHW, beltTop - 0.02, z];
  const roofPt = (z: number, side: number): V3 => [side * (rHW - 0.005), roofAt(z) - 0.03, z];
  const A: [number, number] = [cab.ws0, cab.ws1], C: [number, number] = [cab.bl, cab.rf1];
  const pillarZs = cab.pillars;
  if (mb.lod < 2) for (const side of [1, -1]) {
    pillar(beamG(beltPt(A[0], side), roofPt(A[1], side), pw * 1.15, 0.07));
    if (!cab.noRear) pillar(beamG(beltPt(C[0], side), roofPt(C[1], side), pw * 1.4, 0.07));
    for (const z of pillarZs) pillar(beamG(beltPt(z, side), roofPt(z, side), pw, 0.07));
    // beltline trim: the dark strip under the side windows
    if (close) mb.add(beamG([side * (bHW + 0.006), beltTop, C[0] + 0.05], [side * (bHW + 0.006), beltTop, A[0] - 0.02], 0.026, 0.026), 0x0d0e0f, ZONE.PLASTIC, 0);
  }
  if (cab.rails && mb.lod < 2) for (const side of [1, -1]) {
    const y = roofAt((cab.ws1 + cab.rf1) / 2) + 0.05;
    mb.add(boxG(0.045, 0.045, cab.ws1 - cab.rf1 - 0.35, side * (rHW - 0.09), y, (cab.ws1 + cab.rf1) / 2), 0x2b2d2f, ZONE.PLASTIC, 0);
    if (close) for (const z of [cab.ws1 - 0.15, (cab.ws1 + cab.rf1) / 2, cab.rf1 + 0.15]) mb.add(boxG(0.04, 0.04, 0.05, side * (rHW - 0.09), y - 0.025, z), 0x2b2d2f, ZONE.PLASTIC, 0);
  }
  // glass: side panes between the pillar lines (one long pane per side at far range)
  const glassColor = cab.glassTint ?? 0x1c2a33;
  const lines: Array<{ zb: number; zt: number }> = mb.lod === 2
    ? [{ zb: A[0], zt: A[1] }, { zb: C[0], zt: C[1] }]
    : [{ zb: A[0], zt: A[1] }, ...pillarZs.map((z) => ({ zb: z, zt: z })), ...(cab.noRear ? [] : [{ zb: C[0], zt: C[1] }])];
  if (cab.noRear && mb.lod < 2) lines.push({ zb: cab.rf1, zt: cab.rf1 });
  const sideX = (side: number, y: number, z: number) => side * lerp(bHW, rHW, clamp((y - beltTop) / Math.max(0.1, roofAt(z) - beltTop), 0, 1));
  for (const side of [1, -1]) for (let i = 0; i < lines.length - 1; i++) {
    const f = lines[i], b = lines[i + 1];
    const bl: V3 = [sideX(side, beltTop, f.zb), beltTop, f.zb], tl: V3 = [sideX(side, roofAt(f.zt), f.zt), roofAt(f.zt) - 0.02, f.zt];
    const tr: V3 = [sideX(side, roofAt(b.zt), b.zt), roofAt(b.zt) - 0.02, b.zt], br: V3 = [sideX(side, beltTop, b.zb), beltTop, b.zb];
    const q = inset(side > 0 ? [bl, br, tr, tl] : [br, bl, tl, tr], mb.lod === 2 ? 0.03 : pw * 0.55);
    const off = side * 0.006;
    const off3 = (p: V3): V3 => [p[0] + off, p[1], p[2]];
    // a header band: the glass stops `header` below the roof edge and a paint panel closes the rest
    const hdr = cab.header ?? 0;
    const lerp3 = (a: V3, b: V3, t: number): V3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
    // q runs bottom-left, bottom-right, top-right, top-left (+x side) or the mirror; the two vertical edges are 3-0 and 2-1 (+x) / 2-1 and 3-0 (-x)
    const tGlass = hdr > 0 ? clamp(1 - hdr / Math.max(0.2, Math.abs(q[3][1] - q[0][1])), 0.3, 1) : 1;
    const g0 = q[0], g1 = q[1], g2 = tGlass < 1 ? lerp3(q[1], q[2], tGlass) : q[2], g3 = tGlass < 1 ? lerp3(q[0], q[3], tGlass) : q[3];
    const pane = quadG(off3(g0), off3(g1), off3(g2), off3(g3));
    if (cab.solidFrom !== undefined && (f.zb + b.zb) / 2 < cab.solidFrom) mb.body(quadG(off3(q[0]), off3(q[1]), off3(q[2]), off3(q[3]))); else {
      mb.add(pane, glassColor, ZONE.GLASS, 0);
      if (tGlass < 1) mb.body(quadG(off3(g3), off3(g2), off3(q[2]), off3(q[3])));
    }
  }
  // windshield and backlight
  const wsB = topAt(cab.ws0);
  const ws: [V3, V3, V3, V3] = inset([[-bHW * 0.95, wsB - 0.01, cab.ws0 - 0.02], [bHW * 0.95, wsB - 0.01, cab.ws0 - 0.02], [rHW * 0.96, cab.y1 - 0.045, cab.ws1 + 0.01], [-rHW * 0.96, cab.y1 - 0.045, cab.ws1 + 0.01]], mb.lod === 2 ? 0.03 : 0.05);
  mb.add(quadG(...ws), glassColor, ZONE.GLASS, 0);
  if (!cab.noRear) {
    const bk: [V3, V3, V3, V3] = inset([[bHW * 0.95, deckAt, cab.bl + 0.02], [-bHW * 0.95, deckAt, cab.bl + 0.02], [-rHW * 0.96, cab.y2 - 0.045, cab.rf1 - 0.01], [rHW * 0.96, cab.y2 - 0.045, cab.rf1 - 0.01]], mb.lod === 2 ? 0.03 : 0.05);
    mb.add(quadG(...bk), glassColor, ZONE.GLASS, 0);
  }
  // wipers and cowl vent
  if (close) {
    for (const k of [-1, 1]) mb.add(beamG([k * 0.05, wsB + 0.005, cab.ws0 - 0.05], [k * 0.5 - 0.02 * k, wsB + 0.1, cab.ws0 - 0.16], 0.014, 0.012), 0x0d0e0f, ZONE.PLASTIC, 0);
    mb.add(boxG(bHW * 1.55, 0.02, 0.09, 0, wsB + 0.006, cab.ws0 + 0.02), 0x0c0d0e, ZONE.PLASTIC, 0);
  }

  // ------------------------------------------------------------------------------------------------ front and rear
  const noseTop = topAt(nz), tailTop = topAt(tz);
  const bumpF = plan.bumperF ?? 'body', bumpR = plan.bumperR ?? 'body';
  const yLow = under(nz) + 0.02;
  const lf = plan.lampF ?? { y: noseTop - 0.1, w: 0.36, h: 0.1, x: widthAt(nz) - 0.3 };
  const lr = plan.lampR ?? { y: tailTop - 0.14, w: 0.5, h: 0.12, x: widthAt(tz) - 0.36 };
  mb.lamps.head.push([lf.x, lf.y, nz], [-lf.x, lf.y, nz]);
  mb.lamps.tail.push([lr.x, lr.y, tz], [-lr.x, lr.y, tz]);
  mb.lamps.reverse.push([lr.x - lr.w * 0.3, lr.y - 0.03, tz], [-(lr.x - lr.w * 0.3), lr.y - 0.03, tz]);
  mb.lamps.turnLeft.push([lf.x + lf.w * 0.35, lf.y - lf.h * 0.7, nz], [lr.x - lr.w * 0.3, lr.y + 0.02, tz]);
  mb.lamps.turnRight.push([-(lf.x + lf.w * 0.35), lf.y - lf.h * 0.7, nz], [-(lr.x - lr.w * 0.3), lr.y + 0.02, tz]);
  mb.lamps.nose = [nz, widthAt(nz) * 0.82]; mb.lamps.tailZ = tz; mb.lamps.height = lf.y;
  if (mb.lod === 2) {
    // far: just the four lamps as glowing chips
    for (const s of [1, -1]) {
      mb.add(planeG(lf.w, lf.h, s * lf.x, lf.y, nz + 0.003, -s * 0.32), 0xf4f0e2, ZONE.HEAD, 0);
      mb.add(planeG(lr.w, lr.h, s * lr.x, lr.y, tz - 0.003, s * 0.32, true), 0xc0121a, ZONE.TAIL, 0);
    }
    return { hw: widthAt, top: topAt, under, plan, L, W, H };
  }
  // bumper strip / chrome / bull bar
  const bumperBar = (kind: string, sign: number) => {
    const hwz = widthAt(nz) * 0.93;
    if (kind === 'chrome') mb.add(boxG(hwz * 2, 0.11, 0.09, 0, yLow + 0.16, sign * (nz - 0.005)), 0xb9bec2, ZONE.CHROME, 0);
    else if (kind === 'black' || (kind === 'bull' && sign > 0)) mb.add(boxG(hwz * 1.98, 0.14, 0.1, 0, yLow + 0.12, sign * (nz - 0.01)), 0x141516, ZONE.PLASTIC, 0);
  };
  bumperBar(bumpF === 'bull' ? 'black' : bumpF, 1);
  bumperBar(bumpR, -1);
  if (bumpF === 'bull') {
    // push bar: two uprights and rails, in front of the grille
    const gx = widthAt(nz) * 0.5;
    for (const s of [-1, 1]) mb.add(boxG(0.06, 0.5, 0.06, s * gx, yLow + 0.4, nz + 0.1), 0x0e0f10, ZONE.STEEL, 0);
    mb.add(boxG(gx * 2 + 0.06, 0.06, 0.06, 0, yLow + 0.62, nz + 0.1), 0x0e0f10, ZONE.STEEL, 0);
    mb.add(boxG(gx * 2 + 0.06, 0.06, 0.06, 0, yLow + 0.22, nz + 0.1), 0x0e0f10, ZONE.STEEL, 0);
  }
  // grille
  const gh = plan.grille ?? 'slim';
  if (gh !== 'none') {
    const gy0 = yLow + (bumpF === 'body' ? 0.14 : 0.27), gy1 = Math.max(gy0 + 0.12, noseTop - (gh === 'tall' ? 0.05 : 0.12));
    const gw = widthAt(nz) * (gh === 'wide' ? 0.86 : gh === 'tall' ? 0.62 : gh === 'vw' ? 0.34 : 0.56);
    const zz = nz + 0.004;
    mb.add(quadG([-gw, gy0, zz], [gw, gy0, zz], [gw, gy1, zz], [-gw, gy1, zz], tileUv('grille')), 0x111213, ZONE.DECAL, 0);
    if (close) {
      mb.add(boxG(gw * 2 + 0.04, 0.03, 0.03, 0, gy1 + 0.015, zz), 0x9aa1a6, ZONE.CHROME, 0);
      mb.add(boxG(gw * 0.3, 0.05, 0.03, 0, (gy0 + gy1) / 2, zz + 0.005), 0xb9bec2, ZONE.CHROME, 0); // badge
    }
  }
  // lamps: boxes with a housing at close range, single lit quads farther out
  for (const s of [1, -1]) {
    const tilt = -s * 0.32;
    if (plan.roundLamps) {
      const rr = Math.max(0.09, lf.h * 0.6);
      mb.add(cylG(rr * 1.2, rr * 1.2, 0.05, mb.seg(12, 8), 'z', s * lf.x, lf.y, nz - 0.02), 0xb9bec2, ZONE.CHROME, 0);
      mb.add(cylG(rr, rr, 0.05, mb.seg(12, 8), 'z', s * lf.x, lf.y, nz - 0.005), 0xf4f0e2, ZONE.HEAD, 0);
      mb.add(planeG(lf.w * 0.4, lf.h * 0.45, s * (lf.x + lf.w * 0.7), lf.y - lf.h * 0.9, nz + 0.004), 0xffa317, ZONE.TURN, 0);
    } else if (close) {
      mb.add(boxG(lf.w + 0.03, lf.h + 0.03, 0.05, s * lf.x, lf.y, nz - 0.03, 0, tilt, 0), 0x0d0e0f, ZONE.PLASTIC, 0);
      mb.add(boxG(lf.w, lf.h, 0.03, s * lf.x, lf.y, nz - 0.005, 0, tilt, 0), 0xf4f0e2, ZONE.HEAD, 0);
      mb.add(boxG(lf.w * 0.46, lf.h * 0.5, 0.03, s * (lf.x + 0.03 * Math.sign(lf.x)), lf.y - lf.h * 0.15, nz + 0.001, 0, tilt, 0), 0xffffff, ZONE.HEAD, 0);
      mb.add(boxG(lf.w * 0.4, lf.h * 0.45, 0.03, s * (lf.x + lf.w * 0.35), lf.y - lf.h * 0.72, nz - 0.012, 0, tilt, 0), 0xffa317, ZONE.TURN, 0);
      mb.add(boxG(lr.w + 0.03, lr.h + 0.03, 0.05, s * lr.x, lr.y, tz + 0.03, 0, -tilt, 0), 0x0d0e0f, ZONE.PLASTIC, 0);
      mb.add(boxG(lr.w * (lr.bar ? 1.0 : 0.62), lr.h, 0.03, s * (lr.x + (lr.bar ? 0 : lr.w * 0.14)), lr.y, tz + 0.005, 0, -tilt, 0), 0xc0121a, ZONE.TAIL, 0);
      if (!lr.bar) {
        mb.add(boxG(lr.w * 0.22, lr.h * 0.5, 0.03, s * (lr.x - lr.w * 0.34), lr.y + lr.h * 0.2, tz + 0.008, 0, -tilt, 0), 0xffa317, ZONE.TURN, 0);
        mb.add(boxG(lr.w * 0.22, lr.h * 0.42, 0.03, s * (lr.x - lr.w * 0.34), lr.y - lr.h * 0.28, tz + 0.008, 0, -tilt, 0), 0xf3f3ef, ZONE.REVERSE, 0);
      }
    } else {
      mb.add(planeG(lf.w, lf.h, s * lf.x, lf.y, nz + 0.004, -s * 0.32), 0xf4f0e2, ZONE.HEAD, 0);
      mb.add(planeG(lf.w * 0.4, lf.h * 0.45, s * (lf.x + lf.w * 0.35), lf.y - lf.h * 0.72, nz + 0.006, -s * 0.32), 0xffa317, ZONE.TURN, 0);
      mb.add(planeG(lr.w * (lr.bar ? 1 : 0.62), lr.h, s * (lr.x + (lr.bar ? 0 : lr.w * 0.14)), lr.y, tz - 0.004, s * 0.32, true), 0xc0121a, ZONE.TAIL, 0);
      if (!lr.bar) {
        mb.add(planeG(lr.w * 0.22, lr.h * 0.5, s * (lr.x - lr.w * 0.34), lr.y + lr.h * 0.2, tz - 0.006, s * 0.32, true), 0xffa317, ZONE.TURN, 0);
        mb.add(planeG(lr.w * 0.22, lr.h * 0.42, s * (lr.x - lr.w * 0.34), lr.y - lr.h * 0.28, tz - 0.006, s * 0.32, true), 0xf3f3ef, ZONE.REVERSE, 0);
      }
    }
  }
  // plate (decal from the atlas) and rear detail (a cab-only hull has none: a bed or a body follows)
  const ph = plan.plateRear ?? Math.max(under(tz) + 0.3, tailTop - 0.33);
  if (!plan.noRear) mb.add(quadG([0.26, ph, tz - 0.004], [-0.26, ph, tz - 0.004], [-0.26, ph + 0.13, tz - 0.004], [0.26, ph + 0.13, tz - 0.004], tileUv('plate')), 0xffffff, ZONE.DECAL, 0);
  if (close) {
    if (!plan.noRear) mb.add(boxG(0.62, 0.02, 0.02, 0, ph + 0.15, tz - 0.005), 0x101112, ZONE.PLASTIC, 0);
    // front plate
    mb.add(quadG([-0.26, ph - 0.02, nz + 0.014], [0.26, ph - 0.02, nz + 0.014], [0.26, ph + 0.11, nz + 0.014], [-0.26, ph + 0.11, nz + 0.014], tileUv('plate')), 0xffffff, ZONE.DECAL, 0);
  }
  // exhaust
  if ((plan.exhaust ?? 'single') !== 'none' && !plan.noRear) {
    const xs = plan.exhaust === 'dual' ? [-0.5, 0.5] : [widthAt(tz) * 0.62];
    for (const x of xs) mb.add(cylG(0.032, 0.032, 0.14, mb.seg(8, 5), 'z', x, under(tz) + 0.06, tz + 0.03), 0xa7adb2, ZONE.CHROME, 0);
  }
  // mirrors on stalks (one lump each at near range)
  const mir = plan.mirror ?? { y: beltTop + 0.13, z: cab.ws0 - 0.18 };
  for (const s of [1, -1]) {
    if (close) mb.add(boxG(0.14, 0.02, 0.05, s * (bHW + 0.06), mir.y - 0.05, mir.z), 0x121314, ZONE.PLASTIC, 0);
    mb.add(boxG(mir.big ? 0.05 : 0.075, mir.big ? 0.22 : 0.13, mir.big ? 0.17 : 0.15, s * (bHW + 0.13 + (mir.big ? 0.02 : 0)), mir.y, mir.z), 0xffffff, ZONE.PAINT, 0.9);
    if (close) {
      const mx = bHW + 0.13 + (mir.big ? 0.05 : 0.04) + 0.001;
      const face = quadG([mx, mir.y - 0.05, mir.z + 0.06], [mx, mir.y - 0.05, mir.z - 0.06], [mx, mir.y + 0.05, mir.z - 0.06], [mx, mir.y + 0.05, mir.z + 0.06]);
      mb.add(s > 0 ? face : mirrorX(face), 0x8fa0aa, ZONE.CHROME, 0);
    }
  }
  // doors: cut lines and handles
  if (close) {
    const doors = plan.doors ?? [];
    const yLo = under(0) + trimH + 0.05, yHi = beltTop - 0.03;
    for (const s of [1, -1]) {
      const x = s * (widthAt(0) + 0.003);
      for (const z of doors) mb.add(boxG(0.008, yHi - yLo, 0.014, x, (yLo + yHi) / 2, z), 0x0c0d0e, ZONE.PLASTIC, 0);
      if (doors.length > 1) mb.add(boxG(0.008, 0.012, doors[0] - doors[doors.length - 1], x, yLo, (doors[0] + doors[doors.length - 1]) / 2), 0x0c0d0e, ZONE.PLASTIC, 0);
      if (plan.handles !== false) for (let i = 0; i < doors.length - 1; i++) mb.add(boxG(0.014, 0.024, 0.13, x + s * 0.005, beltTop - 0.1, doors[i] - (doors[i] - doors[i + 1]) * 0.15), 0x1a1b1c, ZONE.CHROME, 0);
    }
  }
  if (plan.spoiler && plan.spoiler > 0 && !plan.noRear) {
    const y = tailTop + plan.spoiler;
    mb.add(boxG(widthAt(tz) * 1.6, 0.03, 0.22, 0, y, tz + 0.3), 0x1a1b1c, ZONE.PLASTIC, 0.6);
    for (const s of [1, -1]) mb.add(boxG(0.03, plan.spoiler, 0.14, s * widthAt(tz) * 0.6, y - plan.spoiler / 2, tz + 0.3), 0x1a1b1c, ZONE.PLASTIC, 0.6);
  }
  return { hw: widthAt, top: topAt, under, plan, L, W, H };
}

void extrudeG; void sphereG; void triG; void cylG;
