// Feed tags: asks TypeSafe's Jev about every X-feed template once (one request
// per line, every question together) and writes src/content/feedTags.ts, which
// postFor reads to prefer lines and authors that fit the city:
//   region        choice any / appalachia / norcal / florida (Florida Man only in Gator Gulch)
//   assumes_size  noul: the line assumes how built-up the town is
//   stage         score, empty valley .. sprawling metro (code maps it to population and sprawl)
//   weather       choice, weatherChange and nightfall lines only: which weather the line assumes
//                 (any / dry and clear / wet or low visibility / snow and ice / heat)
//   fits_event    noul: the line reacts to its event (flags misfiled lines for the owner)
//   author        choice over the people.ts archetypes, the feed organizations and "anyone"
//   winner        choice, lawsuit and buy-out lines only: who comes out ahead (flags reversed lines)
// then a second, small request per line with authors:
//   about_<id>    noul: the line talks about that author in the third person instead of
//                 speaking as them ("Doomer account predicts collapse..." isn't by the doomer)
// Raw answers are cached in docs/feed-tags.json; thresholds live below, so
// changing one reruns from the cache with no API call. Writes a review report
// to docs/FEED_TAGS.md. --dry-run needs no key: it prints the plan and builds
// the tags from whatever is cached. --limit N asks about the first N lines only.
// Exits 1 if a line couldn't be judged.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { answerCache, apiKey, costLine, mapPool, topChoices, usage } from './typesafe.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry-run');
const LIMIT = Number(process.argv[process.argv.indexOf('--limit') + 1]) || Infinity;
const { FEED_TEMPLATES, FEED_ORGANIZATIONS } = await import('../src/content/feed.ts');

// ---- thresholds (decisions; Jev only supplies the numbers)
const T = {
  region: 0.9, // a region only when Jev is this sure ("Rolling Coal" read as Appalachia at 0.87; Florida Man lines are 1.00)
  assumesSize: 0.5, // stage applies only to lines that assume a town size
  stageLevel: 0.15, // levels at least this likely make the line's stage range, then one more each side
  weather: 0.5, // a weatherChange or nightfall line keeps to the weather it assumes at this
  author: 0.15, // an author makes the list at this (top 3)
  anyone: 0.5, // "anyone" this likely: leave the author random
  misfiled: 0.75, // fits_event below this (not ambient chatter, which has no event): listed for the owner
  about: 0.6, // an author the line talks about in the third person is dropped at this
};

const MEANING = {
  gameStart: 'a brand-new city was just founded on empty land; this is the first post of the game',
  roadBuilt: 'the player built a new ordinary road', stroadBuilt: 'the player built a stroad (a wide, fast road lined with driveways and businesses)',
  highwayBuilt: 'the player built a highway', bridgeBuilt: 'the player built a bridge over water', laneAdded: 'the player widened a road by adding a lane',
  roadBulldozed: 'the player bulldozed a road', zoned: 'the player zoned land for homes, shops or industry', buildingOpened: 'a new business or building opened',
  buildingLeveled: 'a building was upgraded to a bigger, fancier level', buildingDemolished: 'a building was demolished', crash: 'a car crash happened',
  drunkCrash: 'a drunk driver crashed', pedestrianHit: 'a car hit a pedestrian', trafficJam: 'a traffic jam built up',
  communeFound: 'the town found a hippie commune on land it wants', communeProtest: 'hippies from a commune protested development',
  communeBribed: 'the city paid a hippie commune to leave', communeSued: 'the city sued a hippie commune to take its land',
  communeLawsuitLost: "the hippie commune lost the county's lawsuit, so the county can clear the land", communeForever: 'a hippie commune won and stays forever',
  treesCut: 'a lot of trees were cut down for development', natureMilestone: 'the share of nature left in the county dropped past a milestone',
  populationMilestone: "the city's population passed a milestone", sprawlMilestone: 'sprawl passed a milestone (more of the county paved over)',
  maxLevelReached: 'a building reached the top level', lowMoney: 'the city treasury is running low', bankrupt: 'the city went bankrupt',
  taxRaised: 'the player raised taxes', taxCut: 'the player cut taxes', seasonChange: 'the season changed', weatherChange: 'the weather changed',
  nightfall: 'night fell over the city', merchDrop: 'the SLOP merch brand dropped new products', ambient: 'nothing in particular: background chatter when nothing is happening',
  serviceBuilt: 'the city built a public service (power, water, police, fire, a school, a clinic)', blackout: 'a power blackout hit the city',
  waterOutage: 'the water went out', sewageBackup: 'sewage backed up', garbagePile: 'garbage piled up uncollected', landfillFull: 'the landfill filled up',
  buildingFire: 'a building caught fire', buildingBurned: 'a building burned down', abandoned: 'buildings were abandoned', crimeWave: 'a crime wave hit',
  sickness: 'people are getting sick', pollution: 'pollution got bad',
};
const PLACEHOLDER = {
  city: "the town's name", road: "a road's name", brand: "a chain store's name", building: "a building's name", commune: "a hippie commune's name",
  amount: 'a dollar amount', season: 'the season', weather: 'the current weather (rain, snow, fog...)', population: 'the population',
  nature: 'the percent of nature left', sprawl: 'the percent of the county paved', count: 'a number',
};
/** who should come out ahead in each outcome event's lines */
const WINNER = { communeLawsuitLost: 'county', communeForever: 'commune' }; // (a buy-out is a deal: both sides get something)
const STAGES = [
  'An empty valley: no town yet, just land, trees and maybe one county road.',
  'A handful of homes and a gas station: barely a town.',
  'A small town: a few streets, a main road and some shops.',
  'A growing suburb: subdivisions, strip malls and traffic starting to build.',
  'A busy city: big-box stores, highways, office parks and real traffic.',
  'A sprawling metro: endless development, towers, huge highways, nature mostly gone.',
];
const WEATHER = {
  fair: 'clear or cloudy (dry: no rain, snow, fog or smoke)', rain: 'rain, a thunderstorm or a hurricane', snow: 'snow or a blizzard',
  haze: 'fog or wildfire smoke (low visibility)', heat: 'a heat wave',
};

// the people.ts archetypes, read from source (the module pulls in the renderer)
const peopleSrc = readFileSync(resolve(ROOT, 'src/agents/people.ts'), 'utf8');
const str = (line, key) => line.match(new RegExp(`${key}: '((?:[^'\\\\]|\\\\.)*)'`))?.[1]?.replace(/\\'/g, "'");
const ARCH = peopleSrc.split('\n').filter((l) => /^\s*\{ id: '/.test(l)).map((l) => ({ id: str(l, 'id'), name: str(l, 'name'), handle: str(l, 'handle'), bio: str(l, 'bio') }));
const ORG_ABOUT = {
  MaxMobilityGov: "the county road department's official account, proud of every lane",
  SLOPChamber: 'the chamber of commerce: cheers every business, ribbon cutting and tax break',
  FillErUpNews: 'the local news wire: reports what happened, deadpan',
  MoreLanesNow: 'a pro-highway advocacy group: always wants more lanes',
  CountyWXDesk: 'the county weather service',
};
const AUTHOR_OPTIONS = {
  ...Object.fromEntries(ARCH.map((a) => [a.id, `${a.name}: ${a.bio}`])),
  ...Object.fromEntries(FEED_ORGANIZATIONS.map((o) => [o.handle, `${o.name}: ${ORG_ABOUT[o.handle] ?? 'an organization'}`])),
  anyone: 'An ordinary resident: no account above fits clearly better.',
};

function request(kind, line) {
  const used = [...new Set([...line.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))];
  const state = {
    game: 'SLOPMERICA, a satirical city builder. An in-game X-style social feed posts reactions to what happens in the city.',
    event: MEANING[kind],
    line,
    ...(used.length ? { placeholders: Object.fromEntries(used.map((u) => [`{${u}}`, PLACEHOLDER[u] ?? u])) } : {}),
  };
  const q = {
    region: {
      type: 'choice',
      instructions: "Which region does this line depend on? Choose 'any' unless the line names or clearly needs one region (a Florida Man story, alligators, hollers and coal country, sequoias and tech money).",
      criteria: {
        any: 'Any American town: nothing in the line ties it to one region.',
        appalachia: 'Appalachia: the hills, hollers, creeks and coal country of Pennsylvania and West Virginia.',
        norcal: 'Northern California: beaches, golden hills, sequoias, tech money, wildfires.',
        florida: 'Florida: flat bayous, swamps, alligators, beaches, hurricanes, Florida Man.',
      },
    },
    assumes_size: { type: 'noul', instructions: 'The line assumes something specific about how big or built-up the town is right now (for example, that no town exists yet, or that highways and towers are everywhere). A line about one road, store or incident that could happen in a town of any size does not.' },
    stage: { type: 'score', instructions: 'How built-up is the town this line assumes?', criteria: STAGES },
    fits_event: { type: 'noul', instructions: `The line reacts to this event: ${MEANING[kind]}.` },
    author: {
      type: 'choice',
      instructions: "Which account would most likely post this line? Match the line's point of view and interests, not just a word it mentions (a line mocking crypto is not by the crypto bro). Choose 'anyone' when no account fits clearly better than an ordinary resident.",
      criteria: AUTHOR_OPTIONS,
    },
  };
  if (WINNER[kind]) {
    q.winner = {
      type: 'choice',
      instructions: 'In this line, who comes out ahead?',
      criteria: { county: 'The county, the city or its developers come out ahead.', commune: 'The hippie commune comes out ahead.', neither: 'Neither side, or the line does not say.' },
    };
  }
  if (kind === 'weatherChange' || kind === 'nightfall') {
    q.weather = {
      type: 'choice',
      instructions: 'Which weather does the line assume? {weather} is filled in with the actual weather, so it assumes nothing by itself; judge the rest of the line.',
      criteria: {
        any: 'Any weather: nothing else in the line depends on the weather.',
        clear: 'Dry, clear weather: stars, a clear view, sunshine, empty dry roads.',
        wet: 'Rain, storms, fog or smoke: poor visibility, headlights, slick roads, driving carefully.',
        snow: 'Snow or ice: cold, plows, icy roads.',
        heat: 'A heat wave: scorching heat, air conditioning, melting asphalt.',
      },
    };
  }
  return { state, questions: q };
}

// ---- ask
const items = Object.entries(FEED_TEMPLATES).flatMap(([kind, lines]) => lines.map((line) => ({ kind, line }))).slice(0, LIMIT);
const missing = Object.keys(FEED_TEMPLATES).filter((k) => !MEANING[k]);
if (missing.length) { console.log(`FAIL no event meaning for ${missing.join(', ')}`); process.exit(1); }
const cache = answerCache('docs/feed-tags.json');
let failed = 0;
if (DRY || !apiKey()) {
  const todo = items.filter((it) => { const r = request(it.kind, it.line); return !cache.has(r.state, r.questions); }).length;
  console.log(`dry run: ${items.length} lines, ${items.length - todo} cached, ${todo} to ask (≈${todo} requests, ≈${(todo * 2600).toLocaleString('en-US')} input tokens, ≈$${((todo * 2600) / 1e6 * 0.042).toFixed(4)})`);
  if (!DRY) console.log('No TYPESAFE_API_KEY: using cached answers only');
} else {
  await mapPool(items, 8, async (it) => {
    const r = request(it.kind, it.line);
    try { await cache.ask(r.state, r.questions); } catch (e) { failed++; console.log(`FAIL couldn't judge ${it.kind}: "${it.line.slice(0, 60)}": ${e.message.slice(0, 120)}`); }
  });
  cache.save();
}

// ---- second pass: drop authors the line only talks about
const firstAuthors = (a) => ((a.author.probabilities.anyone ?? 0) < T.anyone ? topChoices(a.author, 4, T.author).filter(([k]) => k !== 'anyone').slice(0, 3).map(([k]) => k) : []);
const nameOf = (k) => ARCH.find((y) => y.id === k)?.name ?? FEED_ORGANIZATIONS.find((o) => o.handle === k)?.name ?? k;
function aboutRequest(line, ids) {
  return {
    state: { line },
    questions: Object.fromEntries(ids.map((k) => [`about_${k}`, { type: 'noul', instructions: `The line talks about ${nameOf(k)} in the third person (describes, names or quotes them) instead of speaking as them. ${AUTHOR_OPTIONS[k]}` }])),
  };
}
const second = items.map((it) => { const r = request(it.kind, it.line), a = cache.get(r.state, r.questions); const ids = a ? firstAuthors(a) : []; return ids.length ? aboutRequest(it.line, ids) : null; }).filter(Boolean);
if (!DRY && apiKey()) {
  await mapPool(second, 8, async (r) => { try { await cache.ask(r.state, r.questions); } catch (e) { failed++; console.log(`FAIL couldn't judge authors of "${r.state.line.slice(0, 60)}": ${e.message.slice(0, 120)}`); } });
  cache.save();
}

// ---- decide
const tags = {}, rows = [];
const used = new Set();
for (const it of items) {
  const r = request(it.kind, it.line), a = cache.get(r.state, r.questions);
  if (!a) continue;
  const t = {};
  const reg = a.region;
  if (reg.choice !== 'any' && reg.probabilities[reg.choice] >= T.region) t.region = reg.choice;
  if (a.assumes_size.noul >= T.assumesSize) {
    const lv = Object.entries(a.stage.probabilities).filter(([, p]) => p >= T.stageLevel).map(([k]) => Number(k));
    const lo = Math.max(0, Math.min(...lv) - 1), hi = Math.min(STAGES.length - 1, Math.max(...lv) + 1);
    if (lv.length && (lo > 0 || hi < STAGES.length - 1)) t.stage = [lo, hi];
  }
  // which weather groups (see weatherGroup in feed.ts) each assumption posts in
  const POSTS_IN = { clear: ['fair', 'heat'], wet: ['rain', 'snow', 'haze'], snow: ['snow'], heat: ['heat'] };
  if (a.weather && a.weather.choice !== 'any' && a.weather.probabilities[a.weather.choice] >= T.weather) t.weather = POSTS_IN[a.weather.choice];
  const ids = firstAuthors(a), ar = ids.length ? aboutRequest(it.line, ids) : null, about = ar ? cache.get(ar.state, ar.questions) : null;
  const dropped = about ? ids.filter((k) => about[`about_${k}`].noul >= T.about) : [];
  const au = ids.filter((k) => !dropped.includes(k));
  if (au.length) { t.authors = au; au.forEach((k) => used.add(k)); }
  if (Object.keys(t).length) tags[`${it.kind}|${it.line}`] = t;
  rows.push({ ...it, a, t, dropped, about });
}

// ---- write the game's data
const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const EMOJI = ['🏎️', '🛞', '🏛️', '🐊', '🦅', '🛣️', '🌳', '🦃', '📱', '🦋', '🍺', '🌻', '🚲', '🧢', '☕', '🔥'];
const BG = ['#1677ff', '#f5a623', '#7b61ff', '#ec4899', '#0f9d78', '#de3c4b', '#68737d', '#b56b26', '#32a8a2', '#111111'];
const authors = Object.fromEntries(ARCH.filter((x) => used.has(x.id)).map((x) => [x.id, { name: x.name, handle: x.handle, emoji: EMOJI[hash(x.id) % EMOJI.length], bg: BG[hash(x.id + 'bg') % BG.length] }]));
const q = (s) => JSON.stringify(s);
const out = [
  '// Generated by scripts/feedtags.mjs from TypeSafe Jev answers (cached in docs/feed-tags.json).',
  '// Do not edit by hand: change a template or a threshold and rerun. The feed reads this file',
  "// if it's there (src/content/feed.ts, postFor); delete it and posts are picked as before.",
  "import type { FeedAuthor, FeedTag } from './feed';",
  '',
  '/** `${event}|${template}` -> what the line assumes and who would post it */',
  'export const FEED_TAGS: Record<string, FeedTag> = {',
  ...Object.entries(tags).map(([k, t]) => `  ${q(k)}: ${JSON.stringify(t).replace(/"(\w+)":/g, '$1: ')},`),
  '};',
  '',
  '/** people.ts archetypes as feed authors */',
  'export const FEED_AUTHORS: Record<string, FeedAuthor> = {',
  ...Object.entries(authors).map(([k, v]) => `  ${k}: ${JSON.stringify(v).replace(/"(\w+)":/g, '$1: ')},`),
  '};',
  '',
];
writeFileSync(resolve(ROOT, 'src/content/feedTags.ts'), out.join('\n'));
if (!DRY && LIMIT === Infinity) cache.save({ prune: true });

// ---- check against labels we already have
const pct = (a, b) => (b ? `${a}/${b} (${Math.round((a / b) * 100)}%)` : '0/0');
const report = [];
// gameStart only ever posts on an empty map: its lines must allow stage 0
const gs = rows.filter((x) => x.kind === 'gameStart');
report.push(`gameStart lines allow an empty valley (they only post at population 0): ${pct(gs.filter((x) => !x.t.stage || x.t.stage[0] === 0).length, gs.length)}`);
// region words
const REGION_WORDS = { florida: /Florida|alligator|\bgator|airboat|bayou|swamp|hurricane/i, appalachia: /holler|coal (?:mine|country|town)|moonshine|Appalach/i, norcal: /sequoia|Malibu|wildfire|Tesla|Silicon Valley|NorCal/i };
const worded = rows.filter((x) => Object.values(REGION_WORDS).some((re) => re.test(x.line)));
const same = worded.filter((x) => REGION_WORDS[x.t.region]?.test(x.line)).length;
report.push(`lines naming a region's signature (Florida Man, gator, bayou...) tagged to it: ${pct(same, worded.length)}`);
const surprise = rows.filter((x) => x.t.region && !REGION_WORDS[x.t.region].test(x.line));
report.push(`lines tagged to a region without its signature words: ${surprise.length}`);
// author words
// only lines whose voice is unmistakable (a line *about* the crypto bro or a bike lane isn't by them)
const AUTHOR_WORDS = [
  [/one more lane|ONE\. MORE\. LANE|widened/i, ['bigDale', 'MoreLanesNow', 'MaxMobilityGov']],
  [/^Doomer take/i, ['doomer']],
  [/^Reply guy here/i, ['replyGuy']],
];
let aHit = 0, aN = 0;
const aRows = [];
for (const x of rows) for (const [re, who] of AUTHOR_WORDS) if (re.test(x.line)) {
  aN++;
  const top = topChoices(x.a.author, 3, 0.05), hit = top.some(([k]) => who.includes(k));
  if (hit) aHit++;
  aRows.push(`| ${hit ? '✓' : '✗'} | ${x.line.replace(/\|/g, '\\|')} | ${who.map(nameOf).join(' / ')} | ${top.map(([k, p]) => `${nameOf(k)} ${p.toFixed(2)}`).join(', ')} |`);
  break;
}
report.push(`lines in an unmistakable voice (one more lane, "Doomer take", "Reply guy here") have that poster in Jev's top 3: ${pct(aHit, aN)}`);

const md = ['# Feed tags (TypeSafe Jev)', '', `Generated by \`node scripts/feedtags.mjs\` for ${rows.length} feed lines. Thresholds: ${Object.entries(T).map(([k, v]) => `${k} ${v}`).join(', ')}.`, '', '## Agreement with labels we already have', '', ...report.map((r) => `- ${r}`), ''];
const mis = rows.filter((x) => x.kind !== 'ambient' && x.a.fits_event.noul < T.misfiled).sort((a, b) => a.a.fits_event.noul - b.a.fits_event.noul);
const flipped = rows.filter((x) => x.a.winner && x.a.winner.choice !== 'neither' && x.a.winner.choice !== WINNER[x.kind]);
md.push(`## Possibly misfiled (${mis.length}): the line may not react to its event`, '', 'For the owner: move the line, or keep it (fits_event below ' + T.misfiled + ').', '', '| event | line | fits |', '|---|---|---|', ...mis.map((x) => `| ${x.kind} | ${x.line.replace(/\|/g, '\\|')} | ${x.a.fits_event.noul.toFixed(2)} |`), '');
md.push(`## Reversed outcomes (${flipped.length}): the wrong side comes out ahead for the event`, '', '| event | should win | line | Jev says ahead |', '|---|---|---|---|', ...flipped.map((x) => `| ${x.kind} | ${WINNER[x.kind]} | ${x.line.replace(/\|/g, '\\|')} | ${x.a.winner.choice} ${x.a.winner.probabilities[x.a.winner.choice].toFixed(2)} |`), '');
const dropRows = rows.filter((x) => x.dropped?.length);
md.push(`## Authors dropped: the line talks about them (${dropRows.length})`, '', '| line | dropped | kept |', '|---|---|---|', ...dropRows.map((x) => `| ${x.line.replace(/\|/g, '\\|')} | ${x.dropped.map((k) => `${nameOf(k)} ${x.about[`about_${k}`].noul.toFixed(2)}`).join(', ')} | ${(x.t.authors ?? []).map(nameOf).join(', ') || 'random'} |`), '');
const regional = rows.filter((x) => x.t.region);
md.push(`## Region-only lines (${regional.length})`, '', '| region | event | line | p |', '|---|---|---|---|', ...regional.map((x) => `| ${x.t.region} | ${x.kind} | ${x.line.replace(/\|/g, '\\|')} | ${x.a.region.probabilities[x.t.region].toFixed(2)} |`), '');
const staged = rows.filter((x) => x.t.stage);
md.push(`## Lines that assume a town size (${staged.length})`, '', 'Stages: ' + STAGES.map((s, i) => `${i} ${s.split(':')[0].toLowerCase()}`).join(', ') + '.', '', '| stages | event | line |', '|---|---|---|', ...staged.map((x) => `| ${x.t.stage[0]}–${x.t.stage[1]} | ${x.kind} | ${x.line.replace(/\|/g, '\\|')} |`), '');
const wx = rows.filter((x) => x.a.weather);
md.push('## Weather and nightfall lines', '', '| event | line | assumes (p) | posts in |', '|---|---|---|---|', ...wx.map((x) => `| ${x.kind} | ${x.line.replace(/\|/g, '\\|')} | ${Object.entries(x.a.weather.probabilities).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k, p]) => `${k} ${p.toFixed(2)}`).join(', ')} | ${x.t.weather ? x.t.weather.join(', ') : 'any weather'} |`), '');
md.push('## Lines with an obvious poster', '', '| | line | expected | Jev top 3 |', '|---|---|---|---|', ...aRows, '');
md.push('## Authors', '', '| event | line | authors (Jev p) |', '|---|---|---|', ...rows.filter((x) => x.t.authors).map((x) => `| ${x.kind} | ${x.line.replace(/\|/g, '\\|')} | ${x.t.authors.map((k) => `${ARCH.find((y) => y.id === k)?.name ?? FEED_ORGANIZATIONS.find((o) => o.handle === k)?.name ?? k} ${x.a.author.probabilities[k].toFixed(2)}`).join(', ')} |`), '');
writeFileSync(resolve(ROOT, 'docs/FEED_TAGS.md'), md.join('\n'));

console.log(`${rows.length}/${items.length} lines judged; ${Object.keys(tags).length} tagged: ${regional.length} region-only, ${staged.length} by town size, ${wx.filter((x) => x.t.weather).length} by weather, ${rows.filter((x) => x.t.authors).length} with authors (${Object.keys(authors).length} archetypes, ${dropRows.length} lines lost an author they only talk about); ${mis.length} possibly misfiled, ${flipped.length} reversed outcomes`);
for (const r of report) console.log(`     ${r}`);
console.log(`Jev: ${costLine()}`);
const judged = rows.length === items.length;
console.log(`${judged && !failed ? 'OK  ' : 'FAIL'} every line judged${judged ? '' : ` (${items.length - rows.length} missing)`}`);
process.exit(judged && !failed ? 0 : DRY ? 0 : 1);
