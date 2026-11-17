// src/core/lz.ts: what goes in comes out, byte for byte, and save-like text gets much smaller.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bytesToText, compress, decompress, PACKED, packString, textToBytes, unpackString } from '../../src/core/lz.ts';

const rng = (seed) => () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

test('bytes survive, whatever they are', () => {
  const r = rng(7);
  const cases = [
    new Uint8Array(0), new Uint8Array([1]), new Uint8Array([1, 2, 3]), new Uint8Array(5).fill(9),
    new Uint8Array(100000).fill(65),                                              // one long run
    Uint8Array.from({ length: 70000 }, () => Math.floor(r() * 256)),              // noise: nothing to find
    Uint8Array.from({ length: 200000 }, (_, i) => (i * 7 + ((i >> 9) & 3)) & 255), // repeats further back than short ones
    Uint8Array.from({ length: 300000 }, (_, i) => (i % 70000 < 3 ? 255 : i % 251)), // matches at the edge of the 64 KiB window
  ];
  for (const c of cases) {
    const z = compress(c);
    assert.ok(same(decompress(z), c), `${c.length} bytes`);
  }
});

test('a run of 15, 16, 270 and 271 literals and matches (the length-byte edges) survive', () => {
  const r = rng(3);
  for (const lit of [14, 15, 16, 269, 270, 271, 525]) for (const match of [4, 18, 19, 20, 273, 274, 275]) {
    const head = Uint8Array.from({ length: lit }, () => 200 + Math.floor(r() * 50));
    const rep = Uint8Array.from({ length: match }, (_, i) => i % 13);
    const c = new Uint8Array([...rep, ...head, ...rep, 1, 2, 3, 4, 5]);
    assert.ok(same(decompress(compress(c)), c), `${lit} literals, ${match} match`);
  }
});

test('bytes ride in ordinary characters and come back', () => {
  const r = rng(11);
  for (const n of [0, 1, 2, 14, 15, 16, 17, 1000, 65537]) {
    const b = Uint8Array.from({ length: n }, () => Math.floor(r() * 256));
    const t = bytesToText(b);
    for (let i = 0; i < t.length; i++) { const c = t.charCodeAt(i); assert.ok(c >= 0x20 && c <= 0x801f, 'no control characters, no surrogates'); }
    assert.ok(same(textToBytes(t), b), `${n} bytes`);
    assert.ok(t.length <= Math.ceil((n * 8) / 15) + 12, 'about 15 bits a character');
  }
});

test('text survives packing: ASCII, accents, emoji, and text that was never packed', () => {
  for (const s of ['', '{}', 'Señor Slop’s Taquería ⛽🐊 — 100% “freedom”', JSON.stringify({ a: [1, 2, 3], b: 'x'.repeat(5000) })]) {
    const p = packString(s);
    assert.ok(p.startsWith(PACKED));
    assert.equal(unpackString(p), s);
  }
  assert.equal(unpackString('{"v":1}'), '{"v":1}');
});

test('a save-like text gets at least 2.5 times smaller in characters', () => {
  const r = rng(5);
  const cars = Array.from({ length: 600 }, (_, i) => ({ id: i, kind: ['suv', 'sedan', 'pickup', 'semi'][i % 4], s: r() * 300, v: r() * 20, lane: i % 3, path: Array.from({ length: 12 }, (_, k) => [100 + ((i + k) % 80), k % 2 ? 1 : -1]), purpose: 'going to work', dest: 'Slop Mart #' + (i % 9) }));
  const json = JSON.stringify({ v: 2, cars, zones: Array.from({ length: 4000 }, (_, i) => [i * 8.5, i * 3.25, 'resLow']) });
  const packed = packString(json);
  assert.equal(unpackString(packed), json);
  assert.ok(packed.length * 2.5 < json.length, `${json.length} characters became ${packed.length}`);
});

test('damaged data is refused, not turned into nonsense', () => {
  const z = compress(new TextEncoder().encode('the same words the same words the same words'));
  assert.throws(() => decompress(z.subarray(0, z.length - 3)), /lz:/);
  const bad = Uint8Array.from(z); bad[0] ^= 0x40;
  assert.throws(() => decompress(bad), /lz:/);
  assert.throws(() => textToBytes('zz'), /lz:/);
  assert.throws(() => unpackString(PACKED + '5:\u0001\u0002'), /lz:/);
});
