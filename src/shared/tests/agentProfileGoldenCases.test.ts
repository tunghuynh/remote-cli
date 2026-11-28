// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  defaultAgentDescription,
  effectiveAgentValues,
  extractPlaceholderKeys,
  findParamKeyProblem,
  isValidAgentProfileName,
  isValidProfileSlug,
  renderTemplateInstructions,
} from '@/shared/utils';

// The golden file sits at the repo root so the server suite reads the very same cases.
// eslint-disable-next-line no-restricted-imports
import golden from '../../../shared/agent-profile-golden-cases.json';

/**
 * Drift guard: the client keeps copies of server rules (rendering, names, values, patterns) for previews and
 * form warnings. The same golden cases run against the server's implementations in
 * server/modules/agent-profiles/tests/agent-profile-golden-cases.test.ts.
 */

/** Expands the `{64x}` shorthand of the golden file into that many x characters. */
const expand = (text: string): string => text.replace(/\{(\d+)x\}/g, (_match, count: string) => 'x'.repeat(Number(count)));
const repeated = (entries: Record<string, [string, number]>): Record<string, string> =>
  Object.fromEntries(Object.entries(entries).map(([key, [character, count]]) => [key, character.repeat(count)]));

describe('golden cases, client side', () => {
  it.each(golden.render)('render: $name', (item) => {
    const optional = item as { valuesRepeat?: Record<string, [string, number]>; expectedRepeat?: { prefix: string; repeat: [string, number]; suffix: string } };
    const values: Record<string, string> = { ...(item.values as Record<string, string>), ...repeated(optional.valuesRepeat ?? {}) };
    const repeatExpectation = optional.expectedRepeat;
    const expected = repeatExpectation
      ? `${repeatExpectation.prefix}${repeatExpectation.repeat[0].repeat(repeatExpectation.repeat[1])}${repeatExpectation.suffix}`
      : item.expected;
    expect(renderTemplateInstructions(item.instructions, values)).toBe(expected);
  });

  it.each(golden.effectiveValues)('effective values: $name', (item) => {
    expect(effectiveAgentValues({ params: item.params }, item.project, item.agentValues as Record<string, string>)).toEqual(item.expected);
  });

  it.each(golden.defaultDescription)('default description: $name', (item) => {
    expect(defaultAgentDescription(item.template)).toBe(item.expected);
  });

  it.each(golden.placeholderKeys)('placeholder keys: $text', (item) => {
    expect(extractPlaceholderKeys(item.text)).toEqual(item.expected);
  });

  it('slug, parameter key and agent name patterns agree', () => {
    for (const slug of golden.slugs.valid) expect(isValidProfileSlug(slug), `slug ${slug}`).toBe(true);
    for (const slug of golden.slugs.invalid) expect(isValidProfileSlug(slug), `slug ${slug}`).toBe(false);
    for (const key of golden.paramKeys.valid) expect(findParamKeyProblem([key], 0), `key ${key}`).toBeNull();
    for (const key of golden.paramKeys.invalid) expect(findParamKeyProblem([key], 0), `key ${key}`).toBe('invalid');
    for (const name of golden.agentNames.valid) expect(isValidAgentProfileName(expand(name)), `name ${name}`).toBe(true);
    for (const name of golden.agentNames.invalid) expect(isValidAgentProfileName(expand(name)), `name ${name}`).toBe(false);
  });
});
