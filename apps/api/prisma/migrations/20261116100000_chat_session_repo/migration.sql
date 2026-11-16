-- AlterTable
ALTER TABLE "chat_sessions" ADD COLUMN     "repo_id" UUID NOT NULL;

-- CreateIndex
CREATE INDEX "chat_sessions_repo_id_idx" ON "chat_sessions"("repo_id");

-- AddForeignKey
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_repo_id_fkey" FOREIGN KEY ("repo_id") REFERENCES "repos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

