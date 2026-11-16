-- AlterTable
ALTER TABLE "llm_calls" ADD COLUMN     "request_id" TEXT;

-- CreateIndex
CREATE INDEX "llm_calls_request_id_idx" ON "llm_calls"("request_id");

