// Learnability check on UI copy (GAME_DESIGN.md, the Learnability milestone).
// The house rule: a refusal says the rule and the way out, and a waiting lot
// says why it's waiting. Scans src/ for every message a player reads (toasts,
// banners, alerts, placement refusals, tooltips, "why" explanations), keeping
// the pieces of one message together, and asks TypeSafe's Jev three narrow
// questions about each:
//   says_what  noul: it tells a first-time player what happened (or what this is)
//   says_next  noul, refusals and warnings only: it says what to do next
//   jargon     score: plain words .. insider shorthand, for a first-time player
// Jev doesn't write text: the fixes in docs/LEARNABILITY.md are written by hand
// (FIXES below) and only proposed. Raw answers cached in docs/learnability.json;
// thresholds below. Exits 1 when a refusal or warning doesn't say what to do
// next, 2 when messages couldn't be judged. --dry-run needs no key.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { answerCache, apiKey, costLine, mapPool } from './typesafe.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry-run');
const T = {
  saysWhat: 0.5, // below: the message doesn't say what happened
  saysNext: 0.5, // below (refusals and warnings): it doesn't say what to do
  jargon: 1.5, // expected jargon level at or above: flagged
};
const SKIP_DIRS = ['src/content', 'src/art', 'src/dev', 'src/vault', 'src/buildings', 'src/audio'];

// ---- scanner: the argument text of a call, and the string pieces inside it
function readExpr(src, i, stops) {
  // from i, read until a depth-0 stop char; understands strings, templates and ${...}
  let depth = 0;
  const start = i;
  while (i < src.length) {
    const c = src[i];
    if (c === "'" || c === '"') { const q = c; i++; while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; } i++; continue; }
    if (c === '`') { i = skipTemplate(src, i); continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) { if (depth === 0) break; depth--; }
    else if (depth === 0 && stops.includes(c)) break;
    i++;
  }
  return { text: src.slice(start, i), end: i };
}
function skipTemplate(src, i) {
  i++; // opening backtick
  while (i < src.length && src[i] !== '`') {
    if (src[i] === '\\') { i += 2; continue; }
    if (src[i] === '$' && src[i + 1] === '{') { const r = readExpr(src, i + 2, ''); i = r.end + 1; continue; }
    i++;
  }
  return i + 1;
}
/** string and template literals in an expression, templates with ${x.y} shown as {y} */
function pieces(expr) {
  const out = [];
  let i = 0;
  while (i < expr.length) {
    const c = expr[i];
    if (c === "'" || c === '"') {
      let j = i + 1, s = '';
      while (j < expr.length && expr[j] !== c) { if (expr[j] === '\\') { s += expr[j + 1]; j += 2; continue; } s += expr[j++]; }
      out.push(s); i = j + 1; continue;
    }
    if (c === '`') {
      let j = i + 1, s = '';
      while (j < expr.length && expr[j] !== '`') {
        if (expr[j] === '\\') { s += expr[j + 1]; j += 2; continue; }
        if (expr[j] === '$' && expr[j + 1] === '{') {
          const r = readExpr(expr, j + 2, '');
          const inner = pieces(r.text).filter((p) => /[a-z]{2}/i.test(p));
          const name = (r.text.match(/([A-Za-z_]\w*)\s*(?:\?\?|\)|\.toLocaleString|\.toFixed|$)/) ?? [])[1] ?? 'value';
          s += inner.length ? inner.join(' / ') : `{${name}}`;
          j = r.end + 1; continue;
        }
        s += expr[j++];
      }
      out.push(s); i = j + 1; continue;
    }
    i++;
  }
  return out.map((s) => s.replace(/\s+/g, ' ').trim()).filter((s) => /[a-z]{3}/i.test(s) && s.split(' ').length >= 2);
}
const tsFiles = (dir) => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? tsFiles(p) : /\.ts$/.test(f) && !/\.d\.ts$/.test(f) ? [p] : []; });

const records = [];
for (const file of tsFiles(join(ROOT, 'src'))) {
  const rel = relative(ROOT, file).replace(/\\/g, '/');
  if (SKIP_DIRS.some((d) => rel.startsWith(d + '/'))) continue;
  const src = readFileSync(file, 'utf8');
  const line = (i) => src.slice(0, i).split('\n').length;
  const add = (kind, i, expr, bad) => {
    const texts = [...new Set(pieces(expr))];
    if (!texts.length) return;
    records.push({ id: `${rel}:${line(i)}:${kind}`, where: `${rel}:${line(i)}`, kind, bad, texts });
  };
  for (const m of src.matchAll(/\b(toast|banner)\(/g)) {
    if (/^\s*(toast|banner)\([a-z]+: string/.test(src.slice(m.index, m.index + 40))) continue; // the definitions
    const a = readExpr(src, m.index + m[0].length, '');
    const first = readExpr(a.text, 0, ',');
    const rest = a.text.slice(first.end + 1);
    if (m[1] === 'banner') add('banner', m.index, a.text, false);
    else add('toast', m.index, first.text, /^\s*(true|!|bad|!ok)/.test(rest) || /,\s*true\s*$/.test(a.text));
  }
  for (const m of src.matchAll(/\.alert\(\s*'(\w+)'\s*,/g)) { const a = readExpr(src, m.index + m[0].length, ''); add(`alert:${m[1]}`, m.index, a.text, m[1] !== 'info'); }
  for (const m of src.matchAll(/\breason:\s*/g)) { const a = readExpr(src, m.index + m[0].length, ',;'); add('refusal', m.index, a.text, true); }
  for (const m of src.matchAll(/\bwhy:\s*/g)) { const a = readExpr(src, m.index + m[0].length, ',;'); add('why', m.index, a.text, false); }
  for (const m of src.matchAll(/\btip = \{/g)) {
    const obj = readExpr(src, m.index + m[0].length, '').text;
    const t = obj.match(/\btext:\s*/);
    if (!t) continue;
    const a = readExpr(obj, t.index + t[0].length, ',');
    add('tooltip', m.index, a.text, /\bbad:\s*(true|!)/.test(obj));
  }
}

const KIND = {
  toast: 'a pop-up message after something happens', banner: 'a big headline across the screen', 'alert:info': 'a note in the alert log',
  'alert:warn': 'a warning in the alert log', 'alert:crit': 'an urgent warning in the alert log', refusal: "the reason the game won't let the player do something",
  why: 'an explanation of why something is happening', tooltip: 'a tooltip while the player points at something with a tool',
};
function request(r) {
  const refusal = r.bad;
  const state = {
    game: 'SLOPMERICA, a satirical city-building game. The message is shown to a player who may be playing for the first time. Text in {braces} is filled in by the game (a name, a number); "A / B" means one of several versions.',
    shown_as: KIND[r.kind] ?? r.kind,
    ...(r.bad ? { tone: 'shown in red: something went wrong or was refused' } : {}),
    message: r.texts.length === 1 ? r.texts[0] : r.texts,
  };
  const q = {
    says_what: { type: 'noul', instructions: 'The message tells a first-time player what happened, or what the thing they are pointing at is. A joke can still count if the facts are in it.' },
    jargon: {
      type: 'score',
      instructions: 'How much insider language does the message use, for a first-time player?',
      criteria: [
        'Plain words: a first-time player understands every word.',
        'One game or city-planning term a newcomer may not know, but the message makes its meaning clear.',
        'City-planning or game terms a first-time player would not know, left unexplained (for example stroad, induced demand, capacity, upkeep, zoning demand).',
        'Mostly insider shorthand or abbreviations a first-time player could not follow.',
      ],
    },
  };
  if (refusal) q.says_next = { type: 'noul', instructions: 'The message tells the player what to do next to get what they wanted, or how to fix the problem (the way out), not only what went wrong.' };
  return { state, questions: q };
}

// ---- hand labels (the check): read before looking at Jev's answers
const LABELS = {
  // [text fragment, says_next]
  'Too sharp a junction': true,
  'Not enough money for lawyers': false,
  'Could not save in this browser': false,
  'is in the way: bulldoze it first, or go around': true,
  'Too steep (': true,
  'No court in America will touch them': false,
};

if (process.argv.includes('--list')) { for (const r of records) console.log(`${r.where} ${r.kind}${r.bad ? ' (red)' : ''}: ${r.texts.join(' / ').slice(0, 160)}`); process.exit(0); }

// ---- ask
const cache = answerCache('docs/learnability.json');
let failed = 0;
if (DRY || !apiKey()) {
  const todo = records.filter((r) => { const q = request(r); return !cache.has(q.state, q.questions); }).length;
  console.log(`dry run: ${records.length} messages (${records.filter((r) => r.bad).length} refusals/warnings), ${todo} to ask (≈${(todo * 520).toLocaleString('en-US')} input tokens, ≈$${((todo * 520) / 1e6 * 0.042).toFixed(4)})`);
} else {
  await mapPool(records, 8, async (r) => { const q = request(r); try { await cache.ask(q.state, q.questions); } catch (e) { failed++; console.log(`FAIL couldn't judge ${r.where}: ${e.message.slice(0, 120)}`); } });
  cache.save({ prune: true });
}

// ---- decide
const rows = [];
for (const r of records) { const q = request(r), a = cache.get(q.state, q.questions); if (a) rows.push({ ...r, a }); }
const noWhat = rows.filter((x) => x.a.says_what.noul < T.saysWhat);
const noNext = rows.filter((x) => x.a.says_next && x.a.says_next.noul < T.saysNext);
const jargon = rows.filter((x) => x.a.jargon.score >= T.jargon);
let agree = 0, labeled = 0;
const labelRows = [];
for (const [frag, want] of Object.entries(LABELS)) {
  const x = rows.find((r) => r.a.says_next && r.texts.some((t) => t.includes(frag)));
  if (!x) continue;
  labeled++;
  const got = x.a.says_next.noul >= T.saysNext;
  if (got === want) agree++;
  labelRows.push(`| ${got === want ? '✓' : '✗'} | ${frag} | ${want ? 'yes' : 'no'} | ${x.a.says_next.noul.toFixed(2)} |`);
}

const FIXES = (await import('./learnability-fixes.mjs').catch(() => ({ FIXES: {} }))).FIXES;
const md = [
  '# Learnability check (TypeSafe Jev)', '',
  `Generated by \`node scripts/learnability.mjs\` for ${rows.length} player-facing messages (${rows.filter((x) => x.bad).length} refusals and warnings). The house rule: a refusal says the rule and the way out, and a waiting lot says why it's waiting. Thresholds: says what happened < ${T.saysWhat}, says what to do next < ${T.saysNext}, jargon ≥ ${T.jargon} (0 plain … 3 shorthand). Fixes are written by hand and proposed, not applied.`, '',
  `## Hand labels: does a refusal say what to do next? (${agree}/${labeled} agree)`, '', '| | message | label | Jev |', '|---|---|---|---|', ...labelRows, '',
];
const esc = (s) => s.replace(/\|/g, '\\|');
const sect = (title, list, col) => md.push(`## ${title} (${list.length})`, '', `| where | message | ${col} | proposed fix |`, '|---|---|---|---|', ...list.map((x) => `| ${x.where} | ${esc(x.texts.join(' / ').slice(0, 220))} | ${col === 'jargon' ? x.a.jargon.score.toFixed(1) : (col === 'next' ? x.a.says_next.noul : x.a.says_what.noul).toFixed(2)} | ${esc(FIXES[x.texts[0]] ?? FIXES[x.id] ?? (x.kind === 'tooltip' && col === 'what' ? 'fine: a step-by-step instruction, not news' : ''))} |`), '');
sect("Refusals and warnings that don't say what to do next", noNext.sort((a, b) => a.a.says_next.noul - b.a.says_next.noul), 'next');
sect("Messages that don't say what happened", noWhat.sort((a, b) => a.a.says_what.noul - b.a.says_what.noul), 'what');
sect('Jargon a first-time player may not know', jargon.sort((a, b) => b.a.jargon.score - a.a.jargon.score), 'jargon');
writeFileSync(resolve(ROOT, 'docs/LEARNABILITY.md'), md.join('\n'));

console.log(`${rows.length}/${records.length} messages judged: ${noNext.length} refusals/warnings without a next step, ${noWhat.length} that don't say what happened, ${jargon.length} with jargon; hand labels ${agree}/${labeled}`);
console.log(`Jev: ${costLine()}`);
for (const x of noNext) console.log(`FAIL no next step: ${x.where} "${x.texts[0].slice(0, 90)}" (${x.a.says_next.noul.toFixed(2)})`);
if (rows.length < records.length || failed) { console.log(`FAIL ${records.length - rows.length} messages couldn't be judged`); process.exit(2); }
process.exit(noNext.length ? 1 : 0);
