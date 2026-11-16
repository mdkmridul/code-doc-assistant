import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { SourceUnavailableError } from './source-errors';

const execFileAsync = promisify(execFile);

/** Never prompt for credentials: a private or missing repo must fail, not hang. */
const NON_INTERACTIVE_ENV = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
  GCM_INTERACTIVE: 'never',
};

async function git(
  args: string[],
  { cwd, timeoutMs = 60_000 }: { cwd?: string; timeoutMs?: number } = {},
): Promise<string> {
  const { stdout } = await execFileAsync(
    'git',
    // No credential helper (no GUI prompts on Windows); keep LF line endings.
    ['-c', 'credential.helper=', '-c', 'core.autocrlf=false', ...args],
    {
      cwd,
      env: NON_INTERACTIVE_ENV,
      timeout: timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    },
  );
  return stdout.trim();
}

const SHA = /^[0-9a-f]{40}$/;

/** Resolves the commit a public repo's default branch points to, without cloning. */
export async function resolveRemoteHead(url: string): Promise<string> {
  let output: string;
  try {
    output = await git(['ls-remote', '--exit-code', url, 'HEAD'], {
      timeoutMs: 30_000,
    });
  } catch (error) {
    throw new SourceUnavailableError(
      `Repository ${url} was not found or is not public`,
      { cause: error },
    );
  }
  const sha = output.split(/\s+/)[0];
  if (!SHA.test(sha)) {
    throw new SourceUnavailableError(`Could not resolve HEAD of ${url}`);
  }
  return sha;
}

/**
 * Shallow-fetches exactly `commitSha` into `dir` (depth 1, no history, no
 * tags) and checks it out. Returns the SHA git reports for HEAD.
 */
export async function checkoutCommit(
  url: string,
  commitSha: string,
  dir: string,
): Promise<string> {
  await git(['init', '--quiet', dir]);
  await git(['remote', 'add', 'origin', url], { cwd: dir });
  try {
    await git(
      ['fetch', '--quiet', '--depth', '1', '--no-tags', 'origin', commitSha],
      { cwd: dir, timeoutMs: 5 * 60_000 },
    );
  } catch (error) {
    throw new SourceUnavailableError(
      `Could not fetch ${commitSha} from ${url}`,
      { cause: error },
    );
  }
  await git(
    ['-c', 'advice.detachedHead=false', 'checkout', '--quiet', 'FETCH_HEAD'],
    {
      cwd: dir,
    },
  );
  return git(['rev-parse', 'HEAD'], { cwd: dir });
}
