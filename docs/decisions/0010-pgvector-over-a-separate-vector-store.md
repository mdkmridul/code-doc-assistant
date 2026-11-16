# 0010 — pgvector in Postgres over a separate vector store

Semantic search runs as plain SQL in the same Postgres that holds repos, files and chunks: an HNSW index on `chunks.embedding` with cosine distance, queried by `PgvectorRetriever`. We chose this over a dedicated vector database such as Qdrant, Weaviate, Pinecone or Milvus.

**Why pgvector.** One system, one transaction. A file and its chunks and vectors are written atomically (ADR 0005), so search can never see vectors for chunks that do not exist, or the reverse, and there is no second store to back up, secure or keep in sync. Filters are ordinary SQL joins on columns we already have (`repo_id`, `path`, `language`), so no payload has to be copied into another system. The same rows also carry the `simple` tsvector, so keyword and vector search can be combined in one query later. At this project's scale (thousands to low millions of chunks), pgvector's HNSW is fast enough, and Compose stays at Postgres, Redis and Ollama.

**What we give up, and how we handle it.** A dedicated store filters *during* graph search; pgvector's HNSW filters *after*. With default settings it looks at the nearest 40 chunks across all repos and only then drops other repos, paths or languages, so a filtered search can come back short or empty. A test reproduces exactly that. `PgvectorRetriever` turns on pgvector 0.8 iterative index scans (`hnsw.iterative_scan = relaxed_order`, `ef_search = 100`) inside each search transaction, and re-sorts the materialised results by exact distance. For small repos the planner skips HNSW entirely and does an exact filtered scan, which is both correct and fast.

**Second caveat.** Deleted chunks (re-ingesting a file replaces its chunks) stay in the HNSW graph until VACUUM, and many of them measurably hurt recall even with iterative scans. Autovacuum keeps this in check in normal operation. If retrieval quality drops after heavy re-ingestion, run `VACUUM chunks` or tune autovacuum for that table.

We would revisit this choice if the corpus grew past what a single Postgres comfortably serves (tens of millions of vectors), or if strict filtered recall at that scale became a requirement.
