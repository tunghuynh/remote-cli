// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { resolveSelection } from '@/modules/agent-monitor/running/resolveSelection';
import { makeNode, makeSession, makeSnapshot } from '@/modules/agent-monitor/tests/monitorFixtures';

const snapshot = makeSnapshot({
  sessions: [
    makeSession({
      id: 's1',
      agents: [makeNode({ id: 'tu-1', name: 'review-code' })],
      processes: [{ name: 'Node', count: 2, rssBytes: 10, cpuPercent: 1 }, { name: '', count: 1, rssBytes: 1, cpuPercent: null }],
    }),
    makeSession({ id: 's2' }),
  ],
});

describe('resolveSelection', () => {
  it('a session focus (no node) is the session', () => {
    const selection = resolveSelection(snapshot, { sessionKey: 's1', nodeKey: null });
    expect(selection).toMatchObject({ kind: 'session', main: false });
    expect(selection?.session.id).toBe('s1');
  });

  it('the main agent node is the session too, flagged as the main agent', () => {
    expect(resolveSelection(snapshot, { sessionKey: 's1', nodeKey: 'orch:s1' })).toMatchObject({ kind: 'session', main: true });
  });

  it('an agent node is that agent of that session', () => {
    const selection = resolveSelection(snapshot, { sessionKey: 's1', nodeKey: 'agent:s1:tu-1' });
    expect(selection).toMatchObject({ kind: 'agent' });
    expect(selection?.kind === 'agent' && selection.agent.name).toBe('review-code');
  });

  it('a process node is that group of that session, the unnamed "other" group included', () => {
    const named = resolveSelection(snapshot, { sessionKey: 's1', nodeKey: 'proc:s1:node' });
    expect(named?.kind === 'process' && named.group.count).toBe(2);
    const other = resolveSelection(snapshot, { sessionKey: 's1', nodeKey: 'proc:s1:*other' });
    expect(other?.kind === 'process' && other.group.name).toBe('');
  });

  it('the fold node falls back to its session', () => {
    expect(resolveSelection(snapshot, { sessionKey: 's1', nodeKey: 'folded:s1' })).toMatchObject({ kind: 'session', main: false });
  });

  it('is null with no focus, for a session that left the snapshot, and for a node that is gone', () => {
    expect(resolveSelection(snapshot, null)).toBeNull();
    expect(resolveSelection(snapshot, { sessionKey: 'gone', nodeKey: null })).toBeNull();
    expect(resolveSelection(snapshot, { sessionKey: 's1', nodeKey: 'agent:s1:finished' })).toBeNull();
    expect(resolveSelection(snapshot, { sessionKey: 's1', nodeKey: 'proc:s1:bash' })).toBeNull();
  });

  it('never resolves a node of another session even if the id says so', () => {
    expect(resolveSelection(snapshot, { sessionKey: 's2', nodeKey: 'agent:s1:tu-1' })).toBeNull();
  });
});
