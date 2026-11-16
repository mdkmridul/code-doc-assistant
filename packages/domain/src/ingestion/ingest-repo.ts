import type { RepoProgress } from '../events';
import type { IngestJob } from '../ports/ingest-queue';
import type { RepoProgressPublisher } from '../ports/repo-progress-publisher';
import type { RepoStore } from '../ports/repo-store';
import type { WorkspaceFactory } from '../ports/workspace';
import type { IngestFiles, IngestFilesOptions, IngestFilesStats } from './ingest-files';

/** Discards progress: for callers that don't broadcast it. */
const noProgress: RepoProgressPublisher = { publish: () => Promise.resolve() };

/**
 * Runs one ingest job: running → (materialise source, index files) → ready,
 * or failed with the error. The workspace is always disposed. Progress is
 * published at every step; publishing is best effort and never fails the job.
 */
export class IngestRepo {
  constructor(
    private readonly repos: RepoStore,
    private readonly workspaces: WorkspaceFactory,
    private readonly ingestFiles: IngestFiles,
    private readonly progress: RepoProgressPublisher = noProgress,
  ) {}

  async execute(
    job: IngestJob,
    options?: IngestFilesOptions,
  ): Promise<IngestFilesStats> {
    const { repoId, attemptId } = job;
    const counts = { fileCount: 0, chunkCount: 0 };
    const publish = (snapshot: Omit<RepoProgress, 'repoId' | 'fileCount' | 'chunkCount'>) => {
      this.progress
        .publish({ repoId, ...counts, ...snapshot })
        .catch(() => undefined); // best effort
    };

    await this.repos.markRunning(repoId, attemptId);
    publish({ status: 'running', error: null });

    try {
      const workspace = await this.workspaces.open(job.source);
      try {
        const stats = await this.ingestFiles.execute(
          repoId,
          workspace.files(),
          options,
          ({ files, chunks }) => {
            counts.fileCount = files;
            counts.chunkCount = chunks;
            publish({ status: 'running', error: null });
          },
        );
        await this.repos.markReady(repoId, attemptId, workspace.commitSha);
        publish({ status: 'ready', error: null });
        return stats;
      } finally {
        await workspace.dispose();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.repos.markFailed(repoId, attemptId, message);
      publish({ status: 'failed', error: message });
      throw error;
    }
  }
}
