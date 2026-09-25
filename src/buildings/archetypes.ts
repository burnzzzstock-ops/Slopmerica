// Which building archetypes a zone/level/lot allows, and whether a requested
// brand fits. The level decides the building; a caller-supplied brand is only
// honored when it has a matching archetype (and level range), so random brand
// picks upstream can't turn an L1 shed into a data center.
import type { ZoneType } from '../contracts';
import type { Rng } from '../core/rng';
import { brandById, type Archetype, type Brand } from '../art/brands';

export type Weights = Partial<Record<Archetype, number>>;

/** Archetype weights for a zone at a level on a lot (cells wide/deep); 0 or missing = not allowed. */
export function archWeights(zone: ZoneType, L: number, cw: number, cd: number): Weights {
  const D = cd * 8;
  const deep = D >= 16 ? 1 : 0; // drive-thrus and sit-downs need a real lot
  switch (zone) {
    case 'comLow':
      if (cw <= 1) return { shop: 5, coffee: 2, bar: L <= 3 ? 2 : 1, gas: L === 1 ? 1 : 0.5 };
      return {
        shop: [0, 5, 2, 1, 0.5, 0.3][L],
        gas: [0, 1.5, 4, 2.5, 2, 3][L],
        fastFood: [0, 0.5, 4, 3, 2, 2][L] * deep,
        diner: [0, 0.5, 1.5, 1, 1, 0.5][L] * deep,
        bar: [0, 2, 1, 1, 1, 0.5][L],
        coffee: [0, 0.5, 1, 1, 1, 1][L] * deep,
        restaurant: [0, 0, 0.5, 2, 3, 2][L] * (D >= 24 ? 1 : 0),
        carLot: [0, 1, 0.5, 0.5, 1.5, 1][L] * deep,
        strip: [0, 0.5, 1, 4, 4, 3.5][L] * (cw >= 3 ? 1 : cw === 2 ? 0.25 : 0),
      };
    case 'comHigh':
      if (cw <= 1 || cd <= 1) return L >= 4 ? { neonTower: 1 } : L === 3 ? { flagship: 1 } : { bigBox: 1 };
      return ([
        {},
        { bigBox: 6, mall: 0.5, flagship: 0.5 },
        { bigBox: 3, mall: 3, flagship: 1 },
        { flagship: 4, mall: 1, hotel: 1.5, bigBox: 0.5 },
        { hotel: 2, neonTower: 2.5, flagship: 1 },
        { neonTower: 5, hotel: 1 },
      ] as Weights[])[L] ?? {};
    case 'industry':
      return ([
        {},
        { shed: 1 },
        { warehouse: 4, shed: 1 },
        { factory: 3, brewery: 1, warehouse: 1 },
        { propaneDepot: 3, factory: 1.5 },
        { datacenter: 4, propaneDepot: 0.5 },
      ] as Weights[])[L] ?? {};
    case 'office':
      if (L <= 1) return { contentFarm: 1 };
      if (L === 2) return { glassOffice: 1 };
      if (L === 3) return cw >= 2 && cd >= 2 ? { campus: 1 } : { glassOffice: 1 };
      return { officeTower: 1 };
    default:
      return {};
  }
}

function brandWeights(zone: ZoneType, L: number, cw: number, cd: number, b: Brand | undefined): Weights | null {
  if (!b || !b.zones.includes(zone) || (b.levels && (L < b.levels[0] || L > b.levels[1]))) return null;
  if (b.id === 'slopHQ' && (cw < 2 || cd < 2)) return null; // world HQ needs a real lot
  const w = archWeights(zone, L, cw, cd);
  const out: Weights = {};
  let any = false;
  for (const a of b.arch ?? []) if ((w[a] ?? 0) > 0) (out[a] = w[a]), (any = true);
  return any ? out : null;
}

/** Does this brand have a building it can occupy here? */
export function brandFits(zone: ZoneType, L: number, cw: number, cd: number, brandId: string | undefined) {
  return brandWeights(zone, L, cw, cd, brandById(brandId)) !== null;
}

/** Pick an archetype, restricted to the brand's archetypes when the brand fits. */
export function pickArch(rng: Rng, zone: ZoneType, L: number, cw: number, cd: number, brandId?: string): Archetype {
  const w = brandWeights(zone, L, cw, cd, brandById(brandId)) ?? archWeights(zone, L, cw, cd);
  const opts = (Object.keys(w) as Archetype[]).filter((a) => (w[a] ?? 0) > 0);
  if (!opts.length) return 'shop';
  return rng.weighted(opts, (a) => w[a] ?? 0);
}
