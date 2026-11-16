import { hashContent, type Chunk } from '../chunk';
import type { SourceFile } from '../source-file';
import type { ChunkingStrategy } from './chunking-strategy';

export interface LineWindowOptions {
  /** Lines per chunk. */
  windowLines: number;
  /** Lines shared between consecutive chunks, so context is not cut mid-thought. */
  overlapLines: number;
}

export const DEFAULT_LINE_WINDOW: LineWindowOptions = {
  windowLines: 60,
  overlapLines: 10,
};

/**
 * Language-agnostic chunker: fixed-size windows of lines with overlap.
 * Every chunk is a `block` with no symbol. Windows that contain only
 * whitespace are dropped.
 */
export class LineWindowChunker implements ChunkingStrategy {
  private readonly windowLines: number;
  private readonly overlapLines: number;

  constructor(options: LineWindowOptions = DEFAULT_LINE_WINDOW) {
    const { windowLines, overlapLines } = options;
    if (!Number.isInteger(windowLines) || windowLines < 1) {
      throw new RangeError(
        `windowLines must be a positive integer, got ${String(windowLines)}`,
      );
    }
    if (
      !Number.isInteger(overlapLines) ||
      overlapLines < 0 ||
      overlapLines >= windowLines
    ) {
      throw new RangeError(
        `overlapLines must be an integer in [0, windowLines), got ${String(overlapLines)}`,
      );
    }
    this.windowLines = windowLines;
    this.overlapLines = overlapLines;
  }

  chunk(file: SourceFile): Chunk[] {
    const lines = file.content.split(/\r?\n/);
    // A trailing newline terminates the last line; it does not start a new one.
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

    const stride = this.windowLines - this.overlapLines;
    const chunks: Chunk[] = [];

    for (let start = 0; start < lines.length; start += stride) {
      const end = Math.min(start + this.windowLines, lines.length);
      const content = lines.slice(start, end).join('\n');
      if (content.trim() !== '') {
        chunks.push({
          path: file.path,
          language: file.language,
          symbol: null,
          kind: 'block',
          startLine: start + 1,
          endLine: end,
          content,
          contentHash: hashContent(content),
        });
      }
      // The window reached the end of the file; another would only repeat overlap.
      if (end === lines.length) break;
    }

    return chunks;
  }
}
