import type { RepoSource } from '../repo';

export interface IngestJob {
  repoId: string;
  attemptId: string;
  ingestKey: string;
  source: RepoSource;
}

export interface IngestQueue {
  /** Enqueues the job, deduplicated by `ingestKey`. */
  enqueue(job: IngestJob): Promise<void>;
}
