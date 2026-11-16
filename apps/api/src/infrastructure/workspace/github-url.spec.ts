import { normalizeGitHubUrl } from './github-url';
import { InvalidSourceError } from './source-errors';

describe('normalizeGitHubUrl', () => {
  it.each([
    'https://github.com/developit/mitt',
    'https://github.com/developit/mitt/',
    'https://github.com/developit/mitt.git',
    'https://www.github.com/Developit/Mitt',
    '  https://GITHUB.com/developit/mitt  ',
  ])('normalises %s', (input) => {
    expect(normalizeGitHubUrl(input)).toBe('https://github.com/developit/mitt');
  });

  it.each([
    ['not a url', 'Not a valid URL'],
    ['http://github.com/a/b', 'Only https://github.com'],
    ['https://gitlab.com/a/b', 'Only https://github.com'],
    ['https://github.com.evil.com/a/b', 'Only https://github.com'],
    ['https://user:token@github.com/a/b', 'credentials'],
    ['https://github.com/a/b?tab=readme', 'query'],
    ['https://github.com/a', 'Expected a repository URL'],
    ['https://github.com/a/b/tree/main', 'Expected a repository URL'],
    ['https://github.com/-bad/b', 'Not a valid GitHub repository'],
    ['https://github.com/a/b%20c', 'Not a valid GitHub repository'],
  ])('rejects %s', (input, message) => {
    expect(() => normalizeGitHubUrl(input)).toThrow(InvalidSourceError);
    expect(() => normalizeGitHubUrl(input)).toThrow(message);
  });
});
