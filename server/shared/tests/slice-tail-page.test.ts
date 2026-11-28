import assert from 'node:assert/strict';
import test from 'node:test';

import { sliceTailPage } from '@/shared/utils.js';

const ITEMS = ['a', 'b', 'c', 'd', 'e'];

test('pages walk backwards from the most recent to the oldest, and only the oldest reports hasMore false', () => {
  const rows: Array<[string, number, string[], boolean]> = [
    ['offset 0 returns the most recent page', 0, ['d', 'e'], true],
    ['increasing offsets walk backwards in time', 2, ['b', 'c'], true],
    ['the oldest page reports hasMore false', 4, ['a'], false],
  ];
  for (const [label, offset, expectedPage, expectedHasMore] of rows) {
    const { page, hasMore } = sliceTailPage(ITEMS, 2, offset);
    assert.deepEqual(page, expectedPage, label);
    assert.equal(hasMore, expectedHasMore, label);
  }
});

test('null limit returns everything', () => {
  const { page, hasMore } = sliceTailPage(ITEMS, null, 0);
  assert.deepEqual(page, ITEMS);
  assert.equal(hasMore, false);
});

test('offsets past the start return an empty page', () => {
  const { page, hasMore } = sliceTailPage(ITEMS, 3, 10);
  assert.deepEqual(page, []);
  assert.equal(hasMore, false);
});

test('zero limit returns an empty page but keeps hasMore accurate', () => {
  const { page, hasMore } = sliceTailPage(ITEMS, 0, 0);
  assert.deepEqual(page, []);
  assert.equal(hasMore, true);
});
