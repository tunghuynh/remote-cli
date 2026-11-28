// @vitest-environment node
import assert from 'node:assert/strict';

import { test } from 'vitest';

import { splitStreamingMarkdown } from '@/modules/chat/utils/streamingMarkdown';

/**
 * The split is only sound if `settled + pending === content` and the two halves
 * render the same as the whole. Every case below either asserts a safe boundary
 * or asserts that a context-sensitive construct is kept intact.
 */

const assertLossless = (content: string) => {
  const { settled, pending } = splitStreamingMarkdown(content);
  assert.equal(settled + pending, content, 'split must not lose or duplicate text');
};

test('an empty message splits into nothing', () => {
  assert.deepEqual(splitStreamingMarkdown(''), { settled: '', pending: '' });
});

test('a message with no completed block is entirely pending', () => {
  const content = 'The first sentence is still being written';
  assert.deepEqual(splitStreamingMarkdown(content), { settled: '', pending: content });
  assertLossless(content);
});

test('a completed paragraph settles and the partial one stays pending', () => {
  const content = 'First paragraph.\n\nSecond para still stre';
  const { settled, pending } = splitStreamingMarkdown(content);

  assert.equal(settled, 'First paragraph.\n\n');
  assert.equal(pending, 'Second para still stre');
  assertLossless(content);
});

test('a completed block settles and the rest stays pending: paragraphs, closed fences, headings, exact boundaries', () => {
  const rows: Array<[string, string, string, string]> = [
    ['the boundary advances to the last completed block', 'One.\n\nTwo.\n\nThree partial', 'One.\n\nTwo.\n\n', 'Three partial'],
    ['a closed code fence can be settled', '```ts\nconst a = 1;\n```\n\nAfter the block', '```ts\nconst a = 1;\n```\n\n', 'After the block'],
    ['a heading is a safe boundary', '# Title\n\nBody text still coming', '# Title\n\n', 'Body text still coming'],
    ['content ending exactly on a boundary leaves nothing pending', 'Done.\n\n', 'Done.\n\n', ''],
  ];
  for (const [label, content, settled, pending] of rows) {
    const result = splitStreamingMarkdown(content);
    assert.equal(result.settled, settled, label);
    assert.equal(result.pending, pending, label);
  }
});

test('an unterminated code fence keeps the whole block pending', () => {
  const content = 'Intro.\n\n```ts\nconst a = 1;\n\nconst b = 2;\n';
  const { settled, pending } = splitStreamingMarkdown(content);

  assert.equal(settled, 'Intro.\n\n');
  assert.ok(pending.startsWith('```ts'), 'the open fence must stay in one piece');
  assertLossless(content);
});

test('a blank line inside a loose list is not a boundary', () => {
  // Splitting here would restart the numbering at 1 in the second half.
  const content = '1. first\n\n2. second\n\n3. third partial';
  const { settled } = splitStreamingMarkdown(content);

  assert.equal(settled, '', 'must never split a list');
});

test('a blank line inside a bullet list, blockquote or table is not a boundary', () => {
  const rows: Array<[string, string]> = [
    ['between bullet items', '- alpha\n\n- beta\n\n- gamma partial'],
    ['adjacent to a blockquote', '> quoted line\n\n> continued quote partial'],
    ['adjacent to a table', '| a | b |\n| - | - |\n\n| 1 | 2 |'],
  ];
  for (const [label, content] of rows) {
    assert.equal(splitStreamingMarkdown(content).settled, '', label);
  }
});

test('a paragraph before a list settles without splitting the list', () => {
  const content = 'Here are the steps.\n\n- first\n- second partial';
  const { settled, pending } = splitStreamingMarkdown(content);

  assert.equal(settled, '', 'the list start is context-sensitive, so no split yet');
  assert.equal(pending, content);
});

test('the settled prefix only grows as more of the reply arrives', () => {
  const full = 'Alpha para.\n\nBeta para.\n\nGamma still going';
  let previousSettledLength = 0;

  for (let end = 1; end <= full.length; end++) {
    const chunk = full.slice(0, end);
    const { settled } = splitStreamingMarkdown(chunk);
    assertLossless(chunk);
    assert.ok(
      settled.length >= previousSettledLength,
      `settled prefix shrank at length ${end}: ${settled.length} < ${previousSettledLength}`,
    );
    previousSettledLength = settled.length;
  }
});

test('every prefix of a fenced reply stays lossless', () => {
  const full = 'Intro.\n\n```js\nconst x = 1;\n```\n\nOutro para.\n\nTail';
  for (let end = 1; end <= full.length; end++) {
    assertLossless(full.slice(0, end));
  }
});

test('a self-closing $$x$$ line does not leave math tracking stuck open', () => {
  // Toggling on a line that opens and closes in one go would suppress every
  // later boundary, silently disabling the optimisation for the rest of the reply.
  const content = 'Intro.\n\n$$E = mc^2$$\n\nA settled paragraph.\n\nStill writing';
  const { settled, pending } = splitStreamingMarkdown(content);

  assert.equal(pending, 'Still writing');
  assert.ok(settled.includes('A settled paragraph.'));
});

test('a blank line inside an unterminated $$ block is not a boundary', () => {
  // This is the shape mid-stream: the closing $$ has not arrived yet.
  const content = 'Intro.\n\n$$\na = b\n\nc = d';
  const { settled, pending } = splitStreamingMarkdown(content);

  assert.equal(settled, 'Intro.\n\n', 'the open math block must stay in one piece');
  assert.equal(pending, '$$\na = b\n\nc = d');
});

test('a closed $$ block can be settled once its delimiter arrives', () => {
  const content = 'Intro.\n\n$$\na = b\n\nc = d\n$$\n\nAfter';
  const { settled, pending } = splitStreamingMarkdown(content);

  assert.equal(settled, 'Intro.\n\n$$\na = b\n\nc = d\n$$\n\n');
  assert.equal(pending, 'After');
});
