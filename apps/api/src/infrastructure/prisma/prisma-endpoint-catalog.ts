import { Injectable } from '@nestjs/common';
import type {
  EndpointCatalog,
  EndpointFramework,
  EndpointQuery,
  HttpMethod,
  StoredEndpoint,
} from '@cda/domain';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from './prisma.service';

/** Reads the `endpoints` table recorded at ingest (rows belong to `files`). */
@Injectable()
export class PrismaEndpointCatalog implements EndpointCatalog {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    query: EndpointQuery,
  ): Promise<{ endpoints: StoredEndpoint[]; total: number }> {
    const where: Prisma.EndpointWhereInput = {
      file: {
        repoId: query.repoId,
        ...(query.filePrefix !== undefined && {
          path: { startsWith: query.filePrefix },
        }),
      },
      ...(query.method !== undefined && { method: query.method }),
      ...(query.pathContains !== undefined && {
        path: { contains: query.pathContains, mode: 'insensitive' },
      }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.endpoint.findMany({
        where,
        orderBy: [
          { file: { path: 'asc' } },
          { line: 'asc' },
          { method: 'asc' },
        ],
        skip: query.offset,
        take: query.limit,
        include: { file: { select: { path: true } } },
      }),
      this.prisma.endpoint.count({ where }),
    ]);
    return {
      total,
      endpoints: rows.map((row) => ({
        // Written only from ApiEndpoint values, so the strings are these unions.
        method: row.method as HttpMethod,
        path: row.path,
        framework: row.framework as EndpointFramework,
        line: row.line,
        handler: row.handler,
        declaration: row.declaration,
        filePath: row.file.path,
      })),
    };
  }
}
