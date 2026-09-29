// Content audit: every player-facing line in src/ (feed posts, billboards, brand
// names and slogans, signs, street and commune names, UI copy) checked against the
// content rules in docs/WORKSTREAMS.md by TypeSafe's Jev model, plus an IP check
// on the parody brands (how close each name sits to the real one, reused real
// slogans, look-alike signs) before anything heads to a store.
//
//   node scripts/contentaudit.mjs              audit; judge only new or changed lines
//   node scripts/contentaudit.mjs --inventory  list what would be audited (no API calls)
//   node scripts/contentaudit.mjs --dry-run    show the requests without sending them
//   node scripts/contentaudit.mjs --only=feed  limit to items whose file or text matches
//
// Needs TYPESAFE_API_KEY (environment or .env.local) for lines it hasn't judged yet;
// judgments are kept in docs/content-audit.json so unchanged lines are never re-asked.
// Writes docs/CONTENT_AUDIT.md. Exits 1 if a line crosses a hard rule, 2 if some
// lines could not be judged (no key or API errors), 0 otherwise.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MODEL, TypeSafeError, apiKey, mapPool, systemOne } from './typesafe.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');

// ---------------------------------------------------------------- string literals
// A small TS tokenizer: enough to find every string and template literal with its
// line and a best-effort key path (BRANDS[12].tagline, templates.laneAdded[3]).

const REGEX_AFTER_WORD = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'instanceof', 'yield', 'await']);
const CONTROL = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'typeof', 'await']);

function unescape(src, i) {
  // src[i] is the character after a backslash; returns [text, nextIndex]
  const c = src[i];
  const simple = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' };
  if (c in simple && !(c === '0' && /[0-9]/.test(src[i + 1]))) return [simple[c], i + 1];
  if (c === 'x') return [String.fromCharCode(parseInt(src.slice(i + 1, i + 3), 16)), i + 3];
  if (c === 'u' && src[i + 1] === '{') { const e = src.indexOf('}', i); return [String.fromCodePoint(parseInt(src.slice(i + 2, e), 16)), e + 1]; }
  if (c === 'u') return [String.fromCharCode(parseInt(src.slice(i + 1, i + 5), 16)), i + 5];
  if (c === '\r' && src[i + 1] === '\n') return ['', i + 2];
  if (c === '\n') return ['', i + 1];
  return [c, i + 1];
}

function tokenize(src) {
  const toks = [];
  let i = 0;
  let line = 1;
  const regexOk = () => {
    const t = toks[toks.length - 1];
    if (!t) return true;
    if (t.t === 'id') return REGEX_AFTER_WORD.has(t.v);
    if (t.t !== 'p') return false;
    return t.v !== ')' && t.v !== ']';
  };
  const quoted = (q) => {
    let out = '';
    i++;
    while (i < src.length && src[i] !== q) {
      if (src[i] === '\\') { const [s, j] = unescape(src, i + 1); if (src[i + 1] === '\n') line++; out += s; i = j; continue; }
      if (src[i] === '\n') break; // unterminated
      out += src[i++];
    }
    i++;
    return out;
  };
  const template = () => {
    let out = '';
    i++;
    while (i < src.length && src[i] !== '`') {
      if (src[i] === '\\') { const [s, j] = unescape(src, i + 1); out += s; i = j; continue; }
      if (src[i] === '$' && src[i + 1] === '{') { i += 2; lex(true); out += '{…}'; continue; }
      if (src[i] === '\n') line++;
      out += src[i++];
    }
    i++;
    return out;
  };
  const regex = () => {
    let j = i + 1;
    let cls = false;
    for (; j < src.length; j++) {
      const c = src[j];
      if (c === '\\') { j++; continue; }
      if (c === '\n') return false;
      if (c === '[') cls = true;
      else if (c === ']') cls = false;
      else if (c === '/' && !cls) break;
    }
    j++;
    while (/[a-z]/i.test(src[j] ?? '')) j++;
    i = j;
    return true;
  };
  function lex(inExpr) {
    let depth = 0;
    while (i < src.length) {
      const c = src[i];
      if (c === '\n') { line++; i++; continue; }
      if (c === ' ' || c === '\t' || c === '\r' || c === '﻿') { i++; continue; }
      if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
      if (c === '/' && src[i + 1] === '*') {
        const e = src.indexOf('*/', i + 2);
        const end = e < 0 ? src.length : e + 2;
        for (let k = i; k < end; k++) if (src[k] === '\n') line++;
        i = end;
        continue;
      }
      if (c === "'" || c === '"') { const l = line; toks.push({ t: 'str', v: quoted(c), line: l }); continue; }
      if (c === '`') { const l = line; const v = template(); toks.push({ t: 'tmpl', v, line: l }); continue; }
      if (c === '/' && regexOk() && regex()) { toks.push({ t: 'regex', v: '/', line }); continue; }
      if (/[A-Za-z_$]/.test(c)) { let j = i + 1; while (j < src.length && /[\w$]/.test(src[j])) j++; toks.push({ t: 'id', v: src.slice(i, j), line }); i = j; continue; }
      if (/[0-9]/.test(c)) { let j = i + 1; while (j < src.length && /[\w.]/.test(src[j])) j++; toks.push({ t: 'num', v: src.slice(i, j), line }); i = j; continue; }
      if (inExpr && c === '{') depth++;
      if (inExpr && c === '}') { if (depth === 0) { i++; return; } depth--; }
      if (c === '=' && src[i + 1] === '>') { toks.push({ t: 'p', v: '=>', line }); i += 2; continue; }
      toks.push({ t: 'p', v: c, line });
      i++;
    }
  }
  lex(false);
  return toks;
}

/** Every string/template literal with its line, key path and neighbouring tokens. */
function literals(src) {
  const toks = tokenize(src);
  const out = [];
  const frames = []; // { open, label, index }
  let pending = null; // key for the next value
  let decl = null; // name after const/let/var, until its '='
  let fnName = null; // name after `function`, until its body opens
  let popped = null; // label of the frame that just closed (arrow fn bodies inherit it)
  let skip = -1; // frame depth of a type alias or interface body being skipped
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    const prev = toks[k - 1];
    const next = toks[k + 1];
    const isKey = (prev?.v === '{' || prev?.v === ',') && next?.v === ':' && frames[frames.length - 1]?.open === '{';
    if (t.t === 'id') {
      if (t.v === 'type' && next?.t === 'id' && toks[k + 2]?.v !== ':' && skip < 0 && (!prev || [';', '}', '{'].includes(prev.v) || prev.v === 'export')) skip = frames.length;
      else if (t.v === 'interface' && next?.t === 'id' && skip < 0) skip = frames.length;
      else if ((t.v === 'const' || t.v === 'let' || t.v === 'var') && next?.t === 'id') decl = next.v;
      else if (t.v === 'function' && next?.t === 'id') fnName = next.v;
      else if (isKey) pending = t.v;
      continue;
    }
    if (t.t === 'p') {
      if (t.v === '=' && decl && prev?.v !== '=' && next?.v !== '=') { pending = decl; decl = null; }
      else if ('{[('.includes(t.v)) {
        let label = pending;
        if (!label && t.v === '(' && prev?.t === 'id' && !CONTROL.has(prev.v)) label = `${prev.v}()`;
        if (!label && t.v === '{' && prev?.v === '=>') label = popped;
        if (!label && t.v === '{' && fnName) { label = fnName; fnName = null; }
        frames.push({ open: t.v, label, index: 0 });
        pending = null;
      } else if ('}])'.includes(t.v)) {
        popped = frames.pop()?.label ?? null;
        if (skip >= 0 && t.v === '}' && frames.length === skip) skip = -2; // interface body closed
        pending = null;
      } else if (t.v === ',') {
        const f = frames[frames.length - 1];
        if (f?.open === '[') f.index++;
        pending = null;
      } else if (t.v === ';') {
        pending = null;
        decl = null;
        if (skip >= 0 && frames.length === skip) skip = -1;
      }
      if (skip === -2) skip = -1;
      continue;
    }
    if ((t.t === 'str' || t.t === 'tmpl') && skip < 0) {
      if (t.t === 'str' && isKey) { pending = t.v; continue; }
      const parts = [];
      for (const f of frames) {
        if (f.label) parts.push(f.label);
        if (f.open === '[') parts.push(`[${f.index}]`);
      }
      if (pending) parts.push(pending);
      out.push({
        text: t.v,
        line: t.line,
        path: parts.join('.').replace(/\.\[/g, '['),
        before: [toks[k - 2]?.v, prev?.v].join(' '),
        after: next?.v,
      });
      pending = null;
    }
  }
  return out;
}

// ---------------------------------------------------------------- what counts as player-facing
// Literals under these keys, or passed to these calls, are code (ids, styles, DOM
// lookups, logs), not copy.
const CODE_KEYS = /^(id|ids|kind|type|style|font|family|fonts|icon|bg|fg|accent|color|colors|tint|arch|zones?|class|className|key|mode|map|url|src|href|layer|tile|tiles|sfx|sound|anchor|align|baseline|dir|shape|material|brand|archetype|role|cause|source|target|tool|state|status|action|variant|preset|quality|unit|units|format|ease|axis|side|slot|group|category|tag|tags|stat|metric|season|weather|flag|flags|cursor|display|position|overflow|pointerEvents|transform|filter|width|height|margin|padding|border|background|opacity|fontSize|fontWeight|fontFamily|textAlign|whiteSpace|zIndex|transition|animation|inset|top|left|right|bottom|gap|lang|lean|vices|body|outfit|hair|hat|prop|face|fam)$/;
const CODE_CALLS = /^(log|warn|error|info|debug|assert|trace|crumb|Error|TypeError|RangeError|querySelector|querySelectorAll|getElementById|getElementsByClassName|addEventListener|removeEventListener|dispatchEvent|createElement|createElementNS|setAttribute|getAttribute|removeAttribute|hasAttribute|getItem|setItem|removeItem|add|remove|toggle|contains|replace|replaceAll|split|join|startsWith|endsWith|includes|indexOf|match|matchAll|test|padStart|padEnd|getContext|fetch|import|require|T|hasTile|defTile|tileNames|play|emit|on|off|once|has|get|set|delete|define|mark|measure|getPropertyValue|setProperty|toLocaleString|localeCompare|Symbol|RegExp|matchMedia|postMessage|pick|brandById|FontFace|rngFor|strSeed|Euler)\(\)$/;
const FONTS = new Set(['Bungee', 'Anton', 'Titan One', 'Permanent Marker', 'Yellowtail', 'Overpass', 'Georgia', 'Arial', 'Helvetica', 'Impact', 'Inter']);

/** Returns the audit text for a literal, or null when it is code rather than copy. */
function copyText(lit) {
  let s = lit.text;
  if (/#ifdef|#include|\b(uniform|varying|attribute)\s|void main|gl_Position|\bvec[234]\(/.test(s)) return null; // GLSL
  if (/<\/?[a-z][\w-]*[\s>\/]/i.test(s)) s = s.replace(/<[^>]*>/g, ' '); // HTML in UI strings: keep the words
  s = s.replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&#39;/g, (m) => ({ '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" })[m]);
  s = s.replace(/\s+/g, ' ').trim();
  const bare = s.replace(/\{…\}|\{\w+\}/g, ' ').trim(); // without placeholders
  const letters = (bare.match(/\p{L}/gu) || []).length;
  if (letters < 3 || (letters < 4 && !/\s/.test(bare))) return null; // numbers, symbols, placeholders, "Jan"
  const segs = lit.path.split('.');
  if (CODE_KEYS.test(segs[segs.length - 1].replace(/\[\d+\]/g, ''))) return null;
  if (CODE_CALLS.test(segs[segs.length - 1])) return null;
  const before = lit.before.split(' ');
  if (['import', 'from', 'case'].includes(before[1]) || before.join('') === '==' || before.join('') === '!=' || lit.after === 'in') return null; // x === 'id'
  if (FONTS.has(s) || /(^|,)\s*(sans-serif|serif|cursive|monospace|system-ui)\s*$/.test(s)) return null; // font stacks
  if (/\b\d+(px|em|rem|vh|vw|ms|deg)\b|rgba?\(|hsla?\(|var\(--|calc\(|url\(|^\((pointer|hover|prefers|min-|max-)/.test(s)) return null; // CSS, media queries
  const id = s.replace(/\{…\}|\{\w+\}/g, '');
  if (/^[\w$./:@#?&=%+|-]*$/.test(id) && !/^[A-Z]/.test(id) && !/[?!]$/.test(id)) return null; // ids, paths, keys ("ambient-{…}")
  if (/^[a-z][\w-]*( [a-z][\w-]*)+$/.test(s) && /-/.test(s) && !/\s(the|a|of|to|and|is|in|on)\s/.test(` ${s} `)) return null; // class lists like "xpost big-card"
  if (/^[\w-]+\s*:\s*[^;]+;/.test(s) || (/;/.test(s) && /=/.test(s))) return null; // inline CSS, code snippets
  return s;
}

// Files that aren't shown to players: dev pages, type declarations, and the bug
// reporter's diagnostics (device, GPU, error text).
// (feedTags.ts and nameTags.ts are generated by the Jev tagging scripts and only
// repeat, as keys, lines and names that are audited where they're written)
const SKIP = [/^dev[\\/]/, /\.d\.ts$/, /^ui[\\/]bugreport\.ts$/, /^content[\\/]feedTags\.ts$/, /^roads[\\/]nameTags\.ts$/];

function walk(dir, out = []) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (/\.ts$/.test(f)) out.push(p);
  }
  return out;
}

/**
 * Player-facing copy, deduplicated by text: [{ text, where: [{file, line, path, group}] }].
 * Lines judged on their own lose their meaning ("Down 94%. Still early." reads as
 * cruel without "Crypto Bro"), so the pieces of one record (a billboard, brand,
 * character card, service or policy: `NAME[i].field`) and the lines of one sign
 * drawn by the same call (`linesFit()[0..2]`) are joined with " / " and judged together.
 */
function collectCopy() {
  const byText = new Map();
  const add = (text, where) => {
    const item = byText.get(text);
    if (item) item.where.push(where);
    else byText.set(text, { text, where: [where] });
  };
  for (const file of walk(SRC)) {
    const rel = path.relative(SRC, file);
    if (SKIP.some((re) => re.test(rel))) continue;
    const src = `src/${rel.replace(/\\/g, '/')}`;
    const groups = new Map();
    for (const lit of literals(fs.readFileSync(file, 'utf8'))) {
      const text = copyText(lit);
      if (!text) continue;
      const record = lit.path.match(/^([A-Za-z_$][\w$]*(?:\.[\w$]+)*\[\d+\])\./)?.[1];
      const sign = /\(\)\[\d+\]$/.test(lit.path) ? `${lit.line}:${lit.path.replace(/\[\d+\]$/, '')}` : null;
      const key = record ?? sign ?? `single:${groups.size}`;
      if (!groups.has(key)) groups.set(key, { path: record ?? lit.path, parts: [] });
      const g = groups.get(key);
      if (!g.parts.some((p) => p.text === text)) g.parts.push({ text, line: lit.line, path: lit.path });
    }
    for (const g of groups.values()) {
      // a billboard's summary label repeats its headline lines: keep the fuller one
      const low = g.parts.map((p) => p.text.toLowerCase());
      g.parts = g.parts.filter((p, i) => !low.some((o, j) => j !== i && o.length > low[i].length && o.includes(low[i])));
      const joined = g.parts.map((p) => p.text).join(' / ');
      if (g.parts.length > 1 && joined.length <= 700) add(joined, { file: src, line: g.parts[0].line, path: g.path, group: true });
      else for (const p of g.parts) add(p.text, { file: src, line: p.line, path: p.path });
    }
  }
  return [...byText.values()];
}

// Where a line shows up, in words Jev can use as context (first match wins).
const SURFACES = [
  [/^src\/content\/feed\.ts$/, 'feed', 'a post in the in-game X feed'],
  [/^src\/agents\/(people|communes)\.ts$/, 'cast', 'a card describing a resident (name, handle or bio) or a hippie commune'],
  [/^src\/art\/brands\.ts$/, 'brands', 'a parody chain or SLOP brand (name, sign, tagline or blurb)'],
  [/^src\/(art|buildings)\/billboards?\.ts$/, 'billboards', 'a roadside billboard'],
  [/^src\/(art\/(facades|signs|landmarkArt|icons)|buildings\/|roads\/streetDetails|agents\/models\/)/, 'signs', 'text painted on a building, landmark, sign or vehicle'],
  [/^src\/(art\/(names|communeNames)|roads\/names|sim\/districts|transit\/system)\.ts$/, 'names', 'a generated name (street, apartment, commune, district or bus route)'],
  [/./, 'ui', 'game interface text (menus, tooltips, messages, policies, services)'],
];
const surfaceOf = (file) => SURFACES.find(([re]) => re.test(file));
const words = (id) => id.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();

function contextOf(w) {
  const [, , where] = surfaceOf(w.file);
  if (w.file.endsWith('content/feed.ts')) {
    const event = w.path.match(/^templates\.(\w+)/);
    if (event) return `${where}, posted right after this happens in the game: ${words(event[1])}`;
    if (/^replies/.test(w.path)) return 'a reply under a post in the in-game X feed';
    if (/^notes/.test(w.path)) return 'a Community Notes-style fact check under a post in the in-game X feed';
    if (/^parodyFigures/.test(w.path)) return 'the account (name / handle) of a parody public figure in the in-game X feed';
    if (/^organizations/.test(w.path)) return 'the account (name / handle) of an organization in the in-game X feed';
    if (/^wrappers/.test(w.path)) return 'a prefix added to the start of feed posts';
  }
  if (w.group) return `${where}; its separate pieces of text are joined with " / "`;
  const field = w.path.split('.').pop()?.replace(/\[\d+\]/g, '');
  return field && /^[a-z]\w*$/i.test(field) ? `${where} (field: ${words(field)})` : where;
}

// ---------------------------------------------------------------- the questions (assessment)
// Each question is one narrow judgment; Jev answers them all in parallel over the
// same state, so a line costs one request. Changing a question re-judges every line.
const GAME = 'Slopmerica, a satirical city-builder about car-dependent sprawl. Its humor is raunchy on purpose and mocks corporations, internet culture and both political tribes.';
const OWNED = "SLOP, Slop-branded products and Imagine Supply Co. (imaginesupply.co) belong to the game's creator and never count.";

const COPY_QUESTIONS = {
  slur: {
    type: 'noul',
    instructions: 'Does `text` contain a slur: a derogatory word for people based on race, ethnicity, nationality, religion, disability, sexual orientation or gender identity?',
    criteria: { true: 'A slur appears, even casually, partly censored, misspelled or inside a pun.', false: 'No slur. Profanity, insults about behavior, labels such as boomer, bro, hippie, woke or reply guy, and ordinary words that only contain or resemble a slur (color words, puns on brand names) are not slurs.' },
  },
  mocks_race: {
    type: 'noul',
    instructions: 'Is `text` a joke at the expense of people because of their race or ethnicity?',
    criteria: { true: 'The punchline relies on a racial or ethnic stereotype, or mocks people for their race or ethnicity.', false: 'Race and ethnicity are not the target: the joke is about behavior, businesses, politics, places or internet culture. Color words describing colors, screens or brand names do not count.' },
  },
  mocks_religion: {
    type: 'noul',
    instructions: 'Is `text` a joke at the expense of religious believers or of a religious faith itself?',
    criteria: { true: "Mocks people for holding a faith, or ridicules a religion's beliefs, sacred figures or practices.", false: 'No religion, or religious words or imagery appear but the target is something else: commercialism, marketing, parking, politicians, or internet and AI culture.' },
  },
  mocks_disability: {
    type: 'noul',
    instructions: 'Is `text` a joke at the expense of people with a disability, illness or mental-health condition?',
    criteria: { true: 'Mocks people for a physical, intellectual or mental disability, an illness or neurodivergence, or uses a condition as an insult.', false: "No condition is the butt of the joke. Satire of health care, wait times or wellness fads, glitches in AI-generated images (extra fingers, wrong anatomy), plain statements that residents are sick or injured, and puns on a condition's name do not count." },
  },
  mocks_sexuality: {
    type: 'noul',
    instructions: 'Is `text` a joke at the expense of people because of their sexual orientation or gender identity?',
    criteria: { true: 'Mocks gay, lesbian, bisexual, transgender or nonbinary people, or treats an orientation or gender identity as the punchline.', false: 'Orientation and gender identity are not the target. Innuendo and dating jokes do not count.' },
  },
  explicit_sexual: {
    type: 'noul',
    instructions: 'Does `text` contain explicit sexual content?',
    criteria: { true: 'Graphically describes sex acts or genitals, or is pornographic.', false: 'No sexual content, or only innuendo, double entendres, suggestive names or spam-bot parody.' },
  },
  public_figure: {
    type: 'score',
    instructions: 'How directly does `text` name a real, living public figure (a politician, celebrity, CEO or influencer)?',
    criteria: [
      'No real public figure: only fictional characters, generic first names, job titles, historical names, or places and buildings named after someone.',
      'Obvious parody: a real, living public figure is referred to only through a clearly altered joke name, such as a pun on their name.',
      "Thin disguise: a real, living public figure's name with only a letter, a sound or one word changed, so it reads as the real name at a glance.",
      'Real name: a real, living public figure is named by their actual name or a well-known real nickname.',
    ],
  },
  real_brand: {
    type: 'noul',
    instructions: 'Does `text` use the actual name of a real company, product, app or website?',
    criteria: { true: 'A real business or product is named exactly as it is really called, such as a real soda, app, car model or website.', false: `Only fictional or parody names (altered spellings or puns on real brands) or generic nouns. ${OWNED}` },
  },
  punches_down: {
    type: 'noul',
    instructions: 'Is the butt of the joke in `text` a vulnerable person or group?',
    criteria: { true: 'Mocks people for being poor, homeless, addicted, sick, injured, a crime victim or otherwise vulnerable.', false: "Targets corporations, developers, politicians, government, ideologies, online behavior, car culture or harmless everyday habits, or is not a joke (status messages about residents' health or money are not jokes). Mocking a business that preys on people targets the business." },
  },
  political_target: {
    type: 'choice',
    instructions: 'Which political side, if any, does `text` poke fun at?',
    criteria: {
      right: 'Conservative or right-coded people, causes, slogans or memes.',
      left: 'Progressive or left-coded people, causes, slogans or memes.',
      both: 'Both the left and the right in the same line.',
      neither: 'Neither side: corporations, traffic, bureaucracy, weather or the internet in general, or it is not a joke.',
    },
  },
  offense: {
    type: 'score',
    instructions: 'How much offense would `text` cause a player who chose an edgy satirical game and expects raunchy jokes and mockery of both political sides?',
    criteria: [
      'None: harmless or plainly descriptive; nobody would object.',
      'Edgy but expected: innuendo, drinking, drugs, crash humor or sharp political mockery of the kind fans of edgy satire enjoy.',
      'Crosses a line for many players: cruel toward real victims, demeaning toward a group of people, or shock humor likely to draw complaints.',
      'Unacceptable: hateful, sexually explicit, or likely to get the game pulled from a store.',
    ],
  },
};

// Parody chains only: the SLOP / Imagine Supply Co. lines are owned, not parodies.
const BRAND_QUESTIONS = {
  name_closeness: {
    type: 'score',
    instructions: 'How close is `brand.name` to the name of a real company or brand?',
    criteria: [
      'Original: the name does not call any real company or brand to mind.',
      'Loose nod: the name faintly hints at a real brand, but most people would not connect them.',
      'Clear parody: an obvious joke version of a real brand, changed enough that nobody would think it is the real one.',
      'Near copy: reads as a real brand at a glance, with only a letter, a sound or one word changed.',
      'Identical: exactly the name of a real company or brand.',
    ],
  },
  confusable: {
    type: 'noul',
    instructions: "Would a shopper glancing at this storefront (`brand.sign_text` in `brand.sign_colors`, with `brand.tagline`) likely mistake it for one specific real chain's sign?",
    criteria: { true: 'Name, colors and slogan together closely imitate one specific real chain.', false: 'It reads as its own business, or as an obvious joke version of a chain.' },
  },
};

// One slogan question per field: asked about all three at once, Jev caught fewer
// real slogans. Its memory of specific slogans is patchy either way (it knows
// "have it your way", not "for life out here"), so a low answer is not a clearance.
const SLOGAN_FIELDS = ['tagline', 'sign_subtitle', 'blurb'];
const sloganQuestion = (field) => ({
  type: 'noul',
  instructions: `Is \`brand.${field}\` a real company's advertising slogan, word for word or with only one or two words changed?`,
  criteria: { true: 'A real company has used this slogan, or it is that slogan with one or two words swapped for a joke.', false: 'An original line, or it only nods at a real slogan with clearly different wording.' },
});
const brandQuestions = (state) => ({
  ...BRAND_QUESTIONS,
  ...Object.fromEntries(SLOGAN_FIELDS.filter((f) => state.brand[f]).map((f) => [`slogan_${f}`, sloganQuestion(f)])),
});

// ---------------------------------------------------------------- policy (what to do with the answers)
// Assessment and policy are kept apart (the TypeSafe guardrails pattern): change a
// threshold here and the report updates from the cached answers with no API calls.
// Tuned on this repo's copy (September 2026): review thresholds sit just above the
// noise floor of lines a person read and found fine. Retune when the copy changes a lot.
const probOf = (a, levels) => levels.reduce((s, l) => s + (a?.probabilities?.[l] ?? 0), 0);
const COPY_RULES = [
  // hard rules from docs/WORKSTREAMS.md: `block` fails the audit, `review` lists the line for a person
  { label: 'Slur', p: (a) => a.slur, block: 0.7, review: 0.5 },
  { label: 'Joke aimed at race or ethnicity', p: (a) => a.mocks_race, block: 0.7, review: 0.4 },
  { label: 'Joke aimed at religion or believers', p: (a) => a.mocks_religion, block: 0.7, review: 0.35 },
  { label: 'Joke aimed at disability or illness', p: (a) => a.mocks_disability, block: 0.7, review: 0.4 },
  { label: 'Joke aimed at sexuality or gender identity', p: (a) => a.mocks_sexuality, block: 0.7, review: 0.45 },
  { label: 'Explicit sexual content', p: (a) => a.explicit_sexual, block: 0.7, review: 0.4 },
  { label: 'Real public figure by name', p: (a) => probOf(a.public_figure, ['3']), block: 0.6, review: 0.35 },
  { label: 'Public figure thinly disguised', p: (a) => probOf(a.public_figure, ['2']), review: 0.5 },
  { label: 'Could get the game pulled', p: (a) => probOf(a.offense, ['3']), block: 0.7, review: 0.3 },
  // softer guidance: review only
  { label: 'Likely to draw complaints', p: (a) => probOf(a.offense, ['2', '3']), review: 0.4 },
  { label: 'Punches down', p: (a) => a.punches_down, review: 0.6 },
  { label: 'Names a real brand (parody preferred)', p: (a) => a.real_brand, review: 0.6 },
];
const BRAND_RULES = [
  { label: 'Name near-copies a real brand', short: 'near-copy name', p: (a) => probOf(a.name_closeness, ['3', '4']), review: 0.4 },
  { label: 'Reuses a real slogan', short: 'real slogan', p: (a) => Math.max(0, ...SLOGAN_FIELDS.map((f) => a[`slogan_${f}`] ?? 0)), review: 0.4 },
  { label: 'Sign could pass for the real chain', short: 'look-alike sign', p: (a) => a.confusable, review: 0.5 },
];

/** [{ label, p, level: 'block' | 'review' }] for the rules an item trips. */
function findings(rules, answers) {
  if (!answers) return [];
  const out = [];
  for (const r of rules) {
    const p = r.p(answers);
    if (p == null || !Number.isFinite(p)) continue;
    if (r.block != null && p >= r.block) out.push({ label: r.label, p, level: 'block' });
    else if (r.review != null && p >= r.review) out.push({ label: r.label, p, level: 'review' });
  }
  return out;
}

// ---------------------------------------------------------------- items
// Colors go to Jev as words: it reads hex codes poorly (TypeSafe known issues).
const COLOR_NAMES = {
  black: '#111111', charcoal: '#3a3a3a', grey: '#8a8a8a', 'light grey': '#d0d0d0', white: '#ffffff', cream: '#f2e8cf',
  red: '#d62828', 'dark red': '#7a1f1f', pink: '#ff99c8', 'hot pink': '#ff2bd6', orange: '#ff6b00', 'golden yellow': '#ffc220',
  yellow: '#ffe600', brown: '#6b3a1f', tan: '#c9a27a', 'lime green': '#b2ff59', green: '#2e7d32', 'dark green': '#0b5d3b',
  olive: '#5a6b2a', teal: '#12a39a', cyan: '#25f4ee', 'light blue': '#4cc9f0', blue: '#0071ce', 'royal blue': '#1d3a8a',
  navy: '#0b1a33', purple: '#6a1b9a', lavender: '#b388ff',
};
function colorName(hex) {
  const rgb = (h) => { const n = parseInt(h.slice(1).padEnd(6, h.slice(-1)), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  const [r, g, b] = rgb(hex);
  let best = hex;
  let bestD = Infinity;
  for (const [name, h] of Object.entries(COLOR_NAMES)) {
    const [r2, g2, b2] = rgb(h);
    const d = 2 * (r - r2) ** 2 + 4 * (g - g2) ** 2 + 3 * (b - b2) ** 2;
    if (d < bestD) { bestD = d; best = name; }
  }
  return best;
}

async function loadBrands() {
  const file = path.join(SRC, 'art', 'brands.ts');
  const emit = process.emitWarning;
  process.emitWarning = (w, ...rest) => (/type stripping/i.test(String(w)) ? undefined : emit.call(process, w, ...rest));
  const { BRANDS } = await import(pathToFileURL(file).href); // Node strips the TS types
  process.emitWarning = emit;
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  return BRANDS.map((b) => ({ ...b, line: lines.findIndex((l) => l.includes(`id: '${b.id}'`)) + 1 }));
}

function brandState(b) {
  const brand = { name: b.name, sign_text: b.sign?.text ?? b.name };
  if (b.tagline) brand.tagline = b.tagline;
  if (b.sign?.sub && b.sign.sub !== b.tagline) brand.sign_subtitle = b.sign.sub;
  if (b.blurb) brand.blurb = b.blurb;
  brand.business = words(b.kind);
  brand.sign_colors = [...new Set([b.sign?.bg, b.sign?.fg, ...(b.colors ?? [])].filter(Boolean).map(colorName))].join(', ');
  return { game: GAME, brand };
}

function copyState(item) {
  const state = { game: GAME, where: item.context, text: item.text };
  if (/\{(…|\w+)\}/.test(item.text)) state.placeholders = 'Words in {braces} are filled in by the game with a road, brand, building, city, commune, amount or count.';
  return state;
}

// An answer is reused only while both the item and the questions asked about it are unchanged.
const keyOf = (questions, state) => createHash('sha256').update(JSON.stringify([questions, state])).digest('hex').slice(0, 16);

// ---------------------------------------------------------------- judgments cache (docs/content-audit.json)
const CACHE = path.join(ROOT, 'docs', 'content-audit.json');

function loadCache() {
  try { return JSON.parse(fs.readFileSync(CACHE, 'utf8')); } catch { return { judgments: {} }; }
}

function saveCache(cache, keep) {
  const entries = Object.entries(cache.judgments).filter(([k]) => !keep || keep.has(k)).sort(([a], [b]) => a.localeCompare(b));
  // one judgment per line keeps git diffs to the lines that changed
  const body = entries.map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n');
  fs.writeFileSync(CACHE, `{\n  "about": "TypeSafe answers for scripts/contentaudit.mjs, keyed by question set + line. Regenerate with node scripts/contentaudit.mjs.",\n  "model": ${JSON.stringify(cache.model ?? null)},\n  "judgments": {\n${body}\n  }\n}\n`);
}

/**
 * Keeps what the policy needs from each answer: a noul becomes its probability, a
 * choice or score keeps its pick and the probabilities that round above zero.
 */
function compact(answers) {
  const r2 = (x) => Math.round(x * 100) / 100;
  const out = {};
  for (const [id, a] of Object.entries(answers)) {
    if (a.type === 'noul') { out[id] = r2(a.noul); continue; }
    const probabilities = Object.fromEntries(Object.entries(a.probabilities).map(([k, v]) => [k, r2(v)]).filter(([, v]) => v > 0));
    out[id] = a.type === 'choice' ? { choice: a.choice, probabilities } : { score: r2(a.score), probabilities };
  }
  return out;
}

// ---------------------------------------------------------------- main
const copy = collectCopy();
if (flag('inventory')) {
  const perFile = new Map();
  for (const c of copy) for (const w of c.where.slice(0, 1)) perFile.set(w.file, [...(perFile.get(w.file) ?? []), c]);
  const rows = [...perFile.entries()].sort((a, b) => b[1].length - a[1].length);
  const sample = Number(opt('sample') ?? 4);
  const only = opt('only');
  for (const [file, items] of rows) {
    if (only && !file.includes(only)) continue;
    console.log(`${String(items.length).padStart(5)}  ${file}`);
    for (const it of items.slice(0, only ? items.length : sample)) console.log(`         ${it.where[0].line}: [${it.where[0].path}] ${JSON.stringify(it.text).slice(0, 140)}`);
  }
  console.log(`${String(copy.length).padStart(5)}  distinct lines in ${rows.length} files`);
  process.exit(0);
}

const only = opt('only')?.toLowerCase();
const brands = await loadBrands().catch((err) => {
  console.log(`WARN brand IP check skipped: couldn't load src/art/brands.ts (${err.message.split('\n')[0]}). Node 22.18+ reads .ts files directly.`);
  return [];
});
const items = [
  ...copy.map((c) => {
    const item = { kind: 'copy', text: c.text, where: c.where, surface: surfaceOf(c.where[0].file)[1], context: contextOf(c.where[0]) };
    return { ...item, state: copyState(item) };
  }),
  ...brands.filter((b) => !b.merch).map((b) => ({
    kind: 'brand', text: b.name, where: [{ file: 'src/art/brands.ts', line: b.line, path: `BRANDS.${b.id}` }], surface: 'brands', state: brandState(b),
  })),
].filter((it) => !only || it.where.some((w) => w.file.toLowerCase().includes(only)) || it.text.toLowerCase().includes(only));
const questionsFor = (it) => (it.kind === 'brand' ? brandQuestions(it.state) : COPY_QUESTIONS);
for (const it of items) it.key = keyOf(questionsFor(it), it.state);
const loc = (it) => `${it.where[0].file}:${it.where[0].line}`;

const cache = loadCache();
const todo = items.filter((it) => !cache.judgments[it.key]);
const nLines = items.filter((it) => it.kind === 'copy').length;
const nBrands = items.length - nLines;

if (flag('dry-run')) {
  console.log(`${nLines} lines and ${nBrands} parody brands; ${todo.length} not judged yet (would cost ${todo.length} requests)`);
  for (const kind of ['copy', 'brand']) {
    const it = todo.find((i) => i.kind === kind) ?? items.find((i) => i.kind === kind);
    if (it) console.log(`\n--- sample ${kind} request (${loc(it)})\n${JSON.stringify({ model: MODEL, state: it.state, questions: questionsFor(it) }, null, 2)}`);
  }
  process.exit(0);
}

// ---- judge whatever isn't in the cache yet
const failed = [];
let tokens = 0;
let judged = 0;
const key = apiKey();
if (todo.length && key) {
  console.log(`Asking Jev about ${todo.length} new or changed item(s)…`);
  let rejected = false;
  await mapPool(todo, Number(opt('concurrency') ?? 8), async (it) => { // Jev allows 1,200 requests/min; 429s back off
    if (rejected) return;
    try {
      const res = await systemOne(it.state, questionsFor(it), { key });
      cache.model = res.model;
      cache.judgments[it.key] = { kind: it.kind, text: it.text, answers: compact(res.answers) };
      tokens += res.usage?.input_tokens ?? 0;
      if (++judged % 250 === 0) { console.log(`  ${judged}/${todo.length}`); saveCache(cache); }
    } catch (err) {
      if (err.status === 401) rejected = true;
      failed.push({ it, err });
    }
  });
  if (rejected) console.log('FAIL TypeSafe rejected the API key (401): check TYPESAFE_API_KEY in .env.local');
  for (const { it, err } of failed.filter((f) => f.err.status !== 401).slice(0, 5)) console.log(`FAIL ${loc(it)}: ${err instanceof TypeSafeError ? err.message : err}`);
}
saveCache(cache, only ? null : new Set(items.map((it) => it.key))); // a full run drops answers for lines that no longer exist

// ---- apply the policy
const done = items.filter((it) => cache.judgments[it.key]);
const pending = items.filter((it) => !cache.judgments[it.key]);
for (const it of done) {
  it.answers = cache.judgments[it.key].answers;
  it.findings = findings(it.kind === 'brand' ? BRAND_RULES : COPY_RULES, it.answers).sort((a, b) => b.p - a.p);
}
const blocked = done.filter((it) => it.findings.some((f) => f.level === 'block'));
const review = done.filter((it) => it.kind === 'copy' && it.findings.length && !blocked.includes(it)).sort((a, b) => b.findings[0].p - a.findings[0].p);
const brandsDone = done.filter((it) => it.kind === 'brand');
const brandFlags = brandsDone.filter((it) => it.findings.length);
const why = (it) => it.findings.map((f) => `${f.label} ${Math.round(f.p * 100)}%`).join('; ');

const cost = tokens ? ` (${tokens.toLocaleString('en-US')} tokens, about $${((tokens / 1e6) * 0.042).toFixed(3)})` : '';
console.log(`${blocked.length ? 'FAIL' : 'OK  '} ${done.length} of ${items.length} items judged; ${judged} asked now${cost}, the rest from docs/content-audit.json`);
for (const it of blocked) console.log(`FAIL ${loc(it)}  ${JSON.stringify(it.text)}  ${why(it)}`);
console.log(`     ${review.length} line(s) to review, ${brandFlags.length} parody brand(s) to check`);
if (only) for (const it of [...review, ...brandFlags]) console.log(`     ${loc(it)}  ${JSON.stringify(it.text).slice(0, 110)}  ${why(it)}`);
if (pending.length) console.log(`WARN ${pending.length} item(s) not judged: ${key ? 'API errors above' : 'no TypeSafe key; add TYPESAFE_API_KEY to .env.local'}`);
if (!only) {
  fs.writeFileSync(path.join(ROOT, 'docs', 'CONTENT_AUDIT.md'), report());
  console.log('     report: docs/CONTENT_AUDIT.md');
}
process.exit(blocked.length ? 1 : pending.length ? 2 : 0);

// ---------------------------------------------------------------- report
function report() {
  const md = (s) => String(s).replace(/([\\`*_<>|[\]])/g, '\\$1').replace(/\s+/g, ' ');
  const pct = (p) => `${Math.round(p * 100)}%`;
  const link = (w) => `[${w.file.replace(/^src\//, '')}:${w.line}](../${w.file}#L${w.line})`;
  const where = (it) => link(it.where[0]) + (it.where.length > 1 ? ` +${it.where.length - 1}` : '');
  const rows = (list) => list.map((it) => `| ${md(it.text)} | ${where(it)} | ${it.findings.map((f) => `${f.label} ${pct(f.p)}`).join('<br>')} |`).join('\n');
  const out = [];
  out.push('# Content audit', '');
  out.push(`Every player-facing line in \`src/\` checked against the content rules in [WORKSTREAMS.md](WORKSTREAMS.md) by TypeSafe's Jev (\`${cache.model ?? MODEL}\`), plus an IP check on the parody brands. Generated by \`node scripts/contentaudit.mjs\` on ${new Date().toISOString().slice(0, 10)}.`, '');
  const n = (x) => x.toLocaleString('en-US');
  out.push(`**${n(blocked.length)} blocked · ${n(review.length)} to review · ${brandFlags.length} of ${brandsDone.length} parody brands to check before a store release${pending.length ? ` · ${n(pending.length)} not judged yet` : ''}** (${n(nLines)} lines, ${nBrands} parody brands)`, '');
  out.push("Jev doesn't write opinions. It answers typed questions about each line: the probability that a rule is broken, a choice, a score. `COPY_RULES` and `BRAND_RULES` in the script turn those answers into *blocked* and *review*. Change a threshold and rerun, and the report re-sorts from the saved answers in `docs/content-audit.json` without new API calls. This is a screening tool, not legal advice: it points a person at the lines worth a second look.", '');
  if (pending.length) out.push(`> **${n(pending.length)} item(s) not judged yet** (new since the last run with a key). Add \`TYPESAFE_API_KEY\` to \`.env.local\` and rerun.`, '');
  if (!done.length) return out.join('\n');

  out.push('## Blocked', '');
  if (blocked.length) out.push('Lines that cross a hard rule. The audit exits 1 until they change.', '', '| Line | Where | Why |', '|---|---|---|', rows(blocked), '');
  else out.push('Nothing crosses a hard rule.', '');

  out.push('## To review', '');
  if (review.length) {
    out.push(`${n(review.length)} lines a person should read, grouped by their strongest signal. Most will be fine; that is the point of reading them. Pieces of one billboard, card or sign are joined with " / ".`, '');
    for (const rule of COPY_RULES) {
      const list = review.filter((it) => it.findings[0].label === rule.label);
      if (!list.length) continue;
      out.push(`### ${rule.label} (${list.length})`, '', '| Line | Where | Signal |', '|---|---|---|', rows(list), '');
    }
  } else out.push('Nothing to review.', '');

  out.push('## Parody brands', '');
  out.push("How close each parody chain sits to the real one it jokes about. SLOP / Imagine Supply Co. lines are skipped because they are owned. Bold means over the review threshold. **Near-copy name**: the chance the name reads as a real brand at a glance. **Real slogan**: the highest chance that the tagline, sign or blurb is a real slogan; Jev's memory of specific slogans is patchy (it knows \"have it your way\" but not \"for life out here\"), so a low number here is not a clearance. **Look-alike sign**: name, colors and slogan together imitate one real chain.", '');
  const brandRules = Object.fromEntries(BRAND_RULES.map((r) => [r.short, r]));
  const cell = (it, short) => { const r = brandRules[short]; const p = r.p(it.answers) ?? 0; return p >= r.review ? `**${pct(p)}**` : pct(p); };
  const risk = (it) => Math.max(...BRAND_RULES.map((r) => r.p(it.answers) ?? 0));
  out.push('| Brand | Near-copy name | Real slogan | Look-alike sign | Tagline |', '|---|---|---|---|---|');
  const byId = new Map(brands.map((b) => [b.id, b]));
  for (const it of [...brandsDone].sort((a, b) => risk(b) - risk(a))) {
    const b = byId.get(it.where[0].path.slice('BRANDS.'.length));
    out.push(`| ${md(it.text)} | ${cell(it, 'near-copy name')} | ${cell(it, 'real slogan')} | ${cell(it, 'look-alike sign')} | ${md(b?.tagline ?? '')} |`);
  }
  out.push('');

  out.push('## Who the jokes poke at', '');
  out.push("WORKSTREAMS asks for mockery of both political tribes. Jev's pick for each line, by where it appears:", '');
  out.push('| Where | Lines | Right | Left | Both | Neither |', '|---|---|---|---|---|---|');
  const copyDone = done.filter((it) => it.kind === 'copy');
  const tally = (list) => { const t = { right: 0, left: 0, both: 0, neither: 0 }; for (const it of list) t[it.answers.political_target?.choice ?? 'neither']++; return t; };
  for (const [, surface] of SURFACES) {
    const list = copyDone.filter((it) => it.surface === surface);
    if (!list.length) continue;
    const t = tally(list);
    out.push(`| ${surface} | ${list.length} | ${t.right} | ${t.left} | ${t.both} | ${t.neither} |`);
  }
  const all = tally(copyDone);
  out.push(`| **all** | ${copyDone.length} | ${all.right} | ${all.left} | ${all.both} | ${all.neither} |`, '');
  // calibration against labels we already have: each cast card carries its author's lean tag
  const cards = fs.readFileSync(path.join(SRC, 'agents', 'people.ts'), 'utf8').matchAll(/name: '([^']+)', handle: '([^']+)', bio: '((?:[^'\\]|\\.)+)', lean: '(left|right)'/g);
  let same = 0, opposite = 0, tagged = 0;
  for (const [, name, handle, bio, lean] of cards) {
    const it = copyDone.find((c) => c.text === `${name} / ${handle} / ${bio.replace(/\\'/g, "'")}`);
    if (!it) continue;
    tagged++;
    const pick = it.answers.political_target?.choice;
    if (pick === lean) same++;
    else if (pick === (lean === 'left' ? 'right' : 'left')) opposite++;
  }
  if (tagged) out.push(`Check against labels we already have: on the ${tagged} cast cards whose authors tagged them left or right, Jev picked the same side ${same} times and the opposite side ${opposite} times; the rest it called both or neither. Read the counts as clearly political jokes, not every joke with a lean.`, '');

  out.push('## Edgiest lines', '');
  out.push('The 15 lines Jev scores highest for offense (0 = harmless, 3 = could get the game pulled). Useful for tone, not a verdict.', '');
  out.push('| Score | Line | Where |', '|---|---|---|');
  for (const it of [...copyDone].sort((a, b) => (b.answers.offense?.score ?? 0) - (a.answers.offense?.score ?? 0)).slice(0, 15)) out.push(`| ${(it.answers.offense?.score ?? 0).toFixed(2)} | ${md(it.text)} | ${where(it)} |`);
  out.push('');

  out.push('## Rules and thresholds', '');
  out.push('| Rule | Blocks at | Review at |', '|---|---|---|');
  for (const r of [...COPY_RULES, ...BRAND_RULES]) out.push(`| ${r.label} | ${r.block != null ? pct(r.block) : '·'} | ${r.review != null ? pct(r.review) : '·'} |`);
  out.push('', 'Hard rules come from WORKSTREAMS.md: no slurs; no jokes aimed at race, religion-as-identity, disability or sexuality; no explicit sexual content; public figures only as obvious parody names. Parody brands are preferred over real ones. Thresholds are starting points: tune them against lines you have read yourself.', '');
  return out.join('\n');
}
