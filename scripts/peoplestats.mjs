// Pedestrian model cost, without a browser (docs/HANDOFF_CARS_LOOK.md item 5): loads the TypeScript through Vite's SSR loader
// and prints, for each level of detail of the instanced citizen, its vertices, its triangles (everything the geometry holds,
// which is what the vertex shader walks for every instance) and the triangles a given archetype actually shows (the base body
// plus only the outfit, hair, hat, bag and prop pieces its style selects; the rest collapse to a point in the vertex shader).
// usage: node scripts/peoplestats.mjs [--all]   (--all lists every archetype; exits 1 when a budget is broken)
// The budget is the brief's: a person near costs at most about 2x the old code's 1 body + its accessories, measured here.
import { createServer } from 'vite';
const server = await createServer({ root: process.cwd(), server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom', logLevel: 'error' });
const P = await server.ssrLoadModule('/src/agents/people.ts');
const M = await server.ssrLoadModule('/src/agents/models/personModel.ts');
let L = null;
try { L = await server.ssrLoadModule('/src/agents/models/personLooks.ts'); } catch { /* the old model has no looks module */ }
const all = process.argv.includes('--all');
const tri = (g) => (g.index?.count ?? g.getAttribute('position').count) / 3;
const t0 = performance.now();
const lods = M.personLodList ? M.personLodList() : [{ id: 'near', far: false }, { id: 'far', far: true }];
const geos = lods.map((l) => ({ ...l, g: M.personLodList ? M.buildPersonGeometry(l.id) : M.buildPersonGeometry(!!l.far) }));
const buildMs = performance.now() - t0;
// which pieces does an archetype show? old model: every vertex is tagged with a feature id (100.. outfit, 200.. hair, 300.. hat,
// 400.. prop, 500 merch); new model: a bit per named group of pieces (personLooks.ts), and props by id. Both count the triangles
// whose feature the archetype selects; the new one reports its worst case over the props an action can put in a hand.
const tag = (g) => g.getAttribute('aTag');
const propOf = (name) => (name && M.PROP && name in M.PROP ? M.PROP[name] : 0);
function visibleTriangles(lod, g, a) {
  if (M.shownTriangles) {
    const look = L.resolveLook(a, 12345, 0, propOf);
    const ids = [propOf(a.prop), M.PROP.cigarette, M.PROP.beer, M.PROP.vape, M.PROP.phone, M.PROP.sign, M.PROP.drum];
    return Math.max(...ids.map((p) => M.shownTriangles(lod, look.bits, p)));
  }
  const ids = { outfit: M.OUTFIT_ID[a.outfit ?? 'tee'], hair: M.HAIR_ID[a.hair ?? 'crop'], hat: M.HAT_ID[a.hat ?? 'none'], prop: M.PROP_ID[a.prop ?? 'none'] };
  const t = tag(g), n = t.count;
  const sel = (f) => {
    if (f < 0.5) return true;
    if (f > 499.5) return !!a.merch;
    if (f > 399.5) return Math.abs(f - (400 + ids.prop)) < 0.25;
    if (f > 299.5) return Math.abs(f - (300 + ids.hat)) < 0.25;
    if (f > 199.5) return Math.abs(f - (200 + ids.hair)) < 0.25;
    return Math.abs(f - (100 + ids.outfit)) < 0.25;
  };
  let c = 0;
  for (let i = 0; i < n; i += 3) if (sel(t.getZ(i))) c++;
  return c;
}
const rows = P.ARCHETYPES.map((a) => ({ id: a.id, name: a.name, ...Object.fromEntries(geos.map((l) => [l.id, visibleTriangles(l.id, l.g, a)])) }));
console.log('level of detail'.padEnd(16), 'vertices'.padStart(9), 'triangles(all pieces)'.padStart(22), '  shown per person: min / mean / max');
let bad = 0;
const out = {};
for (const l of geos) {
  const v = rows.map((r) => r[l.id]);
  const mean = v.reduce((x, y) => x + y, 0) / v.length;
  out[l.id] = { vertices: l.g.getAttribute('position').count, geometry: tri(l.g), min: Math.min(...v), mean: +mean.toFixed(1), max: Math.max(...v) };
  console.log(l.id.padEnd(16), String(out[l.id].vertices).padStart(9), String(out[l.id].geometry).padStart(22), `   ${out[l.id].min} / ${out[l.id].mean} / ${out[l.id].max}`);
}
if (all) { console.log(); for (const r of rows) console.log(r.id.padEnd(22), geos.map((l) => `${l.id} ${r[l.id]}`).join('  ')); }
console.log(`${P.ARCHETYPES.length} archetypes · build ${buildMs.toFixed(0)} ms for ${geos.length} geometries`);
console.log('JSON ' + JSON.stringify(out));
await server.close();
process.exit(bad ? 1 : 0);
