import type { EmbeddedChunk } from '../chunk';
import type { ApiEndpoint } from '../endpoints/api-endpoint';
import type { SourceFile } from '../source-file';

export interface ChunkStore {
  /**
   * Atomically stores a file with all of its chunks and the HTTP endpoints it
   * declares, replacing any previous version of the same path in the repo.
   * Either everything is saved or nothing.
   */
  saveFile(
    repoId: string,
    file: SourceFile,
    chunks: readonly EmbeddedChunk[],
    endpoints: readonly ApiEndpoint[],
  ): Promise<void>;
}
