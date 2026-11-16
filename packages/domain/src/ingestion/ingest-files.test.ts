import { describe, expect, it } from 'vitest';
import { LineWindowChunker } from '../chunking/line-window-chunker';
import { EmbeddingError } from '../ports/embedder';
import type { SourceFile } from '../source-file';
import { IngestFiles, type IngestFilesOptions } from './ingest-files';
import { FakeChunkStore, FakeClock, FakeEmbedder } from './fakes.test-helpers';

const file = (path: string, lines: number): SourceFile => ({
  path,
  language: 'typescript',
  content: Array.from({ length: lines }, (_, i) => `${path}:${String(i + 1)}`).join('\n'),
});

const options = (overrides: Partial<IngestFilesOptions> = {}): IngestFilesOptions => ({
  batchSize: 100,
  maxBatchChars: 1_000_000,
  retry: { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 1_000 },
  ...overrides,
});

const setup = (embedder = new FakeEmbedder()) => {
  const store = new FakeChunkStore();
  const clock = new FakeClock();
  const useCase = new IngestFiles({
    // 2-line windows, no overlap: an n-line file yields ceil(n/2) chunks.
    chunker: new LineWindowChunker({ windowLines: 2, overlapLines: 0 }),
    embedder,
    store,
    clock,
  });
  return { useCase, store, embedder, clock };
};

describe('IngestFiles', () => {
  it('stores every file with its own chunks and their matching embeddings', async () => {
    const { useCase, store } = setup();

    const stats = await useCase.execute('repo-1', [file('a.ts', 3), file('b.ts', 4)], options());

    expect(stats).toEqual({ files: 2, chunks: 4, embeddingRequests: 1 });
    expect(store.saved.map((s) => [s.repoId, s.file.path, s.chunks.length])).toEqual([
      ['repo-1', 'a.ts', 2],
      ['repo-1', 'b.ts', 2],
    ]);
    // FakeEmbedder puts content length first, so each vector must belong to its chunk.
    for (const { chunks } of store.saved) {
      for (const chunk of chunks) expect(chunk.embedding[0]).toBe(chunk.content.length);
    }
  });

  it('batches chunks across files and respects the batch size', async () => {
    const { useCase, embedder } = setup();

    // 5 files × 2 chunks = 10 chunks, batches of 4 → requests of 4, 4, 2.
    const files = ['a', 'b', 'c', 'd', 'e'].map((n) => file(`${n}.ts`, 4));
    const stats = await useCase.execute('repo-1', files, options({ batchSize: 4 }));

    expect(embedder.calls.map((c) => c.length)).toEqual([4, 4, 2]);
    expect(stats.embeddingRequests).toBe(3);
    expect(stats.chunks).toBe(10);
  });

  it("caps batches at the embedder's own limit", async () => {
    const { useCase, embedder } = setup(new FakeEmbedder(3, 2));

    await useCase.execute('repo-1', [file('a.ts', 8)], options({ batchSize: 100 }));

    expect(embedder.calls.map((c) => c.length)).toEqual([2, 2]);
  });

  it('splits batches by character budget', async () => {
    const { useCase, embedder } = setup();
    // Each 2-line chunk of 'a.ts:N' lines is 13 chars; budget 30 fits two per request.
    await useCase.execute('repo-1', [file('a.ts', 8)], options({ maxBatchChars: 30 }));

    expect(embedder.calls.map((c) => c.length)).toEqual([2, 2]);
  });

  it('retries transient failures with exponential backoff, then succeeds', async () => {
    const embedder = new FakeEmbedder();
    embedder.failures = [
      new EmbeddingError('rate limited', true),
      new Error('socket hang up'),
    ];
    const { useCase, store, clock } = setup(embedder);

    await useCase.execute('repo-1', [file('a.ts', 2)], options());

    expect(embedder.calls).toHaveLength(3);
    // base 100ms doubling, equal jitter with random()=0.5 → 75ms, 150ms
    expect(clock.sleeps).toEqual([75, 150]);
    expect(store.saved).toHaveLength(1);
  });

  it("waits at least the server's retry-after", async () => {
    const embedder = new FakeEmbedder();
    embedder.failures = [new EmbeddingError('rate limited', true, 20_000)];
    const { useCase, clock } = setup(embedder);

    await useCase.execute('repo-1', [file('a.ts', 2)], options());

    expect(clock.sleeps).toEqual([20_000]);
  });

  it('does not retry permanent failures and stores nothing from the failed batch', async () => {
    const embedder = new FakeEmbedder();
    embedder.failures = [new EmbeddingError('invalid api key', false)];
    const { useCase, store } = setup(embedder);

    await expect(useCase.execute('repo-1', [file('a.ts', 2)], options())).rejects.toThrow(
      'invalid api key',
    );
    expect(embedder.calls).toHaveLength(1);
    expect(store.saved).toEqual([]);
  });

  it('gives up after the maximum number of attempts', async () => {
    const embedder = new FakeEmbedder();
    embedder.failures = [1, 2, 3].map(() => new EmbeddingError('overloaded', true));
    const { useCase, store } = setup(embedder);

    await expect(useCase.execute('repo-1', [file('a.ts', 2)], options())).rejects.toThrow(
      'overloaded',
    );
    expect(embedder.calls).toHaveLength(3);
    expect(store.saved).toEqual([]);
  });

  it('rejects vectors of the wrong dimension', async () => {
    // Claims 1024 dimensions but returns 3-d vectors.
    class WrongSizeEmbedder extends FakeEmbedder {
      override embed(texts: readonly string[]): Promise<number[][]> {
        return Promise.resolve(texts.map(() => [1, 2, 3]));
      }
    }
    const { useCase } = setup(new WrongSizeEmbedder(1024));

    await expect(useCase.execute('repo-1', [file('a.ts', 2)], options())).rejects.toThrow(
      /expected 1024/,
    );
  });

  it('stores files that produce no chunks', async () => {
    const { useCase, store, embedder } = setup();

    const stats = await useCase.execute(
      'repo-1',
      [{ path: 'empty.ts', language: 'typescript', content: '' }],
      options(),
    );

    expect(store.saved.map((s) => [s.file.path, s.chunks.length])).toEqual([['empty.ts', 0]]);
    expect(embedder.calls).toEqual([]);
    expect(stats).toEqual({ files: 1, chunks: 0, embeddingRequests: 0 });
  });
});
