import type { RetrievalQuery, RetrievedChunk, Retriever } from '@cda/domain';
import { Prisma, type PrismaClient } from '../../generated/prisma/client';

/** HNSW candidate list size per scan step (pgvector default: 40). */
const EF_SEARCH = 100;

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
 * Semantic search with pgvector (ADR 0010).
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
      return tx.$queryRaw<Row[]>(searchChunksSql(query));
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
