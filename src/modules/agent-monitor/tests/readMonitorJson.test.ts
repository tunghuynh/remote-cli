// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { isMonitorSnapshot, MonitorApiError, readMonitorJson } from '@/modules/agent-monitor/data/readMonitorJson';
import { makeSnapshot } from '@/modules/agent-monitor/tests/monitorFixtures';

/**
 * The monitor must never turn an answer it does not understand into an empty picture: a dev proxy that returns the app's
 * index.html for an API path the (outdated) server does not have used to leave the screen silently empty.
 */

const html = (status = 200) => new Response('<!doctype html><html><body><div id="root"></div></body></html>', { status, headers: { 'Content-Type': 'text/html' } });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const failureOf = async (response: Response, isShape: (value: unknown) => boolean = isMonitorSnapshot): Promise<MonitorApiError> => {
  const error = await readMonitorJson(response, isShape as (value: unknown) => value is unknown).then(() => null, (thrown: unknown) => thrown);
  expect(error).toBeInstanceOf(MonitorApiError);
  return error as MonitorApiError;
};

describe('readMonitorJson', () => {
  it('returns the body of a good snapshot', async () => {
    const snapshot = makeSnapshot();
    expect(await readMonitorJson(json(snapshot), isMonitorSnapshot)).toEqual(snapshot);
  });

  it('treats an HTML page answered with 200 (a dev proxy falling back to index.html) as an unreachable API, not as nothing running', async () => {
    const error = await failureOf(html(200));
    expect(error.kind).toBe('unreachable');
  });

  it('treats an HTML error page, an empty body and plain text the same way', async () => {
    expect((await failureOf(html(502))).kind).toBe('unreachable');
    expect((await failureOf(new Response('', { status: 200 }))).kind).toBe('unreachable');
    expect((await failureOf(new Response('Bad Gateway', { status: 502 }))).kind).toBe('unreachable');
  });

  it('treats JSON of another shape as unreachable: an outdated server without the project grouping is one', async () => {
    const outdated = { ...makeSnapshot() } as Partial<ReturnType<typeof makeSnapshot>>;
    delete outdated.projects;
    expect((await failureOf(json(outdated))).kind).toBe('unreachable');
    expect((await failureOf(json({ ok: true }))).kind).toBe('unreachable');
    expect((await failureOf(json([]))).kind).toBe('unreachable');
  });

  it('keeps the server\'s own message for an error it answered itself', async () => {
    const error = await failureOf(json({ success: false, error: { message: 'boom' } }, 500));
    expect([error.kind, error.status, error.message]).toEqual(['http', 500, 'boom']);
    expect((await failureOf(json({ error: 'forbidden' }, 403))).message).toBe('forbidden');
    expect((await failureOf(json({}, 500))).message).toBe('Request failed (500)');
  });
});
