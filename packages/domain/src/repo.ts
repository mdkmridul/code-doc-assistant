import { createHash } from 'node:crypto';

export type { RepoStatus } from './events';

/** Where a repository's files come from, pinned to an exact version. */
export type RepoSource =
  | {
      type: 'git';
      /** Normalised `https://github.com/<owner>/<repo>`. */
      url: string;
      /** Full 40-character commit SHA the ingest is pinned to. */
      commitSha: string;
    }
  | {
      type: 'local';
      /** Original upload name, for display only. */
      fileName: string;
      /** sha256 of the uploaded archive bytes. */
      contentHash: string;
      /** Where the uploaded archive is staged until the ingest job consumes it. */
      archivePath: string;
    };

/**
 * Identity of one ingest: the same source at the same commit (or the same
 * archive bytes) always yields the same key, so re-submitting it is a no-op.
 */
export function ingestKeyFor(source: RepoSource): string {
  const identity =
    source.type === 'git'
      ? `git:${source.url}@${source.commitSha}`
      : `local:${source.contentHash}`;
  return createHash('sha256').update(identity).digest('hex');
}
