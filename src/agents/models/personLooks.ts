import type { Archetype } from '../people';
import { bitOf } from './personGeo';
import { PED_STRIDE } from './personShader';

// Turns an archetype (what the owner wrote: build, outfit, hair, hat, prop, face, and the look fields added for this pass) and a
// per-person seed (skin, hair and clothes drawn from real-world palettes) into the numbers the shader reads for one instance.
// Nothing here is simulation: it only decides how a citizen is drawn.

/** palettes: everyday clothes, not primaries. The seed picks one of each unless the archetype fixes the colour. */
export const SKIN = [0xf3c9a4, 0xdba276, 0xb97850, 0x895638, 0x603b2a, 0xf0bfa0] as const;
export const HAIR = [0x2b1b15, 0x4a2c1b, 0x8a5a2b, 0xc9a45f, 0xd8d2c4, 0x161616, 0x9b3f2f] as const;
export const PANTS = [0x283447, 0x393735, 0x45513f, 0x3a5f8a, 0x604f3f, 0x1d2026, 0xa89877, 0x31516a] as const;
export const SHIRT = [0x315b73, 0xb64a3c, 0x5d7047, 0xc8913c, 0x6d547d, 0xd7d0bf, 0x303338, 0x8d5b3e, 0x24324a, 0xe8e6df, 0x8b8f93, 0xa8262d, 0x7fa6c9, 0x93a686] as const;
export const SHOES = [0x1c1c1e, 0x3b2f2a, 0xe6e3da, 0x2d3f66, 0x8a3b2f, 0x1c1c1e, 0x5a5a5e] as const;
export const ACCENT = [0x303338, 0x315b73, 0xa8262d, 0x5d7047, 0xd7d0bf, 0x24324a, 0x8d5b3e] as const;

export const BODY: Record<string, { shape: [number, number, number, number]; belly: number; shoulders: number; limbs: number }> = {
  slim: { shape: [0.92, 1.0, 0.92, 1.2], belly: 0, shoulders: 0.94, limbs: 0.98 },
  average: { shape: [1.0, 1.0, 1.0, 1.2], belly: 0.12, shoulders: 1.0, limbs: 1.1 },
  broad: { shape: [1.05, 1.02, 1.04, 1.2], belly: 0.35, shoulders: 1.14, limbs: 1.24 },
  stocky: { shape: [1.06, 0.94, 1.06, 1.2], belly: 0.85, shoulders: 1.06, limbs: 1.22 },
  tall: { shape: [0.95, 1.1, 0.95, 1.14], belly: 0, shoulders: 0.98, limbs: 1.0 },
  kid: { shape: [0.8, 0.78, 0.8, 1.4], belly: 0.05, shoulders: 0.92, limbs: 1.0 },
};

interface OutfitDef {
  id: number; sleeve: 0 | 1 | 2 | 3; sleeveOuter?: boolean; shirtPat?: number; outerPat?: number; pieces?: string[];
  outer?: number; trim?: number; shirt?: number; pantsPat?: number;
}
// pattern ids (personShader.ts): shirt 1 plaid 2 stripes 3 hawaiian 4 tie-dye 5 camo 6 flag 7 graphic chest 8 hi-vis 9 jersey trim
// 10 dots 11 heather; outer garment (3 bits, mapped to the shirt ids in the shader) 1 camo 2 plaid 3 pinstripe 4 stripes 5 hi-vis
// 6 jersey trim 7 heather; pants 1 jeans 2 camo 3 pinstripe 4 pyjama plaid 5 cargo 6 track stripe
export const OUTFITS: Record<string, OutfitDef> = {
  tee: { id: 0, sleeve: 1 },
  hoodie: { id: 1, sleeve: 3, pieces: ['hoodShirt'] },
  suit: { id: 2, sleeve: 3, sleeveOuter: true, pieces: ['jacket'], outer: 0x252b36, trim: 0x8c2b2b, shirt: 0xe8e6df },
  vest: { id: 3, sleeve: 3, pieces: ['vestOver'], outer: 0x3a4a3a },
  tank: { id: 4, sleeve: 0 },
  flannel: { id: 5, sleeve: 3, shirtPat: 1, trim: 0x1a1a1a },
  overalls: { id: 6, sleeve: 1, pieces: ['bib'], outer: 0x3a5f8a },
  robe: { id: 7, sleeve: 3, pieces: ['robe'] },
  jersey: { id: 8, sleeve: 1, shirtPat: 9 },
  workwear: { id: 9, sleeve: 3, sleeveOuter: true, pieces: ['jacketShort'], outer: 0xd48c25 },
  raincoat: { id: 10, sleeve: 3, sleeveOuter: true, pieces: ['coat', 'hoodOuter'], outer: 0xd4a72c },
  polo: { id: 11, sleeve: 1 },
  hawaiian: { id: 12, sleeve: 1, shirtPat: 3, trim: 0xf27a54 },
  dress: { id: 13, sleeve: 1, pieces: ['dress'], shirtPat: 10 },
  track: { id: 14, sleeve: 3, sleeveOuter: true, pieces: ['jacketShort'], outerPat: 6, outer: 0x4b6fa8 },
};

const HAIRS: Record<string, string[]> = {
  bald: [], crop: ['hairCap'], long: ['hairCap', 'hairLong'], ponytail: ['hairCap', 'hairTail'], mohawk: ['hairFin'],
  mullet: ['hairCap', 'hairMullet'], bun: ['hairCap', 'hairBun'], bob: ['hairCap', 'hairBob'], curls: ['hairCurls'], balding: ['hairBald'],
};
const HATS_BY: Record<string, string[]> = {
  none: [], ballcap: ['capCrown', 'capBrim'], beanie: ['beanie'], cowboy: ['cowboyCrown', 'cowboyBrim'], hardhat: ['hardCrown', 'hardBrim'],
  tinfoil: ['foilCone'], sunhat: ['sunCrown', 'sunBrim'],
};
const WALKS: Record<string, { id: number; stride: number }> = {
  normal: { id: 0, stride: 1 }, stiff: { id: 1, stride: 0.98 }, slouch: { id: 2, stride: 0.86 }, bouncy: { id: 3, stride: 1.03 },
  swagger: { id: 4, stride: 1.0 }, elder: { id: 5, stride: 0.8 }, strut: { id: 6, stride: 1.06 }, kid: { id: 7, stride: 1 },
};
const IDLES: Record<string, number> = { hang: 0, pockets: 1, crossed: 2, hips: 3, behind: 4, clasped: 5, loose: 6, onepocket: 7 };

/** bag ids the fragment shader paints straps for */
const BAG_ID: Record<string, number> = { backpack: 1, bigpack: 2, delivery: 3, messenger: 4, tote: 5, fanny: 6, toolbelt: 7, chairbag: 8, camera: 9 };
const FLAG = { trucker: 1, sash: 2, chain: 4, lanyard: 8 };

interface Gear { bits?: string[]; legwear?: number; shoe?: number; bag?: number; shirtPat?: number; outerPat?: number; pantsPat?: number; flags?: number }
/** everything an archetype's `gear` list can name */
export const GEAR: Record<string, Gear> = {
  shorts: { legwear: 1 }, kneepants: { legwear: 2 }, capri: { legwear: 3 },
  boots: { bits: ['boots'], shoe: 1 }, dressshoes: { shoe: 2 }, barefoot: { shoe: 3 }, platform: { shoe: 4 },
  backpack: { bits: ['backpack'], bag: BAG_ID.backpack }, bigpack: { bits: ['bigpack'], bag: BAG_ID.bigpack }, delivery: { bits: ['delivery'], bag: BAG_ID.delivery },
  messenger: { bits: ['messenger'], bag: BAG_ID.messenger }, tote: { bits: ['tote'], bag: BAG_ID.tote }, fanny: { bits: ['fanny'], bag: BAG_ID.fanny },
  toolbelt: { bits: ['toolbelt'], bag: BAG_ID.toolbelt }, chairbag: { bits: ['chairbag'], bag: BAG_ID.chairbag }, camera: { bits: ['camera'], bag: BAG_ID.camera },
  fleeceVest: { bits: ['vestOver'] }, hivisVest: { bits: ['hivisVest'] }, tacticalVest: { bits: ['vestOver', 'pouches'] }, apron: { bits: ['apron'] },
  headphones: { bits: ['headphones'] }, headband: { bits: ['headband'] }, flowers: { bits: ['flowers'] }, visor: { bits: ['visor'] }, helmet: { bits: ['helmet'] },
  hoodUp: { bits: ['hoodUp'] }, shadesHead: { bits: ['shadesHead'] }, beard: { bits: ['beard3d'] }, flatcap: { bits: ['flatcap'] }, pigtails: { bits: ['pigtails'] },
  badge: { bits: ['badge'], flags: FLAG.lanyard }, trucker: { flags: FLAG.trucker }, sash: { flags: FLAG.sash }, chain: { flags: FLAG.chain },
  plaid: { shirtPat: 1 }, stripes: { shirtPat: 2 }, hawaii: { shirtPat: 3 }, tiedye: { shirtPat: 4 }, flagShirt: { shirtPat: 6 }, graphic: { shirtPat: 7 },
  heather: { shirtPat: 11 }, polka: { shirtPat: 10 },
  camoJacket: { outerPat: 1 }, pinstripe: { outerPat: 3 },
  jeans: { pantsPat: 1 }, camoPants: { pantsPat: 2 }, pinstripePants: { pantsPat: 3 }, pajamas: { pantsPat: 4 }, cargo: { pantsPat: 5 }, trackpants: { pantsPat: 6 },
};

export interface PersonLook {
  colA: [number, number, number, number];
  colB: [number, number, number, number];
  maskA: number; maskB: number; maskC: number;
  ints1: number; ints2: number; ints3: number;
  shape: [number, number, number, number];
  build: [number, number, number, number];
  seed01: number;
  face: number;
  /** leg cycles per sim-phase unit: pedestrians.ts advances phase by ground / 1.42 (walk) or / 2.2 (run); a person with their own
   * stride takes 1.42 / stride cycles for it, so the feet still keep up with the ground */
  cadence: number;
  bits: string[];
}

const h32 = (n: number) => { n = Math.imul(n ^ (n >>> 15), 0x2c1b3c6d); n = Math.imul(n ^ (n >>> 12), 0x297a2d39); return ((n ^ (n >>> 15)) >>> 0) / 4294967296; };

export function resolveLook(a: Archetype, seed: number, faceId: number, propOf: (p: string | undefined) => number): PersonLook {
  const s = seed >>> 0;
  const pick = <T,>(arr: readonly T[], shift: number) => arr[(s >>> shift) % arr.length];
  const c = a.colors ?? {};
  const outfit = OUTFITS[a.outfit ?? 'tee'] ?? OUTFITS.tee;
  const skin = a.face === 'npc' ? 0x8b9093 : c.skin ?? pick(SKIN, 3);
  const hair = c.hair ?? pick(HAIR, 7);
  const pants = c.pants ?? pick(PANTS, 11);
  const shirt = c.shirt ?? (a.merch ? 0x171717 : outfit.shirt ?? pick(SHIRT, 15));
  const outerC = c.outer ?? outfit.outer ?? shirt;
  const trim = c.trim ?? outfit.trim ?? pick(ACCENT, 19);
  const shoe = c.shoe ?? pick(SHOES, 23);
  const bagC = c.bag ?? pick(ACCENT, 5);
  const bits: string[] = [...(outfit.pieces ?? []), ...(HAIRS[a.hair ?? 'crop'] ?? []), ...(HATS_BY[a.hat ?? 'none'] ?? [])];
  if (a.merch) bits.push('merchBack');
  let legwear = 0, shoeSt = 0, bag = 0, shirtPat = outfit.shirtPat ?? 0, outerPat = outfit.outerPat ?? 0, pantsPat = outfit.pantsPat ?? 0, flags = 0;
  for (const g of a.gear ?? []) {
    const d = GEAR[g];
    if (!d) continue;
    if (d.bits) bits.push(...d.bits);
    if (d.legwear !== undefined) legwear = d.legwear;
    if (d.shoe !== undefined) shoeSt = d.shoe;
    if (d.bag !== undefined) bag = d.bag;
    if (d.shirtPat !== undefined) shirtPat = d.shirtPat;
    if (d.outerPat !== undefined) outerPat = d.outerPat;
    if (d.pantsPat !== undefined) pantsPat = d.pantsPat;
    if (d.flags) flags |= d.flags;
  }
  const body = BODY[a.body ?? 'average'] ?? BODY.average;
  const j = (k: number) => 0.97 + 0.06 * h32(s + k);
  const bd = a.build ?? {};
  const height = (bd.height ?? 1) * j(2);
  const shape: [number, number, number, number] = [body.shape[0] * j(1), body.shape[1] * height, body.shape[2] * j(3), body.shape[3] * (bd.head ?? 1)];
  const walk = WALKS[a.walk ?? (a.body === 'kid' ? 'kid' : 'normal')] ?? WALKS.normal;
  // Lp: metres of ground per leg cycle, in proportion to leg length
  const stride = PED_STRIDE.walk * shape[1] * walk.stride * (0.97 + 0.06 * h32(s + 9));
  const idle = a.idle !== undefined && a.idle in IDLES ? IDLES[a.idle] : Math.floor(h32(s + 11) * 8);
  const stoop = 3; // 0.04 rad steps around 3 = upright
  const ints1 = outfit.id | (outfit.sleeve << 5) | (legwear << 7) | (shoeSt << 10) | (shirtPat << 13) | (outerPat << 17) | (pantsPat << 20) | ((outfit.sleeveOuter ? 1 : 0) << 23);
  const ints2 = walk.id | (idle << 3) | (stoop << 6) | (propOf(a.prop) << 10) | (Math.floor(h32(s + 13) * 3) << 16) | (bag << 19);
  const masks = [0, 0, 0];
  for (const b of new Set(bits)) { const i = bitOf(b); masks[Math.floor(i / 24)] += 2 ** (i % 24); }
  return {
    colA: [skin, hair, shirt, pants], colB: [outerC, trim, shoe, bagC],
    maskA: masks[0], maskB: masks[1], maskC: masks[2], ints1, ints2, ints3: flags,
    shape, build: [bd.belly ?? body.belly, (bd.shoulders ?? 1) * body.shoulders, (bd.limbs ?? 1) * body.limbs, stride], seed01: h32(s + 17), face: faceId,
    cadence: PED_STRIDE.walk / stride, bits: [...new Set(bits)],
  };
}
