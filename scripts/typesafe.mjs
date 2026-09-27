// TypeSafe Jev ("System One") client for dev and build-time scripts. No
// dependencies. Jev answers typed questions about a `state` with numbers:
//   noul   { type: 'noul', instructions } or { type: 'noul', criteria: { true, false } }
//          -> { noul: p }                       probability the statement is true
//   choice { type: 'choice', instructions?, criteria: { key: description } }
//          -> { choice, confidence, probabilities: { key: p } }
//   score  { type: 'score', instructions?, criteria: [level0, level1, ...] }  (2 to 10 levels)
//          -> { score, confidence, probabilities: { '0': p, ... } }   score is the expected level
// The key comes from TYPESAFE_API_KEY or the gitignored .env.local and is never
// printed, logged or written. The game never calls Jev: scripts ship plain data
// (TS or JSON) that the game reads, and it behaves as before without it.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://api.typesafe.ai/v1/systemone';
export const MODEL = 'jev-latest';
/** dollars per million input tokens */
export const PRICE_PER_M_INPUT = 0.042;

let key;
/** the API key, or '' when there is none (never print it) */
export function apiKey() {
  if (key !== undefined) return key;
  key = process.env.TYPESAFE_API_KEY?.trim() ?? '';
  const env = resolve(ROOT, '.env.local');
  if (!key && existsSync(env)) {
    for (const line of readFileSync(env, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*TYPESAFE_API_KEY\s*=\s*"?([^"\s]+)"?\s*$/);
      if (m) key = m[1];
    }
  }
  return key;
}

/** running totals for this process, for the cost line every script prints */
export const usage = { requests: 0, input: 0, output: 0, retries: 0, cached: 0 };
export const cost = () => (usage.input / 1e6) * PRICE_PER_M_INPUT;
export const costLine = () =>
  `${usage.requests} request${usage.requests === 1 ? '' : 's'} (${usage.cached} cached), ${usage.input.toLocaleString('en-US')} input + ${usage.output.toLocaleString('en-US')} output tokens, ≈$${cost().toFixed(4)}${usage.retries ? `, ${usage.retries} retries` : ''}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Ask Jev every question in `questions` about `state` (a string or a JSON
 * object). Returns { answers, model, usage }. Retries rate limits, server
 * errors and dropped connections with backoff; a bad request throws at once.
 */
export async function systemOne(state, questions, { model = MODEL, tries = 6, timeoutMs = 60000 } = {}) {
  const k = apiKey();
  if (!k) throw new Error('No TypeSafe key: set TYPESAFE_API_KEY or add it to .env.local (or run with --dry-run)');
  const body = JSON.stringify({ model, state, questions });
  let wait = 1000;
  for (let attempt = 1; ; attempt++) {
    let res, text;
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), timeoutMs);
      res = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${k}` }, body, signal: ctl.signal });
      text = await res.text();
      clearTimeout(t);
    } catch (e) {
      if (attempt >= tries) throw new Error(`Jev request failed after ${attempt} tries: ${e.message}`);
      usage.retries++;
      await sleep(wait + Math.random() * 250);
      wait *= 2;
      continue;
    }
    if (res.ok) {
      const j = JSON.parse(text);
      usage.requests++;
      usage.input += j.usage?.input_tokens ?? 0;
      usage.output += j.usage?.output_tokens ?? 0;
      return { answers: j.answers, model: j.model, usage: j.usage };
    }
    if ((res.status === 429 || res.status >= 500) && attempt < tries) {
      usage.retries++;
      const after = Number(res.headers.get('retry-after'));
      await sleep(Number.isFinite(after) && after > 0 ? after * 1000 : wait + Math.random() * 250);
      wait *= 2;
      continue;
    }
    throw new Error(`Jev ${res.status}: ${text.slice(0, 400)}`);
  }
}

/** run fn over items with at most n in flight; results keep the input order */
export async function mapPool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

/**
 * A JSON file of raw answers keyed by a hash of (model, state, questions), so a
 * rerun only asks what changed and thresholds can move without an API call.
 */
export function answerCache(file) {
  const path = resolve(ROOT, file);
  const data = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
  const hash = (state, questions, model = MODEL) => createHash('sha256').update(JSON.stringify([model, state, questions])).digest('hex').slice(0, 24);
  return {
    has: (state, questions) => hash(state, questions) in data,
    get: (state, questions) => data[hash(state, questions)]?.answers,
    /** cached answers, or ask Jev and remember them */
    async ask(state, questions, opts) {
      const h = hash(state, questions);
      if (data[h]) { usage.cached++; return data[h].answers; }
      const r = await systemOne(state, questions, opts);
      data[h] = { answers: r.answers, model: r.model };
      return r.answers;
    },
    save() {
      mkdirSync(dirname(path), { recursive: true });
      const sorted = Object.fromEntries(Object.keys(data).sort().map((k) => [k, data[k]]));
      writeFileSync(path, JSON.stringify(sorted, null, 1) + '\n');
    },
    size: () => Object.keys(data).length,
  };
}

/** the most likely options of a choice answer, best first, down to `min` probability */
export function topChoices(answer, n = 3, min = 0.1) {
  return Object.entries(answer?.probabilities ?? {}).sort((a, b) => b[1] - a[1]).filter(([, p], i) => i === 0 || p >= min).slice(0, n);
}
