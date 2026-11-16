import { describe, expect, it } from 'vitest';
import type { ModelResponse } from '../ports/language-model';
import { ToolRegistry } from '../tools/tool-registry';
import { AnswerQuestion } from './answer-question';
import { DailySpendCapReachedError, SessionRateLimitedError } from './errors';
import {
  call,
  FakeChatStore,
  FakeLanguageModel,
  FakeLlmCallLog,
  FakeUsageGuard,
  final,
  LookupTool,
} from './fakes.test-helpers';
import { LoopPolicy } from './loop-policy';
import { SystemPrompt } from './system-prompt';

const setup = async (script: Partial<ModelResponse>[]) => {
  const chats = new FakeChatStore();
  const { id: sessionId } = await chats.createSession('repo-1');
  const model = new FakeLanguageModel(script);
  const usage = new FakeUsageGuard();
  const useCase = new AnswerQuestion({
    chats,
    model,
    tools: new ToolRegistry([new LookupTool()]),
    llmCalls: new FakeLlmCallLog(),
    prompt: new SystemPrompt('answer-question', 'v7', 'Repo {{repository}}.'),
    policy: new LoopPolicy({ maxIterations: 5, tokenBudget: 100_000 }),
    contextBudget: { maxTokens: 100_000, maxResultTokens: 8_000 },
    usage,
  });
  const ask = (question: string) => useCase.execute({ sessionId, question });
  return { chats, sessionId, model, usage, ask };
};

const toolTurn = (key: string, costUsd: number): Partial<ModelResponse> => ({
  toolCalls: [call(`t-${key}`, 'lookup', { key })],
  usage: { inputTokens: 100, outputTokens: 10, costUsd },
});

describe('AnswerQuestion usage limits', () => {
  it('records every model call’s cost against today’s spend', async () => {
    const { ask, usage } = await setup([
      toolTurn('a', 0.02),
      { text: final('Done.', ['lk-a']), usage: { inputTokens: 100, outputTokens: 10, costUsd: 0.03 } },
    ]);

    await ask('q');

    expect(usage.spends).toEqual([0.02, 0.03]);
  });

  it('refuses a question over the session’s rate limit with a readable error, storing nothing', async () => {
    const { ask, usage, model, chats, sessionId } = await setup([
      { text: final('One.', [], false) },
      { text: final('Two.', [], false) },
    ]);
    usage.questionLimit = 1;

    await ask('first');
    const refused = ask('second');

    await expect(refused).rejects.toThrow(SessionRateLimitedError);
    await expect(refused).rejects.toThrow(
      'Too many questions: this conversation allows 1 per minute. Try again in 42 seconds.',
    );
    expect(model.requests).toHaveLength(1);
    expect((await chats.listMessages(sessionId)).map((m) => m.content)).not.toContain('second');
  });

  it('refuses a question once today’s spend has reached the cap, before any model call', async () => {
    const { ask, usage, model, chats, sessionId } = await setup([{ text: final('x', [], false) }]);
    usage.capUsd = 5;
    usage.spentUsd = 5.02;

    const refused = ask('q');

    await expect(refused).rejects.toThrow(DailySpendCapReachedError);
    await expect(refused).rejects.toThrow(
      'The daily spending limit for answering questions ($5.00) has been reached ($5.02 spent today). ' +
        'Questions can be asked again after 00:00 UTC.',
    );
    expect(model.requests).toEqual([]);
    expect(await chats.listMessages(sessionId)).toEqual([]);
    // A refused question does not use up the rate limit either.
    expect(usage.admitted).toEqual([]);
  });

  it('stops the loop before the next model call when a call takes spend over the cap', async () => {
    const { ask, usage, model } = await setup([
      toolTurn('a', 0.6),
      toolTurn('b', 0.6),
      { text: final('never reached', ['lk-a']) },
    ]);
    usage.capUsd = 1;

    await expect(ask('q')).rejects.toThrow(DailySpendCapReachedError);
    // Two calls ran (0.6, then 1.2 >= 1 stops the third).
    expect(model.requests).toHaveLength(2);
    expect(usage.spends).toEqual([0.6, 0.6]);
  });
});
