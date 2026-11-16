import { describe, expect, it } from 'vitest';
import { ToolRegistry } from '../tools/tool-registry';
import {
  ANSWER_QUESTION_PURPOSE,
  AnswerQuestion,
  CONTEXT_BUDGET_NOTE,
  ITERATION_CAP_NOTE,
} from './answer-question';
import { SessionNotFoundError } from './errors';
import {
  call,
  FakeChatStore,
  FakeLanguageModel,
  FakeLlmCallLog,
  LookupTool,
  SteppingClock,
} from './fakes.test-helpers';
import type { ContextBudgetLimits } from './context-budget';
import { LoopPolicy, type LoopLimits } from './loop-policy';
import { SystemPrompt } from './system-prompt';
import type { ModelResponse } from '../ports/language-model';

const setup = async (
  script: (Partial<ModelResponse> | Error)[],
  limits: LoopLimits = { maxIterations: 5, tokenBudget: 100_000 },
  contextBudget: ContextBudgetLimits = { maxTokens: 100_000, maxResultTokens: 8_000 },
) => {
  const chats = new FakeChatStore();
  const { id: sessionId } = await chats.createSession('repo-1');
  const model = new FakeLanguageModel(script);
  const lookup = new LookupTool();
  const llmCalls = new FakeLlmCallLog();
  const useCase = new AnswerQuestion({
    chats,
    model,
    tools: new ToolRegistry([lookup]),
    llmCalls,
    prompt: new SystemPrompt('answer-question', 'v7', 'You document {{repository}}.'),
    policy: new LoopPolicy(limits),
    contextBudget,
    clock: new SteppingClock(),
  });
  const ask = (question: string) => useCase.execute({ sessionId, question });
  return { chats, sessionId, model, lookup, llmCalls, ask };
};

describe('AnswerQuestion', () => {
  it('answers directly when the model asks for no tools', async () => {
    const { ask, model } = await setup([{ text: 'It is a library.' }]);

    const result = await ask('What is this?');

    expect(result).toMatchObject({
      answer: 'It is a library.',
      outcome: 'completed',
      iterations: 1,
      toolCalls: [],
      citations: [],
      usage: { inputTokens: 100, outputTokens: 10, costUsd: 0.001 },
    });
    expect(model.requests[0]).toMatchObject({
      system: 'You document label-of-repo-1.',
      messages: [{ role: 'user', content: 'What is this?' }],
      allowToolCalls: true,
    });
    expect(model.requests[0].tools.map((t) => t.name)).toEqual(['lookup']);
  });

  it('runs scripted tool calls, feeds results back and loops until the model answers', async () => {
    const { ask, model, lookup } = await setup([
      { toolCalls: [call('t1', 'lookup', { key: 'retry' })] },
      { toolCalls: [call('t2', 'lookup', { key: 'timeout' })] },
      { text: 'Retries live in src/retry.ts.' },
    ]);

    const result = await ask('How are retries done?');

    expect(result.outcome).toBe('completed');
    expect(result.iterations).toBe(3);
    expect(lookup.calls).toEqual([
      { key: 'retry', repoId: 'repo-1' },
      { key: 'timeout', repoId: 'repo-1' },
    ]);
    // The third request carries the whole loop so far, provider content verbatim.
    expect(model.requests[2].messages).toEqual([
      { role: 'user', content: 'How are retries done?' },
      {
        role: 'assistant',
        text: '',
        toolCalls: [call('t1', 'lookup', { key: 'retry' })],
        providerContent: { raw: 'turn-1' },
      },
      {
        role: 'tool_results',
        results: [
          {
            toolCallId: 't1',
            content: JSON.stringify({ value: 'value-of-retry', path: 'src/retry.ts' }),
            isError: false,
          },
        ],
      },
      {
        role: 'assistant',
        text: '',
        toolCalls: [call('t2', 'lookup', { key: 'timeout' })],
        providerContent: { raw: 'turn-2' },
      },
      {
        role: 'tool_results',
        results: [
          {
            toolCallId: 't2',
            content: JSON.stringify({ value: 'value-of-timeout', path: 'src/timeout.ts' }),
            isError: false,
          },
        ],
      },
    ]);
  });

  it('keeps the system prompt and tools identical on every call of the loop', async () => {
    const { ask, model } = await setup([
      { toolCalls: [call('t1', 'lookup', { key: 'a' })] },
      { text: 'done' },
    ]);

    await ask('q');

    expect(model.requests[1].system).toBe(model.requests[0].system);
    expect(model.requests[1].tools).toEqual(model.requests[0].tools);
  });

  it('runs parallel tool calls and returns all results in one message, in call order', async () => {
    const { ask, model } = await setup([
      {
        toolCalls: [call('a', 'lookup', { key: 'one' }), call('b', 'lookup', { key: 'two' })],
      },
      { text: 'ok' },
    ]);

    await ask('q');

    const last = model.requests[1].messages.at(-1);
    expect(last).toMatchObject({
      role: 'tool_results',
      results: [{ toolCallId: 'a' }, { toolCallId: 'b' }],
    });
  });

  it('turns invalid input, unknown tools and tool crashes into error results the model can read', async () => {
    const { ask, model } = await setup([
      {
        toolCalls: [
          call('bad', 'lookup', { key: '' }),
          call('ghost', 'delete_repo', {}),
          call('boom', 'lookup', { key: 'explode' }),
        ],
      },
      { text: 'Sorry, the lookups failed.' },
    ]);

    const result = await ask('q');

    const results = model.requests[1].messages.at(-1);
    expect(results).toMatchObject({
      role: 'tool_results',
      results: [
        { toolCallId: 'bad', isError: true, content: expect.stringMatching(/Invalid input for lookup: key/) as string },
        { toolCallId: 'ghost', isError: true, content: expect.stringMatching(/Unknown tool "delete_repo"/) as string },
        { toolCallId: 'boom', isError: true, content: 'lookup failed: backend down' },
      ],
    });
    expect(result.toolCalls.map((t) => [t.name, t.isError])).toEqual([
      ['lookup', true],
      ['delete_repo', true],
      ['lookup', true],
    ]);
    expect(result.outcome).toBe('completed');
  });

  it('stops at the iteration cap with a final tool-less call that still answers', async () => {
    const { ask, model } = await setup(
      [
        { toolCalls: [call('t1', 'lookup', { key: 'a' })] },
        { toolCalls: [call('t2', 'lookup', { key: 'b' })] },
        { text: 'Best effort: see src/a.ts.' },
      ],
      { maxIterations: 3, tokenBudget: 100_000 },
    );

    const result = await ask('Tell me everything.');

    expect(result).toMatchObject({
      outcome: 'iteration_cap',
      iterations: 3,
      answer: 'Best effort: see src/a.ts.',
    });
    expect(model.requests.map((r) => r.allowToolCalls)).toEqual([true, true, false]);
    expect(model.requests[2].messages.at(-1)).toEqual({
      role: 'system_note',
      content: ITERATION_CAP_NOTE,
    });
  });

  it('never makes more than maxIterations calls, even if the model keeps asking for tools', async () => {
    const { ask, model } = await setup(
      Array.from({ length: 10 }, (_, i) => ({ toolCalls: [call(`t${String(i)}`, 'lookup', { key: 'x' })] })),
      { maxIterations: 2, tokenBudget: 100_000 },
    );

    const result = await ask('q');

    expect(model.requests).toHaveLength(2);
    expect(result.outcome).toBe('iteration_cap');
  });

  it('stops when the token budget is spent', async () => {
    const { ask, model } = await setup(
      [
        { toolCalls: [call('t1', 'lookup', { key: 'a' })], usage: { inputTokens: 900, outputTokens: 200, costUsd: 0.01 } },
        { text: 'never reached' },
      ],
      { maxIterations: 10, tokenBudget: 1_000 },
    );

    const result = await ask('q');

    expect(model.requests).toHaveLength(1);
    expect(result.outcome).toBe('token_budget');
    expect(result.answer).toMatch(/ran out of my budget/);
  });

  describe('context budget', () => {
    const budget = { maxTokens: 5_000, maxResultTokens: 3_000 };

    it('counts the tokens every tool result adds and reports the spend', async () => {
      const { ask } = await setup(
        [{ toolCalls: [call('t1', 'lookup', { key: 'big-1000' })] }, { text: 'Done.' }],
        undefined,
        budget,
      );

      const result = await ask('q');

      expect(result.outcome).toBe('completed');
      // 1000 tokens of value plus the JSON around it.
      expect(result.toolCalls[0].tokens).toBeGreaterThan(1000);
      expect(result.toolCalls[0].tokens).toBeLessThan(1050);
      expect(result.usage.contextTokens).toBe(result.toolCalls[0].tokens);
    });

    it('truncates a result over the per-result cap before the model sees it', async () => {
      const { ask, model } = await setup(
        [{ toolCalls: [call('t1', 'lookup', { key: 'big-4000' })] }, { text: 'Done.' }],
        undefined,
        budget,
      );

      const result = await ask('q');

      const sent = model.requests[1].messages.at(-1);
      expect(sent).toMatchObject({ role: 'tool_results', results: [{ isError: false }] });
      const content = sent?.role === 'tool_results' ? sent.results[0].content : '';
      expect(content).toMatch(/\[Truncated: showing about \d+ of \d+ tokens/);
      expect(content.length).toBeLessThanOrEqual(3_000 * 3);
      expect(result.toolCalls[0].summary).toMatch(/truncated to ~3\.0k tokens/);
      expect(result.outcome).toBe('completed');
    });

    it('refuses a result that would exceed the budget, then makes the model answer without tools', async () => {
      const { ask, model } = await setup(
        [
          { toolCalls: [call('t1', 'lookup', { key: 'big-2500' })] },
          { toolCalls: [call('t2', 'lookup', { key: 'big-2900' })] },
          { text: 'What I found: see src/big-2500.ts:1-10.' },
          { text: 'never reached' },
        ],
        { maxIterations: 8, tokenBudget: 1_000_000 },
        budget,
      );

      const result = await ask('Tell me everything.');

      expect(result).toMatchObject({
        outcome: 'context_budget',
        iterations: 3,
        answer: 'What I found: see src/big-2500.ts:1-10.',
      });
      // The refused result is replaced by a note; nothing of it reaches the model.
      const refused = model.requests[2].messages.at(-2);
      expect(refused).toMatchObject({
        role: 'tool_results',
        results: [{ toolCallId: 't2', isError: true }],
      });
      const refusal = refused?.role === 'tool_results' ? refused.results[0].content : '';
      expect(refusal).toMatch(/^Not added: .* Do not call more tools/);
      expect(refusal).not.toContain('vvvv');
      // The final call has tools disabled and says why.
      expect(model.requests.map((r) => r.allowToolCalls)).toEqual([true, true, false]);
      expect(model.requests[2].messages.at(-1)).toEqual({
        role: 'system_note',
        content: CONTEXT_BUDGET_NOTE,
      });
      // The trace shows the refusal; only the admitted result counts as spent or citable.
      expect(result.toolCalls[1]).toMatchObject({ isError: true, tokens: 0, excerpts: [] });
      expect(result.toolCalls[1].summary).toMatch(/^Not added: over the context budget/);
      expect(result.usage.contextTokens).toBe(result.toolCalls[0].tokens);
      expect(result.citations).toEqual([{ path: 'src/big-2500.ts', startLine: 1, endLine: 10 }]);
    });

    it('stops a question that keeps searching at the budget, well before the iteration cap', async () => {
      // Every turn asks for three ~1,000-token results; the budget holds about four.
      const greedy = Array.from({ length: 20 }, (_, i) => ({
        toolCalls: [0, 1, 2].map((j) => call(`t${String(i)}-${String(j)}`, 'lookup', { key: 'big-1000' })),
      }));
      const { ask, model } = await setup(
        [greedy[0], greedy[1], { text: 'Summary of what I found.' }, ...greedy.slice(2)],
        { maxIterations: 20, tokenBudget: 10_000_000 },
        budget,
      );

      const result = await ask('Find every use of everything.');

      expect(result.outcome).toBe('context_budget');
      expect(result.answer).toBe('Summary of what I found.');
      expect(model.requests).toHaveLength(3);
      expect(result.toolCalls).toHaveLength(6);
      expect(result.toolCalls.filter((t) => t.isError)).toHaveLength(2);
      expect(result.usage.contextTokens).toBeLessThanOrEqual(budget.maxTokens);
    });
  });

  it('logs one llm_call per model call with tokens, cost, latency and prompt version', async () => {
    const { ask, llmCalls, sessionId } = await setup([
      { toolCalls: [call('t1', 'lookup', { key: 'a' })], model: 'claude-x', usage: { inputTokens: 500, outputTokens: 40, costUsd: 0.0028 } },
      { text: 'done', model: 'claude-x', usage: { inputTokens: 700, outputTokens: 60, costUsd: 0.004 } },
    ]);

    const result = await ask('q');

    expect(llmCalls.calls).toEqual([
      {
        sessionId,
        purpose: ANSWER_QUESTION_PURPOSE,
        model: 'claude-x',
        promptVersion: 'answer-question@v7',
        inputTokens: 500,
        outputTokens: 40,
        costUsd: 0.0028,
        latencyMs: 25,
        status: 'succeeded',
      },
      expect.objectContaining({ inputTokens: 700, outputTokens: 60, status: 'succeeded' }),
    ]);
    expect(result.usage).toEqual({ inputTokens: 1200, outputTokens: 100, costUsd: 0.0068, contextTokens: 14 });
  });

  it('logs a failed model call and rethrows, keeping the question stored', async () => {
    const { ask, llmCalls, chats, sessionId } = await setup([new Error('overloaded')]);

    await expect(ask('q')).rejects.toThrow('overloaded');

    expect(llmCalls.calls).toEqual([
      expect.objectContaining({ model: 'fake-model', status: 'failed', inputTokens: 0, outputTokens: 0 }),
    ]);
    expect((await chats.listMessages(sessionId)).map((m) => m.role)).toEqual(['user']);
  });

  it('stores the question and the answer with its tool trace and its verified citations', async () => {
    // LookupTool evidence: src/<key>.ts lines 1-10.
    const answer =
      'The loop is in src/retry.ts:2-5 (see `retry.ts:8`). Also src/retry.ts mentions it, ' +
      'and src/invented.ts:1-3 does too.';
    const { ask, chats, sessionId } = await setup([
      {
        toolCalls: [call('t1', 'lookup', { key: 'retry' }), call('t2', 'lookup', { key: 'unused' })],
      },
      { text: answer },
    ]);

    const result = await ask('How are retries done?');

    // Only line references backed by retrieved code count; a bare path is not a citation,
    // and src/unused.ts was retrieved but never referenced.
    expect(result.citations).toEqual([
      { path: 'src/retry.ts', startLine: 2, endLine: 5 },
      { path: 'src/retry.ts', startLine: 8, endLine: 8 },
    ]);
    expect(result.unverifiedReferences).toEqual(['src/invented.ts:1-3']);
    const stored = await chats.listMessages(sessionId);
    expect(stored).toEqual([
      expect.objectContaining({ role: 'user', content: 'How are retries done?' }),
      expect.objectContaining({
        id: result.messageId,
        role: 'assistant',
        content: answer,
        toolCalls: [
          { name: 'lookup', input: { key: 'retry' }, isError: false, summary: 'ok', excerpts: [], tokens: 16 },
          { name: 'lookup', input: { key: 'unused' }, isError: false, summary: 'ok', excerpts: [], tokens: 17 },
        ],
        citations: result.citations,
      }),
    ]);
  });

  it('replays prior turns as plain question/answer text', async () => {
    const { ask, model } = await setup([
      { toolCalls: [call('t1', 'lookup', { key: 'a' })] },
      { text: 'First answer.' },
      { text: 'Second answer.' },
    ]);

    await ask('First?');
    await ask('Second?');

    expect(model.requests[2].messages).toEqual([
      { role: 'user', content: 'First?' },
      { role: 'assistant', text: 'First answer.', toolCalls: [] },
      { role: 'user', content: 'Second?' },
    ]);
  });

  it('reports a refusal instead of an empty answer', async () => {
    const { ask } = await setup([{ stopReason: 'refusal', text: '' }]);

    const result = await ask('q');

    expect(result.outcome).toBe('refused');
    expect(result.answer).not.toBe('');
  });

  it('does not run tool calls cut off by max_tokens', async () => {
    const { ask, lookup } = await setup([
      { stopReason: 'max_tokens', toolCalls: [call('t1', 'lookup', { key: 'a' })] },
    ]);

    const result = await ask('q');

    expect(result.outcome).toBe('truncated');
    expect(lookup.calls).toEqual([]);
  });

  it('rejects an unknown session without calling the model', async () => {
    const { model } = await setup([]);
    const useCase = new AnswerQuestion({
      chats: new FakeChatStore(),
      model,
      tools: new ToolRegistry([]),
      llmCalls: new FakeLlmCallLog(),
      prompt: new SystemPrompt('p', 'v1', 'x'),
      policy: new LoopPolicy({ maxIterations: 3, tokenBudget: 1000 }),
      contextBudget: { maxTokens: 1000, maxResultTokens: 500 },
    });

    await expect(useCase.execute({ sessionId: 'nope', question: 'q' })).rejects.toThrow(
      SessionNotFoundError,
    );
    expect(model.requests).toEqual([]);
  });
});
