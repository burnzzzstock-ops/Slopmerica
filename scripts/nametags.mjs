// Names that fit the map: asks TypeSafe's Jev about every generated name and
// writes src/roads/nameTags.ts. roadName() (src/roads/names.ts) and the
// commune namer (src/agents/communes.ts) then leave out names that don't fit
// the map ("Sequoia" in the Florida swamp, "Bayou" in the hollers), falling
// back to the whole list. Also judges the building names City Look and the
// Asset Vault print on signs, for the owner's review only (docs/NAME_TAGS.md).
//   local   noul: the name is tied to one part of the country
//   where   choice: appalachia / norcal / florida / elsewhere in America / nowhere in particular;
//           a local name fits every map it's this likely to belong to (several can apply)
// (A yes/no per map was tried first: generic names scored 0.4-0.6 everywhere, so a
// cutoff flipped them at random, and the writers' own commune labels agreed 4/13.)
// Checked against labels we already have: the commune names the writers
// filed under one map. Raw answers cached in docs/name-tags.json; thresholds
// below. --dry-run needs no key. Exits 1 if a name couldn't be judged.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { answerCache, apiKey, costLine, mapPool } from './typesafe.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry-run');
const T = {
  local: 0.3, // at least this local (herons and sunsets are ~0.2: found everywhere)...
  where: 0.75, // ...and Jev this sure where it belongs: the name is kept to that part of the country
  map: 0.25, // it then fits each of our maps it's at least this likely to belong to (several can apply)
};
const MAPS = {
  appalachia: 'Holler County: the Appalachian hills, hollers, creeks and hardwood forests of Pennsylvania and West Virginia',
  norcal: 'Golden Coast: Northern California, with Malibu-style beaches, golden oak hills and sequoias',
  florida: 'Gator Gulch: flat Florida bayous, marshes, sawgrass, mangroves and a turquoise coast',
};

// ---- the names, read from source (names.ts and houses.ts import modules Node can't load)
const src = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const strs = (text) => [...text.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)].map((m) => (m[1] ?? m[2]).replace(/\\'/g, "'"));
const arr = (text, name) => strs(text.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`))[1]);
const names = src('src/roads/names.ts');
const suffixBlock = names.match(/const SUFFIX[^=]*= \{([\s\S]*?)\};/)[1];
const items = [];
const add = (group, name, what, use) => { if (!items.some((x) => x.name === name && x.group === group)) items.push({ group, name, what, use }); };
for (const list of ['NATURE_WATER', 'NATURE_FOREST', 'NATURE_OPEN']) for (const n of arr(names, list)) add('street', n, `the first part of a street name named after nature, as in "${n} Drive"`, 'filter');
for (const n of arr(names, 'MEME')) add('street', n, `an internet meme or catchphrase used as the first part of a street name, as in "${n} Drive"`, 'filter');
for (const n of strs(suffixBlock)) add('suffix', n, `the ending of a road name, as in "Maple ${n}"`, 'filter');
const { COMMUNE_NAMES } = await import('../src/art/communeNames.ts');
for (const n of COMMUNE_NAMES.any) add('commune', n, 'the name of a hippie commune', 'filter');
for (const m of Object.keys(MAPS)) for (const n of COMMUNE_NAMES[m]) add('commune', n, 'the name of a hippie commune', `label:${m}`);
for (const m of src('src/buildings/houses.ts').matchAll(/pickName\(g, \[([^\]]*)\]\)/g)) for (const n of strs(m[1])) add('house', n, 'the name of a kind of house on a sign', 'review');
for (const m of src('src/vault/families.ts').matchAll(/label: "([^"]+)"/g)) add('vault', m[1], 'the name of a building on a sign', 'review');

function request(it) {
  return {
    state: { game: 'SLOPMERICA, a satirical American city builder with three maps.', name: it.name, what: it.what },
    questions: {
      local: { type: 'noul', instructions: 'The name refers to something found mainly in one part of the United States (a landscape, plant, animal, food, festival, place or local culture), not something common all over the country. Everyday words, common birds and trees, brand names, internet memes (even ones that name a place, like "Ohio") and pop-culture references known nationwide (like Woodstock) are not.' },
      where: {
        type: 'choice',
        instructions: 'Which part of the country does the name belong to?',
        criteria: {
          ...Object.fromEntries(Object.entries(MAPS).map(([k, d]) => [k, d.split(': ')[1].replace(/^./, (c) => c.toUpperCase()) + '.'])),
          elsewhere: 'Somewhere else in America: the Midwest prairie, Texas, the desert Southwest, New England, the Rockies.',
          anywhere: 'Nowhere in particular: it could be anywhere in America.',
        },
      },
    },
  };
}

// ---- ask
const cache = answerCache('docs/name-tags.json');
let failed = 0;
if (DRY || !apiKey()) {
  const todo = items.filter((it) => { const r = request(it); return !cache.has(r.state, r.questions); }).length;
  console.log(`dry run: ${items.length} names, ${todo} to ask (≈${(todo * 330).toLocaleString('en-US')} input tokens, ≈$${((todo * 330) / 1e6 * 0.042).toFixed(4)})`);
} else {
  await mapPool(items, 8, async (it) => { const r = request(it); try { await cache.ask(r.state, r.questions); } catch (e) { failed++; console.log(`FAIL couldn't judge "${it.name}": ${e.message.slice(0, 120)}`); } });
  cache.save({ prune: true });
}

// ---- decide
const rows = [];
for (const it of items) {
  const a = cache.get(request(it).state, request(it).questions);
  if (!a) continue;
  const P = a.where.probabilities;
  const sure = Math.max(...[...Object.keys(MAPS), 'elsewhere'].map((m) => P[m] ?? 0));
  // a name from elsewhere in America (Texas bluebonnets, prairie wind) fits none of our maps
  const fits = a.local.noul >= T.local && sure >= T.where ? Object.keys(MAPS).filter((m) => (P[m] ?? 0) >= T.map) : Object.keys(MAPS);
  rows.push({ ...it, a, fits });
}
const limited = (x) => x.fits.length < Object.keys(MAPS).length;
const tags = {};
for (const x of rows) if (x.use === 'filter' && limited(x)) tags[`${x.group}:${x.name}`] = x.fits;
writeFileSync(resolve(ROOT, 'src/roads/nameTags.ts'), [
  '// Generated by scripts/nametags.mjs from TypeSafe Jev answers (cached in docs/name-tags.json).',
  "// The maps each generated name fits, for names that don't fit all three (street: road name",
  '// starts, suffix: road name endings, commune: the shared commune names). Read if present by',
  '// src/roads/names.ts and src/agents/communes.ts; delete it and every name goes on every map.',
  "import type { MapId } from '../world/maps';",
  '',
  'export const NAME_MAPS: Record<string, MapId[]> = {',
  ...Object.entries(tags).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v).replace(/"/g, "'")},`),
  '};',
  '',
].join('\n'));

// ---- agreement with the writers' own labels: commune names filed under one map
const lab = rows.filter((x) => x.use.startsWith('label:'));
const own = lab.filter((x) => x.fits.includes(x.use.slice(6))).length;
const only = lab.filter((x) => x.fits.length === 1 && x.fits[0] === x.use.slice(6)).length;
const pct = (a, b) => `${a}/${b} (${Math.round((a / Math.max(1, b)) * 100)}%)`;
const report = [
  `commune names the writers filed under a map fit that map: ${pct(own, lab.length)}; fit only that map: ${pct(only, lab.length)}`,
];
const md = ['# Name tags (TypeSafe Jev)', '', `Generated by \`node scripts/nametags.mjs\` for ${rows.length} names. A name fits a map at ${T.fits}.`, '', '## Agreement', '', ...report.map((r) => `- ${r}`), ''];
const table = (title, list, note) => md.push(`## ${title} (${list.length})`, '', ...(note ? [note, ''] : []), '| name | fits | local | appalachia · norcal · florida · elsewhere · anywhere |', '|---|---|---|---|', ...list.map((x) => `| ${x.name} | ${x.fits.join(', ') || '**no map**'} | ${x.a.local.noul.toFixed(2)} | ${[...Object.keys(MAPS), 'elsewhere', 'anywhere'].map((m) => (x.a.where.probabilities[m] ?? 0).toFixed(2)).join(' · ')} |`), '');
table('Street names kept to some maps', rows.filter((x) => (x.group === 'street' || x.group === 'suffix') && limited(x)), 'roadName() leaves these out on the other maps.');
table('Shared commune names kept to some maps', rows.filter((x) => x.group === 'commune' && x.use === 'filter' && limited(x)));
table('Commune names filed under a map (the check)', lab);
table('Every street and commune name', rows.filter((x) => x.group !== 'house' && x.group !== 'vault'), 'For tuning: the raw answers behind the decisions above.');
table('House and Asset Vault names tied to a region (review only: their files pick names without the map)', rows.filter((x) => x.use === 'review' && limited(x)), 'For the owner: tie these to their map, or keep them everywhere.');
writeFileSync(resolve(ROOT, 'docs/NAME_TAGS.md'), md.join('\n'));

const count = (g) => rows.filter((x) => x.group === g && limited(x)).length;
console.log(`${rows.length}/${items.length} names judged; kept to some maps: ${count('street')} street names, ${count('suffix')} suffixes, ${rows.filter((x) => x.group === 'commune' && x.use === 'filter' && limited(x)).length} shared commune names; ${rows.filter((x) => x.use === 'review' && limited(x)).length} house/vault names to review; ${rows.filter((x) => !x.fits.length).length} fit no map`);
for (const r of report) console.log(`     ${r}`);
console.log(`Jev: ${costLine()}`);
const judged = rows.length === items.length;
console.log(`${judged && !failed ? 'OK  ' : 'FAIL'} every name judged${judged ? '' : ` (${items.length - rows.length} missing)`}`);
process.exit(judged && !failed ? 0 : DRY ? 0 : 1);
