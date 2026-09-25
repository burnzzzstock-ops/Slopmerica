// Procedural ambient-life models. These intentionally share one material and bake
// their local color zones into vertex colors, keeping each visible species to one draw.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export type AmbientSpecies =
  | 'bird' | 'crow' | 'deer' | 'blackBear' | 'turkey'
  | 'seagull' | 'pelican' | 'seaLion' | 'elk'
  | 'alligator' | 'flamingo' | 'manatee'
  | 'fishingBoat' | 'bassBoat' | 'jetSki' | 'sailboat';

export type AmbientFamily = 'bird' | 'land' | 'shore' | 'waterAnimal' | 'boat';

export interface AmbientModelDef {
  kind: AmbientSpecies;
  family: AmbientFamily;
  geometry: THREE.BufferGeometry;
  scale: number;
  speed: number;
  triangles: number;
}

type Part = { g: THREE.BufferGeometry; color: number; x?: number; y?: number; z?: number; sx?: number; sy?: number; sz?: number; rx?: number; ry?: number; rz?: number };

function colorPart(p: Part): THREE.BufferGeometry {
  const g = p.g.index ? p.g.toNonIndexed() : p.g.clone();
  if (g !== p.g) p.g.dispose();
  // Custom wedges have no UVs; these models use baked vertex colors, so remove
  // primitive UVs as well to keep BufferGeometryUtils attribute sets identical.
  g.deleteAttribute('uv');
  g.scale(p.sx ?? 1, p.sy ?? 1, p.sz ?? 1);
  if (p.rx) g.rotateX(p.rx);
  if (p.ry) g.rotateY(p.ry);
  if (p.rz) g.rotateZ(p.rz);
  g.translate(p.x ?? 0, p.y ?? 0, p.z ?? 0);
  const c = new THREE.Color(p.color);
  const n = g.getAttribute('position').count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

function merge(parts: Part[]): THREE.BufferGeometry {
  const gs = parts.map(colorPart);
  const out = mergeGeometries(gs, false);
  for (const g of gs) g.dispose();
  if (!out) throw new Error('Ambient model geometry could not be merged');
  out.computeBoundingSphere();
  return out;
}

const sphere = () => new THREE.SphereGeometry(1, 8, 5);
const ico = () => new THREE.IcosahedronGeometry(1, 1);
const icoLow = () => new THREE.IcosahedronGeometry(1, 0);
const cyl = () => new THREE.CylinderGeometry(1, 1, 1, 6);
const cone = () => new THREE.ConeGeometry(1, 1, 6);
const box = () => new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);

function wedge(width = 1, height = 1, length = 1): THREE.BufferGeometry {
  const x = width * 0.5, y = height, z = length * 0.5;
  const pos = new Float32Array([
    -x, 0, -z, x, 0, -z, x, 0, z, -x, 0, z,
    -x * .78, y, -z * .72, x * .78, y, -z * .72, x * .52, y * .58, z, -x * .52, y * .58, z,
  ]);
  const idx = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function antlers(parts: Part[], color: number, y: number, z: number, size: number) {
  for (const side of [-1, 1]) {
    parts.push({ g: cyl(), color, x: side * .18 * size, y, z, sx: .025 * size, sy: .34 * size, sz: .025 * size, rz: side * -.35 });
    parts.push({ g: cyl(), color, x: side * .28 * size, y: y + .13 * size, z, sx: .018 * size, sy: .18 * size, sz: .018 * size, rz: side * -.75 });
    parts.push({ g: cyl(), color, x: side * .34 * size, y: y + .23 * size, z: z + .03, sx: .016 * size, sy: .14 * size, sz: .016 * size, rz: side * -.45 });
  }
}

function quadruped(body: number, belly: number, antler = false, bear = false): THREE.BufferGeometry {
  const p: Part[] = [
    { g: sphere(), color: body, y: .78, sx: bear ? .62 : .52, sy: bear ? .43 : .34, sz: bear ? .84 : .75 },
    { g: sphere(), color: belly, y: .74, z: .04, sx: bear ? .5 : .43, sy: bear ? .31 : .25, sz: bear ? .7 : .62 },
    { g: cyl(), color: body, y: 1.04, z: .54, sx: bear ? .28 : .17, sy: bear ? .38 : .52, sz: bear ? .28 : .17, rx: -.24 },
    { g: sphere(), color: body, y: bear ? 1.18 : 1.3, z: bear ? .75 : .69, sx: bear ? .4 : .27, sy: bear ? .32 : .25, sz: bear ? .4 : .34 },
    { g: cone(), color: body, x: -.14, y: bear ? 1.43 : 1.52, z: .68, sx: .09, sy: .18, sz: .08, rz: -.18 },
    { g: cone(), color: body, x: .14, y: bear ? 1.43 : 1.52, z: .68, sx: .09, sy: .18, sz: .08, rz: .18 },
    { g: cone(), color: body, y: .9, z: -.82, sx: bear ? .14 : .1, sy: bear ? .22 : .34, sz: bear ? .14 : .1, rx: Math.PI / 2 },
  ];
  for (const x of [-.3, .3]) for (const z of [-.47, .45]) {
    p.push({ g: cyl(), color: body, x, y: .37, z, sx: bear ? .11 : .075, sy: .7, sz: bear ? .11 : .075 });
    p.push({ g: box(), color: bear ? 0x241d19 : 0x30251e, x, y: .04, z: z + .05, sx: bear ? .2 : .13, sy: .09, sz: .27 });
  }
  if (antler) antlers(p, 0x5a3d22, 1.61, .68, 1);
  return merge(p);
}

function bird(body: number, wing: number, bill: number, pelican = false): THREE.BufferGeometry {
  const p: Part[] = [
    { g: sphere(), color: body, y: .5, sx: .3, sy: .25, sz: .48 },
    { g: sphere(), color: body, y: .73, z: .34, sx: .2, sy: .2, sz: .22 },
    { g: cone(), color: bill, y: pelican ? .67 : .72, z: pelican ? .76 : .58, sx: pelican ? .12 : .07, sy: pelican ? .52 : .22, sz: pelican ? .12 : .07, rx: Math.PI / 2 },
    { g: cone(), color: wing, x: -.43, y: .52, sx: .48, sy: .13, sz: .25, rz: Math.PI / 2 },
    { g: cone(), color: wing, x: .43, y: .52, sx: .48, sy: .13, sz: .25, rz: -Math.PI / 2 },
    { g: cone(), color: wing, y: .5, z: -.55, sx: .18, sy: .32, sz: .12, rx: -Math.PI / 2 },
  ];
  if (pelican) p.push({ g: sphere(), color: 0xd5b56f, y: .58, z: .61, sx: .13, sy: .19, sz: .25 });
  return merge(p);
}

function turkey(): THREE.BufferGeometry {
  const p: Part[] = [
    { g: sphere(), color: 0x3d2b21, y: .55, sx: .42, sy: .38, sz: .5 },
    { g: sphere(), color: 0x453025, y: .79, z: .34, sx: .18, sy: .18, sz: .2 },
    { g: cyl(), color: 0x9b2f29, y: .71, z: .49, sx: .045, sy: .24, sz: .045 },
    { g: cone(), color: 0xd3a13a, y: .79, z: .55, sx: .055, sy: .17, sz: .055, rx: Math.PI / 2 },
  ];
  for (let i = 0; i < 7; i++) {
    const a = -.9 + i * .3;
    p.push({ g: sphere(), color: i % 2 ? 0x7a4a2a : 0x252321, x: Math.sin(a) * .5, y: .76 + Math.cos(a) * .25, z: -.42, sx: .17, sy: .5, sz: .07, rz: -a });
  }
  for (const x of [-.13, .13]) p.push({ g: cyl(), color: 0x9b7651, x, y: .18, z: .05, sx: .035, sy: .35, sz: .035 });
  return merge(p);
}

function seaLion(): THREE.BufferGeometry {
  return merge([
    { g: sphere(), color: 0x51483f, y: .35, sx: .48, sy: .34, sz: 1.05 },
    { g: sphere(), color: 0x5d5146, y: .64, z: .72, sx: .4, sy: .38, sz: .42 },
    { g: cone(), color: 0x403a35, x: -.46, y: .18, z: .18, sx: .22, sy: .56, sz: .08, rz: 1.15 },
    { g: cone(), color: 0x403a35, x: .46, y: .18, z: .18, sx: .22, sy: .56, sz: .08, rz: -1.15 },
    { g: cone(), color: 0x403a35, x: -.2, y: .25, z: -.98, sx: .18, sy: .45, sz: .08, rx: -1.1, rz: -.4 },
    { g: cone(), color: 0x403a35, x: .2, y: .25, z: -.98, sx: .18, sy: .45, sz: .08, rx: -1.1, rz: .4 },
  ]);
}

function alligator(): THREE.BufferGeometry {
  const p: Part[] = [
    { g: sphere(), color: 0x344a2c, y: .27, sx: .42, sy: .25, sz: 1.15 },
    { g: wedge(.72, .3, 1.05), color: 0x3f5935, y: .13, z: 1.3 },
    { g: cone(), color: 0x2f4229, y: .25, z: -1.67, sx: .33, sy: 1.15, sz: .25, rx: -Math.PI / 2 },
  ];
  for (let i = 0; i < 7; i++) p.push({ g: cone(), color: 0x263921, y: .55, z: -.8 + i * .28, sx: .1, sy: .2, sz: .1 });
  for (const x of [-.42, .42]) for (const z of [-.55, .55]) p.push({ g: cyl(), color: 0x344a2c, x, y: .17, z, sx: .08, sy: .5, sz: .08, rz: Math.PI / 2 });
  return merge(p);
}

function flamingo(): THREE.BufferGeometry {
  const p: Part[] = [
    { g: sphere(), color: 0xe77789, y: 1.05, sx: .38, sy: .31, sz: .5 },
    { g: cyl(), color: 0xf08fa0, x: .05, y: 1.46, z: .35, sx: .055, sy: .78, sz: .055, rx: -.35 },
    { g: sphere(), color: 0xf29aaa, x: .18, y: 1.82, z: .5, sx: .15, sy: .14, sz: .17 },
    { g: cone(), color: 0x252326, x: .18, y: 1.77, z: .72, sx: .07, sy: .24, sz: .07, rx: Math.PI / 2 },
  ];
  for (const x of [-.13, .13]) p.push({ g: cyl(), color: 0xc76075, x, y: .46, z: -.03, sx: .025, sy: .96, sz: .025 });
  return merge(p);
}

function manatee(): THREE.BufferGeometry {
  return merge([
    { g: sphere(), color: 0x707a79, y: .05, sx: .62, sy: .4, sz: 1.25 },
    { g: sphere(), color: 0x7d8583, y: .08, z: .98, sx: .5, sy: .36, sz: .52 },
    { g: cone(), color: 0x667170, x: -.55, y: -.02, z: .2, sx: .26, sy: .58, sz: .1, rz: 1.1 },
    { g: cone(), color: 0x667170, x: .55, y: -.02, z: .2, sx: .26, sy: .58, sz: .1, rz: -1.1 },
    { g: sphere(), color: 0x667170, y: .04, z: -1.34, sx: .62, sy: .14, sz: .46 },
  ]);
}

function boat(kind: 'fishingBoat' | 'bassBoat' | 'jetSki' | 'sailboat'): THREE.BufferGeometry {
  if (kind === 'jetSki') return merge([
    { g: wedge(.95, .34, 2.4), color: 0xd84336, y: .05 },
    { g: wedge(.56, .38, 1.25), color: 0x252b31, y: .28, z: -.15 },
    { g: cyl(), color: 0x282b2d, x: -.22, y: .72, z: .25, sx: .035, sy: .48, sz: .035, rz: Math.PI / 2 },
  ]);
  const hullColor = kind === 'bassBoat' ? 0x4f6f87 : kind === 'sailboat' ? 0xe3ded1 : 0xb9c7c8;
  const p: Part[] = [
    { g: wedge(kind === 'sailboat' ? 2.1 : 2.25, .75, kind === 'sailboat' ? 5.2 : 4.7), color: hullColor, y: -.2 },
    { g: box(), color: kind === 'bassBoat' ? 0x46515a : 0xe2e5df, y: .48, z: -.35, sx: kind === 'bassBoat' ? 1.65 : 1.55, sy: kind === 'bassBoat' ? .16 : .7, sz: kind === 'bassBoat' ? 2.8 : 1.55 },
  ];
  if (kind === 'fishingBoat') {
    p.push({ g: box(), color: 0x274459, y: .66, z: .42, sx: 1.48, sy: .42, sz: .06 });
    p.push({ g: cyl(), color: 0x8c9291, y: 1.34, z: -.2, sx: .035, sy: 1.35, sz: .035 });
  } else if (kind === 'bassBoat') {
    p.push({ g: box(), color: 0x20262a, y: .56, z: -.2, sx: .55, sy: .13, sz: .7 });
    p.push({ g: box(), color: 0x1f2426, y: .22, z: -2.38, sx: .52, sy: .7, sz: .25 });
  } else {
    p.push({ g: cyl(), color: 0x8d765b, y: 2.5, z: -.1, sx: .055, sy: 4.5, sz: .055 });
    p.push({ g: cone(), color: 0xf0eee5, x: .12, y: 2.7, z: -.1, sx: .09, sy: 2.0, sz: 1.42, rz: -Math.PI / 2 });
    p.push({ g: cone(), color: 0xcc5749, x: -.1, y: 2.25, z: -.1, sx: .07, sy: 1.55, sz: 1.05, rz: Math.PI / 2 });
  }
  return merge(p);
}

function triCount(g: THREE.BufferGeometry) {
  return (g.index?.count ?? g.getAttribute('position').count) / 3;
}

export function createAmbientModels(): AmbientModelDef[] {
  const rows: [AmbientSpecies, AmbientFamily, THREE.BufferGeometry, number, number][] = [
    ['bird', 'bird', bird(0x776859, 0x574b42, 0xc08a3f), .72, 8],
    ['crow', 'bird', bird(0x202329, 0x15171a, 0x34383d), .78, 9],
    ['deer', 'land', quadruped(0x9a704a, 0xc09a70), 1.16, 2.2],
    ['blackBear', 'land', quadruped(0x292522, 0x39312b, false, true), 1.38, 1.15],
    ['turkey', 'land', turkey(), 1.0, 1.4],
    ['seagull', 'bird', bird(0xd9d9d2, 0x9ba4aa, 0xd7aa4b), .82, 9],
    ['pelican', 'bird', bird(0xd7d0ba, 0x8b8172, 0xd6a14b, true), 1.24, 8],
    ['seaLion', 'shore', seaLion(), 1.45, .8],
    ['elk', 'land', quadruped(0x745638, 0xa07b53, true), 1.48, 2.1],
    ['alligator', 'shore', alligator(), 1.36, 1.0],
    ['flamingo', 'shore', flamingo(), 1.03, .7],
    ['manatee', 'waterAnimal', manatee(), 1.55, .6],
    ['fishingBoat', 'boat', boat('fishingBoat'), 1.05, 5.2],
    ['bassBoat', 'boat', boat('bassBoat'), .95, 7],
    ['jetSki', 'boat', boat('jetSki'), .82, 10],
    ['sailboat', 'boat', boat('sailboat'), 1.12, 3.8],
  ];
  return rows.map(([kind, family, geometry, scale, speed]) => ({ kind, family, geometry, scale, speed, triangles: triCount(geometry) }));
}

export function createAmbientFarGeometry(family: AmbientFamily): THREE.BufferGeometry {
  if (family === 'bird') return merge([
    { g: icoLow(), color: 0xffffff, y: .48, sx: .32, sy: .23, sz: .48 },
    { g: cone(), color: 0xffffff, x: -.4, y: .5, sx: .4, sy: .12, sz: .2, rz: Math.PI / 2 },
    { g: cone(), color: 0xffffff, x: .4, y: .5, sx: .4, sy: .12, sz: .2, rz: -Math.PI / 2 },
  ]);
  if (family === 'boat') return merge([{ g: wedge(1.7, .55, 3.6), color: 0xffffff, y: .05 }, { g: box(), color: 0xdde2df, y: .5, z: -.3, sx: 1.0, sy: .55, sz: 1.0 }]);
  if (family === 'shore') return merge([{ g: icoLow(), color: 0xffffff, y: .35, sx: .46, sy: .32, sz: .85 }, { g: icoLow(), color: 0xffffff, y: .54, z: .56, sx: .27, sy: .24, sz: .3 }]);
  if (family === 'waterAnimal') return merge([{ g: icoLow(), color: 0xffffff, y: .12, sx: .54, sy: .3, sz: 1.0 }, { g: icoLow(), color: 0xffffff, y: .08, z: -.92, sx: .5, sy: .1, sz: .4 }]);
  return merge([{ g: icoLow(), color: 0xffffff, y: .72, sx: .5, sy: .34, sz: .72 }, { g: icoLow(), color: 0xffffff, y: 1.14, z: .55, sx: .25, sy: .25, sz: .28 }, { g: box(), color: 0xffffff, x: -.26, y: .3, z: -.35, sx: .11, sy: .58, sz: .11 }, { g: box(), color: 0xffffff, x: .26, y: .3, z: .35, sx: .11, sy: .58, sz: .11 }]);
}

export const AMBIENT_SPECIES: readonly AmbientSpecies[] = [
  'bird', 'crow', 'deer', 'blackBear', 'turkey', 'seagull', 'pelican', 'seaLion', 'elk',
  'alligator', 'flamingo', 'manatee', 'fishingBoat', 'bassBoat', 'jetSki', 'sailboat',
];
