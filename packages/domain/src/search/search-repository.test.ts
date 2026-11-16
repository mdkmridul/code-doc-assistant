import { describe, expect, it } from 'vitest';
import { RepoNotFoundError, RepoNotReadyError } from '../chat/errors';
import { FakeEmbedder, FakeRepoStore } from '../ingestion/fakes.test-helpers';
import type { RetrievalQuery, RetrievedChunk, Retriever } from '../ports/retriever';
import { SearchCodeTool } from '../tools/search-code';
import { ToolInputError } from '../tools/tool';
import { SearchRepository } from './search-repository';

class OneHit implements Retriever {
  readonly queries: RetrievalQuery[] = [];
  retrieve(query: RetrievalQuery): Promise<RetrievedChunk[]> {
    this.queries.push(query);
    return Promise.resolve([
      { chunkId: 'c1', path: 'src/a.ts', startLine: 1, endLine: 9, symbol: null, snippet: 'x', score: 0.5 },
    ]);
  }
}

const setup = (status: 'ready' | 'running' = 'ready') => {
  const repos = new FakeRepoStore();
  repos.seed({
    id: 'repo-1',
    ingestKey: 'k',
    source: { type: 'git', url: 'https://github.com/o/r', commitSha: 'abc' },
    status,
    commitSha: 'abc',
    error: null,
  });
  const retriever = new OneHit();
  const useCase = new SearchRepository(repos, new SearchCodeTool(new FakeEmbedder(3), retriever));
  return { useCase, retriever };
};

describe('SearchRepository', () => {
  it('runs search_code on a ready repo in the requested retrieval mode', async () => {
    const { useCase, retriever } = setup();

    const output = await useCase.execute({
      repoId: 'repo-1',
      search: { query: 'retry delay', topK: 5 },
      retrievalMode: 'vector',
    });

    expect(output.results.map((r) => r.sourceId)).toEqual(['c1']);
    expect(retriever.queries[0]).toMatchObject({ repoId: 'repo-1', topK: 5, mode: 'vector', text: 'retry delay' });
  });

  it('uses the tool default mode when none is requested', async () => {
    const { useCase, retriever } = setup();
    await useCase.execute({ repoId: 'repo-1', search: { query: 'q' } });
    expect(retriever.queries[0].mode).toBe('hybrid');
  });

  it('rejects unknown and unready repos, and invalid search input', async () => {
    await expect(setup().useCase.execute({ repoId: 'nope', search: { query: 'q' } })).rejects.toThrow(RepoNotFoundError);
    await expect(setup('running').useCase.execute({ repoId: 'repo-1', search: { query: 'q' } })).rejects.toThrow(
      RepoNotReadyError,
    );
    await expect(setup().useCase.execute({ repoId: 'repo-1', search: { query: '' } })).rejects.toThrow(ToolInputError);
  });
});
