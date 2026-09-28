// Minimal TypeSafe System One client for Node scripts (no npm dependency; Node 20+
// has fetch). Docs: https://docs.typesafe.ai/api. The key comes from
// TYPESAFE_API_KEY in the environment or in .env.local at the repo root, and it is
// only ever sent to the TypeSafe API: never printed, logged or written anywhere.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENDPOINT = `${process.env.TYPESAFE_BASE_URL || 'https://api.typesafe.ai'}/v1/systemone`;
export const MODEL = process.env.TYPESAFE_MODEL || 'jev-latest';

/** The API key, or '' when none is configured. */
export function apiKey() {
  const env = (process.env.TYPESAFE_API_KEY || '').trim();
  if (env) return env;
  try {
    const m = fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').match(/^[ \t]*TYPESAFE_API_KEY[ \t]*=[ \t]*["']?([^"'\s#]+)/m);
    return m ? m[1] : '';
  } catch {
    return '';
  }
}

export class TypeSafeError extends Error {
  constructor(status, detail) {
    const why = status === 401 ? 'the API key was rejected; check TYPESAFE_API_KEY in .env.local'
      : status === 422 ? `the request was invalid: ${detail}`
      : `HTTP ${status}: ${detail}`;
    super(`TypeSafe: ${why}`);
    this.status = status;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const backoff = (attempt) => Math.min(20_000, 500 * 2 ** attempt) * (0.75 + Math.random() * 0.5);

/**
 * One System One request: state plus a map of typed questions (noul / choice /
 * score). Returns { model, answers, usage }. Retries rate limits (429), overload
 * (529), other 5xx and network errors with backoff, honouring Retry-After.
 */
export async function systemOne(state, questions, { key = apiKey(), retries = 6, timeoutMs = 60_000 } = {}) {
  if (!key) throw new TypeSafeError(0, 'no API key: set TYPESAFE_API_KEY or put it in .env.local');
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ model: MODEL, state, questions }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (attempt < retries) { await sleep(backoff(attempt)); continue; }
      throw new TypeSafeError(0, `network error: ${err.message}`);
    }
    if (res.ok) return res.json();
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      const after = Number(res.headers.get('retry-after'));
      await sleep(after > 0 ? Math.min(after * 1000, 30_000) : backoff(attempt));
      continue;
    }
    throw new TypeSafeError(res.status, (await res.text().catch(() => '')).slice(0, 600));
  }
}

/** Runs fn over items with at most `limit` in flight; results keep input order. */
export async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
