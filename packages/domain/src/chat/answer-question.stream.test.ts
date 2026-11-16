import { describe, expect, it } from 'vitest';
import type { ChatStreamEvent } from '../events';
import type { ModelResponse } from '../ports/language-model';
import { ToolRegistry } from '../tools/tool-registry';
import { AnswerQuestion, CANCELLED_ANSWER } from './answer-question';
import {
  call,
  FakeChatStore,
  FakeLanguageModel,
  FakeLlmCallLog,
  final,
  HANG,
  LookupTool,
} from './fakes.test-helpers';
import { LoopPolicy } from './loop-policy';
import { SystemPrompt } from './system-prompt';

const setup = async (script: (Partial<ModelResponse> | Error | typeof HANG)[]) => {
  const chats = new FakeChatStore();
  const { id: sessionId } = await chats.createSession('repo-1');
  const model = new FakeLanguageModel(script);
  const llmCalls = new FakeLlmCallLog();
  const useCase = new AnswerQuestion({
    chats,
    model,
    tools: new ToolRegistry([new LookupTool()]),
    llmCalls,
    prompt: new SystemPrompt('answer-question', 'v1', 'Repo {{repository}}'),
    policy: new LoopPolicy({ maxIterations: 5, tokenBudget: 100_000 }),
    contextBudget: { maxTokens: 100_000, maxResultTokens: 8_000 },
  });
  const events: ChatStreamEvent[] = [];
  const ask = (question: string, signal?: AbortSignal) =>
    useCase.execute({ sessionId, question }, { onEvent: (e) => events.push(e), signal });
  return { chats, sessionId, model, llmCalls, events, ask };
};

/** Compact event log: "token:1:Look ", "tool_call:1:lookup", ... */
const trace = (events: ChatStreamEvent[]) =>
  events.map((e) => {
    switch (e.type) {
      case 'token':
        return `token:${String(e.iteration)}:${e.text}`;
      case 'tool_call':
        return `tool_call:${String(e.iteration)}:${e.name}`;
      case 'tool_result':
        return `tool_result:${String(e.iteration)}:${e.summary}`;
      case 'done':
        return `done:${e.result.outcome}`;
      case 'error':
        return `error:${e.message}`;
    }
  });

describe('AnswerQuestion streaming', () => {
  it('streams tokens per iteration, tool events between, and ends with done', async () => {
    const { ask, events } = await setup([
      { text: 'Let me look. ', toolCalls: [call('t1', 'lookup', { key: 'retry' })] },
      { text: final('Retries live in src/retry.ts:1-5.', ['lk-retry']) },
    ]);

    const result = await ask('How are retries done?');

    expect(trace(events)).toEqual([
      'token:1:Let ',
      'token:1:me ',
      'token:1:look. ',
      'tool_call:1:lookup',
      'tool_result:1:ok',
      'token:2:Retries ',
      'token:2:live ',
      'token:2:in ',
      // The citation block streams too (the web app hides it); the stored answer drops it.
      `token:2:src/retry.ts:1-5.${final('', ['lk-retry'])}`,
      'done:completed',
    ]);
    expect(result.answer).toBe('Retries live in src/retry.ts:1-5.');
    const done = events.at(-1);
    expect(done).toEqual({ type: 'done', result });
  });

  it('announces every tool call of a turn before any of their results', async () => {
    const { ask, events } = await setup([
      { toolCalls: [call('a', 'lookup', { key: 'one' }), call('b', 'lookup', { key: 'two' })] },
      { text: final('ok', ['lk-one']) },
    ]);

    await ask('q');

    const kinds = trace(events).filter((e) => e.startsWith('tool_'));
    expect(kinds).toEqual([
      'tool_call:1:lookup',
      'tool_call:1:lookup',
      'tool_result:1:ok',
      'tool_result:1:ok',
    ]);
  });

  it('reports failing tools in tool_result with the error', async () => {
    const { ask, events } = await setup([
      { toolCalls: [call('x', 'lookup', { key: 'explode' })] },
      { text: final('sorry', [], false) },
    ]);

    await ask('q');

    expect(events).toContainEqual({
      type: 'tool_result',
      iteration: 1,
      id: 'x',
      name: 'lookup',
      isError: true,
      summary: 'lookup failed: backend down',
      excerpts: [],
    });
  });

  it('stops after the current model call when aborted between iterations', async () => {
    const controller = new AbortController();
    const { ask, model, chats, sessionId } = await setup([
      { toolCalls: [call('t1', 'lookup', { key: 'a' })] },
      { text: 'never requested' },
    ]);
    // Abort while the first call is running: its result is used, nothing more is called.
    model.onCall = (n) => {
      if (n === 1) controller.abort();
    };

    const result = await ask('q', controller.signal);

    expect(model.requests).toHaveLength(1);
    expect(result).toMatchObject({ outcome: 'cancelled', answer: CANCELLED_ANSWER, iterations: 1 });
    // The session stays a clean question/answer pair.
    expect((await chats.listMessages(sessionId)).map((m) => [m.role, m.content])).toEqual([
      ['user', 'q'],
      ['assistant', CANCELLED_ANSWER],
    ]);
  });

  it('cancels an in-flight model call, logs it as failed and stores the cancellation', async () => {
    const controller = new AbortController();
    const { ask, model, llmCalls, chats, sessionId, events } = await setup([HANG]);
    model.onCall = () => setTimeout(() => { controller.abort(); }, 0);

    const result = await ask('q', controller.signal);

    expect(result.outcome).toBe('cancelled');
    expect(llmCalls.calls).toEqual([expect.objectContaining({ status: 'failed' })]);
    expect((await chats.listMessages(sessionId)).map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(trace(events)).toEqual(['done:cancelled']);
  });

  it('makes no model call at all when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const { ask, model } = await setup([{ text: 'x' }]);

    const result = await ask('q', controller.signal);

    expect(model.requests).toEqual([]);
    expect(result.outcome).toBe('cancelled');
  });

  it('still rethrows real model failures', async () => {
    const { ask } = await setup([new Error('overloaded')]);
    await expect(ask('q', new AbortController().signal)).rejects.toThrow('overloaded');
  });
});
