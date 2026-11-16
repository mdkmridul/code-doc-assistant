import type { EmbeddedChunk } from '../chunk';
import type { ApiEndpoint } from '../endpoints/api-endpoint';
import type { RepoSource, RepoStatus } from '../repo';
import type { ChunkStore } from '../ports/chunk-store';
import type { Embedder } from '../ports/embedder';
import type { IngestJob, IngestQueue } from '../ports/ingest-queue';
import {
  DuplicateIngestKeyError,
  type RepoRecord,
  type RepoStore,
  type RepoView,
} from '../ports/repo-store';
import type { Workspace, WorkspaceFactory } from '../ports/workspace';
import type { RetryClock } from './retry';
import type { SourceFile } from '../source-file';

/** Embeds text as [length, 1, 1, ...] so tests can check which vector went where. */
export class FakeEmbedder implements Embedder {
  readonly calls: string[][] = [];
  /** Errors thrown by the next calls, in order, before succeeding. */
  failures: Error[] = [];

  constructor(
    readonly dimensions = 3,
    readonly maxBatchSize = 1000,
  ) {}

  embed(texts: readonly string[]): Promise<number[][]> {
    this.calls.push([...texts]);
    const failure = this.failures.shift();
    if (failure) return Promise.reject(failure);
    return Promise.resolve(
      texts.map((t) => [
        t.length,
        ...Array.from({ length: this.dimensions - 1 }, () => 1),
      ]),
    );
  }
}

export class FakeChunkStore implements ChunkStore {
  readonly saved: {
    repoId: string;
    file: SourceFile;
    chunks: readonly EmbeddedChunk[];
    endpoints: readonly ApiEndpoint[];
  }[] = [];

  saveFile(
    repoId: string,
    file: SourceFile,
    chunks: readonly EmbeddedChunk[],
    endpoints: readonly ApiEndpoint[],
  ): Promise<void> {
    this.saved.push({ repoId, file, chunks, endpoints });
    return Promise.resolve();
  }
}

export class FakeClock implements RetryClock {
  readonly sleeps: number[] = [];
  sleep(ms: number): Promise<void> {
    this.sleeps.push(ms);
    return Promise.resolve();
  }
  random(): number {
    return 0.5;
  }
}

interface StoredRepo {
  id: string;
  ingestKey: string;
  source: RepoSource;
  status: RepoStatus;
  commitSha: string | null;
  error: string | null;
}

export class FakeRepoStore implements RepoStore {
  readonly repos = new Map<string, StoredRepo>();
  readonly events: string[] = [];
  /** Simulates a concurrent insert: the next `create` loses the race. */
  raceOnCreate: StoredRepo | null = null;
  private nextId = 1;

  seed(repo: StoredRepo): void {
    this.repos.set(repo.id, repo);
  }

  findById(id: string): Promise<RepoView | null> {
    const repo = this.repos.get(id);
    if (!repo) return Promise.resolve(null);
    const view: RepoView = {
      id: repo.id,
      status: repo.status,
      source:
        repo.source.type === 'git'
          ? { type: 'git', url: repo.source.url }
          : { type: 'local', fileName: repo.source.fileName },
      commitSha: repo.commitSha,
      contentHash: repo.source.type === 'local' ? repo.source.contentHash : null,
      error: repo.error,
      fileCount: 0,
      chunkCount: 0,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };
    return Promise.resolve(view);
  }

  findByIngestKey(ingestKey: string): Promise<RepoRecord | null> {
    const repo = [...this.repos.values()].find((r) => r.ingestKey === ingestKey);
    return Promise.resolve(repo ? { id: repo.id, status: repo.status } : null);
  }

  create(ingestKey: string, source: RepoSource): Promise<RepoRecord> {
    if (this.raceOnCreate) {
      this.seed(this.raceOnCreate);
      this.raceOnCreate = null;
      return Promise.reject(new DuplicateIngestKeyError(ingestKey));
    }
    const id = `repo-${String(this.nextId++)}`;
    this.seed({ id, ingestKey, source, status: 'queued', commitSha: null, error: null });
    this.events.push(`create:${id}`);
    return Promise.resolve({ id, status: 'queued' });
  }

  startAttempt(repoId: string): Promise<string> {
    this.update(repoId, { status: 'queued', error: null });
    this.events.push(`attempt:${repoId}`);
    return Promise.resolve(`attempt-${repoId}`);
  }

  markRunning(repoId: string, attemptId: string): Promise<void> {
    this.update(repoId, { status: 'running' });
    this.events.push(`running:${repoId}:${attemptId}`);
    return Promise.resolve();
  }

  markReady(repoId: string, attemptId: string, commitSha: string | null): Promise<void> {
    this.update(repoId, { status: 'ready', commitSha });
    this.events.push(`ready:${repoId}:${attemptId}`);
    return Promise.resolve();
  }

  markFailed(repoId: string, attemptId: string, error: string): Promise<void> {
    this.update(repoId, { status: 'failed', error });
    this.events.push(`failed:${repoId}:${attemptId}`);
    return Promise.resolve();
  }

  private update(id: string, patch: Partial<StoredRepo>): void {
    const repo = this.repos.get(id);
    if (!repo) throw new Error(`unknown repo ${id}`);
    this.repos.set(id, { ...repo, ...patch });
  }
}

export class FakeIngestQueue implements IngestQueue {
  readonly jobs: IngestJob[] = [];
  enqueue(job: IngestJob): Promise<void> {
    this.jobs.push(job);
    return Promise.resolve();
  }
}

export class FakeWorkspaceFactory implements WorkspaceFactory {
  disposed = 0;
  openError: Error | null = null;

  constructor(
    private readonly sourceFiles: SourceFile[],
    private readonly commitSha: string | null = 'abc123',
  ) {}

  open(): Promise<Workspace> {
    if (this.openError) return Promise.reject(this.openError);
    const files = this.sourceFiles;
    return Promise.resolve({
      commitSha: this.commitSha,
      files: async function* () {
        await Promise.resolve();
        yield* files;
      },
      dispose: () => {
        this.disposed += 1;
        return Promise.resolve();
      },
    });
  }
}
