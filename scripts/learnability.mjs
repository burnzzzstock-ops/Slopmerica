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
// next, 2 when messages couldn't be judged. --dry-run needs no key and writes nothing.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { answerCache, apiKey, costLine, mapPool } from './typesafe.mjs';
import { SRC, calls, expr, tokenize, walk } from './copyscan.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry-run');
const T = {
  saysWhat: 0.5, // below: the message doesn't say what happened
  saysNext: 0.5, // below (refusals and warnings): it doesn't say what to do
  jargon: 1.5, // expected jargon level at or above: flagged
};
const SKIP_DIRS = ['src/content', 'src/art', 'src/dev', 'src/vault', 'src/buildings', 'src/audio'];

// ---- find the messages. Tokens come from the shared copy scanner (scripts/copyscan.mjs,
// also used by the content audit); this script reads each message where it's shown.
const P = (t, v) => t?.t === 'p' && t.v === v;
/** the message pieces in a run of tokens: its strings, and its templates with each ${…}
 *  shown as the words inside it ("A / B") or as {name} */
function pieces(run, toks) {
  const inHole = new Set();
  for (const t of run) if (t.t === 'tmpl') for (const h of t.holes) for (let k = h.from; k < h.to; k++) inHole.add(toks[k]);
  const out = [];
  for (const t of run) {
    if (inHole.has(t)) continue;
    if (t.t === 'str') out.push(t.v);
    else if (t.t === 'tmpl') {
      let n = 0;
      out.push(t.v.replace(/\{…\}/g, () => {
        const h = t.holes[n++];
        const inner = pieces(toks.slice(h.from, h.to), toks).filter((p) => /[a-z]{2}/i.test(p));
        const name = (h.expr.match(/([A-Za-z_]\w*)\s*(?:\?\?|\)|\.toLocaleString|\.toFixed|$)/) ?? [])[1] ?? 'value';
        return inner.length ? inner.join(' / ') : `{${name}}`;
      }));
    }
  }
  return out.map((s) => s.replace(/\s+/g, ' ').trim()).filter((s) => /[a-z]{3}/i.test(s) && s.split(' ').length >= 2);
}

const records = [];
for (const file of walk(SRC).filter((f) => !/\.d\.ts$/.test(f))) {
  const rel = relative(ROOT, file).replace(/\\/g, '/');
  if (SKIP_DIRS.some((d) => rel.startsWith(d + '/'))) continue;
  const toks = tokenize(readFileSync(file, 'utf8'));
  const add = (kind, line, run, bad) => {
    const texts = [...new Set(pieces(run, toks))];
    if (!texts.length) return;
    records.push({ id: `${rel}:${line}:${kind}`, where: `${rel}:${line}`, kind, bad, texts });
  };
  // toast(message, bad?) and banner(...)
  for (const c of calls(toks, (t) => t.v === 'toast' || t.v === 'banner')) {
    const [first, ...rest] = c.args;
    if (!first || P(first[1], ':')) continue; // the definitions: toast(msg: string, ...)
    if (c.name === 'banner') add('banner', c.line, c.args.flat(), false);
    else add('toast', c.line, first, ['true', '!', 'bad'].includes(rest[0]?.[0]?.v) || (rest.length > 0 && rest.at(-1).length === 1 && rest.at(-1)[0].v === 'true'));
  }
  // x.alert('warn', message)
  for (const c of calls(toks, (t, prev) => t.v === 'alert' && P(prev, '.'))) {
    const [level] = c.args;
    if (level?.length !== 1 || level[0].t !== 'str' || !/^\w+$/.test(level[0].v) || c.args.length < 2) continue;
    add(`alert:${level[0].v}`, c.line, c.args.slice(1).flat(), level[0].v !== 'info');
  }
  // { reason: ... } (a refusal) and { why: ... }
  const keyed = (key) => toks.flatMap((t, k) => (t.t === 'id' && t.v === key && P(toks[k + 1], ':') && (P(toks[k - 1], '{') || P(toks[k - 1], ',')) ? [k] : []));
  for (const k of keyed('reason')) add('refusal', toks[k].line, expr(toks, k + 2)[0], true);
  for (const k of keyed('why')) add('why', toks[k].line, expr(toks, k + 2)[0], false);
  // tip = { text, bad }
  for (let k = 0; k < toks.length - 2; k++) {
    if (toks[k].t !== 'id' || toks[k].v !== 'tip' || !P(toks[k + 1], '=') || !P(toks[k + 2], '{')) continue;
    const [obj] = expr(toks, k + 3, '');
    let depth = 0, text = null, bad = false;
    obj.forEach((t, j) => {
      if (t.t === 'p' && !t.hole && '([{'.includes(t.v)) depth++;
      else if (t.t === 'p' && !t.hole && ')]}'.includes(t.v)) depth--;
      else if (depth === 0 && t.t === 'id' && P(obj[j + 1], ':')) {
        if (t.v === 'text' && !text) text = expr(obj, j + 2, ',')[0];
        if (t.v === 'bad' && ['true', '!'].includes(obj[j + 2]?.v)) bad = true;
      }
    });
    if (text) add('tooltip', toks[k].line, text, bad);
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
if (!DRY) writeFileSync(resolve(ROOT, 'docs/LEARNABILITY.md'), md.join('\n')); // (a dry run leaves the committed report alone)

console.log(`${rows.length}/${records.length} messages judged: ${noNext.length} refusals/warnings without a next step, ${noWhat.length} that don't say what happened, ${jargon.length} with jargon; hand labels ${agree}/${labeled}`);
console.log(`Jev: ${costLine()}`);
for (const x of noNext) console.log(`FAIL no next step: ${x.where} "${x.texts[0].slice(0, 90)}" (${x.a.says_next.noul.toFixed(2)})`);
if (rows.length < records.length || failed) { console.log(`FAIL ${records.length - rows.length} messages couldn't be judged`); process.exit(2); }
process.exit(noNext.length ? 1 : 0);
