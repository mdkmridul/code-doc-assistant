import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import {
  GetRepo,
  IngestFiles,
  IngestRepo,
  LineWindowChunker,
  RegisterRepo,
} from '@cda/domain';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/env.schema';
import { OllamaEmbedder } from '../infrastructure/embedding/ollama-embedder';
import { PrismaChunkStore } from '../infrastructure/prisma/prisma-chunk-store';
import { PrismaModule } from '../infrastructure/prisma/prisma.module';
import { PrismaRepoStore } from '../infrastructure/prisma/prisma-repo-store';
import { TempWorkspaceFactory } from '../infrastructure/workspace/temp-workspace-factory';
import { BullIngestQueue } from './bull-ingest-queue';
import { IngestProcessor } from './ingest.processor';
import { INGEST_QUEUE } from './ingestion.constants';
import { RepoSourceResolver } from './repo-source-resolver';
import { ReposController } from './repos.controller';

/**
 * Wires the domain use cases to their adapters. The domain classes carry no
 * Nest decorators, so each is built by a factory provider.
 */
@Module({
  imports: [PrismaModule, BullModule.registerQueue({ name: INGEST_QUEUE })],
  controllers: [ReposController],
  providers: [
    PrismaRepoStore,
    PrismaChunkStore,
    BullIngestQueue,
    TempWorkspaceFactory,
    RepoSourceResolver,
    IngestProcessor,
    {
      provide: OllamaEmbedder,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        new OllamaEmbedder({ baseUrl: config.OLLAMA_URL }),
    },
    {
      provide: RegisterRepo,
      inject: [PrismaRepoStore, BullIngestQueue],
      useFactory: (repos: PrismaRepoStore, queue: BullIngestQueue) =>
        new RegisterRepo(repos, queue),
    },
    {
      provide: GetRepo,
      inject: [PrismaRepoStore],
      useFactory: (repos: PrismaRepoStore) => new GetRepo(repos),
    },
    {
      provide: IngestFiles,
      inject: [OllamaEmbedder, PrismaChunkStore],
      useFactory: (embedder: OllamaEmbedder, store: PrismaChunkStore) =>
        new IngestFiles({ chunker: new LineWindowChunker(), embedder, store }),
    },
    {
      provide: IngestRepo,
      inject: [PrismaRepoStore, TempWorkspaceFactory, IngestFiles],
      useFactory: (
        repos: PrismaRepoStore,
        workspaces: TempWorkspaceFactory,
        ingestFiles: IngestFiles,
      ) => new IngestRepo(repos, workspaces, ingestFiles),
    },
  ],
})
export class IngestionModule {}
