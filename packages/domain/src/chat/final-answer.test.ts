import { describe, expect, it } from 'vitest';
import type { CitableSource } from '../tools/tool';
import { parseFinalAnswer, validateCitations, type AnswerMeta } from './final-answer';
import { rewriteNote } from './answer-question';

const block = (meta: unknown) => `<citations>${JSON.stringify(meta)}</citations>`;

describe('parseFinalAnswer', () => {
  it('splits the answer text from a valid citation block', () => {
    const parsed = parseFinalAnswer(
      `Retries are in \`src/retry.ts:2-5\`.\n\n${block({ found: true, citations: [{ sourceId: 'c1', lines: [2, 5] }] })}\n`,
    );
    expect(parsed).toEqual({
      ok: true,
      text: 'Retries are in `src/retry.ts:2-5`.',
      meta: { found: true, citations: [{ sourceId: 'c1', lines: [2, 5] }] },
    });
  });

  it('accepts the JSON inside a ```json fence and citations without lines', () => {
    const parsed = parseFinalAnswer('Answer.\n<citations>\n```json\n{"found": true, "citations": [{"sourceId": "r-1"}]}\n```\n</citations>');
    expect(parsed).toMatchObject({ ok: true, meta: { citations: [{ sourceId: 'r-1' }] } });
  });

  it('accepts found: false with no citations', () => {
    expect(parseFinalAnswer(`Not here.\n${block({ found: false, citations: [] })}`)).toMatchObject({
      ok: true,
      meta: { found: false, citations: [] },
    });
  });

  it.each([
    ['no block', 'Just text.', /does not end with a <citations> block/],
    ['an unclosed block', 'Text.\n<citations>{"found": true', /not closed/],
    ['text after the block', `Text.\n${block({ found: true, citations: [] })}\nP.S. more`, /nothing may follow/],
    ['invalid JSON', 'Text.\n<citations>{found: yes}</citations>', /not valid JSON/],
    ['a missing field', `Text.\n${block({ citations: [] })}`, /found/],
    ['extra fields', `Text.\n${block({ found: true, citations: [], note: 'hi' })}`, /invalid/],
    ['reversed lines', `Text.\n${block({ found: true, citations: [{ sourceId: 'c1', lines: [9, 2] }] })}`, /end >= start/],
    ['an empty sourceId', `Text.\n${block({ found: true, citations: [{ sourceId: ' ' }] })}`, /sourceId/],
  ])('rejects %s, keeping the text', (_, raw, problem) => {
    const parsed = parseFinalAnswer(raw);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.problem).toMatch(problem);
    expect(parsed.text.startsWith('Just text.') || parsed.text.startsWith('Text.')).toBe(true);
  });

  it('uses the last block when the answer quotes the tag earlier', () => {
    const raw = `Write \`<citations>\` at the end.\n\n${block({ found: true, citations: [{ sourceId: 'c1' }] })}`;
    expect(parseFinalAnswer(raw)).toMatchObject({ ok: true, text: 'Write `<citations>` at the end.' });
  });
});

describe('validateCitations', () => {
  const sources = new Map<string, CitableSource>([
    ['c1', { id: 'c1', path: 'src/retry.ts', startLine: 10, endLine: 40 }],
    ['r-1', { id: 'r-1', path: 'src/client.ts', startLine: 1, endLine: 200 }],
  ]);
  const meta = (citations: AnswerMeta['citations']): AnswerMeta => ({ found: true, citations });

  it('turns citations of this turn’s sources into path and lines, the whole source by default', () => {
    expect(
      validateCitations(meta([{ sourceId: 'c1', lines: [12, 20] }, { sourceId: 'r-1' }]), sources),
    ).toEqual({
      citations: [
        { path: 'src/retry.ts', startLine: 12, endLine: 20 },
        { path: 'src/client.ts', startLine: 1, endLine: 200 },
      ],
      rejected: [],
    });
  });

  it('rejects a fabricated citation: a sourceId no tool returned this turn', () => {
    const { citations, rejected } = validateCitations(
      meta([{ sourceId: '7f1c2e9a-0000-4000-8000-000000000000', lines: [1, 5] }, { sourceId: 'c1' }]),
      sources,
    );
    expect(citations).toEqual([{ path: 'src/retry.ts', startLine: 10, endLine: 40 }]);
    expect(rejected).toEqual(['unknown sourceId 7f1c2e9a-0000-4000-8000-000000000000']);
  });

  it('rejects lines outside the cited source', () => {
    const { citations, rejected } = validateCitations(meta([{ sourceId: 'c1', lines: [5, 12] }]), sources);
    expect(citations).toEqual([]);
    expect(rejected).toEqual(['lines 5-12 are outside c1 (src/retry.ts:10-40)']);
  });

  it('deduplicates repeated citations', () => {
    expect(validateCitations(meta([{ sourceId: 'c1' }, { sourceId: 'c1', lines: [10, 40] }]), sources).citations).toHaveLength(1);
  });
});

describe('rewriteNote', () => {
  it('spells out a block that parses, so a rewrite can follow it exactly', () => {
    const note = rewriteNote('the answer does not end with a <citations> block');
    const example = /<citations>.*<\/citations>/.exec(note)?.[0] ?? '';
    const filled = example.replace('<sourceId>', 'c1').replace('<start>', '1').replace('<end>', '2');
    expect(parseFinalAnswer(`Answer.\n${filled}`)).toMatchObject({
      ok: true,
      meta: { found: true, citations: [{ sourceId: 'c1', lines: [1, 2] }] },
    });
    expect(note).toContain('{"found": false, "citations": []}');
  });
});
