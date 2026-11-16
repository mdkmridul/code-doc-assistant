import { Injectable } from '@nestjs/common';
import type {
  ApiEndpoint,
  ChunkStore,
  EmbeddedChunk,
  SourceFile,
} from '@cda/domain';
import { PrismaService } from './prisma.service';

/** pgvector's text input format: "[0.1,0.2,...]". */
const toVectorLiteral = (embedding: readonly number[]) =>
  `[${embedding.join(',')}]`;

@Injectable()
export class PrismaChunkStore implements ChunkStore {
  constructor(private readonly prisma: PrismaService) {}

  async saveFile(
    repoId: string,
    file: SourceFile,
    chunks: readonly EmbeddedChunk[],
    endpoints: readonly ApiEndpoint[],
  ): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        // Replacing makes a retried ingest idempotent; chunks and endpoints cascade.
        await tx.file.deleteMany({ where: { repoId, path: file.path } });
        const { id: fileId } = await tx.file.create({
          data: {
            repoId,
            path: file.path,
            language: file.language,
            content: file.content,
          },
          select: { id: true },
        });

        if (endpoints.length > 0) {
          await tx.endpoint.createMany({
            data: endpoints.map((e) => ({ fileId, ...e })),
          });
        }
        if (chunks.length === 0) return;

        // One statement for all chunks. Prisma cannot write the vector
        // column (Unsupported), so the rows are built with unnest + casts.
        await tx.$executeRaw`
          INSERT INTO "chunks"
            ("file_id", "symbol", "kind", "start_line", "end_line",
             "content", "content_hash", "embedding")
          SELECT ${fileId}::uuid, t.symbol, t.kind::"chunk_kind", t.start_line,
                 t.end_line, t.content, t.content_hash, t.embedding::vector
          FROM unnest(
            ${chunks.map((c) => c.symbol)}::text[],
            ${chunks.map((c) => c.kind)}::text[],
            ${chunks.map((c) => c.startLine)}::int[],
            ${chunks.map((c) => c.endLine)}::int[],
            ${chunks.map((c) => c.content)}::text[],
            ${chunks.map((c) => c.contentHash)}::text[],
            ${chunks.map((c) => toVectorLiteral(c.embedding))}::text[]
          ) AS t(symbol, kind, start_line, end_line, content, content_hash, embedding)`;
      },
      { timeout: 30_000 },
    );
  }
}
