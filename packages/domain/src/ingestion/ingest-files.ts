import type { Chunk, EmbeddedChunk } from '../chunk';
import type { ChunkingStrategy } from '../chunking/chunking-strategy';
import type { ChunkStore } from '../ports/chunk-store';
import { EmbeddingError, type Embedder } from '../ports/embedder';
import type { SourceFile } from '../source-file';
import { systemClock, withRetry, type RetryClock, type RetryOptions } from './retry';

export interface IngestFilesOptions {
  /** Most chunks per embedding request (also capped by the embedder). */
  batchSize: number;
  /** Most characters per embedding request, to stay under provider token limits. */
  maxBatchChars: number;
  retry: RetryOptions;
}

export const DEFAULT_INGEST_FILES_OPTIONS: IngestFilesOptions = {
  batchSize: 128,
  // Upper bound on one request's payload; embedders also cap the input count.
  maxBatchChars: 300_000,
  retry: { maxAttempts: 6, baseDelayMs: 1_000, maxDelayMs: 60_000 },
};

export interface IngestFilesStats {
  files: number;
  chunks: number;
  embeddingRequests: number;
}

interface PendingFile {
  file: SourceFile;
  chunks: Chunk[];
}

export interface IngestFilesDeps {
  chunker: ChunkingStrategy;
  embedder: Embedder;
  store: ChunkStore;
  clock?: RetryClock;
}

/**
 * Chunks files, embeds the chunks in batches that span several files (fewer
 * requests for repos with many small files), and stores each file together
 * with its chunks in one transaction.
 */
export class IngestFiles {
  private readonly clock: RetryClock;

  constructor(private readonly deps: IngestFilesDeps) {
    this.clock = deps.clock ?? systemClock;
  }

  async execute(
    repoId: string,
    files: AsyncIterable<SourceFile> | Iterable<SourceFile>,
    options: IngestFilesOptions = DEFAULT_INGEST_FILES_OPTIONS,
  ): Promise<IngestFilesStats> {
    const batchSize = Math.min(options.batchSize, this.deps.embedder.maxBatchSize);
    const stats: IngestFilesStats = { files: 0, chunks: 0, embeddingRequests: 0 };
    let pending: PendingFile[] = [];
    let pendingChunks = 0;
    let pendingChars = 0;

    const flush = async () => {
      const allChunks = pending.flatMap((p) => p.chunks);
      const embeddings = await this.embedAll(allChunks, batchSize, options, stats);

      let offset = 0;
      for (const { file, chunks } of pending) {
        const embedded: EmbeddedChunk[] = chunks.map((chunk, i) => ({
          ...chunk,
          embedding: embeddings[offset + i],
        }));
        offset += chunks.length;
        await this.deps.store.saveFile(repoId, file, embedded);
        stats.files += 1;
        stats.chunks += chunks.length;
      }
      pending = [];
      pendingChunks = 0;
      pendingChars = 0;
    };

    for await (const file of files) {
      const chunks = this.deps.chunker.chunk(file);
      pending.push({ file, chunks });
      pendingChunks += chunks.length;
      pendingChars += chunks.reduce((sum, c) => sum + c.content.length, 0);
      if (pendingChunks >= batchSize || pendingChars >= options.maxBatchChars) {
        await flush();
      }
    }
    if (pending.length > 0) await flush();

    return stats;
  }

  private async embedAll(
    chunks: readonly Chunk[],
    batchSize: number,
    options: IngestFilesOptions,
    stats: IngestFilesStats,
  ): Promise<number[][]> {
    const vectors: number[][] = [];
    let batch: string[] = [];
    let batchChars = 0;

    const send = async () => {
      if (batch.length === 0) return;
      const texts = batch;
      const result = await withRetry(
        () => this.deps.embedder.embed(texts),
        options.retry,
        this.clock,
      );
      stats.embeddingRequests += 1;
      this.assertShape(result, texts.length);
      vectors.push(...result);
      batch = [];
      batchChars = 0;
    };

    for (const chunk of chunks) {
      const wouldOverflow =
        batch.length >= batchSize ||
        (batch.length > 0 && batchChars + chunk.content.length > options.maxBatchChars);
      if (wouldOverflow) await send();
      batch.push(chunk.content);
      batchChars += chunk.content.length;
    }
    await send();

    return vectors;
  }

  private assertShape(vectors: number[][], expectedCount: number): void {
    const { dimensions } = this.deps.embedder;
    if (vectors.length !== expectedCount) {
      throw new EmbeddingError(
        `Embedder returned ${String(vectors.length)} vectors for ${String(expectedCount)} inputs`,
        false,
      );
    }
    const wrong = vectors.find((v) => v.length !== dimensions);
    if (wrong) {
      throw new EmbeddingError(
        `Embedder returned a ${String(wrong.length)}-d vector, expected ${String(dimensions)}`,
        false,
      );
    }
  }
}
