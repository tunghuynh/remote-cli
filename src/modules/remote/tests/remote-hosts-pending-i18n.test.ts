// @vitest-environment node
import { expect, test } from 'vitest';

import { i18n } from '@/modules/i18n';

const KEYS = ['loading', 'loadError', 'retry', 'openLocal'] as const;

const locales = Object.keys(i18n.options.resources ?? {});

test('SF-02: every registered locale is checked', () => {
  expect(locales.length).toBeGreaterThanOrEqual(15);
});

// The state shown while the saved Host's list is unknown must not fall back to English.
test.each(locales)('SF-02: %s translates every Host-list state string', (locale) => {
  const bundle = i18n.getResourceBundle(locale, 'common') as { remoteHosts?: Record<string, unknown> };
  for (const key of KEYS) {
    const value = bundle?.remoteHosts?.[key];
    expect(typeof value === 'string' && value.trim().length > 0, `${locale} remoteHosts.${key}`).toBe(true);
  }
});
