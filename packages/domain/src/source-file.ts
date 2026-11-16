/** A text file read from a repository, ready to be chunked. */
export interface SourceFile {
  /** Repo-relative POSIX path, e.g. `src/index.ts`. */
  path: string;
  /** Lower-case language id, e.g. `typescript`, or `plaintext` when unknown. */
  language: string;
  content: string;
}
