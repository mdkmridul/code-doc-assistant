-- Hand-written (ADR 0005). Embeddings move from voyage-code-3 (1024-d) to
-- nomic-embed-text via a local Ollama (768-d), ADR 0009.
--
-- Vectors from one model cannot be converted to another, so existing
-- embeddings are cleared. Repos ingested before this migration must be
-- re-ingested to be searchable by meaning (keyword search keeps working).

-- The HNSW index is tied to the column's dimension: rebuild it.
DROP INDEX "chunks_embedding_hnsw_idx";

ALTER TABLE "chunks" ALTER COLUMN "embedding" TYPE vector(768) USING NULL;

CREATE INDEX "chunks_embedding_hnsw_idx" ON "chunks"
    USING hnsw ("embedding" vector_cosine_ops);
