// @vitest-environment node
import assert from 'node:assert/strict';

import { test } from 'vitest';

import { formatPairingCode, isPairingCodeComplete } from '@/modules/remote/utils/pairing-code';

/**
 * Codes are 8 Crockford base32 characters shown as XXXX-XXXX. The field folds
 * what people mistype (case, separators, O/I/L) so the Host and Controller
 * agree on the same string before anything is sent.
 */

test('typing is shown upper-case and grouped as XXXX-XXXX', () => {
  assert.equal(formatPairingCode('ab'), 'AB');
  assert.equal(formatPairingCode('abcd'), 'ABCD');
  assert.equal(formatPairingCode('abcde'), 'ABCD-E');
  assert.equal(formatPairingCode('abcd1234'), 'ABCD-1234');
});

test('separators and spaces are ignored and extra characters are cut off', () => {
  assert.equal(formatPairingCode(' abcd - 1234 '), 'ABCD-1234');
  assert.equal(formatPairingCode('abcd-1234-zzzz'), 'ABCD-1234');
  assert.equal(formatPairingCode('ab!@#cd'), 'ABCD');
});

test('look-alike letters fold the way Crockford base32 does: O is 0, I and L are 1', () => {
  assert.equal(formatPairingCode('oOiIlL'), '0011-11');
});

test('a code is complete only with 8 characters from the alphabet', () => {
  assert.equal(isPairingCodeComplete('ABCD-1234'), true);
  assert.equal(isPairingCodeComplete('ABCD-123'), false);
  assert.equal(isPairingCodeComplete(''), false);
  // U is not part of the alphabet, so it can never be typed correctly.
  assert.equal(isPairingCodeComplete('ABCD-123U'), false);
});
