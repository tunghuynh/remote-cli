// @vitest-environment node
/**
 * The tab's mirror of the Host's deny list (`target-route-policy.ts`) must not drift from the real table
 * (`server/modules/remote/policy/route-rules.ts`, pure data). The server is authoritative; the mirror only saves
 * a wall of refused requests, but a deny rule added on the server without its mirror (or a mirror typo) would
 * go unnoticed otherwise. Both directions are checked against the server table itself.
 */

import { describe, expect, it } from 'vitest';

import { isBlockedInTargetMode } from '@/shared/transport/target-route-policy';

// The point of this test is to read the server's own table (pure data, no imports); no alias reaches `server/`.
// eslint-disable-next-line no-restricted-imports
import { REMOTE_ALLOW_RULES, REMOTE_DENY_RULES } from '../../../server/modules/remote/policy/route-rules';

/** Deny rules a tab never fetches (so the mirror has no entry for them), with the reason. */
const NOT_FETCHED_BY_THE_TAB: Record<string, string> = {
  '/api/auth/**': 'the Controller answers /api/auth/user and /api/auth/status itself; nothing else is requested',
  '/health': 'the Controller answers its own /health',
  '/r/**': 'the proxy mount, never a Host path',
  '/plugin-ws/**': 'a WebSocket path, not fetched',
  '/desktop-notifications': 'a WebSocket path, not fetched',
};

const sampleOf = (pattern: string, tail = 'sub/path'): string => pattern.replace(/\/\*\*$/, `/${tail}`).replace(/\*/g, 'x1');

/** Independent matcher for the table's pattern syntax (`*` = one segment, trailing `/**` = prefix and below). */
const patternMatches = (pattern: string, path: string): boolean => {
  const want = pattern.split('/').filter(Boolean);
  const have = decodeURIComponent(path.split('?')[0]).toLowerCase().split('/').filter(Boolean);
  const rest = want[want.length - 1] === '**';
  const head = rest ? want.slice(0, -1) : want;
  if (rest ? have.length < head.length : have.length !== head.length) return false;
  return head.every((part, index) => part === '*' || part === have[index]);
};

const deniedByServer = (path: string): boolean => REMOTE_DENY_RULES.some((rule) => patternMatches(rule.pattern, path));

describe('the tab mirror of the Host deny list', () => {
  const mirrored = REMOTE_DENY_RULES.filter((rule) => !(rule.pattern in NOT_FETCHED_BY_THE_TAB));

  it('the exemption list only names deny rules that exist on the server (a removed rule must leave it)', () => {
    const patterns = REMOTE_DENY_RULES.map((rule) => rule.pattern);
    for (const exempt of Object.keys(NOT_FETCHED_BY_THE_TAB)) expect(patterns, exempt).toContain(exempt);
  });

  it('blocks a sample of every server deny rule that a tab could fetch, in any case and with a query', () => {
    expect(mirrored.length).toBeGreaterThan(10);
    for (const rule of mirrored) {
      const samples = [sampleOf(rule.pattern), sampleOf(rule.pattern, 'a/b/c')];
      if (rule.pattern.endsWith('/**')) samples.push(rule.pattern.slice(0, -3).replace(/\*/g, 'x1')); // the prefix itself
      for (const sample of samples) {
        expect(isBlockedInTargetMode(sample), `${rule.pattern}: ${sample}`).toBe(true);
        expect(isBlockedInTargetMode(`${sample.toUpperCase()}?a=1`), `${rule.pattern}: ${sample.toUpperCase()}`).toBe(true);
      }
    }
  });

  it('blocks nothing the server would let through: no allow rule of the server is blocked', () => {
    for (const rule of REMOTE_ALLOW_RULES) {
      const sample = sampleOf(rule.pattern);
      expect(isBlockedInTargetMode(sample), `${rule.methods[0]} ${rule.pattern}`).toBe(false);
    }
  });

  it('everything the mirror blocks is denied by the server table too (no client-only deny, no typo)', () => {
    const blocked = [
      '/api/plugins',
      '/api/plugins/x/enable',
      '/api/taskmaster/installation-status',
      '/api/settings/api-keys',
      '/api/voice/health',
      '/api/notifications/endpoints',
      '/api/browser-use/status',
      '/api/browser-use-mcp/tools/t',
      '/api/system/update',
      '/api/agent',
      '/api/remote/peers',
      '/api/user/git-config',
      '/api/user/preferences',
      '/api/providers/mcp/servers/global',
      '/api/agent-profiles/templates',
      '/api/agent-profiles/generate',
      '/api/agent-profiles/generate/values',
      '/api/agent-profiles/claude-agents/hidden',
      '/api/agent-profiles/memory-blocks',
      '/api/agent-profiles/memory-blocks/b1',
      '/api/providers/claude/auth/status',
      '/api/providers/claude/cli',
      '/api/providers/claude/cli/update',
      '/api/providers/claude/mcp/servers',
      '/api/providers/claude/settings-permissions',
      '/api/projects/p1/taskmaster',
      '/api/%70lugins',
    ];
    for (const path of blocked) {
      expect(isBlockedInTargetMode(path), `mirror ${path}`).toBe(true);
      expect(deniedByServer(path), `server ${path}`).toBe(true);
    }
  });

  it('keeps routes the UI needs unblocked, including look-alikes of blocked families', () => {
    for (const path of [
      '/api/providers/claude/models',
      '/api/providers/claude/skills',
      '/api/providers/claude/capabilities',
      '/api/providers/sessions/running',
      '/api/projects/p1/sessions',
      '/api/user/drafts',
      '/api/user/onboarding-status',
      '/api/agent-profiles/scope-options',
      // The monitor (its snapshot and its kill button) is open to a Remote controller (the owner's decision); its tab mirror must not block it.
      '/api/agent-monitor/snapshot',
      '/api/agent-monitor/summary',
      '/api/git/status',
      '/api/file-tree/projects/p1/files',
    ]) {
      expect(isBlockedInTargetMode(path), path).toBe(false);
      expect(deniedByServer(path), `server ${path}`).toBe(false);
    }
  });
});
