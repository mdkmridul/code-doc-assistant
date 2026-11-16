export interface RetrievalQuery {
  repoId: string;
  /** Query vector from the same model (and query mode) the chunks were embedded with. */
  embedding: readonly number[];
  /** How many chunks to return at most. */
  topK: number;
  /** Only chunks whose file path starts with this repo-relative POSIX prefix. */
  pathPrefix?: string;
  /** Only chunks of files in this language id, e.g. `typescript`. */
  language?: string;
  /** Snippets are cut to this many characters to keep results compact. */
  snippetChars: number;
}

/** A compact search hit: enough to cite and decide whether to read more. */
export interface RetrievedChunk {
  chunkId: string;
  path: string;
  startLine: number;
  endLine: number;
  symbol: string | null;
  snippet: string;
  /** Cosine similarity, higher is closer (1 = same direction). */
  score: number;
}

/** Finds the chunks of one repo closest in meaning to a query vector. */
export interface Retriever {
  /** Best match first. Returns fewer than `topK` only if fewer chunks match the filters. */
  retrieve(query: RetrievalQuery): Promise<RetrievedChunk[]>;
}
