-- Hand-written migration. Prisma cannot express pgvector columns, generated
-- columns or HNSW indexes, so schema.prisma declares these columns as
-- Unsupported(...) and this file creates them. See ADR 0005.

CREATE EXTENSION IF NOT EXISTS vector;

-- Semantic search. 1024 dimensions matches the chosen embedding model (ADR 0006).
-- Changing the model's dimension needs a new migration and a full re-embed.
ALTER TABLE "chunks" ADD COLUMN "embedding" vector(1024);

-- Keyword search. The 'simple' configuration lowercases tokens but does not
-- stem them or drop stop words, so identifiers such as `getUserById`,
-- `handlers` or `index` are matched exactly as written. Symbol names rank
-- above body text (weight A vs B).
ALTER TABLE "chunks" ADD COLUMN "search_vector" tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce("symbol", '')), 'A')
    || setweight(to_tsvector('simple', "content"), 'B')
) STORED;

-- Approximate nearest-neighbour index with cosine distance (the `<=>` operator).
CREATE INDEX "chunks_embedding_hnsw_idx" ON "chunks"
    USING hnsw ("embedding" vector_cosine_ops);

-- Full-text index for `search_vector @@ to_tsquery('simple', ...)`.
CREATE INDEX "chunks_search_vector_gin_idx" ON "chunks"
    USING gin ("search_vector");
