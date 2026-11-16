import type { Chunk } from '../chunk';
import type { SourceFile } from '../source-file';

/** Splits one file into chunks. Implementations must be pure and deterministic. */
export interface ChunkingStrategy {
  chunk(file: SourceFile): Chunk[];
}
