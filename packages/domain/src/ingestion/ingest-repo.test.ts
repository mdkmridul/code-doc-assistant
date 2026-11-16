import { describe, expect, it } from 'vitest';
import { LineWindowChunker } from '../chunking/line-window-chunker';
import { EmbeddingError } from '../ports/embedder';
import type { IngestJob } from '../ports/ingest-queue';
import { IngestFiles } from './ingest-files';
import { IngestRepo } from './ingest-repo';
import {
  FakeChunkStore,
  FakeClock,
  FakeEmbedder,
  FakeRepoStore,
  FakeWorkspaceFactory,
} from './fakes.test-helpers';

const job: IngestJob = {
  repoId: 'repo-1',
  attemptId: 'attempt-1',
  ingestKey: 'key',
  source: { type: 'git', url: 'https://github.com/acme/widgets', commitSha: 'a'.repeat(40) },
};

const setup = (embedder = new FakeEmbedder()) => {
  const repos = new FakeRepoStore();
  repos.seed({
    id: 'repo-1',
    ingestKey: 'key',
    source: job.source,
    status: 'queued',
    commitSha: null,
    error: null,
  });
  const store = new FakeChunkStore();
  const workspaces = new FakeWorkspaceFactory(
    [{ path: 'src/index.ts', language: 'typescript', content: 'export const x = 1;\n' }],
    'f'.repeat(40),
  );
  const ingestFiles = new IngestFiles({
    chunker: new LineWindowChunker(),
    embedder,
    store,
    clock: new FakeClock(),
  });
  return { repos, store, workspaces, useCase: new IngestRepo(repos, workspaces, ingestFiles) };
};

describe('IngestRepo', () => {
  it('moves the repo running → ready, stores files and records the commit', async () => {
    const { useCase, repos, store, workspaces } = setup();

    const stats = await useCase.execute(job);

    expect(repos.events).toEqual(['running:repo-1:attempt-1', 'ready:repo-1:attempt-1']);
    expect(repos.repos.get('repo-1')).toMatchObject({
      status: 'ready',
      commitSha: 'f'.repeat(40),
    });
    expect(store.saved.map((s) => s.file.path)).toEqual(['src/index.ts']);
    expect(stats).toEqual({ files: 1, chunks: 1, endpoints: 0, embeddingRequests: 1 });
    expect(workspaces.disposed).toBe(1);
  });

  it('marks the repo failed with the error and still disposes the workspace', async () => {
    const embedder = new FakeEmbedder();
    embedder.failures = [new EmbeddingError('invalid api key', false)];
    const { useCase, repos, workspaces } = setup(embedder);

    await expect(useCase.execute(job)).rejects.toThrow('invalid api key');

    expect(repos.repos.get('repo-1')).toMatchObject({
      status: 'failed',
      error: 'invalid api key',
    });
    expect(workspaces.disposed).toBe(1);
  });

  it('marks the repo failed when the source cannot be opened', async () => {
    const { useCase, repos, workspaces } = setup();
    workspaces.openError = new Error('repository not found');

    await expect(useCase.execute(job)).rejects.toThrow('repository not found');

    expect(repos.events).toEqual(['running:repo-1:attempt-1', 'failed:repo-1:attempt-1']);
    expect(workspaces.disposed).toBe(0);
  });
});
