-- Hand-written: renaming enum values in place keeps existing rows valid
-- (Prisma's generated version would recreate the type and fail to cast them).
ALTER TYPE "repo_status" RENAME VALUE 'pending' TO 'queued';
ALTER TYPE "repo_status" RENAME VALUE 'ingesting' TO 'running';
ALTER TABLE "repos" ALTER COLUMN "status" SET DEFAULT 'queued';

-- sha256 of the uploaded archive, for local sources.
ALTER TABLE "repos" ADD COLUMN "content_hash" TEXT;

-- Identity of one ingest: sha256(source + commit) or sha256(content hash).
-- Rows created before this migration get a unique placeholder so the column
-- can be NOT NULL; they will never match a real key.
ALTER TABLE "repos" ADD COLUMN "ingest_key" TEXT;
UPDATE "repos" SET "ingest_key" = 'legacy:' || "id"::text WHERE "ingest_key" IS NULL;
ALTER TABLE "repos" ALTER COLUMN "ingest_key" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "repos_ingest_key_key" ON "repos"("ingest_key");
