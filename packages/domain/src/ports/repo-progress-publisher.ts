import type { RepoProgress } from '../events';

/** Broadcasts ingest progress to anyone watching a repo (e.g. over SSE). */
export interface RepoProgressPublisher {
  /** Best effort: callers do not wait on delivery and failures must not break ingestion. */
  publish(progress: RepoProgress): Promise<void>;
}
