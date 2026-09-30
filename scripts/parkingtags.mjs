// When each business's lot is full: asks TypeSafe's Jev about every brand in
// the registry (src/art/brands.ts) and writes src/agents/parkingTags.ts, a
// 24-hour occupancy curve per brand. The live parking (src/agents/parking.ts)
// uses it for lots off screen instead of the hand-set curve for the brand's
// kind: the sports bar fills after the game, the coffee kiosk at dawn, the
// church on Sunday-morning hours, the pawn shop at lunch. Parked cars are drawn
// only, so this never changes the simulation. Delete the file and every lot
// follows its kind's curve as before.
//   busy     choice: when the lot is busiest (early morning / morning / lunch /
//            afternoon / evening / late night / overnight); the curve follows
//            the answer's probabilities, smoothed over neighbouring hours
//   late     noul: open with customers after 10 pm (otherwise, unless it's
//            busiest late or overnight, the lot is near empty from 10 pm to 6 am)
//   quiet    score: how full the lot is in its quiet open hours, from nearly
//            empty to most of the way (the curve's floor)
// Checked against what the kinds say (bars busiest late, offices in working
// hours, coffee early, food at meals). Raw answers cached in
// docs/parking-tags.json; the review list is docs/PARKING_TAGS.md. --dry-run
// needs no key. Exits 1 if a brand couldn't be judged.
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { answerCache, apiKey, costLine, mapPool } from './typesafe.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry-run');
const PEAK = 0.85; // a lot at its busiest: most stalls, not all (the design doc's lots are oversized)
const QUIET_MAX = 0.6; // a lot "most of the way" full in its quiet hours sits at this share of its peak
const BANDS = {
  dawn: { from: 5, to: 8, text: 'Early morning, 5 to 8 am (commuters grabbing coffee or gas, shift changes).' },
  morning: { from: 8, to: 11, text: 'Morning, 8 to 11 am.' },
  lunch: { from: 11, to: 14, text: 'Lunchtime, 11 am to 2 pm.' },
  afternoon: { from: 14, to: 17, text: 'Afternoon, 2 to 5 pm.' },
  evening: { from: 17, to: 21, text: 'Evening, 5 to 9 pm (dinner, after work).' },
  late: { from: 21, to: 26, text: 'Late night, 9 pm to 2 am (bars, late-night food).' },
  overnight: { from: 2, to: 5, text: 'Overnight, 2 to 5 am.' },
};
const QUIET = ['Nearly empty.', 'About a quarter as full as at its busiest.', 'About half as full as at its busiest.', 'Most of the way as full as at its busiest.'];
// what each kind of business should say, for the agreement check (the busiest band is one of these)
const EXPECT = { bar: ['evening', 'late'], office: ['morning', 'lunch', 'afternoon'], coffee: ['dawn', 'morning'], food: ['lunch', 'evening'], church: ['morning', 'lunch'], bank: ['morning', 'lunch', 'afternoon'] };

const { BRANDS } = await import('../src/art/brands.ts');

function request(b) {
  return {
    state: {
      game: 'SLOPMERICA, a satirical American city builder. Its businesses are parodies of real American chains and local shops.',
      business: b.name,
      kind: b.kind,
      about: [b.blurb, b.tagline].filter(Boolean).join(' '),
    },
    questions: {
      busy: { type: 'choice', instructions: 'When is the parking lot of this kind of business busiest, in a typical American town on a weekday?', criteria: Object.fromEntries(Object.entries(BANDS).map(([k, v]) => [k, v.text])) },
      late: { type: 'noul', instructions: 'This kind of business is usually open, with customers, after 10 pm.' },
      quiet: { type: 'score', instructions: 'Outside its busiest hours but while it is open, how full is its parking lot?', criteria: QUIET },
    },
  };
}

// ---- ask
const cache = answerCache('docs/parking-tags.json');
let failed = 0;
if (DRY || !apiKey()) {
  const todo = BRANDS.filter((b) => { const r = request(b); return !cache.has(r.state, r.questions); }).length;
  console.log(`dry run: ${BRANDS.length} brands, ${todo} to ask (≈${(todo * 420).toLocaleString('en-US')} input tokens, ≈$${((todo * 420) / 1e6 * 0.042).toFixed(4)})`);
} else {
  await mapPool(BRANDS, 8, async (b) => { const r = request(b); try { await cache.ask(r.state, r.questions); } catch (e) { failed++; console.log(`FAIL couldn't judge ${b.name}: ${e.message.slice(0, 120)}`); } });
  cache.save({ prune: true });
}

// ---- the curves
const bandOf = (h) => Object.keys(BANDS).find((k) => { const { from, to } = BANDS[k]; return (h >= from && h < to) || (h + 24 >= from && h + 24 < to); });
function curve(a) {
  const P = a.busy.probabilities;
  const raw = Array.from({ length: 24 }, (_, h) => P[bandOf(h)] ?? 0);
  // smoothed over the neighbouring hours, so a band edge isn't a cliff
  const sm = raw.map((_, h) => (raw[(h + 23) % 24] + 2 * raw[h] + raw[(h + 1) % 24]) / 4);
  const top = Math.max(...sm) || 1;
  const floor = (a.quiet.score / (QUIET.length - 1)) * QUIET_MAX;
  // open at night: open late with customers, or busiest late or overnight (a warehouse
  // or a crypto mine runs all night with no customers, and its lot stays full)
  const openAtNight = a.late.noul >= 0.5 || (P.late ?? 0) + (P.overnight ?? 0) >= 0.25;
  return sm.map((v, h) => {
    if (!openAtNight && (h >= 22 || h < 6)) return 0.03; // closed: a staff car, maybe
    return +(PEAK * (floor + (1 - floor) * (v / top))).toFixed(2);
  });
}
const rows = [];
for (const b of BRANDS) {
  const a = cache.get(request(b).state, request(b).questions);
  if (!a) continue;
  const top = Object.entries(a.busy.probabilities).sort((x, y) => y[1] - x[1])[0][0];
  rows.push({ b, a, top, curve: curve(a) });
}
writeFileSync(resolve(ROOT, 'src/agents/parkingTags.ts'), [
  '// Generated by scripts/parkingtags.mjs from TypeSafe Jev answers (cached in docs/parking-tags.json).',
  "// Each brand's lot: the share of its stalls taken at each hour, 0-23. Read if present by",
  "// src/agents/parking.ts for lots off screen (drawn only: never the simulation); delete it and",
  "// every lot follows its kind's hand-set curve.",
  '',
  'export const PARKING_CURVES: Record<string, number[]> = {',
  ...rows.map((x) => `  ${JSON.stringify(x.b.id)}: [${x.curve.join(', ')}],`),
  '};',
  '',
].join('\n'));

// ---- agreement with what the kinds say
const judged = rows.filter((x) => EXPECT[x.b.kind]);
const agree = judged.filter((x) => EXPECT[x.b.kind].includes(x.top));
const pct = (a, b) => `${a}/${b} (${Math.round((a / Math.max(1, b)) * 100)}%)`;
const md = [
  '# Parking tags (TypeSafe Jev)',
  '',
  `Generated by \`node scripts/parkingtags.mjs\` for ${rows.length} brands. The live parking fills a brand's lot off screen by its curve; brands not listed follow their kind's hand-set curve (src/agents/parking.ts).`,
  '',
  `Busiest band as the kind says (bars late, offices and banks in working hours, coffee early, food at meals, church in the morning): ${pct(agree.length, judged.length)}.`,
  '',
  '## Disagreements (for review)',
  '',
  '| brand | kind | busiest | open late | quiet |',
  '|---|---|---|---|---|',
  ...judged.filter((x) => !agree.includes(x)).map((x) => `| ${x.b.name} | ${x.b.kind} | ${x.top} | ${x.a.late.noul.toFixed(2)} | ${x.a.quiet.score.toFixed(1)} |`),
  '',
  '## Every brand',
  '',
  '| brand | kind | busiest | ' + Object.keys(BANDS).join(' · ') + ' | open late | quiet | 3am · 8am · noon · 6pm · 11pm |',
  '|---|---|---|---|---|---|---|',
  ...rows.map((x) => `| ${x.b.name} | ${x.b.kind} | ${x.top} | ${Object.keys(BANDS).map((k) => (x.a.busy.probabilities[k] ?? 0).toFixed(2)).join(' · ')} | ${x.a.late.noul.toFixed(2)} | ${x.a.quiet.score.toFixed(1)} | ${[3, 8, 12, 18, 23].map((h) => x.curve[h].toFixed(2)).join(' · ')} |`),
  '',
];
writeFileSync(resolve(ROOT, 'docs/PARKING_TAGS.md'), md.join('\n'));

console.log(`${rows.length}/${BRANDS.length} brands judged; busiest band as the kind says: ${pct(agree.length, judged.length)}`);
const byTop = {};
for (const x of rows) byTop[x.top] = (byTop[x.top] ?? 0) + 1;
console.log(`     busiest: ${Object.entries(byTop).map(([k, n]) => `${k} ${n}`).join(', ')}`);
console.log(`Jev: ${costLine()}`);
const all = rows.length === BRANDS.length;
console.log(`${all && !failed ? 'OK  ' : 'FAIL'} every brand judged${all ? '' : ` (${BRANDS.length - rows.length} missing)`}`);
process.exit(all && !failed ? 0 : DRY ? 0 : 1);
