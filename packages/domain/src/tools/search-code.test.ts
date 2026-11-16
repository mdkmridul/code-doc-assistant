import { describe, expect, it } from 'vitest';
import type { RetrievalQuery, RetrievedChunk, Retriever } from '../ports/retriever';
import { FakeEmbedder } from '../ingestion/fakes.test-helpers';
import { SEARCH_SNIPPET_CHARS, SearchCodeTool, normalizePathPrefix } from './search-code';
import { invokeTool, ToolInputError } from './tool';

class FakeRetriever implements Retriever {
  readonly queries: RetrievalQuery[] = [];
  constructor(private readonly hits: RetrievedChunk[] = []) {}

  retrieve(query: RetrievalQuery): Promise<RetrievedChunk[]> {
    this.queries.push(query);
    return Promise.resolve(this.hits.slice(0, query.topK));
  }
}

const hit = (chunkId: string, score: number): RetrievedChunk => ({
  chunkId,
  path: 'source/core/Ky.ts',
  startLine: 1,
  endLine: 60,
  symbol: null,
  snippet: 'class Ky {}',
  score,
});

const setup = (hits: RetrievedChunk[] = []) => {
  const embedder = new FakeEmbedder(3);
  const retriever = new FakeRetriever(hits);
  return { embedder, retriever, tool: new SearchCodeTool(embedder, retriever) };
};

const context = { repoId: 'repo-1' };

describe('SearchCodeTool', () => {
  it('is named search_code and documents every input field for the model', () => {
    const { tool } = setup();
    expect(tool.name).toBe('search_code');
    for (const field of ['query', 'topK', 'pathPrefix', 'language']) {
      expect(tool.inputSchema.shape[field as keyof typeof tool.inputSchema.shape].description)
        .toBeTruthy();
    }
  });

  it('embeds the query once and searches the context repo with defaults', async () => {
    const { tool, embedder, retriever } = setup();

    await invokeTool(tool, { query: '  how are requests retried?  ' }, context);

    expect(embedder.calls).toEqual([['how are requests retried?']]);
    expect(retriever.queries).toEqual([
      {
        repoId: 'repo-1',
        embedding: [25, 1, 1], // FakeEmbedder: [text length, 1, 1]
        topK: 8,
        pathPrefix: undefined,
        language: undefined,
        snippetChars: SEARCH_SNIPPET_CHARS,
      },
    ]);
  });

  it('passes topK and filters, normalising the path and language', async () => {
    const { tool, retriever } = setup();

    await invokeTool(
      tool,
      { query: 'timeouts', topK: 3, pathPrefix: './source\\utils/', language: ' TypeScript ' },
      context,
    );

    expect(retriever.queries[0]).toMatchObject({
      topK: 3,
      pathPrefix: 'source/utils/',
      language: 'typescript',
    });
  });

  it('treats a prefix of only "./" as the whole repo', async () => {
    const { tool, retriever } = setup();
    await invokeTool(tool, { query: 'x', pathPrefix: './' }, context);
    expect(retriever.queries[0].pathPrefix).toBeUndefined();
  });

  it('returns hits best-first with scores rounded to 3 decimals', async () => {
    const { tool } = setup([hit('a', 0.812345), hit('b', 0.70001)]);

    const output = await invokeTool(tool, { query: 'ky' }, context);

    expect(output.results.map((r) => [r.chunkId, r.score])).toEqual([
      ['a', 0.812],
      ['b', 0.7],
    ]);
  });

  it.each([
    [{}, /query/],
    [{ query: '   ' }, /query/],
    [{ query: 'x', topK: 0 }, /topK/],
    [{ query: 'x', topK: 21 }, /topK/],
    [{ query: 'x', topK: 2.5 }, /topK/],
    [{ query: 'x', repoId: 'other-repo' }, /repoId/],
  ])('rejects invalid input %j without searching', async (input, message) => {
    const { tool, embedder, retriever } = setup();

    const error = await invokeTool(tool, input, context).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ToolInputError);
    expect((error as ToolInputError).message).toMatch(message);
    expect(embedder.calls).toEqual([]);
    expect(retriever.queries).toEqual([]);
  });
});

describe('normalizePathPrefix', () => {
  it.each([
    ['src/auth/', 'src/auth/'],
    ['./src/auth', 'src/auth'],
    ['/src/auth', 'src/auth'],
    ['src\\auth\\', 'src/auth/'],
    ['././src', 'src'],
  ])('%s → %s', (input, expected) => {
    expect(normalizePathPrefix(input)).toBe(expected);
  });
});
