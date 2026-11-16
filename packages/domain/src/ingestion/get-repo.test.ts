import { describe, expect, it } from 'vitest';
import { GetRepo } from './get-repo';
import { FakeRepoStore } from './fakes.test-helpers';

describe('GetRepo', () => {
  it('returns the repo view, or null for an unknown id', async () => {
    const repos = new FakeRepoStore();
    repos.seed({
      id: 'repo-1',
      ingestKey: 'k',
      source: { type: 'git', url: 'https://github.com/acme/widgets', commitSha: 'a'.repeat(40) },
      status: 'ready',
      commitSha: 'a'.repeat(40),
      error: null,
    });
    const useCase = new GetRepo(repos);

    expect(await useCase.execute('repo-1')).toMatchObject({
      id: 'repo-1',
      status: 'ready',
      source: { type: 'git', url: 'https://github.com/acme/widgets' },
    });
    expect(await useCase.execute('nope')).toBeNull();
  });
});
