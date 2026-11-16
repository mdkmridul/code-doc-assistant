import { Module } from '@nestjs/common';
import { SearchCodeTool, SearchRepository, type Embedder } from '@cda/domain';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/env.schema';
import { OllamaEmbedder } from '../infrastructure/embedding/ollama-embedder';
import { PgvectorRetriever } from '../infrastructure/prisma/pgvector-retriever';
import { PrismaModule } from '../infrastructure/prisma/prisma.module';
import { PrismaRepoStore } from '../infrastructure/prisma/prisma-repo-store';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { SearchController } from './search.controller';
import { QUERY_EMBEDDER } from './search.constants';

/** Code search: the `search_code` tool, what it needs, and POST /repos/:id/search. */
@Module({
  imports: [PrismaModule],
  controllers: [SearchController],
  providers: [
    PrismaRepoStore,
    {
      provide: QUERY_EMBEDDER,
      inject: [APP_CONFIG],
      useFactory: (appConfig: AppConfig) =>
        new OllamaEmbedder({
          baseUrl: appConfig.OLLAMA_URL,
          inputType: 'query',
        }),
    },
    {
      provide: PgvectorRetriever,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new PgvectorRetriever(prisma),
    },
    {
      provide: SearchCodeTool,
      inject: [QUERY_EMBEDDER, PgvectorRetriever],
      useFactory: (embedder: Embedder, retriever: PgvectorRetriever) =>
        new SearchCodeTool(embedder, retriever),
    },
    {
      provide: SearchRepository,
      inject: [PrismaRepoStore, SearchCodeTool],
      useFactory: (repos: PrismaRepoStore, searchCode: SearchCodeTool) =>
        new SearchRepository(repos, searchCode),
    },
  ],
  exports: [SearchCodeTool],
})
export class SearchModule {}
