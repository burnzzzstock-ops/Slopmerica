// Exact copies of simulation state as JSON, and back.
//
// A save has to bring back the same county, not a similar one, so what moves (every car, every person, every counter) is
// written whole. encode() walks any plain data (objects, arrays, Maps, Sets, typed arrays, numbers including NaN, Infinity
// and -0, undefined) and writes it so decode() rebuilds the same structure, sharing and cycles included. Things that live
// elsewhere and are rebuilt by their own system (a building, a road, another car) are not copied: a Refs object turns each
// into a name on the way out and back into the live object on the way in.
//
// It refuses what it cannot bring back exactly (a function, a class instance nobody named), saying where it found it:
// a field that quietly failed to save is how a reload changes the future.
//
// This file is plain data-in, data-out TypeScript with nothing but erasable types, so Node's test runner loads it as it is.

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export interface Refs {
  /** a live object that is not this snapshot's to copy -> [kind, id]; anything else -> undefined */
  out(o: object): [string, number | string] | undefined;
  /** [kind, id] -> the live object (or null when it no longer exists) */
  in(kind: string, id: number | string): unknown;
}

export interface EncodeOptions {
  /** leave a property out (it comes back missing): what is only drawn, caches that are rebuilt */
  skip?: (key: string, holder: object) => boolean;
}

const TYPED: Record<string, new (n: number) => ArrayLike<number> & { set(a: ArrayLike<number>): void }> = {
  Float64Array, Float32Array, Int32Array, Uint32Array, Int16Array, Uint16Array, Int8Array, Uint8Array, Uint8ClampedArray,
};
const NO_REFS: Refs = { out: () => undefined, in: () => null };
/** a typed array this long or longer is written as its bytes (base64): exact, and a fifth of the text */
const BYTES_FROM = 16;

/** the bytes of a typed array as base64 */
export function toBase64(a: ArrayBufferView): string {
  const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}
/** base64 back to bytes */
export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64), u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
}
const isPlain = (o: object) => { const p = Object.getPrototypeOf(o); return p === Object.prototype || p === null; };

/** `value` as JSON that decode() turns back into the same structure. */
export function encode(value: unknown, refs: Refs = NO_REFS, opts: EncodeOptions = {}): Json {
  const skip = opts.skip;
  // pass 1: which containers are reached more than once (shared or cyclic): those get a number
  const seen = new Map<object, number>();
  const count = (v: unknown) => {
    if (v === null || typeof v !== 'object') return;
    if (refs.out(v)) return;
    const n = seen.get(v);
    if (n !== undefined) { seen.set(v, n + 1); return; }
    seen.set(v, 1);
    if (ArrayBuffer.isView(v)) return;
    if (Array.isArray(v)) { for (const x of v) count(x); return; }
    if (v instanceof Map) { for (const [k, x] of v) { count(k); count(x); } return; }
    if (v instanceof Set) { for (const x of v) count(x); return; }
    for (const k of Object.keys(v)) if (!skip?.(k, v)) count((v as Record<string, unknown>)[k]);
  };
  count(value);
  const ids = new Map<object, number>();
  let nextId = 1;
  const path: string[] = [];
  const fail = (what: string): never => { throw new Error(`snapshot: ${what} at ${path.join('.') || '(root)'}`); };

  const num = (n: number): Json => (Number.isFinite(n) ? (Object.is(n, -0) ? { $n: '-0' } : n) : { $n: String(n) });
  const enc = (v: unknown): Json => {
    if (v === null) return null;
    switch (typeof v) {
      case 'number': return num(v);
      case 'string': case 'boolean': return v;
      case 'undefined': return { $u: 1 };
      case 'function': return fail('a function (give the thing a name and look it up on load)');
      case 'bigint': case 'symbol': return fail(`a ${typeof v}`);
    }
    const o = v as object;
    const r = refs.out(o);
    if (r) return { $r: [r[0], r[1]] };
    const had = ids.get(o);
    if (had !== undefined) return { $ref: had };
    const shared = (seen.get(o) ?? 0) > 1;
    let id = 0;
    if (shared) { id = nextId++; ids.set(o, id); }
    const wrap = (body: Json): Json => (shared ? { $def: [id, body] } : body);
    if (ArrayBuffer.isView(o)) {
      const name = o.constructor.name;
      if (!TYPED[name]) return fail(`a ${name}`);
      if ((o as unknown as ArrayLike<number>).length >= BYTES_FROM) return wrap({ $tb: [name, toBase64(o)] });
      return wrap({ $ta: [name, Array.from(o as unknown as ArrayLike<number>, num)] });
    }
    if (Array.isArray(o)) {
      // rows of like-shaped plain objects (cars, people): the keys once, then a row of values each
      const t = table(o);
      if (t) return wrap(t);
      return wrap(o.map((x, i) => { path.push(String(i)); const e = enc(x); path.pop(); return e; }));
    }
    if (o instanceof Map) return wrap({ $map: [...o].map(([k, x], i) => { path.push(`<map ${i}>`); const e: Json = [enc(k), enc(x)]; path.pop(); return e; }) });
    if (o instanceof Set) return wrap({ $set: [...o].map((x, i) => { path.push(`<set ${i}>`); const e = enc(x); path.pop(); return e; }) });
    if (!isPlain(o)) return fail(`a ${o.constructor?.name ?? 'class instance'} (name it in Refs, or skip the field)`);
    const out: { [k: string]: Json } = {};
    for (const k of Object.keys(o)) {
      if (skip?.(k, o)) continue;
      if (k[0] === '$') return fail(`a key starting with $ ("${k}")`);
      path.push(k);
      out[k] = enc((o as Record<string, unknown>)[k]);
      path.pop();
    }
    return wrap(out);
  };
  const table = (a: unknown[]): Json | null => {
    if (a.length < 4) return null;
    let keys: string[] | null = null;
    for (const x of a) {
      if (x === null || typeof x !== 'object' || Array.isArray(x) || !isPlain(x) || refs.out(x) || (seen.get(x) ?? 0) > 1) return null;
      const ks = Object.keys(x).filter((k) => !skip?.(k, x));
      if (!keys) { keys = ks; if (ks.some((k) => k[0] === '$')) return null; }
      else if (ks.length !== keys.length || ks.some((k, i) => k !== keys![i])) return null;
    }
    const ks = keys!;
    return { $t: [ks, a.map((x, i) => ks.map((k) => { path.push(`${i}.${k}`); const e = enc((x as Record<string, unknown>)[k]); path.pop(); return e; }))] };
  };
  return enc(value);
}

/** The structure encode() was given, rebuilt (references resolved through `refs`). */
export function decode<T = unknown>(json: Json, refs: Refs = NO_REFS): T {
  const byId = new Map<number, unknown>();
  const num = (j: Json): number => (typeof j === 'number' ? j : Number((j as { $n: string }).$n === '-0' ? -0 : (j as { $n: string }).$n));
  const dec = (j: Json, def?: number): unknown => {
    if (j === null || typeof j !== 'object') return j;
    if (Array.isArray(j)) {
      const a: unknown[] = [];
      if (def) byId.set(def, a);
      for (const x of j) a.push(dec(x));
      return a;
    }
    if ('$n' in j) return num(j);
    if ('$u' in j) return undefined;
    if ('$r' in j) { const [kind, id] = j.$r as [string, number | string]; return refs.in(kind, id); }
    if ('$ref' in j) { if (!byId.has(j.$ref as number)) throw new Error(`snapshot: reference ${j.$ref} before its definition`); return byId.get(j.$ref as number); }
    if ('$def' in j) { const [id, body] = j.$def as [number, Json]; return dec(body, id); }
    if ('$ta' in j) {
      const [name, vals] = j.$ta as [string, Json[]];
      const a = new TYPED[name](vals.length);
      a.set(vals.map(num));
      if (def) byId.set(def, a);
      return a;
    }
    if ('$tb' in j) {
      const [name, b64] = j.$tb as [string, string];
      const bytes = fromBase64(b64);
      const a = new (TYPED[name] as unknown as new (b: ArrayBufferLike) => ArrayBufferView)(bytes.buffer);
      if (def) byId.set(def, a);
      return a;
    }
    if ('$map' in j) {
      const m = new Map<unknown, unknown>();
      if (def) byId.set(def, m);
      for (const [k, x] of j.$map as [Json, Json][]) m.set(dec(k), dec(x));
      return m;
    }
    if ('$set' in j) {
      const s = new Set<unknown>();
      if (def) byId.set(def, s);
      for (const x of j.$set as Json[]) s.add(dec(x));
      return s;
    }
    if ('$t' in j) {
      const [keys, rows] = j.$t as [string[], Json[][]];
      const a: unknown[] = [];
      if (def) byId.set(def, a);
      for (const row of rows) { const o: Record<string, unknown> = {}; for (let i = 0; i < keys.length; i++) o[keys[i]] = dec(row[i]); a.push(o); }
      return a;
    }
    const o: Record<string, unknown> = {};
    if (def) byId.set(def, o);
    for (const k of Object.keys(j)) o[k] = dec((j as { [k: string]: Json })[k]);
    return o;
  };
  return dec(json) as T;
}

/** Some of an object's own fields as a snapshot (state a system keeps as plain fields on itself). */
export function encodeFields<T extends object>(obj: T, keys: readonly (keyof T & string)[], refs: Refs = NO_REFS, opts: EncodeOptions = {}): Json {
  const part: Record<string, unknown> = {};
  for (const k of keys) part[k] = obj[k];
  return encode(part, refs, opts);
}

/** Put fields saved by encodeFields() back on the object (fields the snapshot does not have are left alone: an older save). */
export function decodeFields<T extends object>(obj: T, json: Json | undefined, refs: Refs = NO_REFS) {
  if (json === undefined || json === null) return;
  const part = decode<Record<string, unknown>>(json, refs);
  for (const k of Object.keys(part)) (obj as Record<string, unknown>)[k] = part[k];
}

/** A fingerprint of any JSON value (FNV-1a over its text): equal state, equal hash. */
export function hashJson(j: Json): string {
  const s = JSON.stringify(j);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h.toString(16).padStart(8, '0');
}
