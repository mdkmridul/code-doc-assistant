import type Anthropic from '@anthropic-ai/sdk';
import type { ModelRequest } from '@cda/domain';
import {
  AnthropicLanguageModel,
  type AnthropicClient,
} from './anthropic-language-model';

type CreateParams = Anthropic.Beta.MessageCreateParamsNonStreaming;

const message = (
  overrides: Partial<Anthropic.Beta.BetaMessage>,
): Anthropic.Beta.BetaMessage =>
  ({
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content: [],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: 1_000,
      output_tokens: 100,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      iterations: null,
    },
    ...overrides,
  }) as unknown as Anthropic.Beta.BetaMessage;

function fakeClient(reply: Anthropic.Beta.BetaMessage) {
  const create = jest.fn((params: CreateParams) => {
    void params;
    return Promise.resolve(reply);
  });
  const retrieve = jest.fn((id: string) =>
    Promise.resolve({ id, max_input_tokens: 1_000_000 }),
  );
  const client = {
    beta: { messages: { create } },
    models: { retrieve },
  } as unknown as AnthropicClient;
  return { client, create, retrieve };
}

const request: ModelRequest = {
  system: 'You document ky.',
  tools: [
    {
      name: 'search_code',
      description: 'Search.',
      inputSchema: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
        additionalProperties: false,
      },
    },
  ],
  allowToolCalls: true,
  messages: [
    { role: 'user', content: 'Earlier question?' },
    { role: 'assistant', text: 'Earlier answer.', toolCalls: [] },
    { role: 'user', content: 'How are retries done?' },
    {
      role: 'assistant',
      text: '',
      toolCalls: [
        { id: 'tu_1', name: 'search_code', input: { query: 'retry' } },
      ],
      providerContent: [
        { type: 'thinking', thinking: '', signature: 'sig' },
        {
          type: 'tool_use',
          id: 'tu_1',
          name: 'search_code',
          input: { query: 'retry' },
        },
      ],
    },
    {
      role: 'tool_results',
      results: [
        { toolCallId: 'tu_1', content: '{"results":[]}', isError: false },
      ],
    },
    { role: 'system_note', content: 'Answer now.' },
  ],
};

describe('AnthropicLanguageModel', () => {
  it('sends the conversation in Messages API form', async () => {
    const { client, create } = fakeClient(message({}));

    await new AnthropicLanguageModel(client, {
      model: 'claude-opus-5-5',
    }).complete(request);

    const params = create.mock.calls[0][0];
    expect(params).toMatchObject({
      model: 'claude-opus-5-5',
      system: 'You document ky.',
      tool_choice: { type: 'auto' },
      output_config: { effort: 'medium' },
      cache_control: { type: 'ephemeral' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
    expect(params.tools).toEqual([
      {
        name: 'search_code',
        description: 'Search.',
        input_schema: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
          additionalProperties: false,
        },
      },
    ]);
    expect(params.messages).toEqual([
      { role: 'user', content: 'Earlier question?' },
      { role: 'assistant', content: 'Earlier answer.' },
      { role: 'user', content: 'How are retries done?' },
      // Replayed verbatim: the thinking block must not be altered.
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '', signature: 'sig' },
          {
            type: 'tool_use',
            id: 'tu_1',
            name: 'search_code',
            input: { query: 'retry' },
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu_1',
            content: '{"results":[]}',
            is_error: false,
          },
        ],
      },
      { role: 'system', content: 'Answer now.' },
    ]);
  });

  it('disables tool calls with tool_choice none, keeping the tools declared', async () => {
    const { client, create } = fakeClient(message({}));

    await new AnthropicLanguageModel(client, {
      model: 'claude-opus-5-5',
    }).complete({
      ...request,
      allowToolCalls: false,
    });

    const params = create.mock.calls[0][0];
    expect(params.tool_choice).toEqual({ type: 'none' });
    expect(params.tools).toHaveLength(1);
  });

  it('parses text, tool calls and the stop reason, keeping raw content for replay', async () => {
    const content = [
      { type: 'thinking', thinking: '', signature: 's' },
      { type: 'text', text: 'Let me look. ' },
      {
        type: 'tool_use',
        id: 'tu_9',
        name: 'search_code',
        input: { query: 'x' },
      },
    ] as unknown as Anthropic.Beta.BetaContentBlock[];
    const { client } = fakeClient(
      message({ content, stop_reason: 'tool_use' }),
    );

    const response = await new AnthropicLanguageModel(client, {
      model: 'claude-opus-5-5',
    }).complete(request);

    expect(response).toMatchObject({
      model: 'claude-opus-5-5',
      text: 'Let me look. ',
      toolCalls: [{ id: 'tu_9', name: 'search_code', input: { query: 'x' } }],
      stopReason: 'tool_use',
    });
    expect(response.providerContent).toBe(content);
  });

  it.each([
    ['end_turn', 'end'],
    ['max_tokens', 'max_tokens'],
    ['model_context_window_exceeded', 'max_tokens'],
    ['refusal', 'refusal'],
    ['pause_turn', 'other'],
  ] as const)('maps stop reason %s to %s', async (stop, expected) => {
    const { client } = fakeClient(message({ stop_reason: stop }));
    const response = await new AnthropicLanguageModel(client, {
      model: 'claude-opus-5-5',
    }).complete(request);
    expect(response.stopReason).toBe(expected);
  });

  it('counts cache reads and writes as input and prices each at its own rate', async () => {
    const { client } = fakeClient(
      message({
        usage: {
          input_tokens: 1_000,
          cache_creation_input_tokens: 2_000,
          cache_read_input_tokens: 10_000,
          output_tokens: 500,
          iterations: null,
        } as unknown as Anthropic.Beta.BetaUsage,
      }),
    );

    const { usage } = await new AnthropicLanguageModel(client, {
      model: 'claude-opus-5-5',
    }).complete(request);

    expect(usage.inputTokens).toBe(13_000);
    expect(usage.outputTokens).toBe(500);
    // $4 in, $5 cache write, $0.20 cache read, $20 out (per MTok)
    expect(usage.costUsd).toBeCloseTo(
      (1_000 * 4 + 2_000 * 5 + 10_000 * 0.2 + 500 * 20) / 1e6,
      10,
    );
  });

  it('prices a fallback turn per model from usage.iterations', async () => {
    const { client } = fakeClient(
      message({
        model: 'claude-opus-5',
        usage: {
          input_tokens: 3_000,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          output_tokens: 300,
          iterations: [
            {
              type: 'message',
              model: 'claude-opus-5-5',
              input_tokens: 1_000,
              output_tokens: 100,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
            },
            {
              type: 'fallback_message',
              model: 'claude-opus-5',
              input_tokens: 2_000,
              output_tokens: 200,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
            },
          ],
        } as unknown as Anthropic.Beta.BetaUsage,
      }),
    );

    const response = await new AnthropicLanguageModel(client, {
      model: 'claude-opus-5-5',
    }).complete(request);

    expect(response.model).toBe('claude-opus-5');
    expect(response.usage.costUsd).toBeCloseTo(
      (1_000 * 4 + 100 * 20) / 1e6 + (2_000 * 5 + 200 * 25) / 1e6,
      10,
    );
  });

  describe('onModuleInit', () => {
    it('checks the model exists with the configured key', async () => {
      const { client, retrieve } = fakeClient(message({}));
      await new AnthropicLanguageModel(client, {
        model: 'claude-opus-5-5',
      }).onModuleInit();
      expect(retrieve).toHaveBeenCalledWith('claude-opus-5-5');
    });

    it('fails fast for a model without a price', async () => {
      const { client, retrieve } = fakeClient(message({}));
      await expect(
        new AnthropicLanguageModel(client, {
          model: 'claude-mystery-9',
        }).onModuleInit(),
      ).rejects.toThrow(/No price for ANTHROPIC_MODEL=claude-mystery-9/);
      expect(retrieve).not.toHaveBeenCalled();
    });
  });
});
