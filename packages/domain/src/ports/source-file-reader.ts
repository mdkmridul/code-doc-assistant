import type { SourceFile } from '../source-file';

/** Reads the indexed copy of a repository's files. */
export interface SourceFileReader {
  /** The file at this repo-relative POSIX path, or null if it was not indexed. */
  read(repoId: string, path: string): Promise<SourceFile | null>;
}
