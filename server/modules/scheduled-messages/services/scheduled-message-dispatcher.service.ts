import { scheduledMessagesDb, sessionDraftsDb } from '@/modules/database/index.js';
import type { QueuedSessionMessageRecord, ScheduledMessageRow } from '@/modules/database/index.js';
import { announceScheduledMessagesChanged } from '@/modules/scheduled-messages/services/scheduled-messages.service.js';
import { chatRunRegistry, runDetachedChatTurn } from '@/modules/websocket/index.js';
import type { ProviderRuntimeGateway } from '@/modules/websocket/index.js';
import { sessionsService } from '@/modules/providers/index.js';
import { readQueuedChatMessage } from '@/shared/utils.js';

/**
 * How often due messages are looked for.
 *
 * A minute is the granularity the composer offers, and a claim is indexed on
 * `(status, scheduled_for)`, so the poll is one cheap query. Anything finer
 * would buy precision nobody asked for.
 */
const POLL_INTERVAL_MS = 30_000;

let pollTimer: ReturnType<typeof setInterval> | null = null;
const queuedInFlight = new Set<string>();
const scheduledInFlight = new Map<string, Promise<void>>();

function readOptions(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

async function sendClaimedQueuedMessage(
  candidate: QueuedSessionMessageRecord,
  runtime: ProviderRuntimeGateway,
): Promise<void> {
  const message = readQueuedChatMessage(candidate.queuedMessage);
  if (!message) {
    sessionDraftsDb.deleteEmptyDraft(candidate.userId, candidate.sessionId);
    return;
  }

  const restore = (reason: string) => {
    const queuedMessage = { ...message, failure: reason };
    sessionDraftsDb.restoreQueuedMessage({ ...candidate, queuedMessage, claimToken: JSON.stringify(queuedMessage) });
    console.error('[ScheduledMessages] Queued turn was not started; retained for retry', { sessionId: candidate.sessionId, error: reason });
  };
  try {
    const result = await runDetachedChatTurn(
      {
        sessionId: candidate.sessionId,
        userId: candidate.userId,
        content: message.content,
        options: { ...message.options, attachments: message.attachments },
        origin: candidate.origin,
        requireIdle: true,
      },
      { runtime },
    );
    // Every refusal is retained, independent of human-readable error wording.
    if (!result.started) {
      restore(result.error ?? 'The queued turn could not start.');
      return;
    }
    sessionDraftsDb.deleteEmptyDraft(candidate.userId, candidate.sessionId);
  } catch (error) {
    restore(error instanceof Error ? error.message : String(error));
  }
}

/**
 * Whether a queued turn has to keep waiting for the session.
 *
 * A turn that ends with background work still going (a backgrounded command,
 * agent or workflow) is marked completed, but its CLI process stays open so
 * that work can report back. A new turn replaces that process and stops the
 * work, which is why the composer asks before an interactive send. A queued
 * turn was promised to go "when this finishes", so it waits for that work too.
 */
async function isSessionBusy(sessionId: string, runtime: ProviderRuntimeGateway): Promise<boolean> {
  if (chatRunRegistry.isProcessing(sessionId) || runtime.hasBackgroundWork(sessionId)) return true;
  // Use the same CLI-registry-backed definition as the running-sessions endpoint.
  return (await sessionsService.listRunningSessions()).some((entry) => entry.sessionId === sessionId);
}

/** Sends every persisted queued turn whose session is currently idle. */
export async function dispatchQueuedMessages(runtime: ProviderRuntimeGateway): Promise<number> {
  const candidates = sessionDraftsDb.listQueuedMessages();
  let claimed = 0;

  await Promise.all(candidates.map(async (candidate) => {
    if (queuedInFlight.has(candidate.sessionId)) return;
    queuedInFlight.add(candidate.sessionId);
    try {
      if (await isSessionBusy(candidate.sessionId, runtime)) return;
      if (!sessionDraftsDb.claimQueuedMessage(candidate)) return;
      claimed += 1;
      await sendClaimedQueuedMessage(candidate, runtime);
    } finally {
      queuedInFlight.delete(candidate.sessionId);
    }
  }));

  return claimed;
}

/** Records why a claimed message did not go, and shows it on its session's banner. */
function recordFailure(row: ScheduledMessageRow, reason: string): void {
  scheduledMessagesDb.markFailed(row.id, reason);
  announceScheduledMessagesChanged(row.session_id);
}

async function sendClaimedMessage(
  row: ScheduledMessageRow,
  runtime: ProviderRuntimeGateway,
): Promise<void> {
  try {
    const result = await runDetachedChatTurn(
      {
        sessionId: row.session_id,
        userId: row.user_id,
        content: row.content,
        options: readOptions(row.options),
        // A scheduled message fires with nobody watching the chat: it is always remote, whatever origin its row stored, so it
        // can never be given the tools that stage changes for the Host user to confirm. (The stored origin stays as a record.)
        origin: 'remote',
        // The user picked this time on purpose; a run that happens to be going
        // is aborted so the scheduled message lands when it was due, instead
        // of being recorded as "not sent — session was busy".
        interruptActiveRun: true,
      },
      { runtime },
    );

    // Recorded rather than retried, and recorded whether the run never started
    // (deleted session, unavailable provider) or started and then failed.
    // Silently dropping a message the user scheduled is worse than telling
    // them it did not go.
    if (!result.started || result.error) {
      recordFailure(row, result.error ?? 'The session was unavailable when this was due.');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    recordFailure(row, message);
  }
}

/**
 * Sends every message whose time has come.
 *
 * Exported so a test can drive one pass without waiting on the timer.
 */
export async function dispatchDueScheduledMessages(
  runtime: ProviderRuntimeGateway,
  now: Date = new Date(),
): Promise<number> {
  // Claimed before any of them runs, so a long turn cannot let the next poll
  // pick the same message up again.
  const due = scheduledMessagesDb.claimDue(now);
  if (due.length === 0) {
    return 0;
  }

  // The claim already recorded them as sent, so their banners come down now,
  // as the turns start, rather than once the last turn has finished.
  for (const sessionId of new Set(due.map((row) => row.session_id))) {
    announceScheduledMessagesChanged(sessionId);
  }

  // Serialize schedules within a session, including across poll passes. Other
  // sessions run independently, so a long turn cannot hold their due messages.
  await Promise.all(due.map((row) => {
    const previous = scheduledInFlight.get(row.session_id) ?? Promise.resolve();
    const task = previous.then(() => sendClaimedMessage(row, runtime));
    scheduledInFlight.set(row.session_id, task);
    return task.finally(() => {
      if (scheduledInFlight.get(row.session_id) === task) scheduledInFlight.delete(row.session_id);
    });
  }));

  return due.length;
}

/**
 * Starts the poll that sends scheduled messages.
 *
 * The schedule lives in the database, so a message stays scheduled across a
 * restart and one that came due while the server was down is sent on the first
 * poll after it comes back, rather than being skipped.
 */
export function initializeScheduledMessageDispatcher(runtime: ProviderRuntimeGateway): void {
  if (pollTimer) {
    return;
  }

  const poll = () => {
    // Claims and per-session guards prevent duplicates. Do not hold a global
    // scan lock for the lifetime of a provider turn.
    void Promise.all([dispatchDueScheduledMessages(runtime), dispatchQueuedMessages(runtime)])
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[ScheduledMessages] Dispatch pass failed', { error: message });
      });
  };

  pollTimer = setInterval(poll, POLL_INTERVAL_MS);
  // Never keep the process alive just to poll for scheduled messages.
  pollTimer.unref?.();

  // Catch up on anything that came due while the server was not running.
  poll();
}

export function closeScheduledMessageDispatcher(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
