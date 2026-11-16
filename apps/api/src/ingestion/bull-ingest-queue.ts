import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { IngestJob, IngestQueue } from '@cda/domain';
import { Queue } from 'bullmq';
import { INGEST_JOB_NAME, INGEST_QUEUE } from './ingestion.constants';

@Injectable()
export class BullIngestQueue implements IngestQueue {
  constructor(
    @InjectQueue(INGEST_QUEUE) private readonly queue: Queue<IngestJob>,
  ) {}

  async enqueue(job: IngestJob): Promise<void> {
    await this.queue.add(INGEST_JOB_NAME, job, {
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
    });
  }
}
