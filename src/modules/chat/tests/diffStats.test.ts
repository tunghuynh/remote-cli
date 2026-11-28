// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { calculateDiff, summarizeDiff } from '@/modules/chat/utils/messageTransforms';

const count = (oldStr: string, newStr: string) => summarizeDiff(calculateDiff(oldStr, newStr));

describe('diff line counting', () => {
  it('counts added and removed lines for every kind of edit', () => {
    const rows: Array<[string, string, string, { added: number; removed: number }]> = [
      ['a replaced line is one added and one removed', 'a\nb\nc', 'a\nB\nc', { added: 1, removed: 1 }],
      ['a pure insertion removes nothing', 'a\nc', 'a\nb\nc', { added: 1, removed: 0 }],
      ['a pure deletion adds nothing', 'a\nb\nc', 'a\nc', { added: 0, removed: 1 }],
      ['an edit that changes nothing reports nothing', 'a\nb\nc', 'a\nb\nc', { added: 0, removed: 0 }],
      ['emptying a file is pure deletions', 'a\nb\nc', '', { added: 0, removed: 3 }],
      ['a genuinely blank trailing line still counts', 'a\n', 'a\n\n', { added: 1, removed: 0 }],
      ['an empty-to-empty edit reports nothing', '', '', { added: 0, removed: 0 }],
    ];
    for (const [label, before, after, expected] of rows) {
      expect(count(before, after), label).toEqual(expected);
    }
  });

  // Write passes '' as the "before" for a file that did not exist. Splitting
  // that on '\n' yields [''] — one phantom blank line — which used to be
  // reported as a deletion and drawn as a stray empty red row.
  it('treats a new file as pure additions whether or not it ends in a newline', () => {
    expect(count('', 'a\nb\nc')).toEqual({ added: 3, removed: 0 });
    expect(count('', 'a\nb\nc\n')).toEqual({ added: 3, removed: 0 });
  });

  // A trailing newline terminates the last line; it does not start a new blank
  // one. Otherwise the same content counts differently depending on whether
  // the file happens to end in a newline.
  it('does not count a trailing newline as an extra line', () => {
    expect(count('a\nb', 'a\nb\n')).toEqual({ added: 0, removed: 0 });
    expect(count('a\nb\n', 'a\nb\nc\n')).toEqual({ added: 1, removed: 0 });
  });

  it('renders no diff rows for a new file beyond its own lines', () => {
    const lines = calculateDiff('', 'a\nb\nc');
    expect(lines.map((line) => line.type)).toEqual(['added', 'added', 'added']);
    expect(lines.map((line) => line.content)).toEqual(['a', 'b', 'c']);
  });
});
