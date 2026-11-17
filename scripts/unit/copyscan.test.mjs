// The copy scanner tells player-facing words from code. SVG path data is drawing, not words: the drawn HUD icons added 174
// path strings, and the content audit was about to send each to a model to ask whether it breaks the content rules.
import assert from 'node:assert/strict';
import test from 'node:test';
import { collectCopy, copyText } from '../copyscan.mjs';

const lit = (text, path = 'art.x') => ({ text, path, before: '', after: '' });

test('SVG path data is not copy', () => {
  for (const d of ['M5 3l15 11-7 1 3 6-4 1-3-7-5 4z', 'M7 3h10l5 18H2z', 'M12 5v3m0 4v6', 'M{…} {…}a{…} {…} 0 1 0 {…} 0a{…} {…} 0 1 0 {…} 0Z', 'M3 6l13-3 5 4-1 12-13 2-4-4z', 'm2 20 7-12 3 4 4-9 6 17z']) {
    assert.equal(copyText(lit(d)), null, d);
  }
});

test('words made of the letters path data uses are still copy', () => {
  for (const s of ['CALM', 'Mall Hall', 'Class A Malls', 'M5 Slop Tacos', 'Zzz. Lots 24 to 30 still vacant.', 'All 4 lanes. All 24 hours.']) {
    assert.equal(copyText(lit(s, 'SIGNS[0].text')), s, s);
  }
});

test('the icon file gives the audit nothing but its comments would not either', () => {
  const fromIcons = collectCopy().filter((item) => item.where.some((w) => w.file.endsWith('art/hudIcons.ts')));
  assert.deepEqual(fromIcons.map((i) => i.text), []);
});
