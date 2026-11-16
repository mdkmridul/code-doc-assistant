import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { IngestRepo, type IngestFilesStats } from '@cda/domain';
import type { Job } from 'bullmq';
import { runWithContext } from '../common/request-context';
import type { QueuedIngestJob } from './bull-ingest-queue';
import { INGEST_QUEUE } from './ingestion.constants';

/** One ingest at a time keeps embedding requests under provider rate limits. */
@Processor(INGEST_QUEUE, { concurrency: 1 })
export class IngestProcessor extends WorkerHost {
  private readonly logger = new Logger(IngestProcessor.name);

  constructor(private readonly ingestRepo: IngestRepo) {
    super();
  }

  /** Runs in the context of the request that queued the job (ADR 0020). */
  process(job: Job<QueuedIngestJob>): Promise<IngestFilesStats> {
    const jobId = job.id ?? job.data.ingestKey;
    const requestId = job.data.requestId ?? `job:${jobId}`;
    return runWithContext({ requestId, jobId }, () => this.run(job.data));
  }

  private async run(data: QueuedIngestJob): Promise<IngestFilesStats> {
    const started = Date.now();
    this.logger.log({
      msg: 'ingest started',
      repoId: data.repoId,
      source: data.source.type,
    });
    const stats = await this.ingestRepo.execute(data);
    this.logger.log({
      msg: 'ingest finished',
      repoId: data.repoId,
      files: stats.files,
      chunks: stats.chunks,
      endpoints: stats.endpoints,
      embeddingRequests: stats.embeddingRequests,
      durationMs: Date.now() - started,
    });
    return stats;
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<QueuedIngestJob> | undefined, error: Error): void {
    const jobId = job?.id ?? job?.data.ingestKey;
    runWithContext(
      { requestId: job?.data.requestId ?? `job:${jobId ?? '?'}`, jobId },
      () => {
        this.logger.error({
          msg: 'ingest failed',
          repoId: job?.data.repoId,
          error: error.message,
        });
      },
    );
  }
}
