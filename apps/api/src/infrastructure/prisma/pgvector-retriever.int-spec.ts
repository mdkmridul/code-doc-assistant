/**
 * Runs the retriever's SQL against the Compose Postgres (database `cda_test`,
 * see test/int-global-setup.ts, which forces the HNSW path). Run with
 * `npm run test:integration`.
 */
import type { RetrievalQuery } from '@cda/domain';
import { testPrismaClient } from '../../../test/int-database';
import { Prisma, type PrismaClient } from '../../generated/prisma/client';
import {
  hybridSearchSql,
  PgvectorRetriever,
  searchChunksSql,
} from './pgvector-retriever';

const DIMENSIONS = 768;
const KEY_PREFIX = 'int-test:pgvector-retriever:';

// Test vectors are seeded random dense unit vectors, like real embeddings.
// (Sparse hand-made vectors such as [1,0,0,...] make degenerate HNSW graphs in
// which some nodes are unreachable, which says nothing about real data.)

/** mulberry32: small seeded PRNG so every run builds the same vectors. */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = rng(42);

const dot = (a: readonly number[], b: readonly number[]) =>
  a.reduce((sum, x, i) => sum + x * b[i], 0);
const normalize = (v: number[]) => {
  const norm = Math.sqrt(dot(v, v));
  return v.map((x) => x / norm);
};
const randomUnit = () =>
  normalize(Array.from({ length: DIMENSIONS }, () => random() - 0.5));

/** A unit vector whose cosine similarity to unit vector `q` is exactly `cosine`. */
function withCosine(q: readonly number[], cosine: number): number[] {
  const r = randomUnit();
  const along = dot(r, q);
  const orthogonal = normalize(r.map((x, i) => x - along * q[i]));
  const sin = Math.sqrt(1 - cosine * cosine);
  return q.map((x, i) => cosine * x + sin * orthogonal[i]);
}

const literal = (v: readonly number[]) => `[${v.join(',')}]`;

let prisma: PrismaClient;
let retriever: PgvectorRetriever;
let q: number[];

beforeAll(() => {
  prisma = testPrismaClient();
  retriever = new PgvectorRetriever(prisma);
  q = randomUnit();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  // Cascades to files and chunks.
  await prisma.repo.deleteMany({
    where: { ingestKey: { startsWith: KEY_PREFIX } },
  });
  // Deleted rows stay in the HNSW graph until VACUUM and measurably hurt
  // recall, even with iterative scans (see ADR 0010). Each test starts clean.
  await prisma.$executeRawUnsafe('VACUUM chunks');
});

async function createRepo(name: string): Promise<string> {
  const repo = await prisma.repo.create({
    data: {
      sourceType: 'local',
      localPath: `${name}.zip`,
      ingestKey: `${KEY_PREFIX}${name}`,
      status: 'ready',
    },
  });
  return repo.id;
}

async function createFile(
  repoId: string,
  path: string,
  language = 'typescript',
): Promise<string> {
  const file = await prisma.file.create({
    data: { repoId, path, language, content: '' },
  });
  return file.id;
}

interface ChunkSpec {
  content?: string;
  embedding: readonly number[] | null;
  startLine?: number;
  endLine?: number;
  symbol?: string | null;
}

/** Inserts chunks in one statement; returns their ids in input order. */
async function createChunks(
  fileId: string,
  chunks: ChunkSpec[],
): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO chunks (file_id, symbol, kind, start_line, end_line, content, content_hash, embedding)
    SELECT ${fileId}::uuid, t.symbol, 'block', t.start_line, t.end_line, t.content,
           md5(t.content), t.embedding::vector
    FROM unnest(
      ${chunks.map((c) => c.symbol ?? null)}::text[],
      ${chunks.map((c) => c.startLine ?? 1)}::int[],
      ${chunks.map((c) => c.endLine ?? 10)}::int[],
      ${chunks.map((c, i) => c.content ?? `chunk ${i}`)}::text[],
      ${chunks.map((c) => (c.embedding ? literal(c.embedding) : null))}::text[]
    ) WITH ORDINALITY AS t(symbol, start_line, end_line, content, embedding, n)
    ORDER BY t.n
    RETURNING id`;
  return rows.map((r) => r.id);
}

/** One file per call, one chunk near the query. */
async function chunkIn(
  repoId: string,
  path: string,
  language = 'typescript',
  cosine = 0.8,
): Promise<string> {
  const [id] = await createChunks(await createFile(repoId, path, language), [
    { embedding: withCosine(q, cosine) },
  ]);
  return id;
}

const query = (
  overrides: Partial<RetrievalQuery> & Pick<RetrievalQuery, 'repoId'>,
): RetrievalQuery => ({
  embedding: q,
  text: '',
  mode: 'vector',
  topK: 10,
  snippetChars: 600,
  ...overrides,
});

describe('PgvectorRetriever (Postgres)', () => {
  it('ranks by cosine similarity and returns compact rows', async () => {
    const repoId = await createRepo('ranking');
    const fileId = await createFile(repoId, 'src/ky.ts');
    const [far, best, middle] = await createChunks(fileId, [
      { embedding: withCosine(q, 0.1), startLine: 21, endLine: 40 },
      {
        // Cosine ignores magnitude: a scaled copy still scores ~1.
        embedding: withCosine(q, 0.999).map((x) => x * 3),
        content: 'retry logic',
        startLine: 1,
        endLine: 20,
        symbol: 'retry',
      },
      { embedding: withCosine(q, 0.6), startLine: 11, endLine: 30 },
    ]);

    const results = await retriever.retrieve(query({ repoId }));

    expect(results.map((r) => r.chunkId)).toEqual([best, middle, far]);
    expect(results.map((r) => r.score)).toEqual([
      expect.closeTo(0.999, 4),
      expect.closeTo(0.6, 4),
      expect.closeTo(0.1, 4),
    ]);
    expect(results[0]).toEqual({
      chunkId: best,
      path: 'src/ky.ts',
      startLine: 1,
      endLine: 20,
      symbol: 'retry',
      snippet: 'retry logic',
      score: expect.any(Number) as number,
    });
  });

  it('returns at most topK rows, the best ones', async () => {
    const repoId = await createRepo('top-k');
    const ids = await createChunks(
      await createFile(repoId, 'a.ts'),
      [0.9, 0.8, 0.7, 0.6, 0.5].map((c) => ({ embedding: withCosine(q, c) })),
    );

    const results = await retriever.retrieve(query({ repoId, topK: 2 }));

    expect(results.map((r) => r.chunkId)).toEqual(ids.slice(0, 2));
  });

  it('cuts snippets to snippetChars', async () => {
    const repoId = await createRepo('snippet');
    await createChunks(await createFile(repoId, 'a.ts'), [
      { content: 'x'.repeat(50), embedding: withCosine(q, 0.9) },
    ]);

    const [result] = await retriever.retrieve(
      query({ repoId, snippetChars: 10 }),
    );

    expect(result.snippet).toBe('x'.repeat(10));
  });

  it('only searches the requested repo', async () => {
    const mine = await createRepo('mine');
    const other = await createRepo('other');
    await chunkIn(other, 'a.ts', 'typescript', 0.99); // closer, but not ours
    const own = await chunkIn(mine, 'a.ts', 'typescript', 0.5);

    const results = await retriever.retrieve(query({ repoId: mine }));

    expect(results.map((r) => r.chunkId)).toEqual([own]);
  });

  it('filters by path prefix literally, not as a LIKE pattern', async () => {
    const repoId = await createRepo('path');
    const underscore = await chunkIn(repoId, 'src_util/a.ts');
    await chunkIn(repoId, 'srcXutil/b.ts'); // would match LIKE 'src_util%'
    const nested = await chunkIn(repoId, 'src/core/c.ts');

    const byUnderscore = await retriever.retrieve(
      query({ repoId, pathPrefix: 'src_util/' }),
    );
    const bySrc = await retriever.retrieve(
      query({ repoId, pathPrefix: 'src/' }),
    );

    expect(byUnderscore.map((r) => r.chunkId)).toEqual([underscore]);
    expect(bySrc.map((r) => r.chunkId)).toEqual([nested]);
  });

  it('filters by language', async () => {
    const repoId = await createRepo('language');
    await chunkIn(repoId, 'README.md', 'markdown', 0.95);
    const code = await chunkIn(repoId, 'a.ts', 'typescript', 0.6);

    const results = await retriever.retrieve(
      query({ repoId, language: 'typescript' }),
    );

    expect(results.map((r) => r.chunkId)).toEqual([code]);
  });

  it('skips chunks that have no embedding yet', async () => {
    const repoId = await createRepo('no-embedding');
    const [embedded] = await createChunks(await createFile(repoId, 'a.ts'), [
      { embedding: withCosine(q, 0.7) },
      { embedding: null },
    ]);

    const results = await retriever.retrieve(query({ repoId }));

    expect(results.map((r) => r.chunkId)).toEqual([embedded]);
  });

  it('uses the HNSW index', async () => {
    const repoId = await createRepo('plan');
    await chunkIn(repoId, 'a.ts');

    const plan = await prisma.$queryRaw<{ 'QUERY PLAN': string }[]>(
      Prisma.sql`EXPLAIN ${searchChunksSql(query({ repoId }))}`,
    );

    expect(plan.map((row) => row['QUERY PLAN']).join('\n')).toContain(
      'Index Scan using chunks_embedding_hnsw_idx',
    );
  });

  it('still fills topK when the nearest chunks all belong to another repo (iterative scan)', async () => {
    // 300 decoys, all closer to the query than any target: far more than the
    // retriever's ef_search (100) candidates per scan step.
    const crowd = await createRepo('crowd');
    await createChunks(
      await createFile(crowd, 'decoys.ts'),
      Array.from({ length: 300 }, (_, i) => ({
        embedding: withCosine(q, 0.6 + (0.3 * i) / 300),
      })),
    );
    const target = await createRepo('target');
    const targets = await createChunks(
      await createFile(target, 'wanted.ts'),
      [0.3, 0.25, 0.2].map((c) => ({ embedding: withCosine(q, c) })),
    );
    const request = query({ repoId: target, topK: 3 });

    // Same SQL without iterative scans: the index yields only the nearest
    // candidates (all decoys), and the repo filter then discards them.
    const plain = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL hnsw.ef_search = 100');
      await tx.$executeRawUnsafe('SET LOCAL hnsw.iterative_scan = off');
      return tx.$queryRaw<unknown[]>(searchChunksSql(request));
    });
    const results = await retriever.retrieve(request);

    expect(plain.length).toBeLessThan(3);
    expect(results.map((r) => r.chunkId)).toEqual(targets);
  });

  describe('hybrid mode', () => {
    /** One identifier chunk far from the query vector, among decoys close to it. */
    async function identifierAmongDecoys(
      repoId: string,
    ): Promise<{ wanted: string; decoys: string[] }> {
      const fileId = await createFile(repoId, 'source/retry.ts');
      const decoys = await createChunks(
        fileId,
        [0.9, 0.85, 0.8, 0.75, 0.7].map((cosine, i) => ({
          content: `generic request handling ${String(i)}`,
          embedding: withCosine(q, cosine),
        })),
      );
      const [wanted] = await createChunks(fileId, [
        {
          content: 'export const afterStatusCodes = [413, 429, 503];',
          symbol: 'afterStatusCodes',
          embedding: withCosine(q, 0.1),
        },
      ]);
      return { wanted, decoys };
    }

    it('ranks an exact identifier match that the vector ranking alone misses', async () => {
      const repoId = await createRepo('hybrid-identifier');
      const { wanted, decoys } = await identifierAmongDecoys(repoId);
      const text = 'Which status codes does afterStatusCodes list?';

      const vectorOnly = await retriever.retrieve(
        query({ repoId, topK: 3, text, mode: 'vector' }),
      );
      const hybrid = await retriever.retrieve(
        query({ repoId, topK: 3, text, mode: 'hybrid' }),
      );

      expect(vectorOnly.map((r) => r.chunkId)).toEqual(decoys.slice(0, 3));
      expect(hybrid[0].chunkId).toBe(wanted);
      expect(hybrid.map((r) => r.chunkId).slice(1)).toEqual(decoys.slice(0, 2));
      // Fused scores are scaled to 0-1 and sorted best first.
      for (const r of hybrid) {
        expect(r.score).toBeGreaterThan(0);
        expect(r.score).toBeLessThanOrEqual(1);
      }
      expect(hybrid.map((r) => r.score)).toEqual(
        [...hybrid.map((r) => r.score)].sort((a, b) => b - a),
      );
    });

    it('keeps the repo, path and language filters on the text half', async () => {
      const repoId = await createRepo('hybrid-filters');
      const other = await createRepo('hybrid-filters-other');
      await identifierAmongDecoys(other);
      const docs = await createFile(repoId, 'docs/readme.md', 'markdown');
      await createChunks(docs, [
        {
          content: 'afterStatusCodes is documented here',
          embedding: withCosine(q, 0.2),
        },
      ]);
      const [code] = await createChunks(
        await createFile(repoId, 'source/a.ts'),
        [
          {
            content: 'const x = afterStatusCodes;',
            embedding: withCosine(q, 0.2),
          },
        ],
      );

      const results = await retriever.retrieve(
        query({
          repoId,
          text: 'afterStatusCodes',
          mode: 'hybrid',
          pathPrefix: 'source/',
          language: 'typescript',
        }),
      );

      expect(results.map((r) => r.chunkId)).toEqual([code]);
    });

    it('falls back to vector search when the question has no searchable words', async () => {
      const repoId = await createRepo('hybrid-fallback');
      await identifierAmongDecoys(repoId);
      const text = 'How does it work?';

      const vectorOnly = await retriever.retrieve(
        query({ repoId, topK: 3, text, mode: 'vector' }),
      );
      const hybrid = await retriever.retrieve(
        query({ repoId, topK: 3, text, mode: 'hybrid' }),
      );

      expect(hybrid).toEqual(vectorOnly);
    });

    // Only the vector half's plan is stable on a tiny test table; the text half
    // and the final lookup are planner choices (see ADR 0018 for the real plan).
    it('keeps the HNSW index for the vector half', async () => {
      const repoId = await createRepo('hybrid-plan');
      await identifierAmongDecoys(repoId);

      const plan = await prisma.$queryRaw<{ 'QUERY PLAN': string }[]>(
        Prisma.sql`EXPLAIN ${hybridSearchSql(query({ repoId, mode: 'hybrid' }), 'afterstatuscodes')}`,
      );
      const text = plan
        .map((row) => row['QUERY PLAN'])
        .join(String.fromCharCode(10));

      expect(text).toContain('chunks_embedding_hnsw_idx');
    });
  });
});
