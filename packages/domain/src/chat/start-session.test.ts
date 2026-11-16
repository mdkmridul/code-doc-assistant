import { describe, expect, it } from 'vitest';
import { FakeRepoStore } from '../ingestion/fakes.test-helpers';
import type { RepoStatus } from '../repo';
import { RepoNotFoundError, RepoNotReadyError } from './errors';
import { FakeChatStore } from './fakes.test-helpers';
import { StartSession } from './start-session';
import { SystemPrompt } from './system-prompt';

const setup = (status: RepoStatus) => {
  const repos = new FakeRepoStore();
  repos.seed({
    id: 'repo-1',
    ingestKey: 'k',
    source: { type: 'git', url: 'https://github.com/a/b', commitSha: 'a'.repeat(40) },
    status,
    commitSha: null,
    error: null,
  });
  const chats = new FakeChatStore();
  return { chats, useCase: new StartSession(repos, chats) };
};

describe('StartSession', () => {
  it('opens a session on a ready repo', async () => {
    const { useCase, chats } = setup('ready');

    const session = await useCase.execute('repo-1');

    expect(session).toEqual({ id: 'session-1', repoId: 'repo-1' });
    expect(chats.sessions.has('session-1')).toBe(true);
  });

  it.each(['queued', 'running', 'failed'] as const)('refuses a %s repo', async (status) => {
    const { useCase, chats } = setup(status);

    await expect(useCase.execute('repo-1')).rejects.toThrow(RepoNotReadyError);
    expect(chats.sessions.size).toBe(0);
  });

  it('refuses an unknown repo', async () => {
    const { useCase } = setup('ready');
    await expect(useCase.execute('nope')).rejects.toThrow(RepoNotFoundError);
  });
});

describe('SystemPrompt', () => {
  it('fills placeholders and identifies itself as name@version', () => {
    const prompt = new SystemPrompt('answer-question', 'v2', 'Repo: {{ repository }}. Again: {{repository}}.');

    expect(prompt.id).toBe('answer-question@v2');
    expect(prompt.render({ repository: 'ky' })).toBe('Repo: ky. Again: ky.');
  });

  it('refuses to render with a missing value', () => {
    expect(() => new SystemPrompt('p', 'v1', 'Hi {{name}}').render({})).toThrow(/\{\{name\}\}/);
  });
});
