import type { RetrievalQuery, RetrievedChunk, Retriever } from '@cda/domain';
import { Prisma, type PrismaClient } from '../../generated/prisma/client';
import { toOrTsQuery } from './fts-query';

/** HNSW candidate list size per scan step (pgvector default: 40). */
const EF_SEARCH = 100;

/** Reciprocal rank fusion constant: the usual 60 keeps any single list from dominating. */
const RRF_K = 60;

/** Each ranking contributes this many candidates (at least) to the fusion. */
const HYBRID_CANDIDATES = 40;

/** pgvector's text input format: "[0.1,0.2,...]". */
const toVectorLiteral = (embedding: readonly number[]) =>
  `[${embedding.join(',')}]`;

interface Row {
  chunk_id: string;
  path: string;
  start_line: number;
  end_line: number;
  symbol: string | null;
  snippet: string;
  score: number;
}

/**
 * Top-k chunks of one repo by cosine similarity, with optional filters.
 *
 * The inner ORDER BY `embedding <=> query` + LIMIT is what lets Postgres use
 * the HNSW index. With iterative scans in `relaxed_order` mode the index may
 * yield rows slightly out of order, so the CTE is materialised and re-sorted
 * by exact distance (the pattern pgvector documents).
 *
 * `starts_with` matches the prefix literally; LIKE would treat `_` and `%`
 * in paths as wildcards.
 */
export function searchChunksSql(query: RetrievalQuery): Prisma.Sql {
  const vector = toVectorLiteral(query.embedding);
  const pathPrefix = query.pathPrefix ?? null;
  const language = query.language ?? null;

  return Prisma.sql`
    WITH nearest AS MATERIALIZED (
      SELECT c.id AS chunk_id,
             f.path,
             c.start_line,
             c.end_line,
             c.symbol,
             left(c.content, ${query.snippetChars}::int) AS snippet,
             c.embedding <=> ${vector}::vector AS distance
      FROM chunks c
      JOIN files f ON f.id = c.file_id
      WHERE f.repo_id = ${query.repoId}::uuid
        AND c.embedding IS NOT NULL
        AND (${pathPrefix}::text IS NULL OR starts_with(f.path, ${pathPrefix}::text))
        AND (${language}::text IS NULL OR f.language = ${language}::text)
      ORDER BY c.embedding <=> ${vector}::vector
      LIMIT ${query.topK}::int
    )
    SELECT chunk_id, path, start_line, end_line, symbol, snippet,
           (1 - distance)::float8 AS score
    FROM nearest
    ORDER BY distance + 0`;
}

/**
 * Hybrid search (ADR 0018): the vector ranking above and a full-text ranking
 * of the query's words over `chunks.search_vector` (`simple` configuration,
 * GIN index), each cut to `candidates`, fused with reciprocal rank fusion:
 * score = Σ 1 / (RRF_K + rank) over the lists a chunk appears in. The score
 * is scaled to 0-1 by the best possible value (rank 1 in both lists).
 *
 * The vector half keeps the inner `ORDER BY embedding <=> query LIMIT n`
 * shape, so HNSW is still used; the text half matches with `@@`, which the
 * GIN index serves. Both apply the same repo, path and language filters.
 */
export function hybridSearchSql(
  query: RetrievalQuery,
  tsquery: string,
): Prisma.Sql {
  const vector = toVectorLiteral(query.embedding);
  const pathPrefix = query.pathPrefix ?? null;
  const language = query.language ?? null;
  const candidates = Math.max(HYBRID_CANDIDATES, query.topK * 4);
  const best = 2 / (RRF_K + 1);

  return Prisma.sql`
    WITH nearest AS MATERIALIZED (
      SELECT c.id AS chunk_id,
             c.embedding <=> ${vector}::vector AS distance
      FROM chunks c
      JOIN files f ON f.id = c.file_id
      WHERE f.repo_id = ${query.repoId}::uuid
        AND c.embedding IS NOT NULL
        AND (${pathPrefix}::text IS NULL OR starts_with(f.path, ${pathPrefix}::text))
        AND (${language}::text IS NULL OR f.language = ${language}::text)
      ORDER BY c.embedding <=> ${vector}::vector
      LIMIT ${candidates}::int
    ),
    vector_ranked AS (
      SELECT chunk_id, row_number() OVER (ORDER BY distance, chunk_id) AS rank
      FROM nearest
    ),
    text_ranked AS (
      SELECT chunk_id, row_number() OVER (ORDER BY rank DESC, chunk_id) AS rank
      FROM (
        SELECT c.id AS chunk_id,
               ts_rank_cd(c.search_vector, to_tsquery('simple', ${tsquery})) AS rank
        FROM chunks c
        JOIN files f ON f.id = c.file_id
        WHERE f.repo_id = ${query.repoId}::uuid
          AND c.search_vector @@ to_tsquery('simple', ${tsquery})
          AND (${pathPrefix}::text IS NULL OR starts_with(f.path, ${pathPrefix}::text))
          AND (${language}::text IS NULL OR f.language = ${language}::text)
        ORDER BY rank DESC, c.id
        LIMIT ${candidates}::int
      ) matches
    ),
    fused AS (
      SELECT chunk_id, sum(1.0 / (${RRF_K}::int + rank)) AS rrf
      FROM (
        SELECT chunk_id, rank FROM vector_ranked
        UNION ALL
        SELECT chunk_id, rank FROM text_ranked
      ) ranks
      GROUP BY chunk_id
    )
    SELECT c.id AS chunk_id, f.path, c.start_line, c.end_line, c.symbol,
           left(c.content, ${query.snippetChars}::int) AS snippet,
           (fused.rrf / ${best}::float8)::float8 AS score
    FROM fused
    JOIN chunks c ON c.id = fused.chunk_id
    JOIN files f ON f.id = c.file_id
    ORDER BY fused.rrf DESC, c.id
    LIMIT ${query.topK}::int`;
}

/**
 * Semantic search with pgvector (ADR 0010), optionally fused with full-text
 * search (`mode: 'hybrid'`, ADR 0018).
 *
 * HNSW filters after finding neighbours: by default it looks at the nearest
 * 40 chunks across *all* repos and then drops those of other repos, paths or
 * languages, so a filtered query could come back short or empty. Iterative
 * scans keep walking the index until `topK` rows pass the filters.
 */
export class PgvectorRetriever implements Retriever {
  constructor(private readonly prisma: PrismaClient) {}

  async retrieve(query: RetrievalQuery): Promise<RetrievedChunk[]> {
    const rows = await this.prisma.$transaction(async (tx) => {
      // SET LOCAL lasts until the transaction ends; values are constants.
      await tx.$executeRawUnsafe(`SET LOCAL hnsw.ef_search = ${EF_SEARCH}`);
      await tx.$executeRawUnsafe(
        `SET LOCAL hnsw.iterative_scan = relaxed_order`,
      );
      // A question with only stop words has nothing for full text to match.
      const tsquery = query.mode === 'hybrid' ? toOrTsQuery(query.text) : null;
      return tx.$queryRaw<Row[]>(
        tsquery === null
          ? searchChunksSql(query)
          : hybridSearchSql(query, tsquery),
      );
    });

    return rows.map((row) => ({
      chunkId: row.chunk_id,
      path: row.path,
      startLine: row.start_line,
      endLine: row.end_line,
      symbol: row.symbol,
      snippet: row.snippet,
      score: row.score,
    }));
  }
}
