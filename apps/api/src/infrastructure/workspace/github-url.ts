import { InvalidSourceError } from './source-errors';

// GitHub's own limits: owner ≤ 39 chars of [A-Za-z0-9-], repo ≤ 100 of [A-Za-z0-9._-].
const OWNER = /^[a-z0-9](?:[a-z0-9-]{0,38})$/i;
const REPO = /^[a-z0-9._-]{1,100}$/i;

/**
 * Validates a public GitHub repository URL and normalises it to
 * `https://github.com/<owner>/<repo>` (lower-case, no `.git`, no trailing
 * slash), so equivalent URLs produce the same ingest key.
 */
export function normalizeGitHubUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new InvalidSourceError(`Not a valid URL: ${input}`);
  }

  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== 'https:' ||
    (host !== 'github.com' && host !== 'www.github.com')
  ) {
    throw new InvalidSourceError(
      'Only https://github.com/<owner>/<repo> URLs are supported',
    );
  }
  if (url.username || url.password || url.port || url.search || url.hash) {
    throw new InvalidSourceError(
      'The URL must not contain credentials, a port, a query or a fragment',
    );
  }

  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length !== 2) {
    throw new InvalidSourceError(
      'Expected a repository URL: https://github.com/<owner>/<repo>',
    );
  }
  const owner = segments[0];
  const repo = segments[1].replace(/\.git$/i, '');
  if (!OWNER.test(owner) || !REPO.test(repo) || repo === '.' || repo === '..') {
    throw new InvalidSourceError(
      `Not a valid GitHub repository: ${owner}/${repo}`,
    );
  }

  return `https://github.com/${owner.toLowerCase()}/${repo.toLowerCase()}`;
}
