// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { buildRunningTree, folderKey, type BuildRunningTreeInput } from '@/modules/agent-monitor/running/buildRunningTree';
import { makeNode, makeSession } from '@/modules/agent-monitor/tests/monitorFixtures';
import type { AgentMonitorSession, Project } from '@/shared/types';

/** The pure model behind the Running tab's tree: app sessions, the terminal merge by folder, ordering and expansion defaults. */

const project = (projectId: string, fullPath: string, sessionIds: string[] = []): Project => ({
  projectId,
  displayName: projectId.toUpperCase(),
  fullPath,
  sessions: sessionIds.map((id) => ({ id, summary: id, __provider: 'claude' })),
}) as unknown as Project;

const ALPHA = project('alpha', 'C:\\work\\Alpha', ['s1']);
const OTHER = project('other', 'C:\\work\\Other');

const build = (overrides: Partial<BuildRunningTreeInput>) => buildRunningTree({
  sessions: [], displayedProjects: [ALPHA], allProjects: [ALPHA, OTHER], search: '', keepSessionKey: null, ...overrides,
});

const terminal = (id: string, extra: Partial<AgentMonitorSession> = {}) => makeSession({
  id, source: 'terminal', detail: 'transcript', openSessionId: null, label: id, projectName: null, ...extra,
});

describe('folderKey', () => {
  it('gives one key to the same folder however it is written', () => {
    expect(folderKey('C:\\work\\Alpha')).toBe(folderKey('c:/work/alpha/'));
    expect(folderKey('C:\\work\\Alpha')).toBe('c:/work/alpha');
    expect(folderKey('\\\\?\\C:\\work\\Alpha')).toBe('c:/work/alpha');
  });

  it('keeps the case of a POSIX folder (it is case-sensitive there) and strips the trailing slash', () => {
    expect(folderKey('/home/Dev/App/')).toBe('/home/Dev/App');
    expect(folderKey('/home/Dev/app')).not.toBe(folderKey('/home/dev/app'));
    expect(folderKey('/')).toBe('/');
  });

  it('has one key for "no folder"', () => {
    expect(folderKey(null)).toBe(folderKey(''));
    expect(folderKey('  ')).toBe('no-folder');
  });
});

describe('buildRunningTree: an app session', () => {
  it('lists the main agent first, then the sub-agents in server order, the finished counter, then the process groups', () => {
    const session = makeSession({
      id: 's1',
      agents: [makeNode({ id: 'a1' }), makeNode({ id: 'a2', state: 'done', endedAt: 2 })],
      foldedFinished: 3,
      processes: [{ name: 'node', count: 2, rssBytes: 10, cpuPercent: 1 }, { name: '', count: 4, rssBytes: 5, cpuPercent: null }],
    });
    const node = build({ sessions: [session] }).byAppSessionId.get('s1');

    expect(node?.mainKey).toBe('orch:s1');
    expect(node?.nodeKey).toBe('session:s1');
    // Sub-agents and process groups are siblings under the main agent, never one under the other.
    expect(node?.children.map((row) => row.key)).toEqual(['agent:s1:a1', 'agent:s1:a2', 'folded:s1', 'proc:s1:node', 'proc:s1:*other']);
    expect(node?.children.map((row) => row.kind)).toEqual(['agent', 'agent', 'folded', 'process', 'process']);
  });

  it('uses the graph\'s own node ids, which is how a focus finds its box', () => {
    const node = build({ sessions: [makeSession({ id: 's1', agents: [makeNode({ id: 'tu-1' })], processes: [{ name: 'Node', count: 1, rssBytes: 1, cpuPercent: 0 }] })] }).byAppSessionId.get('s1');
    expect(node?.children.map((row) => row.key)).toEqual(['agent:s1:tu-1', 'proc:s1:node']);
  });

  it('leaves the process rows out while processes are hidden, and keeps the agents and the finished counter', () => {
    const session = makeSession({
      id: 's1',
      agents: [makeNode({ id: 'a1' })],
      foldedFinished: 2,
      processes: [{ name: 'node', count: 2, rssBytes: 10, cpuPercent: 1 }],
    });
    const node = build({ sessions: [session], showProcesses: false }).byAppSessionId.get('s1');
    expect(node?.children.map((row) => row.key)).toEqual(['agent:s1:a1', 'folded:s1']);
    // A session with only processes under it has nothing to open when they are hidden.
    const quiet = build({ sessions: [makeSession({ id: 's1', state: 'running', orchestrator: { ...session.orchestrator, state: 'running' }, processes: [{ name: 'node', count: 1, rssBytes: 1, cpuPercent: 0 }] })], showProcesses: false }).byAppSessionId.get('s1');
    expect(quiet?.mainExpandedByDefault).toBe(false);
    // The default shows them.
    expect(build({ sessions: [session] }).byAppSessionId.get('s1')?.children.map((row) => row.kind)).toContain('process');
  });

  it('tolerates a server that sends no process list', () => {
    const node = build({ sessions: [makeSession({ id: 's1', processes: undefined })] }).byAppSessionId.get('s1');
    expect(node?.children).toEqual([]);
  });

  it('only describes sessions the list draws', () => {
    const tree = build({ sessions: [makeSession({ id: 's1' }), makeSession({ id: 'not-listed' })] });
    expect([...tree.byAppSessionId.keys()]).toEqual(['s1']);
  });

  it('leaves a listed session without a node while the monitor does not know it yet', () => {
    expect(build({ sessions: [] }).byAppSessionId.size).toBe(0);
  });

  it('opens a working session to its main agent, and the main agent only when it works and has something under it', () => {
    const working = build({ sessions: [makeSession({ id: 's1', agents: [makeNode({ id: 'a' })] })] }).byAppSessionId.get('s1');
    expect([working?.sessionExpandedByDefault, working?.mainExpandedByDefault]).toEqual([true, true]);

    const noChildren = build({ sessions: [makeSession({ id: 's1' })] }).byAppSessionId.get('s1');
    expect([noChildren?.sessionExpandedByDefault, noChildren?.mainExpandedByDefault]).toEqual([true, false]);

    const idle = build({
      sessions: [makeSession({ id: 's1', state: 'idle', agents: [makeNode({ id: 'a', state: 'done', endedAt: 2 })], orchestrator: { name: 'main', fromProfile: false, state: 'done', lastToolName: null, contextTokens: null, contextWindow: null } })],
    }).byAppSessionId.get('s1');
    expect([idle?.sessionExpandedByDefault, idle?.mainExpandedByDefault]).toEqual([false, false]);
  });

  it('takes the terminal session a chat was resumed in as that chat\'s own picture, not as a second row', () => {
    const resumed = terminal('term-1', { openSessionId: 's1', agents: [makeNode({ id: 'a' })] });
    const tree = build({ sessions: [resumed] });
    expect(tree.byAppSessionId.get('s1')?.sessionKey).toBe('term-1');
    expect(tree.terminalCount).toBe(0);
  });
});

describe('buildRunningTree: terminal sessions', () => {
  it('joins the project row of the same folder, however the folder is written', () => {
    const tree = build({ sessions: [terminal('t1', { projectPath: 'c:/work/alpha/' })] });
    expect(tree.terminalByProjectId.get('alpha')?.map((node) => node.sessionKey)).toEqual(['t1']);
    expect(tree.terminalGroups).toEqual([]);
    expect(tree.terminalCount).toBe(1);
  });

  it('gets a project row of its own, named after the app project that has the folder', () => {
    const tree = build({ sessions: [terminal('t1', { projectPath: 'C:\\work\\Other' })] });
    expect(tree.terminalByProjectId.size).toBe(0);
    expect(tree.terminalGroups).toHaveLength(1);
    expect(tree.terminalGroups[0]).toMatchObject({ name: 'OTHER', path: 'C:\\work\\Other' });
  });

  it('is named after the folder when no app project has it', () => {
    const tree = build({ sessions: [terminal('t1', { projectPath: 'C:\\somewhere\\Scratch Pad' })] });
    expect(tree.terminalGroups[0].name).toBe('Scratch Pad');
  });

  it('has no name at all for a session without a folder (the row says "no folder")', () => {
    const tree = build({ sessions: [terminal('t1', { projectPath: null, projectKey: 'no-folder' })] });
    expect(tree.terminalGroups[0]).toMatchObject({ name: null, path: null });
  });

  it('puts the terminal sessions of one folder in one row, in the snapshot\'s order', () => {
    const tree = build({ sessions: [terminal('t1', { projectPath: 'C:\\x\\Y' }), terminal('t2', { projectPath: 'C:\\x\\Y' })] });
    expect(tree.terminalGroups).toHaveLength(1);
    expect(tree.terminalGroups[0].sessions.map((node) => node.sessionKey)).toEqual(['t1', 't2']);
  });

  it('orders the folder rows: waiting first, then running, then the most recent', () => {
    const tree = build({
      sessions: [
        terminal('running-old', { projectPath: 'C:\\a\\Old', lastEventAt: 100 }),
        terminal('running-new', { projectPath: 'C:\\a\\New', lastEventAt: 900 }),
        terminal('waiting', { projectPath: 'C:\\a\\Wait', state: 'waiting', lastEventAt: 1 }),
      ],
    });
    expect(tree.terminalGroups.map((group) => group.name)).toEqual(['Wait', 'New', 'Old']);
  });

  it('leaves out an idle terminal session unless it is the focused one', () => {
    const idle = terminal('idle-1', { state: 'idle', projectPath: 'C:\\a\\Idle' });
    expect(build({ sessions: [idle] }).terminalCount).toBe(0);
    expect(build({ sessions: [idle], keepSessionKey: 'idle-1' }).terminalCount).toBe(1);
  });

  it('narrows the terminal sessions by the search text (label, folder, project, main agent)', () => {
    const sessions = [terminal('alpha', { projectPath: 'C:\\a\\One' }), terminal('beta', { projectPath: 'C:\\a\\Two' })];
    expect(build({ sessions, search: 'ALP' }).terminalGroups.flatMap((group) => group.sessions.map((node) => node.sessionKey))).toEqual(['alpha']);
    expect(build({ sessions, search: 'two' }).terminalGroups.flatMap((group) => group.sessions.map((node) => node.sessionKey))).toEqual(['beta']);
    expect(build({ sessions, search: 'nothing like it' }).terminalCount).toBe(0);
  });

  it('gives a terminal session the same children as an app session, and marks its chat when the app knows it', () => {
    const tree = build({ sessions: [terminal('t1', { projectPath: 'C:\\a\\One', openSessionId: 'chat-9', agents: [makeNode({ id: 'a' })] })] });
    const node = tree.terminalGroups[0].sessions[0];
    expect(node.chatId).toBe('chat-9');
    expect(node.children.map((row) => row.key)).toEqual(['agent:t1:a']);
  });
});
