// @vitest-environment node
import assert from 'node:assert/strict';

import { test } from 'vitest';

import {
  clearDirectoryLoadError,
  collectPartialDirectories,
  replaceDirectoryChildren,
} from '@/modules/file-tree/utils/fileTreeUtils';
import type { FileTreeNode } from '@/shared/types';

const file = (path: string): FileTreeNode => ({ type: 'file', name: path.split('/').pop()!, path });
const directory = (path: string, children: FileTreeNode[] = [], extra: Partial<FileTreeNode> = {}): FileTreeNode => ({
  type: 'directory',
  name: path.split('/').pop()!,
  path,
  children,
  ...extra,
});

test('collectPartialDirectories finds the unlisted folders at any depth', () => {
  const tree = [
    directory('/p/a', [directory('/p/a/deep', [], { partial: true })]),
    directory('/p/b', [], { partial: true }),
    file('/p/readme.md'),
  ];
  assert.deepEqual(collectPartialDirectories(tree).map((node) => node.path), ['/p/a/deep', '/p/b']);
});

test('replaceDirectoryChildren puts the listing in place, clears the flags and shares the rest of the tree', () => {
  const untouched = directory('/p/a', [file('/p/a/x.ts')]);
  const target = directory('/p/b', [], { partial: true, loadError: true });
  const tree = [untouched, target];
  const listing = [file('/p/b/y.ts')];

  const next = replaceDirectoryChildren(tree, '/p/b', listing);

  assert.equal(next[0], untouched, 'a branch that was not on the way is the same object');
  assert.deepEqual(next[1], { type: 'directory', name: 'b', path: '/p/b', children: listing });
  assert.equal(target.partial, true, 'the previous tree is not mutated');
});

test('replaceDirectoryChildren reaches a nested folder and leaves the tree alone when the path is unknown', () => {
  const tree = [directory('/p/a', [directory('/p/a/inner', [], { partial: true })])];

  const next = replaceDirectoryChildren(tree, '/p/a/inner', [file('/p/a/inner/z.ts')]);
  assert.equal(next[0].children?.[0].children?.[0].name, 'z.ts');
  assert.equal(next[0].children?.[0].partial, undefined);

  assert.equal(replaceDirectoryChildren(tree, '/p/missing', []), tree);
});

test('a failed listing marks the folder, and clearing the mark allows another try', () => {
  const tree = [directory('/p/a', [], { partial: true })];

  const failed = replaceDirectoryChildren(tree, '/p/a', null);
  assert.equal(failed[0].loadError, true);
  assert.equal(failed[0].partial, true, 'the folder is still unlisted');

  const retried = clearDirectoryLoadError(failed, '/p/a');
  assert.equal(retried[0].loadError, undefined);
  assert.equal(retried[0].partial, true);

  assert.equal(clearDirectoryLoadError(retried, '/p/a'), retried, 'nothing to clear: same tree back');
});
