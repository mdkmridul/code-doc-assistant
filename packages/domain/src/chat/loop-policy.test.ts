import { describe, expect, it } from 'vitest';
import { LoopPolicy } from './loop-policy';

const policy = new LoopPolicy({ maxIterations: 3, tokenBudget: 1_000 });

describe('LoopPolicy', () => {
  it.each([
    [{ iterations: 0, tokensUsed: 0 }, 'call'],
    [{ iterations: 1, tokensUsed: 500 }, 'call'],
    // The last allowed call is reserved for an answer.
    [{ iterations: 2, tokensUsed: 500 }, 'final_call'],
    [{ iterations: 3, tokensUsed: 500 }, 'stop'],
    // The budget wins over remaining iterations.
    [{ iterations: 1, tokensUsed: 1_000 }, 'stop'],
    [{ iterations: 0, tokensUsed: 5_000 }, 'stop'],
    // An exhausted context budget ends research early, but still answers...
    [{ iterations: 1, tokensUsed: 500, contextExhausted: true }, 'final_call'],
    // ...unless no call is left.
    [{ iterations: 3, tokensUsed: 500, contextExhausted: true }, 'stop'],
    [{ iterations: 1, tokensUsed: 1_000, contextExhausted: true }, 'stop'],
  ] as const)('%j → %s', (state, expected) => {
    expect(policy.nextStep(state)).toBe(expected);
  });

  it('makes the only call a final call when maxIterations is 1', () => {
    expect(
      new LoopPolicy({ maxIterations: 1, tokenBudget: 10 }).nextStep({
        iterations: 0,
        tokensUsed: 0,
      }),
    ).toBe('final_call');
  });

  it('is done exactly when the model asks for no tools', () => {
    expect(policy.isDone({ toolCalls: [] })).toBe(true);
    expect(policy.isDone({ toolCalls: [{}] })).toBe(false);
  });

  it.each([
    { maxIterations: 0, tokenBudget: 10 },
    { maxIterations: 1.5, tokenBudget: 10 },
    { maxIterations: 3, tokenBudget: 0 },
  ])('rejects invalid limits %j', (limits) => {
    expect(() => new LoopPolicy(limits)).toThrow(RangeError);
  });
});
