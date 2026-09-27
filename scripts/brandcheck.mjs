// Brand-name consistency: copy that mentions a chain the brand registry
// (src/art/brands.ts) doesn't have, like the feed's old "Burger Duke", "Waffle
// Bunker" and "Slop Mart" (now Burger Baron, Waffle Hut and SprawlMart). Code finds the mentions: title-case phrases in
// player-facing strings that look like a chain (they share an uncommon word
// with a registered brand, or end like one: Mart, Hut, Barn, King, Depot, 's)
// and aren't a registered name, skipping the files that list other kinds of
// names (people, communes, streets, houses, maps) and names standing alone in a
// list that isn't a brand list (district and bus line names). The Asset
// Vault's buildings are a second registry of one-off businesses: reported
// only where they echo a registered chain. TypeSafe's Jev reads each
// mention in its sentence:
//   is_chain  noul: here the phrase names a store, restaurant or company
//   means     choice over the registered brand names plus "none"
// and code proposes one canonical name per chain (docs/BRAND_NAMES.md).
// Proposes only; the owner decides names. Cache: docs/brand-names.json.
// --dry-run needs no key. Exits 1 when a chain mention matches no brand
// and isn't in KNOWN.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { answerCache, apiKey, costLine, mapPool } from './typesafe.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry-run');
const T = { chain: 0.5, means: 0.5 };
/** chains the owner decided to keep as one-offs, with why (none yet) */
export const KNOWN = {};
const { BRANDS } = await import('../src/art/brands.ts');

// ---- find mentions
const NOT_BRANDS = /^src\/(buildings\/serviceModels\.ts|dev\/|art\/brands\.ts|art\/names\.ts|art\/communeNames\.ts|agents\/people\.ts|roads\/names\.ts|roads\/nameTags\.ts|roads\/roadTypes\.ts|roads\/interchanges\.ts|world\/maps\.ts|buildings\/houses\.ts|content\/feedTags\.ts)/;
const lower = (s) => s.toLowerCase();
/** exact names that aren't chains, looked up in code: the owner's own SLOP products, characters and
 *  slogans (docs/WORKSTREAMS.md brand bible) and zone names players see */
const NOT_A_CHAIN = new Set([
  'Slop Script', 'Slop Lightning Tee', 'Cannon Scribble Tee', 'Neural Fly Sweatshirt', 'Fill Er Up Tee', 'Pig Cabana Resort Shirt',
  'Cannon Coast Button-Up', 'Wigette', 'Wiglet', 'Cannon Boys', 'The Cannon Boys', 'Loose Cannon', 'Short Fuse', 'Play With Fire', 'Smoke Signal',
  'Content Farms',
  // the town's own service buildings (src/sim/services.ts)
  ...[...readFileSync(join(ROOT, 'src/sim/services.ts'), 'utf8').matchAll(/\bname: '([^']+)'/g)].flatMap((m) => [m[1], m[1].replace(/\s*\(.*$/, '')]),
].map((n) => n.toLowerCase()));
const names = new Set(BRANDS.flatMap((b) => [b.name, b.sign?.text].filter(Boolean).map(lower)));
const STOP = new Set(['the', 'co', 'inc', 'llc', 'of', 'at', 'and', 'big', 'energy', 'club', 'house', 'center', 'bros', 'plaza', 'suites', 'tower', 'capital', 'partners', 'slop']);
const word = (w) => lower(w).replace(/[’']s$/, '').replace(/[^a-z0-9-]/g, '');
const vocab = new Map();
for (const b of BRANDS) for (const w of b.name.split(/[\s-]+/).map(word).filter((w) => w.length > 2 && !STOP.has(w))) vocab.set(w, (vocab.get(w) ?? 0) + 1);
const SUFFIX = /(Mart|Hut|Barn|King|Kingdom|Depot|Duke|Bunker|Shack|Palace|Emporium|Outlet|Express|[’']s)$/;
const files = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? files(p) : /\.ts$/.test(f) ? [p] : []; });
const mentions = new Map();
for (const f of files(join(ROOT, 'src'))) {
  const rel = relative(ROOT, f).replace(/\\/g, '/');
  if (NOT_BRANDS.test(rel)) continue;
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) {
    const s = (m[1] ?? m[2] ?? m[3] ?? '').replace(/\\'/g, "'");
    if (!/[a-z]/.test(s) || s.split(' ').length < 2) continue;
    const line = src.slice(0, m.index).split('\n').length;
    // a name alone in a list only counts in a list of brands (the feed's filler brands)
    const inList = src.slice(Math.max(0, m.index - 4000), m.index).match(/const (\w+)[^=\n]*=\s*\[[^\]]*$/);
    const alone = (ph) => ph === s.trim() && !/brand/i.test(inList?.[1] ?? '') && !/^\s*\{?\s*(label|name|sign|line|text|blurb|tagline|caption)\s*:/.test(src.slice(m.index - 12, m.index));
    for (const p of s.matchAll(/(?:[A-Z][\w’'-]*(?:\s+|$)){1,4}/g)) {
      const ph = p[0].trim().replace(/[.,:;!?)'’]+$/, '');
      if (alone(ph) && !rel.startsWith('src/vault/')) continue;
      if (NOT_A_CHAIN.has(lower(ph)) || ph === ph.toUpperCase()) continue; // (all caps: a billboard headline)
      const ws = ph.split(/\s+/);
      if (names.has(lower(ph)) || [...names].some((n) => n.includes(lower(ph)))) continue;
      const shares = ws.some((w) => { const n = vocab.get(word(w)) ?? 0; return n >= 1 && n <= 2; });
      if (!(shares || (ws.length >= 2 && SUFFIX.test(ph)))) continue;
      const key = ph.replace(/^The\s+/, '');
      if (!mentions.has(key)) mentions.set(key, []);
      mentions.get(key).push({ where: `${rel}:${line}`, sentence: s.replace(/\$\{[^}]*\}/g, '…').slice(0, 200), vault: rel.startsWith('src/vault/') });
    }
  }
}
const items = [...mentions].map(([phrase, at]) => ({ phrase, at }));

function request(it) {
  return {
    state: { game: 'SLOPMERICA, a satirical city builder full of parody chain stores.', phrase: it.phrase, sentence: it.at[0].sentence },
    questions: {
      is_chain: { type: 'noul', instructions: `In this sentence, "${it.phrase}" is the name of a store, restaurant, gas station or company (a business you could walk into or buy from). Not a business: a person or character, a place, a road, a zone or building type, the town's own public buildings (its incinerator, solar farm, clinic, bus depot), a product (a T-shirt, a drink), a slogan, or a headline.` },
      means: {
        type: 'choice',
        instructions: `Which of the game's chains does "${it.phrase}" mean? Pick "none" if it's a different business, or not a business at all.`,
        criteria: { ...Object.fromEntries(BRANDS.map((b) => [b.id, `${b.name}${b.blurb ? `: ${b.blurb}` : ''}`])), none: 'None of these chains.' },
      },
    },
  };
}

// ---- ask
const cache = answerCache('docs/brand-names.json');
let failed = 0;
if (DRY || !apiKey()) {
  const todo = items.filter((it) => { const r = request(it); return !cache.has(r.state, r.questions); }).length;
  console.log(`dry run: ${items.length} possible chain mentions, ${todo} to ask (≈${(todo * 2600).toLocaleString('en-US')} input tokens, ≈$${((todo * 2600) / 1e6 * 0.042).toFixed(4)})`);
} else {
  await mapPool(items, 8, async (it) => { const r = request(it); try { await cache.ask(r.state, r.questions); } catch (e) { failed++; console.log(`FAIL couldn't judge "${it.phrase}": ${e.message.slice(0, 120)}`); } });
  cache.save({ prune: true });
}

// ---- decide
const byId = Object.fromEntries(BRANDS.map((b) => [b.id, b]));
const rows = [];
for (const it of items) {
  const r = request(it), a = cache.get(r.state, r.questions);
  if (!a) continue;
  const chain = a.is_chain.noul >= T.chain;
  const id = a.means.choice, p = a.means.probabilities[id] ?? 0;
  const brand = id !== 'none' && p >= T.means ? byId[id] : null;
  // "SprawlMart Supercenter", "Amazin' Fulfillment Center": the brand plus what it is, consistent
  const contains = brand && lower(it.phrase).includes(lower(brand.name).replace(/’/g, "'"));
  const vault = it.at.every((w) => w.vault);
  const status = !chain ? 'not a chain' : contains ? 'consistent' : vault ? (brand ? 'vault echo' : 'vault one-off') : brand ? 'variant' : KNOWN[it.phrase] ? 'kept' : 'unregistered';
  rows.push({ ...it, a, chain, brand, status });
}
const variants = rows.filter((x) => x.status === 'variant');
const unreg = rows.filter((x) => x.status === 'unregistered');
const esc = (s) => s.replace(/\|/g, '\\|');
const md = ['# Brand names in copy (TypeSafe Jev)', '', `Generated by \`node scripts/brandcheck.mjs\`: ${rows.length} possible chain mentions found in code, read by Jev in their sentence. A mention is a chain at ${T.chain}; it means a registered brand at ${T.means}.`, ''];
md.push(`## Other names for a registered chain (${variants.length}): proposed canonical name`, '', '| mention | where | Jev: means (p) | proposal |', '|---|---|---|---|', ...variants.map((x) => `| ${esc(x.phrase)} | ${x.at.map((w) => w.where).join(', ')} | ${x.brand.name} (${x.a.means.probabilities[x.brand.id].toFixed(2)}) | use "${x.brand.name}" |`), '');
md.push(`## Chains the registry doesn't have (${unreg.length})`, '', 'For the owner: rename to a registered chain, or add it to src/art/brands.ts (City Look), or keep it as a one-off (KNOWN in the script).', '', '| mention | where | sentence | nearest (p) |', '|---|---|---|---|', ...unreg.map((x) => { const top = Object.entries(x.a.means.probabilities).filter(([k]) => k !== 'none').sort((a, b) => b[1] - a[1])[0]; return `| ${esc(x.phrase)} | ${x.at.map((w) => w.where).join(', ')} | ${esc(x.at[0].sentence.slice(0, 90))} | ${top ? `${byId[top[0]].name} ${top[1].toFixed(2)}` : '—'} |`; }), '');
const echoes = rows.filter((x) => x.status === 'vault echo');
md.push(`## Asset Vault businesses that echo a registered chain (${echoes.length})`, '', 'Two parody businesses for one joke: keep both, or fold one into the other.', '', '| vault business | registered chain (p) |', '|---|---|', ...echoes.map((x) => `| ${esc(x.phrase)} | ${x.brand.name} (${x.a.means.probabilities[x.brand.id].toFixed(2)}) |`), '');
md.push(`## Consistent (${rows.filter((x) => x.status === 'consistent').length}) and not chains (${rows.filter((x) => x.status === 'not a chain').length})`, '', rows.filter((x) => x.status === 'consistent').map((x) => x.phrase).join(' · '), '', rows.filter((x) => x.status === 'not a chain').map((x) => x.phrase).join(' · '), '');
writeFileSync(resolve(ROOT, 'docs/BRAND_NAMES.md'), md.join('\n'));

console.log(`${rows.length}/${items.length} mentions judged: ${variants.length} other names for a registered chain, ${unreg.length} chains the registry doesn't have, ${echoes.length} vault businesses echoing a chain, ${rows.filter((x) => x.status === 'consistent').length} consistent, ${rows.filter((x) => x.status === 'not a chain').length} not chains`);
for (const x of variants) console.log(`REVIEW "${x.phrase}" means ${x.brand.name} (${x.at[0].where})`);
for (const x of unreg) console.log(`FAIL "${x.phrase}" is a chain the registry doesn't have (${x.at[0].where})`);
console.log(`Jev: ${costLine()}`);
if (rows.length < items.length || failed) process.exit(2);
process.exit(unreg.length ? 1 : 0);
