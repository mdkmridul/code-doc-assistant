import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { IngestJob, IngestQueue } from '@cda/domain';
import { Queue } from 'bullmq';
import { currentContext } from '../common/request-context';
import { INGEST_JOB_NAME, INGEST_QUEUE } from './ingestion.constants';

/** The job as stored in Redis: the domain job plus the id of the request that queued it. */
export type QueuedIngestJob = IngestJob & { requestId?: string };

@Injectable()
export class BullIngestQueue implements IngestQueue {
  private readonly logger = new Logger(BullIngestQueue.name);

  constructor(
    @InjectQueue(INGEST_QUEUE) private readonly queue: Queue<QueuedIngestJob>,
  ) {}

  async enqueue(job: IngestJob): Promise<void> {
    // The request id travels with the job, so the worker's logs share it (ADR 0020).
    const requestId = currentContext()?.requestId;
    await this.queue.add(
      INGEST_JOB_NAME,
      { ...job, ...(requestId !== undefined && { requestId }) },
      {
        // BullMQ ignores an add whose jobId is already queued or running, so
        // the same source + commit/content can only be in flight once.
        jobId: job.ingestKey,
        // Retries happen per embedding request inside the job; a failed job
        // marks the repo failed and is re-queued by re-submitting the source.
        attempts: 1,
        // Removing finished jobs frees the jobId for a later re-queue; the
        // outcome is recorded in Postgres (repos, ingest_jobs).
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
    this.logger.log({
      msg: 'ingest job queued',
      repoId: job.repoId,
      jobId: job.ingestKey,
    });
  }
}
