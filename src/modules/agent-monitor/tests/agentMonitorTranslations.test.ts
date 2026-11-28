// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { i18n } from '@/modules/i18n';

/**
 * Every string of the Agent Monitor goes through the app's i18n. `fallbackLng: 'en'` hides a missing key by rendering the
 * key itself, so this reads every `t('...')` literal in the module and asks i18next whether the English bundle has it,
 * then does the same for the key families built at run time (states, resource kinds).
 */

const MODULE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const sourceFiles = (directory: string): string[] =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'tests' ? [] : sourceFiles(full);
    return entry.name.endsWith('.tsx') || entry.name.endsWith('.ts') ? [full] : [];
  });

const resolves = (key: string): boolean => i18n.exists(`agentMonitor:${key}`, { lng: 'en' });

describe('Agent Monitor translations', () => {
  const keys = [...new Set(sourceFiles(MODULE_DIR).flatMap((file) =>
    [...fs.readFileSync(file, 'utf8').matchAll(/\bt\(\s*'([^'$]+)'/g)].map((match) => match[1])))];

  it('finds the keys the module uses (guard against the scan silently matching nothing)', () => {
    expect(keys.length).toBeGreaterThan(30);
  });

  it('has an English string for every key the module uses', () => {
    expect(keys.filter((key) => !resolves(key))).toEqual([]);
  });

  it('has a string for every key family built at run time', () => {
    const dynamic = [
      ...['running', 'waiting', 'done', 'failed', 'stopped', 'idle'].map((state) => `state.${state}`),
      ...['elapsed', 'cpu', 'memory', 'context', 'tokens', 'tools', 'processes'].map((stat) => `graph.stat.${stat}`),
      // One line for EVERY word the kill route can answer with (the client picks the key from the result).
      ...['killed', 'stopped', 'gone', 'noHandle', 'unavailable', 'refused', 'error'].map((result) => `graph.kill.result.${result}`),
      // Chosen with a ternary inside `t(...)`, which the literal scan above cannot see.
      'tree.expand',
      'tree.collapse',
      'tree.tokens',
      'tree.tokensApprox',
    ];
    expect(dynamic.filter((key) => !resolves(key))).toEqual([]);
  });

  it('keeps no explanatory or how-to text: the notes, hints and legend are gone from the bundle', () => {
    const removed = [
      'pane.derivedNote', 'tree.terminalHint', 'graph.hint', 'graph.legend', 'usage.tokenNote', 'limits.note',
    ];
    expect(removed.filter(resolves)).toEqual([]);
  });

  it('has the short forms of the empty and measuring states', () => {
    const text = (key: string) => i18n.t(`agentMonitor:${key}`, { lng: 'en' });
    expect(text('graph.empty')).toBe('Nothing is running.');
    expect(text('usage.measuring')).toBe('Measuring…');
    expect(text('usage.noTokens')).toBe('—');
  });

  it('names the process toggle in both states', () => {
    const text = (key: string) => i18n.t(`agentMonitor:${key}`, { lng: 'en' });
    expect(text('graph.processes.show')).toBe('Show child processes');
    expect(text('graph.processes.hide')).toBe('Hide child processes');
  });

  it('no longer names a settings tab or the header Activity entry (the monitor lives in the Running tab)', () => {
    expect(i18n.exists('settings:mainTabs.agentMonitor', { lng: 'en' })).toBe(false);
    expect(i18n.exists('agentMonitor:activity.title', { lng: 'en' })).toBe(false);
    expect(i18n.exists('agentMonitor:graph.openSession', { lng: 'en' })).toBe(false);
  });
});
