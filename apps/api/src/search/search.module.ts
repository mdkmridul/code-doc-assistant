import { Module } from '@nestjs/common';
import { SearchCodeTool, type Embedder } from '@cda/domain';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/env.schema';
import { OllamaEmbedder } from '../infrastructure/embedding/ollama-embedder';
import { PgvectorRetriever } from '../infrastructure/prisma/pgvector-retriever';
import { PrismaModule } from '../infrastructure/prisma/prisma.module';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { QUERY_EMBEDDER } from './search.constants';

/** Semantic code search: the `search_code` tool and what it needs. */
@Module({
  imports: [PrismaModule],
  providers: [
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
  ],
  exports: [SearchCodeTool],
})
export class SearchModule {}
