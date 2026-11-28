import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import os, { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, scheduledMessagesDb, sessionDraftsDb, sessionsDb, userDb } from '@/modules/database/index.js';
import { dispatchDueScheduledMessages, dispatchQueuedMessages, initializeScheduledMessageDispatcher, closeScheduledMessageDispatcher } from '@/modules/scheduled-messages/services/scheduled-message-dispatcher.service.js';
import { scheduledMessagesService } from '@/modules/scheduled-messages/services/scheduled-messages.service.js';
import { sessionsService } from '@/modules/providers/index.js';
import { chatRunRegistry, connectedClients } from '@/modules/websocket/index.js';

const SESSION_ID = 'scheduled-session';

async function withIsolatedDatabase(runTest: (userId: number) => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'scheduled-messages-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();

  try {
    const user = userDb.createUser('scheduler', 'hash');
    sessionsDb.createAppSession(SESSION_ID, 'claude', tempDirectory, 'Scheduled session');
    await runTest(Number(user.id));
  } finally {
    chatRunRegistry.clearAll();
    connectedClients.clear();
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

type RunCall = { provider: string; command: string; options: Record<string, unknown> };

function createRuntime(
  runs: RunCall[],
  behaviour: 'ok' | 'throw' = 'ok',
  aborts: string[] = [],
  hasBackgroundWork: (sessionId: string) => boolean = () => false,
) {
  return {
    hasRuntime: () => true,
    hasBackgroundWork,
    run: async (provider: string, command: string, options: Record<string, unknown>) => {
      if (behaviour === 'throw') {
        throw new Error('provider exploded');
      }
      runs.push({ provider, command, options });
    },
    abort: async (_provider: string, sessionId: string) => {
      aborts.push(sessionId);
      return true;
    },
  } as never;
}

/** A chat socket that records what it is sent, standing in for an open browser tab. */
class FakeConnection {
  readyState = 1; // WS_OPEN_STATE
  frames: Array<Record<string, unknown>> = [];

  send(data: string): void {
    this.frames.push(JSON.parse(data) as Record<string, unknown>);
  }

  /** The scheduled-message announcements among everything this socket received. */
  announcements(): Array<Record<string, unknown>> {
    return this.frames.filter((frame) => frame.kind === 'scheduled_messages_changed');
  }
}

function openTab(): FakeConnection {
  const connection = new FakeConnection();
  connectedClients.add(connection as never);
  return connection;
}

test('a message due in the past is sent on the next pass, not skipped', async () => {
  await withIsolatedDatabase(async (userId) => {
    // The server was down when this came due.
    scheduledMessagesService.schedule({
      userId,
      sessionId: SESSION_ID,
      content: 'run the nightly checks',
      scheduledFor: new Date(Date.now() - 60_000).toISOString(),
    });

    const runs: RunCall[] = [];
    const sent = await dispatchDueScheduledMessages(createRuntime(runs));

    assert.equal(sent, 1);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].command, 'run the nightly checks');
    assert.equal(scheduledMessagesDb.listForSession(userId, SESSION_ID)[0].status, 'sent');
  });
});

test('a queued message is sent by the server without a browser connection', async () => {
  await withIsolatedDatabase(async (userId) => {
    sessionDraftsDb.saveDraft(userId, SESSION_ID, {
      text: '',
      queuedMessage: {
        content: 'continue on the VPS',
        options: { model: 'claude-opus-5' },
        attachments: [{ path: '/tmp/upload.png' }],
      },
    });

    const runs: RunCall[] = [];
    assert.equal(await dispatchQueuedMessages(createRuntime(runs)), 1);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].command, 'continue on the VPS');
    assert.equal(runs[0].options.model, 'claude-opus-5');
    assert.deepEqual(runs[0].options.attachments, []);
    assert.equal(sessionDraftsDb.getDrafts(userId).length, 0);
  });
});

test('a queued message stays pending while its session is busy', async () => {
  await withIsolatedDatabase(async (userId) => {
    sessionDraftsDb.saveDraft(userId, SESSION_ID, {
      text: '',
      queuedMessage: { content: 'send after this run' },
    });
    chatRunRegistry.startRun({
      appSessionId: SESSION_ID,
      provider: 'claude',
      providerSessionId: null,
      connection: null,
      userId,
    });

    const runs: RunCall[] = [];
    assert.equal(await dispatchQueuedMessages(createRuntime(runs)), 0);
    assert.equal(runs.length, 0);
    assert.deepEqual(sessionDraftsDb.getDrafts(userId)[0]?.queuedMessage, {
      content: 'send after this run',
    });
  });
});

test('a queued message waits for background work its session\'s last turn left running', async () => {
  await withIsolatedDatabase(async (userId) => {
    sessionDraftsDb.saveDraft(userId, SESSION_ID, {
      text: '',
      queuedMessage: { content: 'send after the background job' },
    });
    // Turn A ended, so its run is completed, but it backgrounded a command
    // that is still running under A's CLI process.
    const runA = chatRunRegistry.startRun({
      appSessionId: SESSION_ID,
      provider: 'claude',
      providerSessionId: null,
      connection: null,
      userId,
    });
    runA!.writer.sendComplete({ exitCode: 0 });
    assert.equal(chatRunRegistry.isProcessing(SESSION_ID), false);

    let backgroundWork = true;
    const runs: RunCall[] = [];
    const runtime = createRuntime(runs, 'ok', [], (sessionId) => sessionId === SESSION_ID && backgroundWork);

    // Starting B now would replace that process and stop the command.
    assert.equal(await dispatchQueuedMessages(runtime), 0);
    assert.equal(runs.length, 0);
    assert.deepEqual(sessionDraftsDb.getDrafts(userId)[0]?.queuedMessage, {
      content: 'send after the background job',
    });

    // Once the work has reported back, B goes on the next pass.
    backgroundWork = false;
    assert.equal(await dispatchQueuedMessages(runtime), 1);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].command, 'send after the background job');
    assert.equal(sessionDraftsDb.getDrafts(userId).length, 0);
  });
});

test('follow-ups queued during one turn are all sent, once, in order, as the next turn', async () => {
  await withIsolatedDatabase(async (userId) => {
    for (const content of ['follow-up A', 'follow-up B', 'follow-up C']) {
      sessionDraftsDb.appendQueuedMessage(userId, SESSION_ID, { content, options: { model: 'opus' }, attachments: [] });
    }

    const runs: RunCall[] = [];
    assert.equal(await dispatchQueuedMessages(createRuntime(runs)), 1);
    assert.equal(await dispatchQueuedMessages(createRuntime(runs)), 0, 'nothing is left to send');

    assert.equal(runs.length, 1);
    assert.equal(runs[0].command, 'follow-up A\n\nfollow-up B\n\nfollow-up C');
    assert.equal(runs[0].options.model, 'opus');
    assert.equal(sessionDraftsDb.getDrafts(userId).length, 0);
  });
});

test('a draft-text save after the queued message was sent does not send it again', async () => {
  await withIsolatedDatabase(async (userId) => {
    sessionDraftsDb.appendQueuedMessage(userId, SESSION_ID, { content: 'send me once', attachments: [] });
    const runs: RunCall[] = [];
    assert.equal(await dispatchQueuedMessages(createRuntime(runs)), 1);

    // The composer keeps saving its text while the user types the next
    // follow-up; its copy of the queue still holds the message just sent.
    sessionDraftsDb.saveDraftText(userId, SESSION_ID, 'typing the next one');

    assert.equal(await dispatchQueuedMessages(createRuntime(runs)), 0);
    assert.deepEqual(runs.map((run) => run.command), ['send me once']);
  });
});

test('a due message interrupts a run in progress instead of failing', async () => {
  await withIsolatedDatabase(async (userId) => {
    scheduledMessagesService.schedule({
      userId,
      sessionId: SESSION_ID,
      content: 'the schedule wins',
      scheduledFor: new Date(Date.now() - 1_000).toISOString(),
    });
    chatRunRegistry.startRun({
      appSessionId: SESSION_ID,
      provider: 'claude',
      providerSessionId: null,
      connection: null,
      userId,
    });

    const runs: RunCall[] = [];
    const aborts: string[] = [];
    assert.equal(await dispatchDueScheduledMessages(createRuntime(runs, 'ok', aborts)), 1);

    assert.deepEqual(aborts, [SESSION_ID]);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].command, 'the schedule wins');
    assert.equal(scheduledMessagesDb.listForSession(userId, SESSION_ID)[0].status, 'sent');
  });
});

test('a message that is not due yet is left alone', async () => {
  await withIsolatedDatabase(async (userId) => {
    scheduledMessagesService.schedule({
      userId,
      sessionId: SESSION_ID,
      content: 'later',
      scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
    });

    const runs: RunCall[] = [];
    assert.equal(await dispatchDueScheduledMessages(createRuntime(runs)), 0);
    assert.equal(runs.length, 0);
    assert.equal(scheduledMessagesDb.listForSession(userId, SESSION_ID)[0].status, 'pending');
  });
});

test('a due message is claimed once, so overlapping passes cannot double-send it', async () => {
  await withIsolatedDatabase(async (userId) => {
    scheduledMessagesService.schedule({
      userId,
      sessionId: SESSION_ID,
      content: 'only once',
      scheduledFor: new Date(Date.now() - 1_000).toISOString(),
    });

    const runs: RunCall[] = [];
    const runtime = createRuntime(runs);
    await Promise.all([
      dispatchDueScheduledMessages(runtime),
      dispatchDueScheduledMessages(runtime),
    ]);

    assert.equal(runs.length, 1);
  });
});

test('the composer settings it was scheduled with travel with it', async () => {
  await withIsolatedDatabase(async (userId) => {
    scheduledMessagesService.schedule({
      userId,
      sessionId: SESSION_ID,
      content: 'with options',
      options: { model: 'claude-opus-5', permissionMode: 'plan' },
      scheduledFor: new Date(Date.now() - 1_000).toISOString(),
    });

    const runs: RunCall[] = [];
    await dispatchDueScheduledMessages(createRuntime(runs));

    assert.equal(runs[0].options.model, 'claude-opus-5');
    assert.equal(runs[0].options.permissionMode, 'plan');
  });
});

test('a provider failure is recorded on the message instead of vanishing', async () => {
  await withIsolatedDatabase(async (userId) => {
    scheduledMessagesService.schedule({
      userId,
      sessionId: SESSION_ID,
      content: 'will fail',
      scheduledFor: new Date(Date.now() - 1_000).toISOString(),
    });

    await dispatchDueScheduledMessages(createRuntime([], 'throw'));

    const row = scheduledMessagesDb.listForSession(userId, SESSION_ID)[0];
    assert.equal(row.status, 'failed');
    assert.match(row.failure_reason ?? '', /provider exploded/);
  });
});

test('a cancelled message never fires', async () => {
  await withIsolatedDatabase(async (userId) => {
    const scheduled = scheduledMessagesService.schedule({
      userId,
      sessionId: SESSION_ID,
      content: 'never mind',
      scheduledFor: new Date(Date.now() - 1_000).toISOString(),
    });
    scheduledMessagesService.cancel(userId, scheduled.id);

    const runs: RunCall[] = [];
    assert.equal(await dispatchDueScheduledMessages(createRuntime(runs)), 0);
    assert.equal(runs.length, 0);
  });
});

test('a failed message can be dismissed, and stays dismissed', async () => {
  await withIsolatedDatabase(async (userId) => {
    const scheduled = scheduledMessagesService.schedule({
      userId,
      sessionId: SESSION_ID,
      content: 'will fail',
      scheduledFor: new Date(Date.now() - 1_000).toISOString(),
    });
    await dispatchDueScheduledMessages(createRuntime([], 'throw'));
    assert.equal(scheduledMessagesDb.listForSession(userId, SESSION_ID)[0].status, 'failed');

    scheduledMessagesService.cancel(userId, scheduled.id);

    assert.equal(scheduledMessagesDb.listForSession(userId, SESSION_ID)[0].status, 'cancelled');
  });
});

test('cancelling something that already fired is refused', async () => {
  await withIsolatedDatabase(async (userId) => {
    const scheduled = scheduledMessagesService.schedule({
      userId,
      sessionId: SESSION_ID,
      content: 'gone',
      scheduledFor: new Date(Date.now() - 1_000).toISOString(),
    });
    await dispatchDueScheduledMessages(createRuntime([]));

    assert.throws(
      () => scheduledMessagesService.cancel(userId, scheduled.id),
      (error: Error & { code?: string }) => error.code === 'SCHEDULED_MESSAGE_NOT_PENDING',
    );
  });
});

test('one user cannot cancel another user\'s scheduled message', async () => {
  await withIsolatedDatabase(async (userId) => {
    const scheduled = scheduledMessagesService.schedule({
      userId,
      sessionId: SESSION_ID,
      content: 'mine',
      scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
    });

    assert.throws(
      () => scheduledMessagesService.cancel(userId + 1, scheduled.id),
      (error: Error & { code?: string }) => error.code === 'SCHEDULED_MESSAGE_NOT_PENDING',
    );
    assert.equal(scheduledMessagesDb.listForSession(userId, SESSION_ID)[0].status, 'pending');
  });
});

test('scheduling validates its input', async () => {
  await withIsolatedDatabase(async (userId) => {
    const base = { userId, sessionId: SESSION_ID, scheduledFor: new Date(Date.now() + 1000).toISOString() };

    assert.throws(
      () => scheduledMessagesService.schedule({ ...base, content: '   ' }),
      (error: Error & { code?: string }) => error.code === 'CONTENT_REQUIRED',
    );
    assert.throws(
      () => scheduledMessagesService.schedule({ ...base, content: 'hi', scheduledFor: 'not a date' }),
      (error: Error & { code?: string }) => error.code === 'INVALID_SCHEDULE_TIME',
    );
    assert.throws(
      () => scheduledMessagesService.schedule({
        ...base,
        content: 'hi',
        scheduledFor: new Date(Date.now() + 400 * 24 * 3600 * 1000).toISOString(),
      }),
      (error: Error & { code?: string }) => error.code === 'SCHEDULE_TOO_FAR_AHEAD',
    );
    assert.throws(
      () => scheduledMessagesService.schedule({ ...base, sessionId: 'nope', content: 'hi' }),
      (error: Error & { code?: string }) => error.code === 'SESSION_NOT_FOUND',
    );
  });
});

// The composer banner is read over REST, so these announcements are the only
// way an open tab learns that its list changed without it doing anything
// (#1546): the banner of a message the timer had already sent stayed up until
// a reload.

test('a due message is announced to open tabs as it is claimed, before its turn runs', async () => {
  await withIsolatedDatabase(async (userId) => {
    scheduledMessagesService.schedule({
      userId,
      sessionId: SESSION_ID,
      content: 'run the nightly checks',
      scheduledFor: new Date(Date.now() - 1_000).toISOString(),
    });
    const tab = openTab();

    let announcedBeforeTheTurn: Array<Record<string, unknown>> = [];
    const runtime = {
      hasRuntime: () => true,
      hasBackgroundWork: () => false,
      run: async () => {
        announcedBeforeTheTurn = tab.announcements();
      },
      abort: async () => true,
    } as never;
    assert.equal(await dispatchDueScheduledMessages(runtime), 1);

    // The banner comes down when the turn starts, not after it finishes,
    // which for a long turn can be many minutes later.
    assert.equal(announcedBeforeTheTurn.length, 1);
    assert.equal(announcedBeforeTheTurn[0].sessionId, SESSION_ID);
    assert.equal(tab.announcements().length, 1);
  });
});

test('a pass announces each session it claimed from once, however many of its messages were due', async () => {
  await withIsolatedDatabase(async (userId) => {
    const otherSessionId = 'other-scheduled-session';
    sessionsDb.createAppSession(otherSessionId, 'claude', tmpdir(), 'Other scheduled session');
    for (const [sessionId, content] of [
      [SESSION_ID, 'first for this session'],
      [SESSION_ID, 'second for this session'],
      [otherSessionId, 'only one for the other session'],
    ]) {
      scheduledMessagesService.schedule({
        userId,
        sessionId,
        content,
        scheduledFor: new Date(Date.now() - 1_000).toISOString(),
      });
    }
    const tab = openTab();

    assert.equal(await dispatchDueScheduledMessages(createRuntime([])), 3);

    // One read per session is enough: a single GET returns all of its rows.
    assert.deepEqual(tab.announcements().map((frame) => frame.sessionId).sort(), [otherSessionId, SESSION_ID]);
  });
});

test('a message that fails to send is announced again once the reason is recorded', async () => {
  await withIsolatedDatabase(async (userId) => {
    scheduledMessagesService.schedule({
      userId,
      sessionId: SESSION_ID,
      content: 'will fail',
      scheduledFor: new Date(Date.now() - 1_000).toISOString(),
    });
    const tab = openTab();

    await dispatchDueScheduledMessages(createRuntime([], 'throw'));

    // Claimed (the banner comes down), then failed (it comes back as the
    // failure notice).
    assert.deepEqual(tab.announcements().map((frame) => frame.sessionId), [SESSION_ID, SESSION_ID]);
    assert.equal(scheduledMessagesDb.listForSession(userId, SESSION_ID)[0].status, 'failed');
  });
});

test('scheduling and cancelling are announced, so other tabs and devices follow', async () => {
  await withIsolatedDatabase(async (userId) => {
    const tab = openTab();

    const scheduled = scheduledMessagesService.schedule({
      userId,
      sessionId: SESSION_ID,
      content: 'from another tab',
      scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
    });
    assert.equal(tab.announcements().length, 1);

    scheduledMessagesService.cancel(userId, scheduled.id);
    assert.equal(tab.announcements().length, 2);

    // A refused cancel changed nothing, so there is nothing to announce.
    assert.throws(() => scheduledMessagesService.cancel(userId, scheduled.id));
    assert.equal(tab.announcements().length, 2);

    // The frame names the session and nothing else: each tab reads the list
    // again through its own authenticated request.
    for (const frame of tab.announcements()) {
      assert.deepEqual(Object.keys(frame).sort(), ['kind', 'sessionId', 'timestamp']);
      assert.equal(frame.sessionId, SESSION_ID);
    }
  });
});

test('a socket that cannot be written to does not stop a claimed message from being sent', async () => {
  await withIsolatedDatabase(async (userId) => {
    scheduledMessagesService.schedule({
      userId,
      sessionId: SESSION_ID,
      content: 'still goes',
      scheduledFor: new Date(Date.now() - 1_000).toISOString(),
    });
    const closedTab = openTab();
    closedTab.readyState = 3; // CLOSED
    connectedClients.add({
      readyState: 1,
      send: () => {
        throw new Error('socket went away mid-send');
      },
    } as never);

    const runs: RunCall[] = [];
    assert.equal(await dispatchDueScheduledMessages(createRuntime(runs)), 1);

    assert.equal(runs.length, 1);
    assert.equal(runs[0].command, 'still goes');
    assert.equal(closedTab.frames.length, 0);
  });
});

// ---------------------------
// Run origin: stored when the row is created, from the request, never from `options`.

const PAST = () => new Date(Date.now() - 60_000).toISOString();

test('a schedule keeps the origin it was created with, but an unattended run is remote whatever it stored', async () => {
  await withIsolatedDatabase(async (userId) => {
    const base = { userId, sessionId: SESSION_ID, scheduledFor: PAST() };
    scheduledMessagesService.schedule({ ...base, content: 'local one', origin: 'local' });
    scheduledMessagesService.schedule({ ...base, content: 'bridged one', origin: 'remote' });
    scheduledMessagesService.schedule({ ...base, content: 'no origin' });

    const runs: RunCall[] = [];
    await dispatchDueScheduledMessages(createRuntime(runs));
    const originOf = (command: string) => runs.find((run) => run.command === command)?.options.origin;
    for (const command of ['local one', 'bridged one', 'no origin']) assert.equal(originOf(command), 'remote', command);
  });
});

test('a row written before the origin column existed (null) runs as remote', async () => {
  await withIsolatedDatabase(async (userId) => {
    const row = scheduledMessagesDb.create({
      userId, sessionId: SESSION_ID, content: 'legacy', options: {}, scheduledFor: new Date(Date.now() - 1000),
    });
    assert.equal(row.origin, null);
    const runs: RunCall[] = [];
    await dispatchDueScheduledMessages(createRuntime(runs));
    assert.equal(runs[0].options.origin, 'remote');
  });
});

test('options saved with a schedule or a queued message cannot claim local', async () => {
  await withIsolatedDatabase(async (userId) => {
    scheduledMessagesService.schedule({
      userId, sessionId: SESSION_ID, content: 'sneaky', options: { origin: 'local' }, scheduledFor: PAST(), origin: 'remote',
    });
    const runs: RunCall[] = [];
    await dispatchDueScheduledMessages(createRuntime(runs));
    assert.equal(runs[0].options.origin, 'remote');

    sessionDraftsDb.saveDraft(userId, SESSION_ID, {
      text: '', queuedMessage: { content: 'sneaky queued', options: { origin: 'local' }, attachments: [] },
    });
    const queuedRuns: RunCall[] = [];
    await dispatchQueuedMessages(createRuntime(queuedRuns));
    assert.equal(queuedRuns[0].options.origin, 'remote');
  });
});

test('a queued message keeps the origin it was queued with, and a merged one is local only if every part was', async () => {
  await withIsolatedDatabase(async (userId) => {
    const message = (content: string) => ({ content, attachments: [] });
    sessionDraftsDb.saveDraft(userId, SESSION_ID, { text: '', queuedMessage: message('saved locally') }, 'local');
    let runs: RunCall[] = [];
    await dispatchQueuedMessages(createRuntime(runs));
    assert.equal(runs[0].options.origin, 'local');

    sessionDraftsDb.appendQueuedMessage(userId, SESSION_ID, message('first'), 'local');
    sessionDraftsDb.appendQueuedMessage(userId, SESSION_ID, message('second'), 'local');
    runs = [];
    await dispatchQueuedMessages(createRuntime(runs));
    assert.equal(runs[0].options.origin, 'local');

    sessionDraftsDb.appendQueuedMessage(userId, SESSION_ID, message('local part'), 'local');
    sessionDraftsDb.appendQueuedMessage(userId, SESSION_ID, message('bridged part'), 'remote');
    runs = [];
    await dispatchQueuedMessages(createRuntime(runs));
    assert.equal(runs[0].options.origin, 'remote');

    sessionDraftsDb.appendQueuedMessage(userId, SESSION_ID, message('no origin given'));
    runs = [];
    await dispatchQueuedMessages(createRuntime(runs));
    assert.equal(runs[0].options.origin, 'remote');
  });
});

test('a queued message restored after a lost race keeps its origin', async () => {
  await withIsolatedDatabase(async (userId) => {
    sessionDraftsDb.appendQueuedMessage(userId, SESSION_ID, { content: 'mine', attachments: [] }, 'local');
    const [candidate] = sessionDraftsDb.listQueuedMessages();
    assert.equal(candidate.origin, 'local');
    assert.ok(sessionDraftsDb.claimQueuedMessage(candidate));
    sessionDraftsDb.restoreQueuedMessage(candidate);
    assert.equal(sessionDraftsDb.listQueuedMessages()[0].origin, 'local');

    // Re-saving the same text from the bridge changes the origin, so a stale local claim no longer matches.
    sessionDraftsDb.saveDraft(userId, SESSION_ID, { text: '', queuedMessage: { content: 'mine', attachments: [] } }, 'remote');
    assert.equal(sessionDraftsDb.claimQueuedMessage(candidate), false);
  });
});

test('POST /api/scheduled-messages stores the origin of the request authentication, not anything in the body', async () => {
  const { default: express } = await import('express');
  const { once } = await import('node:events');
  const { scheduledMessagesRoutes } = await import('@/modules/scheduled-messages/index.js');

  await withIsolatedDatabase(async (userId) => {
    for (const [authKind, expected] of [['session', 'local'], ['loopback', 'remote'], [undefined, 'remote']] as const) {
      const app = express();
      app.use(express.json());
      app.use((req, _res, next) => {
        (req as unknown as { user: { id: number }; authKind?: string }).user = { id: userId };
        (req as unknown as { authKind?: string }).authKind = authKind;
        next();
      });
      app.use('/api/scheduled-messages', scheduledMessagesRoutes);
      const server = app.listen(0, '127.0.0.1');
      await once(server, 'listening');
      try {
        const { port } = server.address() as { port: number };
        const response = await fetch(`http://127.0.0.1:${port}/api/scheduled-messages`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            sessionId: SESSION_ID,
            content: `from ${authKind}`,
            scheduledFor: PAST(),
            origin: 'local',
            options: { origin: 'local' },
          }),
        });
        assert.equal(response.status, 201);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
      const row = scheduledMessagesDb.listForSession(userId, SESSION_ID).find((candidate) => candidate.content === `from ${authKind}`);
      assert.equal(row?.origin, expected, String(authKind));
    }
  });
});


test('a queued turn waits for the CLI registry even without an app run or background tasks', async (t) => {
  await withIsolatedDatabase(async (userId) => {
    let busy = true;
    t.mock.method(sessionsService, 'listRunningSessions', async () => busy ? [{ sessionId: SESSION_ID, canInterrupt: false }] : []);
    sessionDraftsDb.appendQueuedMessage(userId, SESSION_ID, { content: 'wait for external CLI', attachments: [] }, 'remote');
    const runs: RunCall[] = [];
    assert.equal(await dispatchQueuedMessages(createRuntime(runs)), 0);
    assert.equal(sessionDraftsDb.listQueuedMessages().length, 1);
    busy = false;
    assert.equal(await dispatchQueuedMessages(createRuntime(runs)), 1);
    assert.equal(await dispatchQueuedMessages(createRuntime(runs)), 0);
    assert.equal(runs.length, 1);
  });
});

test('an unavailable provider retains the queued message and records why it could not start', async () => {
  await withIsolatedDatabase(async (userId) => {
    sessionDraftsDb.appendQueuedMessage(userId, SESSION_ID, { content: 'keep me', attachments: [] }, 'remote');
    const runtime = { hasRuntime: () => false, hasBackgroundWork: () => false } as never;
    await dispatchQueuedMessages(runtime);
    const queued = sessionDraftsDb.getDrafts(userId)[0]?.queuedMessage as { content: string; failure?: string };
    assert.equal(queued?.content, 'keep me');
    assert.match(queued.failure ?? '', /not available/);
  });
});

test('a lost run-reservation race retains the message regardless of the is/was error wording', async (t) => {
  await withIsolatedDatabase(async (userId) => {
    sessionDraftsDb.appendQueuedMessage(userId, SESSION_ID, { content: 'keep after race', attachments: [] }, 'local');
    t.mock.method(chatRunRegistry, 'startRun', () => null);
    await dispatchQueuedMessages(createRuntime([]));
    const queued = sessionDraftsDb.getDrafts(userId)[0]?.queuedMessage as { content: string; failure?: string };
    assert.equal(queued?.content, 'keep after race');
    assert.match(queued.failure ?? '', /already in progress/);
    assert.equal(sessionDraftsDb.listQueuedMessages()[0].origin, 'local');
  });
});

test('an exception before startup restores the queued message', async () => {
  await withIsolatedDatabase(async (userId) => {
    sessionDraftsDb.appendQueuedMessage(userId, SESSION_ID, { content: 'keep after exception', attachments: [] }, 'remote');
    const runtime = { hasRuntime: () => { throw new Error('startup unavailable'); }, hasBackgroundWork: () => false } as never;
    await dispatchQueuedMessages(runtime);
    const queued = sessionDraftsDb.getDrafts(userId)[0]?.queuedMessage as { content: string; failure?: string };
    assert.equal(queued?.content, 'keep after exception');
    assert.match(queued.failure ?? '', /startup unavailable/);
  });
});


test('a later poll dispatches another session while the first queued turn is still running', async (t) => {
  await withIsolatedDatabase(async (userId) => {
    const runs: string[] = [];
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const runtime = { hasRuntime: () => true, hasBackgroundWork: () => false,
      run: async (_provider: string, content: string) => { runs.push(content); if (content === 'long A') await held; },
      abort: async () => true,
    } as never;
    const originalSetInterval = globalThis.setInterval;
    let poll!: () => void;
    t.mock.method(globalThis, 'setInterval', (callback: () => void) => {
      poll = callback;
      return originalSetInterval(callback, 3_600_000);
    });
    const waitFor = async (content: string) => {
      for (let attempt = 0; attempt < 100 && !runs.includes(content); attempt++) await new Promise((resolve) => setTimeout(resolve, 5));
      assert.ok(runs.includes(content), content + ' should have started');
    };
    sessionsDb.createAppSession('other-queued-session', 'claude', '/tmp/project', 'Other');
    sessionDraftsDb.appendQueuedMessage(userId, SESSION_ID, { content: 'long A', attachments: [] }, 'remote');
    try {
      initializeScheduledMessageDispatcher(runtime);
      await waitFor('long A');
      sessionDraftsDb.appendQueuedMessage(userId, 'other-queued-session', { content: 'ready B', attachments: [] }, 'remote');
      poll();
      await waitFor('ready B');
      poll();
      assert.equal(runs.filter((content) => content === 'long A').length, 1);
      assert.equal(runs.filter((content) => content === 'ready B').length, 1);
    } finally {
      closeScheduledMessageDispatcher(); release();
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  });
});


test('a CLI becoming busy after the scan is rechecked before the queued turn starts', async (t) => {
  await withIsolatedDatabase(async (userId) => {
    let reads = 0;
    t.mock.method(sessionsService, 'listRunningSessions', async () => ++reads === 1 ? [] : [{ sessionId: SESSION_ID }]);
    sessionDraftsDb.appendQueuedMessage(userId, SESSION_ID, { content: 'do not race the CLI', attachments: [] }, 'remote');
    const runs: RunCall[] = [];
    await dispatchQueuedMessages(createRuntime(runs));
    assert.equal(runs.length, 0);
    assert.equal(sessionDraftsDb.listQueuedMessages().length, 1);
  });
});

test('a failed startup preserves a newer queued follow-up and the failure reason', async () => {
  await withIsolatedDatabase(async (userId) => {
    sessionDraftsDb.appendQueuedMessage(userId, SESSION_ID, { content: 'first', attachments: [] }, 'local');
    const runtime = { hasBackgroundWork: () => false, hasRuntime: () => {
      sessionDraftsDb.appendQueuedMessage(userId, SESSION_ID, { content: 'second', attachments: [] }, 'remote');
      return false;
    } } as never;
    await dispatchQueuedMessages(runtime);
    const queued = sessionDraftsDb.getDrafts(userId)[0]?.queuedMessage as { content: string; failure?: string };
    assert.equal(queued.content, 'first\n\nsecond');
    assert.match(queued.failure ?? '', /not available/);
    assert.equal(sessionDraftsDb.listQueuedMessages()[0].origin, 'remote');
  });
});


test('a missing session retains its queued turn with a reason', async (t) => {
  await withIsolatedDatabase(async (userId) => {
    sessionDraftsDb.appendQueuedMessage(userId, SESSION_ID, { content: 'session was removed', attachments: [] }, 'remote');
    t.mock.method(sessionsDb, 'getSessionById', () => null);
    await dispatchQueuedMessages(createRuntime([]));
    const queued = sessionDraftsDb.getDrafts(userId)[0]?.queuedMessage as { content: string; failure?: string };
    assert.equal(queued?.content, 'session was removed');
    assert.match(queued.failure ?? '', /no longer exists/);
  });
});

test('an invalid agent snapshot retains its queued turn with a reason', async (t) => {
  await withIsolatedDatabase(async (userId) => {
    sessionDraftsDb.appendQueuedMessage(userId, SESSION_ID, { content: 'fix agent then retry', attachments: [] }, 'remote');
    t.mock.method(sessionsDb, 'getAgentSnapshot', () => { throw new Error('agent snapshot invalid'); });
    await dispatchQueuedMessages(createRuntime([]));
    const queued = sessionDraftsDb.getDrafts(userId)[0]?.queuedMessage as { content: string; failure?: string };
    assert.equal(queued?.content, 'fix agent then retry');
    assert.match(queued.failure ?? '', /snapshot invalid/);
  });
});


test('the real CLI registry keeps a queued turn until its busy record becomes idle', async (t) => {
  await withIsolatedDatabase(async (userId) => {
    const home = await mkdtemp(path.join(tmpdir(), 'queue-cli-registry-'));
    try {
      await mkdir(path.join(home, '.claude', 'sessions'), { recursive: true });
      t.mock.method(os, 'homedir', () => home);
      sessionsDb.assignProviderSessionId(SESSION_ID, 'queued-native-session');
      const file = path.join(home, '.claude', 'sessions', `${process.pid}.json`);
      const record = { pid: process.pid, sessionId: 'queued-native-session', status: 'busy', entrypoint: 'cli', startedAt: Date.now() };
      await writeFile(file, JSON.stringify(record));
      sessionDraftsDb.appendQueuedMessage(userId, SESSION_ID, { content: 'wait for CLI registry', attachments: [] }, 'remote');
      const runs: RunCall[] = [];
      assert.equal(chatRunRegistry.isProcessing(SESSION_ID), false);
      assert.equal(await dispatchQueuedMessages(createRuntime(runs)), 0);
      assert.equal(sessionDraftsDb.listQueuedMessages().length, 1);
      await writeFile(file, JSON.stringify({ ...record, status: 'idle' }));
      assert.equal(await dispatchQueuedMessages(createRuntime(runs)), 1);
      assert.equal(await dispatchQueuedMessages(createRuntime(runs)), 0);
      assert.equal(runs.length, 1);
    } finally { await rm(home, { recursive: true, force: true }); }
  });
});
