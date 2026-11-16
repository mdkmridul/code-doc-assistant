import type { EmbeddedChunk } from '../chunk';
import type { SourceFile } from '../source-file';

export interface ChunkStore {
  /**
   * Atomically stores a file and all of its chunks, replacing any previous
   * version of the same path in the repo. Either everything is saved or nothing.
   */
  saveFile(
    repoId: string,
    file: SourceFile,
    chunks: readonly EmbeddedChunk[],
  ): Promise<void>;
}
