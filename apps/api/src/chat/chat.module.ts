import { DynamicModule, Module } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import {
  AnswerQuestion,
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
import { PrismaLlmCallLog } from '../infrastructure/prisma/prisma-llm-call-log';
import { PrismaModule } from '../infrastructure/prisma/prisma.module';
import { PrismaRepoStore } from '../infrastructure/prisma/prisma-repo-store';
import { PrismaSourceFileReader } from '../infrastructure/prisma/prisma-source-file-reader';
import { SearchModule } from '../search/search.module';
import { ANSWER_QUESTION_PROMPT } from './chat.constants';
import { loadPrompt } from './prompt-loader';
import { SessionsController } from './sessions.controller';

/** Q&A sessions: the agent loop, the model adapter and their stores. */
@Module({})
export class ChatModule {
  static forRoot(appConfig: AppConfig): DynamicModule {
    return {
      module: ChatModule,
      imports: [PrismaModule, SearchModule.forRoot(appConfig)],
      controllers: [SessionsController],
      providers: [
        PrismaChatStore,
        PrismaLlmCallLog,
        PrismaRepoStore,
        PrismaSourceFileReader,
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
          inject: [SearchCodeTool, PrismaSourceFileReader],
          useFactory: (
            searchCode: SearchCodeTool,
            files: PrismaSourceFileReader,
          ) => new ToolRegistry([searchCode, new ReadFileTool(files)]),
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
          ],
          useFactory: (
            config: AppConfig,
            chats: PrismaChatStore,
            model: AnthropicLanguageModel,
            tools: ToolRegistry,
            llmCalls: PrismaLlmCallLog,
          ) =>
            new AnswerQuestion({
              chats,
              model,
              tools,
              llmCalls,
              prompt: loadPrompt(
                ANSWER_QUESTION_PROMPT.name,
                ANSWER_QUESTION_PROMPT.version,
              ),
              policy: new LoopPolicy({
                maxIterations: config.CHAT_MAX_ITERATIONS,
                tokenBudget: config.CHAT_TOKEN_BUDGET,
              }),
            }),
        },
      ],
    };
  }
}
