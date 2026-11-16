import type { HttpMethod, StoredEndpoint } from '../endpoints/api-endpoint';

export interface EndpointQuery {
  repoId: string;
  method?: HttpMethod;
  /** Case-insensitive substring of the route path, e.g. "users". */
  pathContains?: string;
  /** Only endpoints declared in files under this repo-relative path, e.g. "src/admin/". */
  filePrefix?: string;
  limit: number;
  /** Matches to skip first, for paging. */
  offset: number;
}

/** The HTTP routes recorded for a repository during ingest. */
export interface EndpointCatalog {
  /** Matching endpoints ordered by file path and line, `limit` from `offset`, with the total match count. */
  list(query: EndpointQuery): Promise<{ endpoints: StoredEndpoint[]; total: number }>;
}
