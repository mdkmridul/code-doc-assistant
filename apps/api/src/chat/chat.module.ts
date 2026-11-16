import { Module } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import {
  AnswerQuestion,
  DEFAULT_MAX_RESULT_TOKENS,
  GetSession,
  ListEndpointsTool,
  LoopPolicy,
  ReadFileTool,
  SearchCodeTool,
  StartSession,
  ToolRegistry,
} from '@cda/domain';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/env.schema';
import { AnthropicLanguageModel } from '../infrastructure/llm/anthropic-language-model';
import { PrismaChatStore } from '../infrastructure/prisma/prisma-chat-store';
import { PrismaEndpointCatalog } from '../infrastructure/prisma/prisma-endpoint-catalog';
import { PrismaLlmCallLog } from '../infrastructure/prisma/prisma-llm-call-log';
import { PrismaModule } from '../infrastructure/prisma/prisma.module';
import { PrismaRepoStore } from '../infrastructure/prisma/prisma-repo-store';
import { RedisModule } from '../infrastructure/redis/redis.module';
import { RedisService } from '../infrastructure/redis/redis.service';
import { RedisUsageGuard } from '../infrastructure/redis/redis-usage-guard';
import { PrismaSourceFileReader } from '../infrastructure/prisma/prisma-source-file-reader';
import { SearchModule } from '../search/search.module';
import { ANSWER_QUESTION_PROMPT } from './chat.constants';
import { loadPrompt, loadPromptVersions } from './prompt-loader';
import { SessionsController } from './sessions.controller';

/** Q&A sessions: the agent loop, the model adapter and their stores. */
@Module({
  imports: [PrismaModule, RedisModule, SearchModule],
  controllers: [SessionsController],
  providers: [
    PrismaChatStore,
    PrismaLlmCallLog,
    PrismaRepoStore,
    PrismaSourceFileReader,
    PrismaEndpointCatalog,
    {
      provide: AnthropicLanguageModel,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        new AnthropicLanguageModel(
          new Anthropic({ apiKey: config.ANTHROPIC_API_KEY }),
          {
            model: config.ANTHROPIC_MODEL,
          },
        ),
    },
    {
      provide: ToolRegistry,
      inject: [SearchCodeTool, PrismaSourceFileReader, PrismaEndpointCatalog],
      useFactory: (
        searchCode: SearchCodeTool,
        files: PrismaSourceFileReader,
        endpoints: PrismaEndpointCatalog,
      ) =>
        new ToolRegistry([
          searchCode,
          new ReadFileTool(files),
          new ListEndpointsTool(endpoints),
        ]),
    },
    {
      provide: GetSession,
      inject: [PrismaChatStore],
      useFactory: (chats: PrismaChatStore) => new GetSession(chats),
    },
    {
      provide: StartSession,
      inject: [PrismaRepoStore, PrismaChatStore],
      useFactory: (repos: PrismaRepoStore, chats: PrismaChatStore) =>
        new StartSession(repos, chats),
    },
    {
      provide: AnswerQuestion,
      inject: [
        APP_CONFIG,
        PrismaChatStore,
        AnthropicLanguageModel,
        ToolRegistry,
        PrismaLlmCallLog,
        RedisService,
      ],
      useFactory: (
        config: AppConfig,
        chats: PrismaChatStore,
        model: AnthropicLanguageModel,
        tools: ToolRegistry,
        llmCalls: PrismaLlmCallLog,
        redis: RedisService,
      ) =>
        new AnswerQuestion({
          chats,
          model,
          tools,
          llmCalls,
          usage: new RedisUsageGuard(redis.client, {
            questionsPerMinute: config.SESSION_QUESTIONS_PER_MINUTE,
            dailySpendCapUsd: config.DAILY_SPEND_CAP_USD,
          }),
          prompt: loadPrompt(
            ANSWER_QUESTION_PROMPT.name,
            ANSWER_QUESTION_PROMPT.version,
          ),
          // Older versions stay loadable per question (promptVersion), for evals.
          otherPrompts: loadPromptVersions(ANSWER_QUESTION_PROMPT.name).filter(
            (p) => p.version !== ANSWER_QUESTION_PROMPT.version,
          ),
          policy: new LoopPolicy({
            maxIterations: config.CHAT_MAX_ITERATIONS,
            tokenBudget: config.CHAT_TOKEN_BUDGET,
          }),
          contextBudget: {
            maxTokens: config.CHAT_CONTEXT_BUDGET,
            maxResultTokens: DEFAULT_MAX_RESULT_TOKENS,
          },
        }),
    },
  ],
})
export class ChatModule {}
