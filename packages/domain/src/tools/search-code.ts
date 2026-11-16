import { z } from 'zod';
import type { Embedder } from '../ports/embedder';
import type { RetrievedChunk, Retriever } from '../ports/retriever';
import type { Tool, ToolContext } from './tool';

/** Long enough to recognise the code, short enough that 8–20 hits stay cheap. */
export const SEARCH_SNIPPET_CHARS = 600;

export const searchCodeInputSchema = z
  .object({
    query: z
      .string()
      .trim()
      .min(1)
      .max(1000)
      .describe(
        'What to look for, in natural language or code terms, e.g. "where are failed requests retried?"',
      ),
    topK: z
      .number()
      .int()
      .min(1)
      .max(20)
      .default(8)
      .describe('How many results to return (1-20).'),
    pathPrefix: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .optional()
      .describe('Only search under this repo-relative path, e.g. "src/auth/".'),
    language: z
      .string()
      .trim()
      .toLowerCase()
      .min(1)
      .max(50)
      .optional()
      .describe('Only search files in this language, e.g. "typescript" or "markdown".'),
  })
  .strict();

export type SearchCodeInput = z.infer<typeof searchCodeInputSchema>;

export interface SearchCodeOutput {
  results: RetrievedChunk[];
}

/** "./src\\auth/" and "/src/auth/" both mean "src/auth/" in the repo. */
export function normalizePathPrefix(prefix: string): string {
  return prefix.replace(/\\/g, '/').replace(/^(\.\/|\/)+/, '');
}

/** Semantic search over the conversation's repository. */
export class SearchCodeTool implements Tool<SearchCodeInput, SearchCodeOutput> {
  readonly name = 'search_code';
  readonly description =
    'Semantic search over the current repository. Returns the code chunks closest in ' +
    'meaning to the query, best first, each with path, line range, symbol, a snippet and a ' +
    'similarity score (0-1). Use it to find where something is implemented, configured or ' +
    'documented. Narrow with pathPrefix or language when you know where to look.';
  readonly inputSchema = searchCodeInputSchema;

  constructor(
    /** Must embed in query mode, with the same model used to index chunks. */
    private readonly queryEmbedder: Embedder,
    private readonly retriever: Retriever,
  ) {}

  async execute(input: SearchCodeInput, context: ToolContext): Promise<SearchCodeOutput> {
    const [embedding] = await this.queryEmbedder.embed([input.query]);
    const pathPrefix =
      input.pathPrefix === undefined ? undefined : normalizePathPrefix(input.pathPrefix);

    const results = await this.retriever.retrieve({
      repoId: context.repoId,
      embedding,
      topK: input.topK,
      // An empty prefix after normalisation ("./") means the whole repo.
      pathPrefix: pathPrefix === '' ? undefined : pathPrefix,
      language: input.language,
      snippetChars: SEARCH_SNIPPET_CHARS,
    });

    return {
      results: results.map((r) => ({ ...r, score: Math.round(r.score * 1000) / 1000 })),
    };
  }
}
