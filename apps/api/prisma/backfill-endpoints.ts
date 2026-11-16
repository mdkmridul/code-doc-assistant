/**
 * Records HTTP endpoints for repositories ingested before the endpoint scan
 * existed (or after the extractor changed), from the file contents already in
 * the `files` table: no clone and no re-embedding. Idempotent: each file's
 * endpoints are replaced. Run with `npm run db:backfill-endpoints -w api`.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { extractEndpoints } from '@cda/domain';
import { PrismaClient } from '../src/generated/prisma/client';
import { loadConfig } from '../src/config/load-config';

const BATCH = 200;

async function main(): Promise<void> {
  const config = loadConfig();
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: config.DATABASE_URL }),
  });

  try {
    const repos = await prisma.repo.findMany({
      where: { status: 'ready' },
      select: { id: true, url: true, localPath: true },
    });
    for (const repo of repos) {
      let cursor: string | undefined;
      let files = 0;
      let endpoints = 0;
      for (;;) {
        const batch = await prisma.file.findMany({
          where: { repoId: repo.id },
          orderBy: { id: 'asc' },
          take: BATCH,
          ...(cursor !== undefined && { skip: 1, cursor: { id: cursor } }),
          select: { id: true, path: true, language: true, content: true },
        });
        if (batch.length === 0) break;
        cursor = batch[batch.length - 1].id;

        const rows = batch.flatMap((file) =>
          extractEndpoints(file).map((e) => ({ fileId: file.id, ...e })),
        );
        await prisma.$transaction([
          prisma.endpoint.deleteMany({
            where: { fileId: { in: batch.map((f) => f.id) } },
          }),
          prisma.endpoint.createMany({ data: rows }),
        ]);
        files += batch.length;
        endpoints += rows.length;
      }
      console.log(
        `${repo.url ?? repo.localPath ?? repo.id}: ${String(endpoints)} endpoints in ${String(files)} files`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
