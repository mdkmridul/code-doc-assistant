import { Injectable } from '@nestjs/common';
import type { SourceFile, SourceFileReader } from '@cda/domain';
import { PrismaService } from './prisma.service';

/** Reads files from the `files` table: the exact content that was chunked and embedded. */
@Injectable()
export class PrismaSourceFileReader implements SourceFileReader {
  constructor(private readonly prisma: PrismaService) {}

  read(repoId: string, path: string): Promise<SourceFile | null> {
    return this.prisma.file.findUnique({
      where: { repoId_path: { repoId, path } },
      select: { path: true, language: true, content: true },
    });
  }
}
