import type { RepoSource } from '../repo';
import type { SourceFile } from '../source-file';

/** A checked-out copy of a repo source on local disk. */
export interface Workspace {
  /** Commit the files come from, or null for sources without one (archives). */
  readonly commitSha: string | null;
  /** Files worth indexing, after skip rules (ignored, binary, vendored, too large). */
  files(): AsyncIterable<SourceFile>;
  /** Deletes everything the workspace created on disk. Safe to call twice. */
  dispose(): Promise<void>;
}

export interface WorkspaceFactory {
  /** Materialises the source (clone, unzip). Cleans up after itself if it fails. */
  open(source: RepoSource): Promise<Workspace>;
}
