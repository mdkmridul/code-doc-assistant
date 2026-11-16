import { describe, expect, it } from 'vitest';
import { hashContent } from '../chunk';
import type { SourceFile } from '../source-file';
import { LineWindowChunker } from './line-window-chunker';

const file = (content: string): SourceFile => ({
  path: 'src/example.ts',
  language: 'typescript',
  content,
});

/** "line 1\nline 2\n...line n" */
const numberedLines = (n: number) =>
  Array.from({ length: n }, (_, i) => `line ${String(i + 1)}`).join('\n');

const ranges = (content: string, windowLines: number, overlapLines: number) =>
  new LineWindowChunker({ windowLines, overlapLines })
    .chunk(file(content))
    .map((c) => [c.startLine, c.endLine]);

describe('LineWindowChunker', () => {
  it('returns no chunks for an empty or whitespace-only file', () => {
    const chunker = new LineWindowChunker();
    expect(chunker.chunk(file(''))).toEqual([]);
    expect(chunker.chunk(file('  \n\n\t\n'))).toEqual([]);
  });

  it('returns one chunk covering a file shorter than the window', () => {
    const content = 'const a = 1;\nconst b = 2;\n';
    const [chunk, ...rest] = new LineWindowChunker().chunk(file(content));

    expect(rest).toEqual([]);
    expect(chunk).toEqual({
      path: 'src/example.ts',
      language: 'typescript',
      symbol: null,
      kind: 'block',
      startLine: 1,
      endLine: 2,
      content: 'const a = 1;\nconst b = 2;',
      contentHash: hashContent('const a = 1;\nconst b = 2;'),
    });
  });

  it('slides fixed windows with the configured overlap', () => {
    // stride = 10 - 2 = 8 → windows start at lines 1, 9, 17
    expect(ranges(numberedLines(25), 10, 2)).toEqual([
      [1, 10],
      [9, 18],
      [17, 25],
    ]);
  });

  it('puts exactly the window lines in each chunk', () => {
    const [, second] = new LineWindowChunker({
      windowLines: 3,
      overlapLines: 1,
    }).chunk(file(numberedLines(5)));

    expect(second.content).toBe('line 3\nline 4\nline 5');
  });

  it('stops once a window reaches the end instead of emitting a pure-overlap chunk', () => {
    // 18 lines, window 10, overlap 2 → [1-10], [9-18]; a third window would only repeat lines.
    expect(ranges(numberedLines(18), 10, 2)).toEqual([
      [1, 10],
      [9, 18],
    ]);
  });

  it('supports zero overlap', () => {
    expect(ranges(numberedLines(7), 3, 0)).toEqual([
      [1, 3],
      [4, 6],
      [7, 7],
    ]);
  });

  it('treats a trailing newline as the end of the last line, and handles CRLF', () => {
    expect(ranges('a\nb\n', 1, 0)).toEqual([
      [1, 1],
      [2, 2],
    ]);
    const [chunk] = new LineWindowChunker().chunk(file('a\r\nb\r\n'));
    expect(chunk.content).toBe('a\nb');
    expect(chunk.endLine).toBe(2);
  });

  it('skips windows that contain only whitespace but keeps line numbers aligned', () => {
    // Lines 4-6 are blank: their window is dropped, numbering is unchanged.
    expect(ranges('a\nb\nc\n\n\n\ng\nh\ni', 3, 0)).toEqual([
      [1, 3],
      [7, 9],
    ]);
  });

  it('rejects invalid options', () => {
    expect(() => new LineWindowChunker({ windowLines: 0, overlapLines: 0 })).toThrow(
      RangeError,
    );
    expect(() => new LineWindowChunker({ windowLines: 5, overlapLines: 5 })).toThrow(
      RangeError,
    );
    expect(() => new LineWindowChunker({ windowLines: 5, overlapLines: -1 })).toThrow(
      RangeError,
    );
    expect(() => new LineWindowChunker({ windowLines: 2.5, overlapLines: 0 })).toThrow(
      RangeError,
    );
  });
});
