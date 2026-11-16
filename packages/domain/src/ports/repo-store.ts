import type { RepoSource, RepoStatus } from '../repo';

export interface RepoRecord {
  id: string;
  status: RepoStatus;
}

export interface RepoView extends RepoRecord {
  source: { type: 'git'; url: string } | { type: 'local'; fileName: string };
  commitSha: string | null;
  contentHash: string | null;
  error: string | null;
  fileCount: number;
  chunkCount: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Thrown by `create` when another request registered the same ingest key first. */
export class DuplicateIngestKeyError extends Error {
  constructor(readonly ingestKey: string) {
    super(`A repo with ingest key ${ingestKey} already exists`);
    this.name = 'DuplicateIngestKeyError';
  }
}

export interface RepoStore {
  findById(id: string): Promise<RepoView | null>;
  findByIngestKey(ingestKey: string): Promise<RepoRecord | null>;
  /** Creates the repo in `queued` state. */
  create(ingestKey: string, source: RepoSource): Promise<RepoRecord>;
  /** Records a new ingest attempt and moves the repo to `queued`. Returns the attempt id. */
  startAttempt(repoId: string): Promise<string>;
  markRunning(repoId: string, attemptId: string): Promise<void>;
  markReady(
    repoId: string,
    attemptId: string,
    commitSha: string | null,
  ): Promise<void>;
  markFailed(repoId: string, attemptId: string, error: string): Promise<void>;
}
