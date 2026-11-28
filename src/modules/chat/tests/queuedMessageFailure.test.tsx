import assert from 'node:assert/strict';

import { render, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, test, vi } from 'vitest';

import QueuedMessageCard from '@/modules/chat/composer/QueuedMessageCard';
import '@/modules/i18n';
afterEach(cleanup);
test('a retained queue failure is readable and preserves edit/delete actions', () => {
  const onEdit = vi.fn(); const onDelete = vi.fn();
  const view = render(<QueuedMessageCard content="unsent message" failure="Provider is not available." onEdit={onEdit} onDelete={onDelete} />);
  assert.equal(view.getByRole('status').textContent, 'Provider is not available.');
  assert.ok(view.getByText('unsent message'));
  fireEvent.click(view.getByRole('button', { name: /edit queued/i }));
  fireEvent.click(view.getByRole('button', { name: /delete queued/i }));
  assert.equal(onEdit.mock.calls.length, 1); assert.equal(onDelete.mock.calls.length, 1);
});
