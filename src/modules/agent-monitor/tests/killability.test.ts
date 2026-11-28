// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { killAction, isNodeActive } from '@/modules/agent-monitor/graph/killability';
import { layoutMonitorTree, type GraphNode } from '@/modules/agent-monitor/graph/layoutMonitorTree';
import { makeNode, makeSession } from '@/modules/agent-monitor/tests/monitorFixtures';
import type { AgentMonitorProcessGroup, AgentMonitorSession } from '@/shared/types';

const group = (name: string, count = 2): AgentMonitorProcessGroup => ({ name, count, rssBytes: 1000, cpuPercent: 1 });

/** Every box the layout draws for a session, by id. */
const boxes = (session: AgentMonitorSession) => new Map<string, GraphNode>(layoutMonitorTree([session]).nodes.map((node) => [node.id, node]));

describe('which boxes have a kill button', () => {
  const session = makeSession({
    id: 's1',
    agents: [makeNode({ id: 'a-run' }), makeNode({ id: 'a-wait', state: 'waiting' }), makeNode({ id: 'a-done', state: 'done', endedAt: 1_000_500 })],
    foldedFinished: 2,
    processes: [group('node', 3), group('')],
  });
  const all = boxes(session);

  it('the main agent and a working sub-agent do; the session box does not', () => {
    expect(killAction(all.get('orch:s1') as GraphNode)).toEqual({ kind: 'main', name: 'orchestrator', count: 0 });
    expect(killAction(all.get('agent:s1:a-run') as GraphNode)?.kind).toBe('agent');
    expect(killAction(all.get('agent:s1:a-wait') as GraphNode)?.kind).toBe('agent');
    expect(killAction(all.get('session:s1') as GraphNode)).toBeNull();
  });

  it('a finished agent has nothing to kill', () => {
    expect(killAction(all.get('agent:s1:a-done') as GraphNode)).toBeNull();
  });

  it('a named process group does, and says how many; the unnamed "other" group does not', () => {
    expect(killAction(all.get('proc:s1:node') as GraphNode)).toEqual({ kind: 'process', name: 'node', count: 3 });
    expect(killAction(all.get('proc:s1:*other') as GraphNode)).toBeNull();
  });

  it('the "+N finished" fold has none', () => {
    const folded = [...all.values()].find((node) => node.kind === 'folded');
    expect(folded).toBeTruthy();
    expect(killAction(folded as GraphNode)).toBeNull();
  });

  it('a terminal session\'s agent has none (the server refuses it) but its main agent and groups do', () => {
    const terminal = boxes(makeSession({ id: 'terminal:abc', source: 'terminal', agents: [makeNode({ id: 'a1' })], processes: [group('node')] }));
    expect(killAction(terminal.get('agent:terminal:abc:a1') as GraphNode)).toBeNull();
    expect(killAction(terminal.get('orch:terminal:abc') as GraphNode)?.kind).toBe('main');
    expect(killAction(terminal.get('proc:terminal:abc:node') as GraphNode)?.kind).toBe('process');
  });

  it('the group of an idle session is not killed from its box, and an idle main agent has no button', () => {
    const idle = boxes(makeSession({ id: 's2', state: 'idle', orchestrator: { name: 'orchestrator', fromProfile: true, state: 'done', lastToolName: null, contextTokens: null, contextWindow: null }, processes: [group('node')] }));
    expect(killAction(idle.get('proc:s2:node') as GraphNode)).toBeNull();
    expect(killAction(idle.get('orch:s2') as GraphNode)).toBeNull();
  });
});

describe('whether a box is still worth killing, from the snapshot', () => {
  const sessions = [
    makeSession({ id: 's1', agents: [makeNode({ id: 'a1' }), makeNode({ id: 'a2', state: 'done' })], processes: [group('Node')] }),
    makeSession({ id: 's2', state: 'idle', processes: [group('node')] }),
  ];

  it('reads the main agent from the session, an agent from its own state, a group from the session and the group list', () => {
    expect(isNodeActive(sessions, 'orch:s1')).toBe(true);
    expect(isNodeActive(sessions, 'orch:s2')).toBe(false);
    expect(isNodeActive(sessions, 'agent:s1:a1')).toBe(true);
    expect(isNodeActive(sessions, 'agent:s1:a2')).toBe(false);
    expect(isNodeActive(sessions, 'agent:s1:missing')).toBe(false);
    expect(isNodeActive(sessions, 'proc:s1:node')).toBe(true);
    expect(isNodeActive(sessions, 'proc:s1:python')).toBe(false);
    expect(isNodeActive(sessions, 'proc:s2:node')).toBe(false);
    expect(isNodeActive(sessions, 'orch:nobody')).toBe(false);
  });
});
