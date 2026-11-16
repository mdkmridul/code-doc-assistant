import { ingestKeyFor, type RepoSource } from '../repo';
import type { IngestQueue } from '../ports/ingest-queue';
import {
  DuplicateIngestKeyError,
  type RepoRecord,
  type RepoStore,
} from '../ports/repo-store';

export interface RegisterRepoResult {
  repo: RepoRecord;
  /** False when the same source+commit/content was already queued, running or ready. */
  enqueued: boolean;
}

/**
 * Registers a repo source for ingestion. Submitting a source that is already
 * queued, running or ready is a no-op that returns the existing repo. A source
 * whose previous ingest failed is queued again.
 */
export class RegisterRepo {
  constructor(
    private readonly repos: RepoStore,
    private readonly queue: IngestQueue,
  ) {}

  async execute(source: RepoSource): Promise<RegisterRepoResult> {
    const ingestKey = ingestKeyFor(source);

    let repo = await this.repos.findByIngestKey(ingestKey);
    if (!repo) {
      try {
        repo = await this.repos.create(ingestKey, source);
      } catch (error) {
        // A concurrent request created it between our lookup and insert.
        if (!(error instanceof DuplicateIngestKeyError)) throw error;
        const existing = await this.repos.findByIngestKey(ingestKey);
        if (!existing) throw error;
        return { repo: existing, enqueued: false };
      }
    } else if (repo.status !== 'failed') {
      return { repo, enqueued: false };
    }

    const attemptId = await this.repos.startAttempt(repo.id);
    await this.queue.enqueue({ repoId: repo.id, attemptId, ingestKey, source });
    return { repo: { id: repo.id, status: 'queued' }, enqueued: true };
  }
}
