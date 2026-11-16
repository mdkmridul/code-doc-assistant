import { Logger, OnModuleInit } from '@nestjs/common';
import type {
  ConversationMessage,
  LanguageModel,
  CompleteOptions,
  ModelRequest,
  ModelResponse,
  ModelStopReason,
  ToolDefinition,
} from '@cda/domain';
import Anthropic from '@anthropic-ai/sdk';
import {
  ANTHROPIC_PRICES,
  costOf,
  type TokenCounts,
} from './anthropic-pricing';

type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface AnthropicLanguageModelOptions {
  model: string;
  /** Opus 5.5 defaults to `medium`; set explicitly so a model change can't shift it. */
  effort?: Effort;
  /** Thinking counts toward this, so leave room beyond the visible answer. */
  maxTokens?: number;
}

/** Only what this adapter calls, so tests can pass a fake client. */
export type AnthropicClient = Pick<Anthropic, 'beta' | 'models'>;

const STOP_REASONS: Partial<Record<string, ModelStopReason>> = {
  end_turn: 'end',
  stop_sequence: 'end',
  tool_use: 'tool_use',
  max_tokens: 'max_tokens',
  model_context_window_exceeded: 'max_tokens',
  refusal: 'refusal',
};

/**
 * LanguageModel on Claude via the streaming Messages API (manual tool loop, ADR 0011).
 *
 * - Assistant turns from the current loop are replayed with their original
 *   content blocks (thinking included): Claude Opus 5.5 binds thinking blocks
 *   to the conversation, so they must come back unchanged.
 * - `tool_choice: none` (not removing tools) disables tools for the final
 *   call, keeping the tools array identical across the loop.
 * - Refusals fall back server-side to the model Anthropic recommends for the
 *   refusal category (`fallbacks: "default"`).
 * - The whole prefix is cached (top-level `cache_control`), so each loop
 *   iteration re-reads earlier turns at the cache-read price.
 */
export class AnthropicLanguageModel implements LanguageModel, OnModuleInit {
  readonly modelName: string;
  private readonly effort: Effort;
  private readonly maxTokens: number;
  private readonly logger = new Logger(AnthropicLanguageModel.name);

  constructor(
    private readonly client: AnthropicClient,
    options: AnthropicLanguageModelOptions,
  ) {
    this.modelName = options.model;
    this.effort = options.effort ?? 'medium';
    this.maxTokens = options.maxTokens ?? 16_000;
  }

  /** Fails the boot on a bad key, an unknown model or a model we can't price. */
  async onModuleInit(): Promise<void> {
    if (!ANTHROPIC_PRICES[this.modelName]) {
      throw new Error(
        `No price for ANTHROPIC_MODEL=${this.modelName}; add it to anthropic-pricing.ts`,
      );
    }
    const info = await this.client.models.retrieve(this.modelName);
    this.logger.log(
      `Anthropic ready (${info.id}, effort ${this.effort}, ${info.max_input_tokens ?? '?'} input tokens)`,
    );
  }

  async complete(
    request: ModelRequest,
    { onTextDelta, signal }: CompleteOptions = {},
  ): Promise<ModelResponse> {
    // Streamed so answer text reaches the client as it is generated. Tool
    // inputs are small (queries, paths), so they are not streamed eagerly:
    // the API delivers and validates them whole.
    const stream = this.client.beta.messages.stream(
      {
        model: this.modelName,
        max_tokens: this.maxTokens,
        system: request.system,
        messages: request.messages.map(toMessageParam),
        tools: request.tools.map(toToolParam),
        tool_choice: request.allowToolCalls
          ? { type: 'auto' }
          : { type: 'none' },
        output_config: { effort: this.effort },
        cache_control: { type: 'ephemeral' },
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      },
      // Aborting cancels the HTTP stream; finalMessage() then rejects.
      { signal },
    );
    if (onTextDelta) stream.on('text', (delta) => onTextDelta(delta));
    const response = await stream.finalMessage();

    const toolCalls = response.content
      .filter((block) => block.type === 'tool_use')
      .map((block) => ({ id: block.id, name: block.name, input: block.input }));
    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');

    return {
      model: response.model,
      text,
      toolCalls,
      stopReason: STOP_REASONS[response.stop_reason ?? ''] ?? 'other',
      usage: {
        inputTokens:
          response.usage.input_tokens +
          (response.usage.cache_creation_input_tokens ?? 0) +
          (response.usage.cache_read_input_tokens ?? 0),
        outputTokens: response.usage.output_tokens,
        costUsd: this.priceOf(response),
      },
      providerContent: response.content,
    };
  }

  /**
   * After a fallback, `usage.iterations` splits the call by model (the
   * declining model's part and the rescuing model's part), each priced at its
   * own rates. Without iterations the whole usage belongs to `response.model`.
   */
  private priceOf(response: Anthropic.Beta.BetaMessage): number {
    const entries: { model: string; usage: TokenCounts }[] =
      response.usage.iterations
        ?.filter((entry) => 'input_tokens' in entry && 'output_tokens' in entry)
        .map((entry) => ({
          model:
            ('model' in entry &&
              typeof entry.model === 'string' &&
              entry.model) ||
            response.model,
          usage: entry,
        })) ?? [];
    const parts =
      entries.length > 0
        ? entries
        : [{ model: response.model, usage: response.usage }];

    let total = 0;
    for (const { model, usage } of parts) {
      const cost = costOf(model, usage);
      if (cost === null) {
        this.logger.warn(
          `No price for ${model}; its tokens are recorded at $0`,
        );
      } else {
        total += cost;
      }
    }
    return total;
  }
}

function toToolParam(tool: ToolDefinition): Anthropic.Beta.BetaTool {
  // `$schema` is metadata for validators, not part of the input shape.
  const schema = { ...tool.inputSchema };
  delete schema.$schema;
  return {
    name: tool.name,
    description: tool.description,
    input_schema: { ...schema, type: 'object' },
  };
}

function toMessageParam(
  message: ConversationMessage,
): Anthropic.Beta.BetaMessageParam {
  switch (message.role) {
    case 'user':
      return { role: 'user', content: message.content };
    case 'assistant':
      // Turns from this loop go back exactly as Claude produced them.
      if (message.providerContent !== undefined) {
        return {
          role: 'assistant',
          content:
            message.providerContent as Anthropic.Beta.BetaContentBlockParam[],
        };
      }
      return { role: 'assistant', content: message.text };
    case 'tool_results':
      return {
        role: 'user',
        content: message.results.map((result) => ({
          type: 'tool_result' as const,
          tool_use_id: result.toolCallId,
          content: result.content,
          is_error: result.isError,
        })),
      };
    case 'system_note':
      return { role: 'system', content: message.content };
  }
}
