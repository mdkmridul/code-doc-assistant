-- CreateTable
CREATE TABLE "endpoints" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "file_id" UUID NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "framework" TEXT NOT NULL,
    "line" INTEGER NOT NULL,
    "handler" TEXT,
    "declaration" TEXT NOT NULL,

    CONSTRAINT "endpoints_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "endpoints_file_id_idx" ON "endpoints"("file_id");

-- AddForeignKey
ALTER TABLE "endpoints" ADD CONSTRAINT "endpoints_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

