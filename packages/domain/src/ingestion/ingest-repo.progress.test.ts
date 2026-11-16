import { describe, expect, it } from 'vitest';
import { LineWindowChunker } from '../chunking/line-window-chunker';
import type { RepoProgress } from '../events';
import { EmbeddingError } from '../ports/embedder';
import type { IngestJob } from '../ports/ingest-queue';
import type { RepoProgressPublisher } from '../ports/repo-progress-publisher';
import { IngestFiles } from './ingest-files';
import { IngestRepo } from './ingest-repo';
import {
  FakeChunkStore,
  FakeClock,
  FakeEmbedder,
  FakeRepoStore,
  FakeWorkspaceFactory,
} from './fakes.test-helpers';

class RecordingPublisher implements RepoProgressPublisher {
  readonly published: RepoProgress[] = [];
  failing = false;
  publish(progress: RepoProgress): Promise<void> {
    this.published.push(progress);
    return this.failing ? Promise.reject(new Error('redis down')) : Promise.resolve();
  }
}

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
  const workspaces = new FakeWorkspaceFactory([
    { path: 'a.ts', language: 'typescript', content: 'const a = 1;\n' },
    // 3 lines with 2-line windows → 2 chunks
    { path: 'b.ts', language: 'typescript', content: 'x\ny\nz\n' },
  ]);
  const ingestFiles = new IngestFiles({
    chunker: new LineWindowChunker({ windowLines: 2, overlapLines: 0 }),
    embedder,
    store: new FakeChunkStore(),
    clock: new FakeClock(),
  });
  const publisher = new RecordingPublisher();
  return { publisher, useCase: new IngestRepo(repos, workspaces, ingestFiles, publisher) };
};

const snapshot = (overrides: Partial<RepoProgress>): RepoProgress => ({
  repoId: 'repo-1',
  status: 'running',
  fileCount: 0,
  chunkCount: 0,
  error: null,
  ...overrides,
});

describe('IngestRepo progress', () => {
  it('publishes running, a snapshot per stored file, then ready', async () => {
    const { useCase, publisher } = setup();

    await useCase.execute(job);

    expect(publisher.published).toEqual([
      snapshot({}),
      snapshot({ fileCount: 1, chunkCount: 1 }),
      snapshot({ fileCount: 2, chunkCount: 3 }),
      snapshot({ status: 'ready', fileCount: 2, chunkCount: 3 }),
    ]);
  });

  it('publishes failed with the error', async () => {
    const embedder = new FakeEmbedder();
    embedder.failures = [new EmbeddingError('model not pulled', false)];
    const { useCase, publisher } = setup(embedder);

    await expect(useCase.execute(job)).rejects.toThrow('model not pulled');

    expect(publisher.published.at(-1)).toEqual(
      snapshot({ status: 'failed', error: 'model not pulled' }),
    );
  });

  it('keeps ingesting when publishing fails', async () => {
    const { useCase, publisher } = setup();
    publisher.failing = true;

    const stats = await useCase.execute(job);

    expect(stats).toMatchObject({ files: 2, chunks: 3 });
  });
});
