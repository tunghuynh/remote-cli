// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { formatBytes, formatClock, formatPercent, formatTokenCount } from '@/modules/agent-monitor/format/monitorFormat';
import { edgeThickness, layoutMonitorTree, MAX_DRAWN_AGENTS, MAX_DRAWN_PROCESSES, MAX_DRAWN_PROCESSES_PER_SESSION, PROCESS_ACTIVE_CPU_PERCENT } from '@/modules/agent-monitor/graph/layoutMonitorTree';
import { makeNode, makeSession } from '@/modules/agent-monitor/tests/monitorFixtures';
import { agentTokenShares } from '@/modules/agent-monitor/usage/agentTokenShares';
import type { AgentMonitorProcessGroup } from '@/shared/types';

describe('display formats', () => {
  it('formats bytes in binary units', () => {
    expect(formatBytes(5)).toBe('5 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(631 * 1024 * 1024)).toBe('631 MB');
    expect(formatBytes(2.5 * 1024 ** 3)).toBe('2.5 GB');
    expect(formatBytes(-1)).toBe('—');
  });

  it('formats token counts and clocks', () => {
    expect(formatTokenCount(950)).toBe('950');
    expect(formatTokenCount(1200)).toBe('1.2k');
    expect(formatTokenCount(12_300)).toBe('12k');
    expect(formatTokenCount(2_400_000)).toBe('2.4M');
    expect(formatClock(45_000)).toBe('0:45');
    expect(formatClock(125_000)).toBe('2:05');
    expect(formatClock(3_725_000)).toBe('1:02:05');
    expect(formatClock(-5)).toBe('0:00');
  });

  it('formats percentages, with "not measured yet" as a dash', () => {
    expect(formatPercent(null)).toBe('—');
    expect(formatPercent(0.04)).toBe('<0.1%');
    expect(formatPercent(8.39)).toBe('8.4%');
    expect(formatPercent(45)).toBe('45%');
    expect(formatPercent(0)).toBe('0.0%');
  });
});

describe('layoutMonitorTree', () => {
  const columnOf = (kind: string, layout: ReturnType<typeof layoutMonitorTree>) => layout.nodes.filter((node) => node.kind === kind).map((node) => node.x);
  const group = (name: string, overrides: Partial<AgentMonitorProcessGroup> = {}): AgentMonitorProcessGroup => ({ name, count: 1, rssBytes: 10 * 1024 * 1024, cpuPercent: 0, ...overrides });

  it('draws nothing when no session is known: there is no server box any more', () => {
    const layout = layoutMonitorTree([]);
    expect(layout.nodes).toEqual([]);
    expect(layout.edges).toEqual([]);
    expect(layout.height).toBe(0);
  });

  it('roots each tree at its session: session, orchestrator and agents in three columns, joined by one edge each', () => {
    const session = makeSession({ id: 's1', agents: [makeNode({ id: 'a1', tokensPerSecond: 100 }), makeNode({ id: 'a2', state: 'done', endedAt: 1 })] });
    const layout = layoutMonitorTree([session]);

    expect(layout.nodes.some((node) => (node.kind as string) === 'server')).toBe(false);
    const xs = ['session', 'orchestrator', 'agent'].map((kind) => columnOf(kind, layout)[0]);
    expect(xs[0]).toBe(0);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(new Set(xs).size).toBe(3);
    expect(layout.nodes.filter((node) => node.kind === 'agent')).toHaveLength(2);
    expect(layout.edges.map((edge) => edge.id)).toEqual([
      'session:s1>orch:s1',
      'orch:s1>agent:s1:a1',
      'orch:s1>agent:s1:a2',
    ]);
    const working = layout.edges.find((edge) => edge.to === 'agent:s1:a1');
    const finished = layout.edges.find((edge) => edge.to === 'agent:s1:a2');
    expect(working?.flowing).toBe(true);
    expect(finished?.flowing).toBe(false);
    expect(working!.thickness).toBeGreaterThan(finished!.thickness);
  });

  it('stacks agents without overlap and centres the session and orchestrator against them', () => {
    const agents = Array.from({ length: 4 }, (_, index) => makeNode({ id: `a${index}` }));
    const layout = layoutMonitorTree([makeSession({ id: 's1', agents })]);
    const stack = layout.nodes.filter((node) => node.kind === 'agent');
    for (let index = 1; index < stack.length; index += 1) {
      expect(stack[index].y).toBeGreaterThanOrEqual(stack[index - 1].y + stack[index - 1].h);
    }
    const middle = (stack[0].y + stack[stack.length - 1].y + stack[stack.length - 1].h) / 2;
    const orchestrator = layout.nodes.find((node) => node.kind === 'orchestrator')!;
    expect(orchestrator.y + orchestrator.h / 2).toBeCloseTo(middle, 5);
  });

  it('puts later sessions in their own block below earlier ones, each with its own root', () => {
    const layout = layoutMonitorTree([
      makeSession({ id: 's1', agents: [makeNode({ id: 'a' })] }),
      makeSession({ id: 's2', agents: [makeNode({ id: 'b' }), makeNode({ id: 'c' })] }),
    ]);
    const sessions = layout.nodes.filter((node) => node.kind === 'session');
    expect(sessions).toHaveLength(2);
    expect(sessions[1].y).toBeGreaterThan(sessions[0].y);
    // The two trees never share a box: the first block ends above the second block's first box.
    const firstBlock = layout.nodes.filter((node) => node.sessionId === 's1');
    const secondBlock = layout.nodes.filter((node) => node.sessionId === 's2');
    expect(Math.max(...firstBlock.map((node) => node.y + node.h))).toBeLessThan(Math.min(...secondBlock.map((node) => node.y)));
  });

  it('adds a "finished" chip for folded agents and caps the drawn agents', () => {
    const folded = layoutMonitorTree([makeSession({ id: 's1', foldedFinished: 3, agents: [makeNode({ id: 'a' })] })]);
    expect(folded.nodes.filter((node) => node.kind === 'folded')).toMatchObject([{ count: 3 }]);

    const many = Array.from({ length: MAX_DRAWN_AGENTS + 5 }, (_, index) => makeNode({ id: `a${index}` }));
    const capped = layoutMonitorTree([makeSession({ id: 's1', agents: many })]);
    expect(capped.nodes.filter((node) => node.kind === 'agent')).toHaveLength(MAX_DRAWN_AGENTS);
    expect(capped.omittedAgents).toBe(5);
    expect(capped.nodes.filter((node) => node.kind === 'folded')).toMatchObject([{ count: 5 }]);
  });

  it('keeps an idle session as a quiet (done) box, not a working one', () => {
    const layout = layoutMonitorTree([makeSession({ id: 's1', state: 'idle', orchestrator: { name: 'o', fromProfile: false, state: 'done', lastToolName: null, contextTokens: null, contextWindow: null } })]);
    expect(layout.nodes.find((node) => node.kind === 'session')?.state).toBe('done');
    expect(layout.edges.find((edge) => edge.id === 'session:s1>orch:s1')?.flowing).toBe(false);
  });

  it('draws one process leaf per group in the leaf column, after the agents, joined to the orchestrator by a thin edge', () => {
    const session = makeSession({
      id: 's1',
      agents: [makeNode({ id: 'a1' })],
      processes: [group('node', { count: 3, cpuPercent: 12 }), group('bash', { cpuPercent: 0.2 }), group('', { count: 4, cpuPercent: null })],
    });
    const layout = layoutMonitorTree([session]);

    const leaves = layout.nodes.filter((node) => node.kind === 'process');
    expect(leaves.map((node) => node.id)).toEqual(['proc:s1:node', 'proc:s1:bash', 'proc:s1:*other']);
    const agent = layout.nodes.find((node) => node.kind === 'agent')!;
    expect(leaves.every((node) => node.x === agent.x)).toBe(true);
    expect(leaves[0].y).toBeGreaterThanOrEqual(agent.y + agent.h);

    const edge = (id: string) => layout.edges.find((candidate) => candidate.to === id)!;
    expect(edge('proc:s1:node')).toMatchObject({ kind: 'process', from: 'orch:s1', flowing: true });
    expect(edge('proc:s1:bash').flowing).toBe(false);
    expect(edge('proc:s1:*other').flowing).toBe(false);
    expect(edge('proc:s1:node').thickness).toBeLessThan(edge('agent:s1:a1').thickness);
    expect(edge('agent:s1:a1').kind).toBe('agent');
  });

  it('shows a process group as running while its session works and as done once it is idle; it has no state of its own', () => {
    const working = layoutMonitorTree([makeSession({ id: 's1', processes: [group('node', { cpuPercent: 50 })] })]);
    expect(working.nodes.find((node) => node.kind === 'process')?.state).toBe('running');
    const waiting = layoutMonitorTree([makeSession({ id: 's1', state: 'waiting', processes: [group('node')] })]);
    expect(waiting.nodes.find((node) => node.kind === 'process')?.state).toBe('running');
    const idle = layoutMonitorTree([makeSession({ id: 's1', state: 'idle', processes: [group('node', { cpuPercent: 50 })] })]);
    expect(idle.nodes.find((node) => node.kind === 'process')?.state).toBe('done');
  });

  it('only flows a process edge at or above the CPU threshold, and never when CPU is not measured', () => {
    const layout = layoutMonitorTree([makeSession({ id: 's1', processes: [
      group('at', { cpuPercent: PROCESS_ACTIVE_CPU_PERCENT }), group('below', { cpuPercent: PROCESS_ACTIVE_CPU_PERCENT - 0.01 }), group('unknown', { cpuPercent: null }),
    ] })]);
    expect(layout.edges.filter((edge) => edge.kind === 'process').map((edge) => edge.flowing)).toEqual([true, false, false]);
  });

  it('caps the process leaves per session and overall, and counts what it leaves out', () => {
    const groups = Array.from({ length: 8 }, (_, index) => group(`tool${index}`));
    const one = layoutMonitorTree([makeSession({ id: 's1', processes: groups })]);
    expect(one.nodes.filter((node) => node.kind === 'process')).toHaveLength(MAX_DRAWN_PROCESSES_PER_SESSION);
    expect(one.omittedProcesses).toBe(8 - MAX_DRAWN_PROCESSES_PER_SESSION);
    // The heaviest groups (the server sends them first) are the ones drawn.
    expect(one.nodes.filter((node) => node.kind === 'process').map((node) => node.id)).toEqual(groups.slice(0, MAX_DRAWN_PROCESSES_PER_SESSION).map((entry) => `proc:s1:${entry.name}`));

    const sessions = Array.from({ length: 10 }, (_, index) => makeSession({ id: `s${index}`, processes: groups }));
    const all = layoutMonitorTree(sessions);
    expect(all.nodes.filter((node) => node.kind === 'process')).toHaveLength(MAX_DRAWN_PROCESSES);
    expect(all.omittedProcesses).toBe(80 - MAX_DRAWN_PROCESSES);

    const small = layoutMonitorTree(sessions, MAX_DRAWN_AGENTS, 7);
    expect(small.nodes.filter((node) => node.kind === 'process')).toHaveLength(7);
  });

  it('draws no process box, no process edge and no "not shown" count while processes are hidden; agents are untouched', () => {
    const sessions = [makeSession({ id: 's1', agents: [makeNode({ id: 'a1' })], processes: Array.from({ length: 8 }, (_, index) => group(`tool${index}`)) })];
    const hidden = layoutMonitorTree(sessions, MAX_DRAWN_AGENTS, MAX_DRAWN_PROCESSES, { showProcesses: false });
    expect(hidden.nodes.filter((node) => node.kind === 'process')).toEqual([]);
    expect(hidden.edges.filter((edge) => edge.kind === 'process')).toEqual([]);
    expect(hidden.omittedProcesses).toBe(0);
    expect(hidden.nodes.map((node) => node.id)).toEqual(['session:s1', 'orch:s1', 'agent:s1:a1']);
    // Shown is the default: the same call without options is the full picture.
    expect(layoutMonitorTree(sessions, MAX_DRAWN_AGENTS, MAX_DRAWN_PROCESSES, { showProcesses: true })).toEqual(layoutMonitorTree(sessions));
  });

  it('treats a session from an older server (no processes field) as having no process leaves', () => {
    const layout = layoutMonitorTree([makeSession({ id: 's1' })]);
    expect(layout.nodes.filter((node) => node.kind === 'process')).toEqual([]);
    expect(layout.omittedProcesses).toBe(0);
  });

  it('is deterministic: the same sessions give the same boxes and edges', () => {
    const sessions = [makeSession({ id: 's1', agents: [makeNode({ id: 'a' })], processes: [group('node')] }), makeSession({ id: 's2', processes: [group('bash')] })];
    expect(layoutMonitorTree(sessions)).toEqual(layoutMonitorTree(sessions));
  });

  it('edge thickness grows with the token rate and is bounded', () => {
    expect(edgeThickness(0)).toBe(1.5);
    expect(edgeThickness(10)).toBeGreaterThan(edgeThickness(1));
    expect(edgeThickness(1_000_000)).toBeLessThanOrEqual(6);
  });
});
describe('agentTokenShares', () => {
  it('lists the agents of ONE session by tokens, largest first, and leaves out the ones that reported nothing', () => {
    const shares = agentTokenShares(makeSession({
      id: 's1',
      agentTokens: 4200,
      agents: [makeNode({ id: 'a', name: 'coding--alpha', tokens: 3000 }), makeNode({ id: 'b', name: 'testing--alpha', tokens: 1000 }), makeNode({ id: 'c', name: 'idle', tokens: 0 })],
    }));
    expect(shares.map((share) => [share.label, share.tokens])).toEqual([['coding--alpha', 3000], ['testing--alpha', 1000]]);
  });

  it('keeps at most `limit` bars', () => {
    const agents = Array.from({ length: 9 }, (_, index) => makeNode({ id: `a${index}`, tokens: 100 + index }));
    expect(agentTokenShares(makeSession({ id: 's1', agents }), 4)).toHaveLength(4);
  });
});