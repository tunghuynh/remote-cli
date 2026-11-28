// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { sessionSetKey, toFlowEdges, toFlowNodes } from '@/modules/agent-monitor/graph/buildFlowGraph';
import { layoutMonitorTree } from '@/modules/agent-monitor/graph/layoutMonitorTree';
import { makeNode, makeSession } from '@/modules/agent-monitor/tests/monitorFixtures';

/** The layout turned into React Flow nodes and edges: same ids, same positions, no way for the user to connect or delete anything. */

const session = makeSession({
  id: 's1',
  foldedFinished: 2,
  agents: [makeNode({ id: 'a1', tokensPerSecond: 100 }), makeNode({ id: 'a2', state: 'done', endedAt: 1 })],
  processes: [{ name: 'node', count: 2, rssBytes: 1024, cpuPercent: 12 }],
});
const layout = layoutMonitorTree([session]);

describe('toFlowNodes', () => {
  const nodes = toFlowNodes(layout);

  it('has one node per layout box, with the layout\'s id, kind as type, position and size', () => {
    expect(nodes.map((node) => node.id)).toEqual(layout.nodes.map((box) => box.id));
    expect(nodes.map((node) => node.type)).toEqual(['session', 'orchestrator', 'agent', 'agent', 'folded', 'process']);
    layout.nodes.forEach((box, index) => {
      expect(nodes[index].position).toEqual({ x: box.x, y: box.y });
      expect(nodes[index]).toMatchObject({ width: box.w, height: box.h });
      expect(nodes[index].data.graphNode).toBe(box);
    });
  });

  it('declares a connector exactly where an edge starts or ends: the session only an outgoing one, the main agent both, a leaf an incoming one, the fold none', () => {
    const handlesOf = (id: string) => nodes.find((node) => node.id === id)?.handles?.map((handle) => handle.type);
    expect(handlesOf('session:s1')).toEqual(['source']);
    expect(handlesOf('orch:s1')).toEqual(['target', 'source']);
    expect(handlesOf('agent:s1:a1')).toEqual(['target']);
    expect(handlesOf('proc:s1:node')).toEqual(['target']);
    expect(handlesOf('folded:s1')).toEqual([]);
  });

  it('cannot be selected, connected, deleted or tabbed to as a wrapper (the box inside is the button)', () => {
    for (const node of nodes) {
      expect(node).toMatchObject({ selectable: false, connectable: false, deletable: false, focusable: false });
    }
  });
});

describe('toFlowEdges', () => {
  const edges = toFlowEdges(layout);

  it('has one edge per layout edge, same ids and ends, carrying the width, flow and state in data', () => {
    expect(edges.map((edge) => edge.id)).toEqual(layout.edges.map((edge) => edge.id));
    const working = edges.find((edge) => edge.target === 'agent:s1:a1');
    const finished = edges.find((edge) => edge.target === 'agent:s1:a2');
    expect(working).toMatchObject({ source: 'orch:s1', type: 'monitor', data: { kind: 'agent', flowing: true, state: 'running' } });
    expect(finished?.data?.flowing).toBe(false);
    expect(working!.data!.thickness).toBeGreaterThan(finished!.data!.thickness);
    expect(edges.find((edge) => edge.target === 'proc:s1:node')?.data).toMatchObject({ kind: 'process', flowing: true });
  });

  it('cannot be selected, deleted or reconnected', () => {
    for (const edge of edges) expect(edge).toMatchObject({ selectable: false, deletable: false, reconnectable: false });
  });
});

describe('sessionSetKey', () => {
  it('is the same for the same sessions in any order (the server reorders them as they get busier) and changes when the set changes', () => {
    const one = makeSession({ id: 'a' });
    const two = makeSession({ id: 'b' });
    expect(sessionSetKey(layoutMonitorTree([one, two]))).toBe(sessionSetKey(layoutMonitorTree([two, one])));
    expect(sessionSetKey(layoutMonitorTree([one, two]))).not.toBe(sessionSetKey(layoutMonitorTree([one])));
  });

  it('does not change when only what the boxes say changes', () => {
    const before = layoutMonitorTree([makeSession({ id: 'a', agents: [makeNode({ id: 'x' })] })]);
    const after = layoutMonitorTree([makeSession({ id: 'a', agents: [makeNode({ id: 'x', tokens: 900 }), makeNode({ id: 'y' })] })]);
    expect(sessionSetKey(after)).toBe(sessionSetKey(before));
  });
});
