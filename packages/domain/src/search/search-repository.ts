import { RepoNotFoundError, RepoNotReadyError } from '../chat/errors';
import type { RetrievalMode } from '../ports/retriever';
import type { RepoStore } from '../ports/repo-store';
import type { SearchCodeInput, SearchCodeOutput } from '../tools/search-code';
import { invokeTool, type Tool } from '../tools/tool';

export interface SearchRepositoryInput {
  repoId: string;
  /** Unvalidated search_code arguments: query, topK, pathPrefix, language. */
  search: unknown;
  /** The server default when absent. */
  retrievalMode?: RetrievalMode;
}

/**
 * Runs `search_code` directly on a ready repository, outside any chat: what
 * the assistant would see for a query. Evals use it to measure retrieval
 * (recall@k) per retrieval mode without calling a model.
 */
export class SearchRepository {
  constructor(
    private readonly repos: Pick<RepoStore, 'findById'>,
    private readonly searchCode: Tool<SearchCodeInput, SearchCodeOutput>,
  ) {}

  async execute({ repoId, search, retrievalMode }: SearchRepositoryInput): Promise<SearchCodeOutput> {
    const repo = await this.repos.findById(repoId);
    if (!repo) throw new RepoNotFoundError(repoId);
    if (repo.status !== 'ready') {
      throw new RepoNotReadyError(repoId, repo.status, 'searched');
    }
    return invokeTool(this.searchCode, search, {
      repoId,
      ...(retrievalMode !== undefined && { retrievalMode }),
    });
  }
}
