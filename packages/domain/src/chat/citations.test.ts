import { describe, expect, it } from 'vitest';
import type { Citation } from '../ports/chat-store';
import { resolveCitations } from './citations';

const evidence: Citation[] = [
  { path: 'source/core/Ky.ts', startLine: 701, endLine: 760 },
  { path: 'source/core/Ky.ts', startLine: 1251, endLine: 1310 },
  { path: 'source/utils/timeout.ts', startLine: 1, endLine: 46 },
  { path: 'source/errors/TimeoutError.ts', startLine: 1, endLine: 15 },
  { path: 'test/timeout.ts', startLine: 1, endLine: 60 },
];

const cite = (path: string, startLine: number, endLine = startLine) => ({
  path,
  startLine,
  endLine,
});

describe('resolveCitations', () => {
  it('turns full-path line ranges backed by evidence into citations, in order', () => {
    const answer =
      'It throws in `source/core/Ky.ts:1251-1273` after racing in source/utils/timeout.ts:1-46.';

    expect(resolveCitations(answer, evidence)).toEqual({
      citations: [cite('source/core/Ky.ts', 1251, 1273), cite('source/utils/timeout.ts', 1, 46)],
      unverifiedReferences: [],
    });
  });

  it('keeps the precise range the answer cites, not the whole retrieved chunk', () => {
    const { citations } = resolveCitations('See source/core/Ky.ts:751-763.', evidence);
    expect(citations).toEqual([cite('source/core/Ky.ts', 751, 763)]);
  });

  it('accepts single lines and en-dash ranges', () => {
    const { citations } = resolveCitations(
      'Line source/core/Ky.ts:705 and source/core/Ky.ts:710–712.',
      evidence,
    );
    expect(citations).toEqual([
      cite('source/core/Ky.ts', 705),
      cite('source/core/Ky.ts', 710, 712),
    ]);
  });

  it('resolves a bare file name when exactly one retrieved file has it', () => {
    const { citations } = resolveCitations('Defined in `TimeoutError.ts:1-15`.', evidence);
    expect(citations).toEqual([cite('source/errors/TimeoutError.ts', 1, 15)]);
  });

  it('resolves a partial path suffix', () => {
    const { citations } = resolveCitations('In core/Ky.ts:701-710.', evidence);
    expect(citations).toEqual([cite('source/core/Ky.ts', 701, 710)]);
  });

  it('reports an ambiguous bare name as unverified', () => {
    // source/utils/timeout.ts and test/timeout.ts are both "timeout.ts".
    expect(resolveCitations('See timeout.ts:1-10.', evidence)).toEqual({
      citations: [],
      unverifiedReferences: ['timeout.ts:1-10'],
    });
  });

  it('reports references to files or lines the model never saw', () => {
    const answer =
      'Also source/core/Ky.ts:100-120, source/core/other.ts:1-5 and source/core/Ky.ts:9-5.';

    expect(resolveCitations(answer, evidence)).toEqual({
      citations: [],
      unverifiedReferences: [
        'source/core/Ky.ts:100-120', // file seen, lines not
        'source/core/other.ts:1-5', // file never seen
        'source/core/Ky.ts:9-5', // backwards range
      ],
    });
  });

  it('ignores bare paths without line numbers and prose that only looks like a reference', () => {
    const answer =
      'The file source/core/Ky.ts handles it. Step:1, ratio 3:2, at 10:30, see https://x.io:443.';

    expect(resolveCitations(answer, evidence)).toEqual({
      citations: [],
      unverifiedReferences: [],
    });
  });

  it('cites each range once', () => {
    const { citations } = resolveCitations(
      'source/core/Ky.ts:701-705 … again source/core/Ky.ts:701-705 … and Ky.ts:701-705.',
      evidence,
    );
    expect(citations).toEqual([cite('source/core/Ky.ts', 701, 705)]);
  });
});
