import { createHash } from 'node:crypto';

export type ChunkKind = 'function' | 'class' | 'method' | 'block';

/**
 * A contiguous slice of a source file: the unit that gets embedded and searched.
 * Storage identity (ids, repo, file) belongs to the ChunkStore, not to the chunk.
 */
export interface Chunk {
  path: string;
  language: string;
  /** Name of the function/class/method the chunk covers, or null for plain blocks. */
  symbol: string | null;
  kind: ChunkKind;
  /** 1-based, inclusive. */
  startLine: number;
  /** 1-based, inclusive. */
  endLine: number;
  content: string;
  /** sha256 of `content`, hex encoded. */
  contentHash: string;
}

export interface EmbeddedChunk extends Chunk {
  embedding: readonly number[];
}

export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}
