/**
 * Dev seed: one local repo, one file and two chunks with dummy embeddings.
 * Safe to re-run: it deletes the previous seed repo first (cascades to files/chunks).
 * Run with `npm run db:seed -w api`.
 */
import { createHash } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { loadConfig } from '../src/config/load-config';

/** Must match vector(1024) in the chunk_search_columns migration. */
const EMBEDDING_DIMENSIONS = 1024;
const SEED_REPO_PATH = '/seed/example-repo';

const FILE_CONTENT = `export class UserService {
  getUserById(id: string) {
    return this.users.find((user) => user.id === id);
  }
}
`;

/** A deterministic, non-zero unit vector (cosine distance needs non-zero input). */
function dummyEmbedding(hotIndex: number): string {
  const values = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) =>
    i === hotIndex ? 1 : 0,
  );
  return `[${values.join(',')}]`;
}

const sha256 = (text: string) =>
  createHash('sha256').update(text).digest('hex');

async function main(): Promise<void> {
  const config = loadConfig();
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: config.DATABASE_URL }),
  });

  try {
    await prisma.repo.deleteMany({ where: { localPath: SEED_REPO_PATH } });

    const repo = await prisma.repo.create({
      data: {
        sourceType: 'local',
        localPath: SEED_REPO_PATH,
        status: 'ready',
        files: {
          create: {
            path: 'src/user.service.ts',
            language: 'typescript',
            content: FILE_CONTENT,
          },
        },
      },
      include: { files: true },
    });
    const file = repo.files[0];

    const classContent = FILE_CONTENT;
    const methodContent = FILE_CONTENT.split('\n').slice(1, 4).join('\n');
    const chunks = await prisma.chunk.createManyAndReturn({
      data: [
        {
          fileId: file.id,
          symbol: 'UserService',
          kind: 'class',
          startLine: 1,
          endLine: 5,
          content: classContent,
          contentHash: sha256(classContent),
        },
        {
          fileId: file.id,
          symbol: 'getUserById',
          kind: 'method',
          startLine: 2,
          endLine: 4,
          content: methodContent,
          contentHash: sha256(methodContent),
        },
      ],
    });

    // Prisma cannot write Unsupported("vector") columns, so use raw SQL.
    for (const [index, chunk] of chunks.entries()) {
      await prisma.$executeRaw`
        UPDATE "chunks" SET "embedding" = ${dummyEmbedding(index)}::vector
        WHERE "id" = ${chunk.id}::uuid`;
    }

    console.log(
      `Seeded repo ${repo.id}: 1 file (${file.path}), ${chunks.length} chunks ` +
        `(${chunks.map((c) => c.symbol).join(', ')}) with ${EMBEDDING_DIMENSIONS}-d embeddings.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
