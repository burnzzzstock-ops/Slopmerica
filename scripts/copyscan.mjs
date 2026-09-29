// The copy scanner shared by the Jev content scripts: a small TypeScript
// tokenizer that finds every string and template literal in src/ with its line
// and a best-effort key path (BRANDS[12].tagline, templates.laneAdded[3]),
// decides which literals are player-facing copy rather than code, and keeps the
// pieces of one record (a billboard, brand, character card, service) or one sign
// together, because a line judged alone loses its meaning. Moved here from
// scripts/contentaudit.mjs when learnability.mjs and brandcheck.mjs needed it.
//
//   collectCopy()        player-facing copy, grouped and deduplicated (contentaudit)
//   literals(src)        every literal with its line, key path and neighbours (brandcheck)
//   tokenize(src)        tokens; a template's ${…} holes keep their source and inner tokens
//   fill(tok, toks)      a template's text with the strings inside its ${…} put back (brandcheck)
//   calls(toks, match)   the argument tokens of each matching call, e.g. toast(...) (learnability)
//   expr(toks, k)        the tokens of one value, e.g. after `reason:` (learnability)
//
// Run it directly for a self-check: node scripts/copyscan.mjs (no key, no API
// calls; --dry-run is accepted and changes nothing). Prints OK/FAIL lines and
// exits 1 on a failure.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SRC = path.join(ROOT, 'src');

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

export function tokenize(src) {
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
    const holes = []; // each ${…}: its source text and the tokens lexed from it (toks[from..to), marked .hole)
    i++;
    while (i < src.length && src[i] !== '`') {
      if (src[i] === '\\') { const [s, j] = unescape(src, i + 1); out += s; i = j; continue; }
      if (src[i] === '$' && src[i + 1] === '{') { i += 2; const at = i, from = toks.length; lex(true); for (let k = from; k < toks.length; k++) toks[k].hole = true; holes.push({ expr: src.slice(at, i - 1), from, to: toks.length }); out += '{…}'; continue; }
      if (src[i] === '\n') line++;
      out += src[i++];
    }
    i++;
    return { out, holes };
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
      if (c === '`') { const l = line; const { out, holes } = template(); toks.push({ t: 'tmpl', v: out, line: l, holes }); continue; }
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

/** Every string/template literal with its line, key path, neighbouring tokens and token (pass
 *  `toks` when you already have tokenize(src), so .tok is one of them). */
export function literals(src, toks = tokenize(src)) {
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
        tok: t,
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
export function copyText(lit) {
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
export const SKIP = [/^dev[\\/]/, /\.d\.ts$/, /^ui[\\/]bugreport\.ts$/, /^content[\\/]feedTags\.ts$/, /^roads[\\/]nameTags\.ts$/];

export function walk(dir, out = []) {
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
export function collectCopy() {
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


// ---------------------------------------------------------------- call sites
// For scripts that read a message where it's shown (toast(...), reason: ...)
// rather than as keyed data. Tokens inside a template's ${…} (marked .hole)
// belong to that template and never end a value.

/** The tokens of one value from toks[k], up to a depth-0 stop or an unbalanced closer: [tokens, endIndex]. */
export function expr(toks, k, stops = ',;') {
  const out = [];
  let depth = 0;
  for (; k < toks.length; k++) {
    const t = toks[k];
    if (t.t === 'p' && !t.hole) {
      if ('([{'.includes(t.v)) depth++;
      else if (')]}'.includes(t.v)) { if (depth === 0) break; depth--; }
      else if (depth === 0 && stops.includes(t.v)) break;
    }
    out.push(t);
  }
  return [out, k];
}

/** Calls whose name token passes match(token, previousToken): [{ name, line, k, args: [tokens[]] }]. */
export function calls(toks, match) {
  const out = [];
  for (let k = 0; k < toks.length - 1; k++) {
    const t = toks[k];
    if (t.t !== 'id' || toks[k + 1].t !== 'p' || toks[k + 1].v !== '(' || !match(t, toks[k - 1])) continue;
    const args = [];
    let j = k + 2;
    while (j < toks.length && !(toks[j].t === 'p' && toks[j].v === ')')) {
      const [a, end] = expr(toks, j, ',');
      args.push(a);
      if (toks[end]?.v !== ',') break;
      j = end + 1;
    }
    out.push({ name: t.v, line: t.line, k, args });
  }
  return out;
}

/** A template's text with each ${…} replaced by the strings inside it (" / " between them), or by `empty`. */
export function fill(tok, toks, empty = '{…}') {
  if (tok.t !== 'tmpl') return tok.v;
  let n = 0;
  return tok.v.replace(/\{…\}/g, () => {
    const h = tok.holes[n++];
    const run = toks.slice(h.from, h.to);
    const inner = new Set(run.flatMap((t) => (t.t === 'tmpl' ? t.holes.flatMap((g) => toks.slice(g.from, g.to)) : [])));
    const strs = run.filter((t) => (t.t === 'str' || t.t === 'tmpl') && !inner.has(t)).map((t) => fill(t, toks, empty)).filter((x) => /\p{L}/u.test(x));
    return strs.length ? strs.join(' / ') : empty;
  });
}

// ---------------------------------------------------------------- self-check
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  let bad = 0;
  const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra).slice(0, 300)); if (!ok) bad++; };
  const texts = (src) => literals(src).map((l) => l.text);

  check('a regex with a quote in it is not a string', JSON.stringify(texts("const r = /it's/g; say('fine');")) === '["fine"]', texts("const r = /it's/g; say('fine');"));
  check('escapes are decoded', texts("x('Built \\u2014 fast\\nnow')")[0] === 'Built — fast\nnow', texts("x('Built \\u2014 fast\\nnow')"));
  const toks = tokenize('toast(`Needs ${fmt(DEPOT_COST, 0)} to build ${ok ? `a ${n} bus` : \'nothing\'}`, true);');
  const tm = toks.find((t) => t.t === 'tmpl' && t.v.startsWith('Needs'));
  check('a template keeps its holes', tm?.v === 'Needs {…} to build {…}' && tm.holes[0].expr === 'fmt(DEPOT_COST, 0)' && tm.holes.length === 2, tm);
  check('fill() puts the words inside ${…} back', fill(tm, toks, '…') === 'Needs … to build a … bus / nothing', fill(tm, toks, '…'));
  const c = calls(toks, (t) => t.v === 'toast');
  check('call arguments split at depth-0 commas only (not inside ${…})', c.length === 1 && c[0].args.length === 2 && c[0].args[1][0].v === 'true', c.map((x) => x.args.map((a) => a.map((t) => t.v))));
  const paths = literals("const BRANDS = [{ name: 'Bullseye', tagline: 'Aim low' }, { name: 'Hoots' }];").map((l) => l.path);
  check('key paths name the record and field', paths.join() === 'BRANDS[0].name,BRANDS[0].tagline,BRANDS[1].name', paths);
  const rt = tokenize("return { ok: false, reason: a ? 'too steep' : `needs ${x}, sorry`, at: 1 };");
  const [v] = expr(rt, rt.findIndex((t) => t.v === 'reason') + 2);
  check('a value ends at its depth-0 comma', v.map((t) => t.v).join(' ') === 'a ? too steep : x needs {…}, sorry', v.map((t) => t.v));

  let files = 0, lits = 0, failed = [];
  for (const f of walk(SRC)) { try { lits += literals(fs.readFileSync(f, 'utf8')).length; files++; } catch (e) { failed.push(`${path.relative(ROOT, f)}: ${e.message}`); } }
  check(`every file in src/ scans (${files} files, ${lits.toLocaleString('en-US')} literals)`, failed.length === 0 && files > 100, failed);
  const copy = collectCopy();
  const grouped = copy.filter((x) => x.where.some((w) => w.group)).length;
  check(`player-facing copy found: ${copy.length.toLocaleString('en-US')} lines, ${grouped} of them joined records or signs`, copy.length > 2000 && grouped > 100, { lines: copy.length, grouped });
  process.exit(bad ? 1 : 0);
}
