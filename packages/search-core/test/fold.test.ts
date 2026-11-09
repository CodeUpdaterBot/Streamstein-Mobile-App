import assert from 'node:assert/strict';
import { test } from 'node:test';

import { foldText, toOriginalIndex } from '../src/fold.ts';

test('folding preserves a map back to the original offsets', () => {
  const f = foldText('Café Society');
  assert.equal(f.folded, 'cafe society');
  assert.equal(f.map.length, f.folded.length);

  const at = f.folded.indexOf('cafe');
  const start = toOriginalIndex(f, at);
  const end = toOriginalIndex(f, at + 'cafe'.length);
  assert.equal(f.original.slice(start, end), 'Café', 'offsets must land on the accented original');
});

test('folded length may differ from original length, and the map still holds', () => {
  // Decomposed input shortens when the combining mark is dropped.
  const decomposed = foldText('a\u0301bc');
  assert.equal(decomposed.original.length, 4);
  assert.equal(decomposed.folded, 'abc');
  assert.deepEqual(decomposed.map, [0, 2, 3]);

  const f = foldText('İstanbul Café');
  for (let i = 0; i < f.map.length; i += 1) {
    const o = f.map[i]!;
    assert.ok(o >= 0 && o < f.original.length, `map[${i}]=${o} inside original`);
  }
  const at = f.folded.indexOf('cafe');
  assert.ok(at >= 0);
  assert.equal(f.original.slice(toOriginalIndex(f, at), f.original.length), 'Café');
});

test('combining marks alone are dropped without desynchronising the map', () => {
  const f = foldText('a\u0301b'); // "áb" decomposed
  assert.equal(f.folded, 'ab');
  assert.deepEqual(f.map, [0, 2]);
});
