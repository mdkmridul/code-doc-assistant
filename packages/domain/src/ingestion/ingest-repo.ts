import type { IngestJob } from '../ports/ingest-queue';
import type { RepoStore } from '../ports/repo-store';
import type { WorkspaceFactory } from '../ports/workspace';
import type { IngestFiles, IngestFilesOptions, IngestFilesStats } from './ingest-files';

/**
 * Runs one ingest job: running → (materialise source, index files) → ready,
 * or failed with the error. The workspace is always disposed.
 */
export class IngestRepo {
  constructor(
    private readonly repos: RepoStore,
    private readonly workspaces: WorkspaceFactory,
    private readonly ingestFiles: IngestFiles,
  ) {}

  async execute(
    job: IngestJob,
    options?: IngestFilesOptions,
  ): Promise<IngestFilesStats> {
    const { repoId, attemptId } = job;
    await this.repos.markRunning(repoId, attemptId);

    try {
      const workspace = await this.workspaces.open(job.source);
      try {
        const stats = await this.ingestFiles.execute(
          repoId,
          workspace.files(),
          options,
        );
        await this.repos.markReady(repoId, attemptId, workspace.commitSha);
        return stats;
      } finally {
        await workspace.dispose();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.repos.markFailed(repoId, attemptId, message);
      throw error;
    }
  }
}
