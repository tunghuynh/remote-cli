// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { isSameFolder } from '@/shared/utils';

/** Folder matching used to pick the Agent Profiles project of the sidebar project and to tell whether a session opened elsewhere. */
describe('isSameFolder', () => {
  it('ignores separator style and trailing separators', () => {
    expect(isSameFolder('C:\\Work\\Alpha', 'C:/Work/Alpha/')).toBe(true);
    expect(isSameFolder('/home/me/alpha/', '/home/me/alpha')).toBe(true);
  });

  it('ignores case for Windows paths only', () => {
    expect(isSameFolder('c:\\work\\alpha', 'C:\\Work\\Alpha')).toBe(true);
    expect(isSameFolder('\\\\Server\\Share\\Alpha', '//server/share/alpha')).toBe(true);
    expect(isSameFolder('/home/me/Alpha', '/home/me/alpha')).toBe(false);
  });

  it('reads a Windows long-path prefix as the plain path', () => {
    expect(isSameFolder('\\\\?\\C:\\Work\\Alpha', 'C:\\Work\\Alpha')).toBe(true);
    expect(isSameFolder('\\\\?\\UNC\\server\\share\\alpha', '\\\\server\\share\\alpha')).toBe(true);
  });

  it('tells different folders apart, including a folder and its parent', () => {
    expect(isSameFolder('/work/alpha', '/work/alpha-two')).toBe(false);
    expect(isSameFolder('/work/alpha', '/work')).toBe(false);
    expect(isSameFolder('C:\\', 'C:')).toBe(true);
    expect(isSameFolder('/', '/work')).toBe(false);
  });

  it('never matches an empty path', () => {
    expect(isSameFolder('', '')).toBe(false);
    expect(isSameFolder('  ', '/work')).toBe(false);
  });
});
