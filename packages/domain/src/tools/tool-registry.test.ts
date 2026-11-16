import { describe, expect, it } from 'vitest';
import { LookupTool } from '../chat/fakes.test-helpers';
import { FakeEmbedder } from '../ingestion/fakes.test-helpers';
import type { RetrievedChunk, Retriever } from '../ports/retriever';
import { SearchCodeTool } from './search-code';
import { ToolRegistry } from './tool-registry';

class OneHitRetriever implements Retriever {
  retrieve(): Promise<RetrievedChunk[]> {
    return Promise.resolve([
      { chunkId: 'c1', path: 'src/a.ts', startLine: 3, endLine: 9, symbol: null, snippet: 'x', score: 0.9 },
    ]);
  }
}

describe('ToolRegistry', () => {
  it('describes tools to the model as JSON Schema, sorted by name', () => {
    const registry = new ToolRegistry([
      new SearchCodeTool(new FakeEmbedder(3), new OneHitRetriever()),
      new LookupTool(),
    ]);

    const definitions = registry.definitions();

    expect(definitions.map((d) => d.name)).toEqual(['lookup', 'search_code']);
    const search = definitions[1];
    expect(search.description).toMatch(/Semantic search/);
    expect(search.inputSchema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['query'], // topK has a default, so callers may omit it
      properties: {
        query: { type: 'string', description: expect.any(String) as string },
        topK: { type: 'integer', minimum: 1, maximum: 20, default: 8 },
      },
    });
  });

  it('executes a valid call and returns the tool citations', async () => {
    const registry = new ToolRegistry([
      new SearchCodeTool(new FakeEmbedder(3), new OneHitRetriever()),
    ]);

    const execution = await registry.execute('search_code', { query: 'q' }, { repoId: 'r' });

    expect(execution).toMatchObject({
      ok: true,
      citations: [{ path: 'src/a.ts', startLine: 3, endLine: 9 }],
      summary: '1 result',
      excerpts: [{ path: 'src/a.ts', startLine: 3, endLine: 9, text: 'x', source: 'search' }],
    });
  });

  it('rejects duplicate tool names', () => {
    expect(() => new ToolRegistry([new LookupTool(), new LookupTool()])).toThrow(/Duplicate/);
  });
});
