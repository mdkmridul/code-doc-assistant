import { describe, expect, it } from 'vitest';
import { ingestKeyFor, type RepoSource } from '../repo';
import { RegisterRepo } from './register-repo';
import { FakeIngestQueue, FakeRepoStore } from './fakes.test-helpers';

const gitSource: RepoSource = {
  type: 'git',
  url: 'https://github.com/acme/widgets',
  commitSha: 'a'.repeat(40),
};

const setup = () => {
  const repos = new FakeRepoStore();
  const queue = new FakeIngestQueue();
  return { repos, queue, useCase: new RegisterRepo(repos, queue) };
};

describe('RegisterRepo', () => {
  it('creates a queued repo and enqueues one job keyed by source and commit', async () => {
    const { useCase, queue } = setup();

    const result = await useCase.execute(gitSource);

    expect(result).toEqual({ repo: { id: 'repo-1', status: 'queued' }, enqueued: true });
    expect(queue.jobs).toEqual([
      {
        repoId: 'repo-1',
        attemptId: 'attempt-repo-1',
        ingestKey: ingestKeyFor(gitSource),
        source: gitSource,
      },
    ]);
  });

  it.each(['queued', 'running', 'ready'] as const)(
    'is a no-op when the same source is already %s',
    async (status) => {
      const { useCase, repos, queue } = setup();
      repos.seed({
        id: 'existing',
        ingestKey: ingestKeyFor(gitSource),
        source: gitSource,
        status,
        commitSha: null,
        error: null,
      });

      const result = await useCase.execute(gitSource);

      expect(result).toEqual({ repo: { id: 'existing', status }, enqueued: false });
      expect(queue.jobs).toEqual([]);
    },
  );

  it('re-queues a source whose previous ingest failed', async () => {
    const { useCase, repos, queue } = setup();
    repos.seed({
      id: 'existing',
      ingestKey: ingestKeyFor(gitSource),
      source: gitSource,
      status: 'failed',
      commitSha: null,
      error: 'boom',
    });

    const result = await useCase.execute(gitSource);

    expect(result).toEqual({ repo: { id: 'existing', status: 'queued' }, enqueued: true });
    expect(queue.jobs.map((j) => j.repoId)).toEqual(['existing']);
    expect(repos.repos.get('existing')?.error).toBeNull();
  });

  it('treats a new commit of the same repo as a new ingest', async () => {
    const { useCase, queue } = setup();

    await useCase.execute(gitSource);
    await useCase.execute({ ...gitSource, commitSha: 'b'.repeat(40) });

    expect(queue.jobs.map((j) => j.repoId)).toEqual(['repo-1', 'repo-2']);
  });

  it('keys local archives by content hash, not file name', async () => {
    const { useCase, queue } = setup();
    const archive = (fileName: string): RepoSource => ({
      type: 'local',
      fileName,
      contentHash: 'c'.repeat(64),
      archivePath: `/tmp/${fileName}`,
    });

    await useCase.execute(archive('one.zip'));
    const second = await useCase.execute(archive('renamed.zip'));

    expect(second.enqueued).toBe(false);
    expect(queue.jobs).toHaveLength(1);
  });

  it('returns the winner when a concurrent request creates the repo first', async () => {
    const { useCase, repos, queue } = setup();
    repos.raceOnCreate = {
      id: 'winner',
      ingestKey: ingestKeyFor(gitSource),
      source: gitSource,
      status: 'queued',
      commitSha: null,
      error: null,
    };

    const result = await useCase.execute(gitSource);

    expect(result).toEqual({ repo: { id: 'winner', status: 'queued' }, enqueued: false });
    expect(queue.jobs).toEqual([]);
  });
});
