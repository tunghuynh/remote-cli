// @vitest-environment node
import assert from 'node:assert/strict';

import { test } from 'vitest';

import { parseRemotePeers } from '@/modules/remote/utils/parse-remote-peers';
import { peerDisplayName } from '@/modules/remote/utils/peer-display-name';

const entry = (extra: Record<string, unknown> = {}) => ({
  peerId: 'peer_one11111',
  name: 'b3f9c2e81a7d',
  state: 'online',
  lastConnectedAt: null,
  ...extra,
});

test('the alias the server sends is kept, next to the declared name', () => {
  const [peer] = parseRemotePeers([entry({ alias: 'Home PC' })]);

  assert.equal(peer?.alias, 'Home PC');
  assert.equal(peer?.name, 'b3f9c2e81a7d');
});

test('a missing, null, blank or non-text alias means "no alias" (an older server never sends one)', () => {
  for (const alias of [undefined, null, '', '   ', 7, {}]) {
    const [peer] = parseRemotePeers([entry({ alias })]);
    assert.equal(peer?.alias, null, `alias ${JSON.stringify(alias)}`);
  }
});

test('the display name is the alias when there is one, else the declared name', () => {
  assert.equal(peerDisplayName({ name: 'b3f9c2e81a7d', alias: 'Home PC' }), 'Home PC');
  assert.equal(peerDisplayName({ name: 'b3f9c2e81a7d', alias: null }), 'b3f9c2e81a7d');
});
