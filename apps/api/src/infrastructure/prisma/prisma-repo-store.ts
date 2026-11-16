import { Injectable } from '@nestjs/common';
import {
  DuplicateIngestKeyError,
  type RepoRecord,
  type RepoSource,
  type RepoStore,
  type RepoView,
} from '@cda/domain';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from './prisma.service';

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2002';

@Injectable()
export class PrismaRepoStore implements RepoStore {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<RepoView | null> {
    const repo = await this.prisma.repo.findUnique({
      where: { id },
      include: { _count: { select: { files: true } } },
    });
    if (!repo) return null;
    const chunkCount = await this.prisma.chunk.count({
      where: { file: { repoId: id } },
    });

    return {
      id: repo.id,
      status: repo.status,
      source:
        repo.sourceType === 'git'
          ? { type: 'git', url: repo.url ?? '' }
          : { type: 'local', fileName: repo.localPath ?? '' },
      commitSha: repo.commitSha,
      contentHash: repo.contentHash,
      error: repo.error,
      fileCount: repo._count.files,
      chunkCount,
      createdAt: repo.createdAt,
      updatedAt: repo.updatedAt,
    };
  }

  findByIngestKey(ingestKey: string): Promise<RepoRecord | null> {
    return this.prisma.repo.findUnique({
      where: { ingestKey },
      select: { id: true, status: true },
    });
  }

  async create(ingestKey: string, source: RepoSource): Promise<RepoRecord> {
    const data =
      source.type === 'git'
        ? {
            sourceType: 'git' as const,
            url: source.url,
            commitSha: source.commitSha,
          }
        : {
            sourceType: 'local' as const,
            localPath: source.fileName,
            contentHash: source.contentHash,
          };
    try {
      return await this.prisma.repo.create({
        data: { ...data, ingestKey, status: 'queued' },
        select: { id: true, status: true },
      });
    } catch (error) {
      if (isUniqueViolation(error))
        throw new DuplicateIngestKeyError(ingestKey);
      throw error;
    }
  }

  async startAttempt(repoId: string): Promise<string> {
    const [, attempt] = await this.prisma.$transaction([
      this.prisma.repo.update({
        where: { id: repoId },
        data: { status: 'queued', error: null },
      }),
      this.prisma.ingestJob.create({
        data: { repoId, status: 'queued' },
        select: { id: true },
      }),
    ]);
    return attempt.id;
  }

  async markRunning(repoId: string, attemptId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.repo.update({
        where: { id: repoId },
        data: { status: 'running', error: null },
      }),
      this.prisma.ingestJob.update({
        where: { id: attemptId },
        data: { status: 'running', startedAt: new Date() },
      }),
    ]);
  }

  async markReady(
    repoId: string,
    attemptId: string,
    commitSha: string | null,
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.repo.update({
        where: { id: repoId },
        data: { status: 'ready', error: null, ...(commitSha && { commitSha }) },
      }),
      this.prisma.ingestJob.update({
        where: { id: attemptId },
        data: { status: 'succeeded', finishedAt: new Date() },
      }),
    ]);
  }

  async markFailed(
    repoId: string,
    attemptId: string,
    error: string,
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.repo.update({
        where: { id: repoId },
        data: { status: 'failed', error },
      }),
      this.prisma.ingestJob.update({
        where: { id: attemptId },
        data: { status: 'failed', error, finishedAt: new Date() },
      }),
    ]);
  }
}
