// node --test scripts/unit/   (no browser, no build: Node loads the TypeScript as it is)
// src/core/snapshot.ts: what is saved comes back the same structure, exactly.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decode, decodeFields, encode, encodeFields, hashJson } from '../../src/core/snapshot.ts';

const round = (v, refs, opts) => decode(JSON.parse(JSON.stringify(encode(v, refs, opts))), refs);

test('numbers come back exactly, the odd ones included', () => {
  const v = [0, -0, 1.1, 0.1 + 0.2, 1e-320, Number.MAX_VALUE, NaN, Infinity, -Infinity, 2 ** 53];
  const r = round(v);
  assert.equal(r.length, v.length);
  for (let i = 0; i < v.length; i++) assert.ok(Object.is(r[i], v[i]), `${v[i]} came back as ${r[i]}`);
});

test('undefined stays a property; null stays null', () => {
  const r = round({ a: undefined, b: null, c: [undefined, null] });
  assert.deepEqual(Object.keys(r), ['a', 'b', 'c']);
  assert.equal(r.a, undefined);
  assert.equal(r.b, null);
  assert.equal(r.c[0], undefined);
  assert.equal(r.c[1], null);
});

test('Maps, Sets and typed arrays keep their kind, their order and their values', () => {
  const v = { m: new Map([[3, 'c'], [1, 'a'], [2, { x: NaN }]]), s: new Set([5, 4, 'z']), f: new Float64Array([1.5, -0, NaN]), u: new Uint8Array([0, 255]) };
  const r = round(v);
  assert.ok(r.m instanceof Map && r.s instanceof Set && r.f instanceof Float64Array && r.u instanceof Uint8Array);
  assert.deepEqual([...r.m.keys()], [3, 1, 2]);
  assert.ok(Number.isNaN(r.m.get(2).x));
  assert.deepEqual([...r.s], [5, 4, 'z']);
  assert.ok(r.f[0] === 1.5 && Object.is(r.f[1], -0) && Number.isNaN(r.f[2]));
  assert.deepEqual([...r.u], [0, 255]);
});

test('a long typed array is written as its bytes and comes back bit for bit', () => {
  const f = new Float32Array(5000);
  for (let i = 0; i < f.length; i++) f[i] = Math.sin(i * 1.7) * 1000 + (i % 97 === 0 ? NaN : 0);
  const d = new Float64Array([Math.PI, -0, 1e-310, Infinity, 5e-324, ...Array(20).fill(0.1)]);
  const j = encode({ f, d });
  assert.ok('$tb' in j.f && '$tb' in j.d, 'as bytes');
  assert.ok(JSON.stringify(j).length < f.length * 6, 'and smaller than the numbers as text');
  const r = round({ f, d });
  assert.ok(r.f instanceof Float32Array && r.d instanceof Float64Array && r.f.length === 5000 && r.d.length === d.length);
  assert.deepEqual(new Uint8Array(r.f.buffer), new Uint8Array(f.buffer));
  assert.deepEqual(new Uint8Array(r.d.buffer), new Uint8Array(d.buffer));
});

test('two fields pointing at one object still point at one object; a cycle is a cycle', () => {
  const curve = { node: 7, t: 0.25 };
  const car = { junction: curve, prevJ: curve, self: null, list: [] };
  car.self = car;
  car.list.push(car.list);
  const r = round(car);
  assert.equal(r.junction, r.prevJ);
  r.junction.t = 0.5;
  assert.equal(r.prevJ.t, 0.5);
  assert.equal(r.self, r);
  assert.equal(r.list[0], r.list);
});

test('rows of like-shaped objects are written as a table and come back as objects', () => {
  const cars = Array.from({ length: 6 }, (_, i) => ({ id: i, s: i * 1.25, lat: NaN, hold: undefined, path: [{ seg: i, dir: 1 }] }));
  const j = encode(cars);
  assert.ok('$t' in j, 'a table');
  assert.equal(JSON.stringify(j).split('"lat"').length - 1, 1, 'each key is written once');
  const r = round(cars);
  assert.equal(r.length, 6);
  assert.deepEqual(Object.keys(r[3]), ['id', 's', 'lat', 'hold', 'path']);
  assert.ok(r[3].id === 3 && r[3].s === 3.75 && Number.isNaN(r[3].lat) && r[3].hold === undefined && r[3].path[0].seg === 3);
});

test('rows that are also pointed at from elsewhere stay rows, and the pointers still land on them', () => {
  const cars = Array.from({ length: 6 }, (_, i) => ({ id: i, s: i * 2.5, lead: null }));
  cars[1].lead = cars[4];   // a row points at a later row
  cars[4].lead = cars[1];   // and back: a cycle between rows
  const state = { cars, buckets: new Map([[7, [cars[2], cars[0]]]]), tail: cars[5] };
  const j = encode(state);
  assert.ok('$t' in j.cars, 'still a table');
  assert.equal(JSON.stringify(j).split('"lead"').length - 1, 1, 'each key once');
  const r = round(state);
  assert.equal(r.cars[1].lead, r.cars[4]);
  assert.equal(r.cars[4].lead, r.cars[1]);
  assert.equal(r.buckets.get(7)[0], r.cars[2]);
  assert.equal(r.buckets.get(7)[1], r.cars[0]);
  assert.equal(r.tail, r.cars[5]);
  assert.equal(r.cars[3].s, 7.5);
});

test('a Map of like-shaped records is a table too', () => {
  const m = new Map(Array.from({ length: 8 }, (_, i) => [100 + i, { bad: i, cov: { fire: i / 3, police: NaN }, trash: 'queued' }]));
  const j = encode({ m });
  assert.ok('$mt' in j.m, 'a map table');
  assert.equal(JSON.stringify(j).split('"trash"').length - 1, 1);
  const r = round({ m });
  assert.ok(r.m instanceof Map && r.m.size === 8);
  assert.deepEqual([...r.m.keys()], [100, 101, 102, 103, 104, 105, 106, 107]);
  assert.ok(r.m.get(105).bad === 5 && r.m.get(105).cov.fire === 5 / 3 && Number.isNaN(r.m.get(105).cov.police) && r.m.get(105).trash === 'queued');
});

test('things that live elsewhere go out as names and come back as the live objects', () => {
  const bank = { id: 12, label: 'First Slop Bank' }, shop = { id: 30, label: 'Slop Mart' };
  const live = new Map([[12, bank], [30, shop]]);
  const refs = { out: (o) => (live.get(o.id) === o ? ['b', o.id] : undefined), in: (kind, id) => (kind === 'b' ? live.get(id) ?? null : null) };
  const v = { dest: bank, byLot: new Map([[bank, 2], [shop, 5]]), trip: { from: shop } };
  const j = encode(v, refs);
  assert.ok(!JSON.stringify(j).includes('First Slop Bank'), 'the building itself is not copied');
  const r = decode(JSON.parse(JSON.stringify(j)), refs);
  assert.equal(r.dest, bank);
  assert.equal(r.trip.from, shop);
  assert.equal(r.byLot.get(bank), 2);
  assert.equal(r.byLot.get(shop), 5);
  live.delete(30);
  assert.equal(decode(j, refs).trip.from, null, 'a thing that is gone comes back as null');
});

test('skip leaves a field out; what cannot come back exactly is refused, with where it was', () => {
  const r = round({ keep: 1, handle: 99, drawn: { still: 3 } }, undefined, { skip: (k) => k === 'handle' || k === 'drawn' });
  assert.deepEqual(r, { keep: 1 });
  assert.throws(() => encode({ cars: [{ onDone: () => 1 }] }), /a function.*at cars\.0\.onDone/);
  class Mesh {}
  assert.throws(() => encode({ a: { mesh: new Mesh() } }), /a Mesh.*at a\.mesh/);
  assert.throws(() => encode({ $bad: 1 }), /key starting with \$/);
});

test('fields of an object go out and back; a save without a field leaves it alone', () => {
  const sim = { demand: { res: 12.5 }, jobsFilled: 40, speed: 2, notSaved: 'x' };
  const j = encodeFields(sim, ['demand', 'jobsFilled']);
  const back = { demand: null, jobsFilled: 0, speed: 3, added: 'later' };
  decodeFields(back, JSON.parse(JSON.stringify(j)));
  assert.deepEqual(back, { demand: { res: 12.5 }, jobsFilled: 40, speed: 3, added: 'later' });
  decodeFields(back, undefined);
  assert.equal(back.jobsFilled, 40);
});

test('equal state has an equal hash, and one bit of difference does not', () => {
  const a = { cars: [{ s: 1.0000000000000002 }], m: new Map([[1, NaN]]) };
  const b = { cars: [{ s: 1.0000000000000002 }], m: new Map([[1, NaN]]) };
  const c = { cars: [{ s: 1 }], m: new Map([[1, NaN]]) };
  assert.equal(hashJson(encode(a)), hashJson(encode(b)));
  assert.notEqual(hashJson(encode(a)), hashJson(encode(c)));
});
