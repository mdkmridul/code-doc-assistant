import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { IngestRepo, type IngestFilesStats, type IngestJob } from '@cda/domain';
import type { Job } from 'bullmq';
import { INGEST_QUEUE } from './ingestion.constants';

/** One ingest at a time keeps embedding requests under provider rate limits. */
@Processor(INGEST_QUEUE, { concurrency: 1 })
export class IngestProcessor extends WorkerHost {
  private readonly logger = new Logger(IngestProcessor.name);

  constructor(private readonly ingestRepo: IngestRepo) {
    super();
  }

  async process(job: Job<IngestJob>): Promise<IngestFilesStats> {
    const started = Date.now();
    this.logger.log(
      `Ingesting repo ${job.data.repoId} (${job.data.source.type})`,
    );
    const stats = await this.ingestRepo.execute(job.data);
    this.logger.log(
      `Repo ${job.data.repoId} ready: ${stats.files} files, ${stats.chunks} chunks, ` +
        `${stats.embeddingRequests} embedding requests in ${Date.now() - started} ms`,
    );
    return stats;
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<IngestJob> | undefined, error: Error): void {
    this.logger.error(
      `Ingest of repo ${job?.data.repoId ?? '?'} failed: ${error.message}`,
    );
  }
}
