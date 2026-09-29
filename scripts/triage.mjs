// Playtest bug triage: node scripts/triage.mjs <folder> [--dry-run]
// Reads every tester report in the folder (the plain text from 🐞 Report bug,
// one per .txt file) and asks TypeSafe's Jev, for each:
//   area      choice: which part of the game
//   severity  score: cosmetic / broken with a workaround / broken with no
//             workaround / crash or blocker
//   check     choice over the regression scripts, described by their README
//             one-liners: which existing check would catch this?
// then, for each earlier report in the folder, one noul: is this the same
// problem? Numbers go in as words (a frame rate is "choppy", not 22).
// Writes <folder>/TRIAGE.md, sorted by severity, and prints it. With a
// labels.json in the folder (hand labels), prints the agreement. Raw answers
// cached in <folder>/triage-cache.json; thresholds below. --dry-run needs no
// key and writes nothing. Exits 2 when reports couldn't be judged.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { answerCache, apiKey, costLine, mapPool, topChoices } from './typesafe.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry-run');
const DIR = resolve(process.argv.slice(2).find((a) => !a.startsWith('--')) ?? join(ROOT, 'scripts/triage-samples'));
const T = {
  check: 0.3, // a check is suggested when Jev is at least this sure; else "none"
  dup: 0.6, // two reports are the same problem at this
  maxCandidates: 12, // earlier reports compared against each report
  // severity level from Jev's expected score: below 0.5 cosmetic, below 1.8 workaround,
  // below 2.5 no workaround, else crash. Jev splits "workaround" and "no workaround" on
  // bugs you can redo (a lost bus line scored 1.5-1.7), so "no workaround" needs 1.8.
  // Tuned on the 12 hand-labelled samples: recheck on real reports.
  levels: [0.5, 1.8, 2.5],
};
const AREAS = {
  roads: 'Roads, bridges, junctions and the road tools, including a building not connected to the road network',
  zoning: 'Zoning, buildings growing and levelling up, demand',
  services: 'City services: power, water, sewage, trash, police, fire, health, schools, and placing them',
  economy: 'Money, taxes, the budget, loans, buying land',
  transit: 'Buses, depots, stops and transit lines',
  feed: 'The in-game social feed and its posts',
  visuals: 'How things look: terrain, water, trees, buildings, lighting, weather',
  performance: 'Slowness: low frame rate, stutter, lag',
  ui: 'Menus, panels, tooltips, messages, buttons and touch controls',
  save: 'Saving, loading and city files',
  crash: 'The game crashes, freezes, shows an error or will not start',
  other: 'Ideas and anything else',
};
const SEVERITY = [
  'Cosmetic: something looks or reads wrong, but the game plays normally.',
  'Broken, but there is a workaround: the player can still do what they wanted another way.',
  'Broken with no workaround: the player cannot do something the game should let them do.',
  'Crash or blocker: the game crashes, freezes, loses the city, or cannot be played on.',
];
const SEV_SHORT = ['cosmetic', 'workaround', 'no workaround', 'crash/blocker'];

// ---- the checks: every README one-liner
const CHECKS = {};
for (const m of readFileSync(join(ROOT, 'README.md'), 'utf8').matchAll(/^node scripts\/([\w/-]+)\.mjs[^#\n]*#\s*(.+)$/gm)) if (!CHECKS[m[1]]) CHECKS[m[1]] = m[2].trim();
CHECKS.none = 'None of these checks would catch it (an idea, or something no test covers).';

// ---- the reports
const field = (text, name) => text.match(new RegExp(`^${name}: (.*)$`, 'm'))?.[1]?.trim();
function parse(file) {
  const text = readFileSync(file, 'utf8');
  const fps = Number(field(text, 'Perf')?.match(/^([\d.]+) fps/)?.[1]);
  const pop = Number((field(text, 'City')?.match(/pop ([\d,]+)/)?.[1] ?? '').replace(/,/g, ''));
  const errs = text.match(/^Errors \((\d+)\):\n (.*)$/m);
  const recent = text.split('Recent actions:')[1]?.trim().split('\n').slice(-5).map((l) => l.trim().replace(/^[\d:]+\s*/, '')) ?? [];
  const facts = {
    device: /touch/.test(field(text, 'Device') ?? '') ? 'phone or tablet (touch)' : field(text, 'Device') ? 'computer (mouse)' : 'unknown',
    ...(Number.isFinite(fps) ? { frame_rate: `about ${Math.round(fps)} fps: ${fps >= 45 ? 'smooth' : fps >= 25 ? 'a bit choppy' : fps >= 15 ? 'choppy' : 'a slideshow'}` } : {}),
    ...(Number.isFinite(pop) && field(text, 'City') ? { city: pop < 200 ? 'a tiny new town' : pop < 1100 ? 'a small town' : pop < 4000 ? 'a mid-size town' : 'a big city' } : {}),
    ...(field(text, 'Where') ? { tool_in_hand: field(text, 'Where').match(/tool ([\w/]+)/)?.[1] ?? 'none' } : {}),
    errors: errs ? `${errs[1]} error${errs[1] === '1' ? '' : 's'} caught, first: ${errs[2].replace(/^\[[^\]]*\]\s*/, '').slice(0, 160)}` : /Errors: none caught/.test(text) ? 'no errors caught' : 'no error log',
    ...(field(text, 'Alerts') ? { last_alerts: field(text, 'Alerts').slice(0, 240) } : {}),
    ...(recent.length ? { last_actions: recent.join('; ') } : {}),
    ...(/^Session: /m.test(text) && !field(text, 'City') ? { note: 'the report came from before a city was running (title screen or loading)' } : {}),
  };
  return { file: basename(file), kind: text.match(/BUG REPORT · (.+)$/m)?.[1] ?? 'unknown', what: field(text, 'What happened') ?? text.slice(0, 300), expected: field(text, 'Expected'), facts };
}
const reports = readdirSync(DIR).filter((f) => f.endsWith('.txt')).sort().map((f) => parse(join(DIR, f)));

function request(r) {
  return {
    state: { game: 'SLOPMERICA, a satirical city-building game in the browser.', report_kind: r.kind, what_happened: r.what, ...(r.expected ? { expected: r.expected } : {}), facts: r.facts },
    questions: {
      area: { type: 'choice', instructions: 'Which part of the game is this report about?', criteria: AREAS },
      severity: { type: 'score', instructions: 'How bad is this for the player?', criteria: SEVERITY },
      check: { type: 'choice', instructions: 'Which existing automated check would catch this problem if it came back? Pick "none" for ideas, or when no check covers it.', criteria: CHECKS },
    },
  };
}
function dupRequest(r, earlier) {
  return {
    state: { report: { what_happened: r.what, ...(r.expected ? { expected: r.expected } : {}), facts: r.facts } },
    questions: Object.fromEntries(earlier.map((e, i) => [`same_${i}`, { type: 'noul', instructions: `This report describes the same problem as this earlier report, even if worded differently (the same bug, not just the same area): "${e.what}"` }])),
  };
}
const candidatesOf = (i) => reports.slice(Math.max(0, i - T.maxCandidates), i);

// ---- ask
const cache = answerCache(join(DIR, 'triage-cache.json').replace(ROOT + '/', ''));
let failed = 0;
if (!reports.length) { console.log(`no .txt reports in ${DIR}`); process.exit(2); }
if (DRY || !apiKey()) {
  const todo = reports.filter((r) => { const q = request(r); return !cache.has(q.state, q.questions); }).length;
  console.log(`dry run: ${reports.length} reports, ${todo} to ask, plus ${reports.filter((_, i) => i > 0).length} duplicate checks (≈${((todo * 2500) + reports.length * 400).toLocaleString('en-US')} input tokens)`);
} else {
  await mapPool(reports, 6, async (r) => { const q = request(r); try { await cache.ask(q.state, q.questions); } catch (e) { failed++; console.log(`FAIL couldn't judge ${r.file}: ${e.message.slice(0, 120)}`); } });
  await mapPool(reports.map((r, i) => [r, i]).filter(([, i]) => i > 0), 6, async ([r, i]) => { const q = dupRequest(r, candidatesOf(i)); try { await cache.ask(q.state, q.questions); } catch (e) { failed++; console.log(`FAIL couldn't compare ${r.file}: ${e.message.slice(0, 120)}`); } });
  cache.save({ prune: true });
}

// ---- decide
const rows = [];
reports.forEach((r, i) => {
  const q = request(r), a = cache.get(q.state, q.questions);
  if (!a) return;
  const sev = T.levels.filter((c) => a.severity.score >= c).length;
  const [check, cp] = topChoices(a.check, 1)[0];
  const earlier = candidatesOf(i);
  const d = i > 0 ? cache.get(dupRequest(r, earlier).state, dupRequest(r, earlier).questions) : {};
  const dupOf = earlier.filter((_, j) => (d?.[`same_${j}`]?.noul ?? 0) >= T.dup).map((e) => e.file);
  rows.push({ ...r, area: a.area.choice, areaP: a.area.probabilities[a.area.choice], sev, sevScore: a.severity.score, check: cp >= T.check ? check : 'none', checkP: cp, dupOf });
});
rows.sort((x, y) => y.sevScore - x.sevScore);
const esc = (s) => String(s).replace(/\|/g, '\\|');
const table = ['| severity | area | report | what happened | would be caught by | same problem as |', '|---|---|---|---|---|---|',
  ...rows.map((x) => `| ${SEV_SHORT[x.sev]} (${x.sevScore.toFixed(1)}) | ${x.area} | ${x.file} | ${esc(x.what.slice(0, 110))} | ${x.check === 'none' ? '—' : `${x.check} (${x.checkP.toFixed(2)})`} | ${x.dupOf.join(', ') || '—'} |`)];

// ---- hand labels
const report = [];
const lf = join(DIR, 'labels.json');
if (existsSync(lf)) {
  const L = JSON.parse(readFileSync(lf, 'utf8'));
  let n = 0, area = 0, sev = 0, sev1 = 0, check = 0, dupTP = 0, dupFP = 0, dupFN = 0;
  const misses = [];
  for (const x of rows) {
    const l = L[x.file];
    if (!l) continue;
    n++;
    if (l.area.includes(x.area)) area++; else misses.push(`area ${x.file}: ${x.area} (label ${l.area.join('/')})`);
    if (l.severity === x.sev) sev++; else misses.push(`severity ${x.file}: ${SEV_SHORT[x.sev]} (label ${SEV_SHORT[l.severity]})`);
    if (Math.abs(l.severity - x.sev) <= 1) sev1++;
    if (l.check.includes(x.check)) check++; else misses.push(`check ${x.file}: ${x.check} (label ${l.check.join('/')})`);
    for (const f of x.dupOf) if (l.dupOf.includes(f)) dupTP++; else { dupFP++; misses.push(`duplicate ${x.file} ~ ${f} (label: not the same)`); }
    for (const f of l.dupOf) if (!x.dupOf.includes(f)) { dupFN++; misses.push(`duplicate missed: ${x.file} ~ ${f}`); }
  }
  report.push(`area ${area}/${n}`, `severity ${sev}/${n} exact, ${sev1}/${n} within one level`, `check ${check}/${n}`, `duplicates: ${dupTP} found, ${dupFN} missed, ${dupFP} false`);
  if (!DRY) writeFileSync(join(DIR, 'TRIAGE.md'), ['# Bug triage', '', `${rows.length} reports from \`${basename(DIR)}\`, most severe first (score 0 cosmetic … 3 crash). Suggested check at ${T.check}; same problem at ${T.dup}.`, '', ...table, '', `## Agreement with labels.json: ${report.join(' · ')}`, '', ...misses.map((m) => `- ${m}`), ''].join('\n'));
} else if (!DRY) writeFileSync(join(DIR, 'TRIAGE.md'), ['# Bug triage', '', `${rows.length} reports, most severe first.`, '', ...table, ''].join('\n'));

console.log(table.join('\n'));
if (report.length) console.log(`\nAgreement with hand labels: ${report.join(' · ')}`);
console.log(`Jev: ${costLine()}`);
if (rows.length < reports.length || failed) process.exit(2);
