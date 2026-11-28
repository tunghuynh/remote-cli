// @vitest-environment node
import assert from 'node:assert/strict';

import { test } from 'vitest';

import {
  formatFullTimestampTooltip,
  formatMessageTimestamp,
  stripProposedPlanEnvelope,
} from '@/modules/chat/utils/chatFormatting';

test('stripProposedPlanEnvelope removes a complete outer plan envelope', () => {
  assert.equal(
    stripProposedPlanEnvelope('<proposed_plan>\n# Session Timeline\n\nPlan body\n</proposed_plan>'),
    '# Session Timeline\n\nPlan body',
  );
});

test('stripProposedPlanEnvelope removes the opening tag while a plan is streaming', () => {
  assert.equal(
    stripProposedPlanEnvelope('<proposed_plan>\n# Partial plan'),
    '# Partial plan',
  );
});

test('stripProposedPlanEnvelope preserves tags that are not the outer envelope', () => {
  const content = 'Use `<proposed_plan>` only for plans.';
  assert.equal(stripProposedPlanEnvelope(content), content);
});

test('stripProposedPlanEnvelope preserves an unmatched terminal closing tag', () => {
  const content = 'Ordinary text that mentions a terminal tag.\n</proposed_plan>';
  assert.equal(stripProposedPlanEnvelope(content), content);
});

test('formatMessageTimestamp returns HH:mm when on the same calendar day', () => {
  const now = new Date(2026, 10, 13, 16, 0, 0); // 13 Nov 2026, 16:00
  const msgTime = new Date(2026, 10, 13, 9, 5, 0); // 13 Nov 2026, 09:05
  assert.equal(formatMessageTimestamp(msgTime, now), '09:05');
});

test('formatMessageTimestamp returns DD/MM/YYYY HH:mm when on a different calendar day', () => {
  const now = new Date(2026, 10, 13, 16, 0, 0); // 13 Nov 2026
  const yesterday = new Date(2026, 10, 12, 14, 30, 0); // 12 Nov 2026, 14:30
  assert.equal(formatMessageTimestamp(yesterday, now), '12/11/2026 14:30');

  const lastYear = new Date(2025, 5, 1, 8, 0, 0); // 01 Jun 2025, 08:00
  assert.equal(formatMessageTimestamp(lastYear, now), '01/06/2025 08:00');
});

test('formatMessageTimestamp handles string ISO, number, stringified epoch, and Date objects', () => {
  const now = new Date(2026, 10, 13, 16, 0, 0);
  const msgDate = new Date(2026, 10, 13, 10, 15, 0);

  assert.equal(formatMessageTimestamp(msgDate.toISOString(), now), '10:15');
  assert.equal(formatMessageTimestamp(msgDate.getTime(), now), '10:15');
  assert.equal(formatMessageTimestamp(String(msgDate.getTime()), now), '10:15');
  assert.equal(formatMessageTimestamp(msgDate, now), '10:15');
});

test('formatMessageTimestamp returns empty string on invalid or null/undefined inputs', () => {
  assert.equal(formatMessageTimestamp(null), '');
  assert.equal(formatMessageTimestamp(undefined), '');
  assert.equal(formatMessageTimestamp(''), '');
  assert.equal(formatMessageTimestamp('not-a-date'), '');
});

test('formatFullTimestampTooltip formats as DD/MM/YYYY HH:mm:ss', () => {
  const date = new Date(2026, 10, 13, 9, 5, 7);
  assert.equal(formatFullTimestampTooltip(date), '13/11/2026 09:05:07');
  assert.equal(formatFullTimestampTooltip(null), '');
  assert.equal(formatFullTimestampTooltip('invalid'), '');
});

