// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  analyzeTemplatePlaceholders,
  defaultAgentDescription,
  effectiveAgentValues,
  extractPlaceholderKeys,
  isAbsoluteDirectoryPath,
  isValidAgentProfileName,
  isValidProfileSlug,
  looksLikeRepositoryUrl,
  renderTemplateInstructions,
  slugifyProfileName,
} from '@/shared/utils';

describe('placeholder analysis', () => {
  it('lists each {{key}} once, in first-seen order, tolerating inner spaces', () => {
    expect(extractPlaceholderKeys('a {{git_url}} b {{ guideline }} c {{git_url}} {{1bad}}')).toEqual(['git_url', 'guideline']);
  });

  it('reports a key without a parameter as missing, and a parameter nobody uses as unused', () => {
    expect(analyzeTemplatePlaceholders('Use {{git_url}} and {{nope}}', ['git_url', 'extra'])).toEqual({
      missing: ['nope'],
      unused: ['extra'],
    });
  });

  it('accepts the reserved project keys without a parameter', () => {
    expect(analyzeTemplatePlaceholders('{{project_name}} in {{project_directory}}', [])).toEqual({ missing: [], unused: [] });
  });
});

describe('repository addresses', () => {
  it('recognizes web, SSH and scp-style addresses and nothing else', () => {
    for (const good of ['https://git.example.com/org/repo.git', 'http://host/x', 'ssh://git@host:22/org/repo', 'git@github.com:org/repo.git', 'user@host.example:path/repo', 'git.example.com:org/repo']) {
      expect(looksLikeRepositoryUrl(good), good).toBe(true);
    }
    for (const bad of ['', 'repo', 'not a url', 'C:\\work\\repo', '/home/me/repo', 'https://', 'host:']) {
      expect(looksLikeRepositoryUrl(bad), bad).toBe(false);
    }
  });

  it('checks the slug pattern with its 40-character limit', () => {
    expect(isValidProfileSlug('code-review')).toBe(true);
    expect(isValidProfileSlug('Code')).toBe(false);
    expect(isValidProfileSlug('a'.repeat(41))).toBe(false);
  });
});

describe('names and slugs', () => {
  it('builds a lower-case hyphenated slug of at most 40 characters', () => {
    expect(slugifyProfileName('  Code Reviewer (v2)! ')).toBe('code-reviewer-v2');
    expect(slugifyProfileName('x'.repeat(60))).toHaveLength(40);
    expect(slugifyProfileName('???')).toBe('');
  });

  it('accepts only 1-64 letters, digits, - and _ starting with a letter or digit', () => {
    expect(isValidAgentProfileName('review-code--alpha')).toBe(true);
    expect(isValidAgentProfileName('-bad')).toBe(false);
    expect(isValidAgentProfileName('has space')).toBe(false);
    expect(isValidAgentProfileName('a'.repeat(65))).toBe(false);
  });

  it('recognizes absolute Windows and POSIX directories', () => {
    expect(isAbsoluteDirectoryPath('C:\\work\\alpha')).toBe(true);
    expect(isAbsoluteDirectoryPath('D:/work')).toBe(true);
    expect(isAbsoluteDirectoryPath('/home/u/alpha')).toBe(true);
    expect(isAbsoluteDirectoryPath('\\\\server\\share')).toBe(true);
    expect(isAbsoluteDirectoryPath('work/alpha')).toBe(false);
    expect(isAbsoluteDirectoryPath('')).toBe(false);
  });
});

describe('effective values and descriptions', () => {
  const template = {
    params: [
      { key: 'git_url', type: 'url' as const, title: 'Git', description: '', required: true },
      { key: 'report_dir', type: 'dir' as const, title: 'Reports', description: '', required: false, default: 'reports' },
    ],
  };
  const project = { name: 'Alpha', directory: '/w/alpha' };

  it('prefers the typed value, then the template default; blank counts as unset', () => {
    expect(effectiveAgentValues(template, project, { git_url: 'https://git/alpha' })).toMatchObject({ git_url: 'https://git/alpha', report_dir: 'reports', project_name: 'Alpha', project_directory: '/w/alpha' });
    expect(effectiveAgentValues(template, project, { git_url: '   ', report_dir: '' })).toMatchObject({ git_url: '', report_dir: 'reports' });
    expect(effectiveAgentValues(template, null, {})).toMatchObject({ git_url: '', project_name: '', project_directory: '' });
  });

  it('ignores typed keys the template does not declare and never lets a typed value replace a reserved key', () => {
    const values = effectiveAgentValues(template, project, { stray: 'x', project_name: 'evil' });
    expect(values).not.toHaveProperty('stray');
    expect(values.project_name).toBe('Alpha');
  });

  it('writes a default description with the role and when to use it', () => {
    expect(defaultAgentDescription({ name: 'Tester', description: 'Runs tests' })).toBe('Tester: Runs tests.');
    expect(defaultAgentDescription({ name: 'Q&A', description: 'Answers questions.' })).toBe('Q&A: Answers questions.');
  });
});

describe('rendering', () => {
  it('wraps each filled value in a <param> tag, escapes it and puts the data notice first', () => {
    const text = renderTemplateInstructions('Repo {{git_url}} / {{other}} / {{empty}}', { git_url: 'a<b>&c', empty: '  ' });
    expect(text.startsWith('Text inside <param> tags')).toBe(true);
    expect(text).toContain('<param name="git_url">a&lt;b&gt;&amp;c</param>');
    expect(text).toContain('{{other}}');
    expect(text).toContain('<param name="empty">(not set)</param>');
  });

  it('leaves text without a filled placeholder untouched', () => {
    expect(renderTemplateInstructions('plain', {})).toBe('plain');
  });
});
