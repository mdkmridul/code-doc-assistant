import { describe, expect, it } from 'vitest';
import { CHARS_PER_TOKEN, ContextBudget, estimateTokens } from './context-budget';

/** Text of exactly `tokens` estimated tokens. */
const ofTokens = (tokens: number, char = 'x') => char.repeat(tokens * CHARS_PER_TOKEN);

describe('estimateTokens', () => {
  it('rounds characters up to whole tokens', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('a')).toBe(1);
    expect(estimateTokens('abc')).toBe(1);
    expect(estimateTokens('abcd')).toBe(2);
    expect(estimateTokens(ofTokens(1000))).toBe(1000);
  });
});

describe('ContextBudget', () => {
  it('admits results that fit and keeps a running spend', () => {
    const budget = new ContextBudget({ maxTokens: 1000, maxResultTokens: 500 });

    const first = budget.admit(ofTokens(300));
    expect(first).toMatchObject({ admitted: true, tokens: 300, originalTokens: 300, truncated: false });
    expect(first.content).toBe(ofTokens(300));
    expect(budget.spent).toBe(300);
    expect(budget.remaining).toBe(700);

    budget.admit(ofTokens(400));
    expect(budget.spent).toBe(700);
    expect(budget.remaining).toBe(300);
    expect(budget.exhausted).toBe(false);
  });

  it('admits a result that exactly fills the budget', () => {
    const budget = new ContextBudget({ maxTokens: 1000, maxResultTokens: 1000 });
    expect(budget.admit(ofTokens(1000)).admitted).toBe(true);
    expect(budget.remaining).toBe(0);
    expect(budget.exhausted).toBe(false);
  });

  it('refuses a result that would exceed the budget, whole, without spending anything', () => {
    const budget = new ContextBudget({ maxTokens: 1000, maxResultTokens: 1000 });
    budget.admit(ofTokens(800));

    const refused = budget.admit(ofTokens(201));

    expect(refused).toMatchObject({ admitted: false, tokens: 201, remaining: 200 });
    expect(refused.content).toMatch(/about 201 tokens and only 200 tokens .* remain/);
    expect(refused.content).toMatch(/Do not call more tools/);
    expect(budget.spent).toBe(800);
    expect(budget.exhausted).toBe(true);
  });

  it('still admits a small result after a refusal, but stays exhausted', () => {
    const budget = new ContextBudget({ maxTokens: 1000, maxResultTokens: 1000 });
    budget.admit(ofTokens(800));
    budget.admit(ofTokens(500));

    expect(budget.admit(ofTokens(100)).admitted).toBe(true);
    expect(budget.spent).toBe(900);
    expect(budget.exhausted).toBe(true);
  });

  it('truncates a result over the per-result cap to within the cap, with a note', () => {
    const budget = new ContextBudget({ maxTokens: 10_000, maxResultTokens: 1000 });
    const lines = Array.from({ length: 2000 }, (_, i) => `line ${String(i).padStart(4, '0')}`).join('\n');
    const original = estimateTokens(lines);

    const result = budget.admit(lines);

    expect(result.admitted).toBe(true);
    if (!result.admitted) return;
    expect(result.truncated).toBe(true);
    expect(result.originalTokens).toBe(original);
    expect(result.tokens).toBeLessThanOrEqual(1000);
    expect(result.tokens).toBeGreaterThan(900);
    expect(budget.spent).toBe(result.tokens);
    // Cut at a line break, and the note says how much was shown.
    expect(result.content).toMatch(/\nline \d{4}\n\[Truncated: showing about \d+ of \d+ tokens\./);
    expect(result.content.startsWith('line 0000\nline 0001')).toBe(true);
  });

  it('truncates mid-line when a single line is longer than the cap', () => {
    const budget = new ContextBudget({ maxTokens: 10_000, maxResultTokens: 1000 });
    const result = budget.admit(ofTokens(5000));
    expect(result).toMatchObject({ admitted: true, truncated: true });
    expect(result.tokens).toBeLessThanOrEqual(1000);
  });

  it('checks the truncated size, not the original, against the remaining budget', () => {
    const budget = new ContextBudget({ maxTokens: 1500, maxResultTokens: 1000 });
    budget.admit(ofTokens(400));
    // 3000 tokens originally, about 1000 after truncation: fits in the 1100 left.
    expect(budget.admit(ofTokens(3000)).admitted).toBe(true);
    // Another 1000 doesn't fit in what is left.
    expect(budget.admit(ofTokens(3000)).admitted).toBe(false);
  });

  it('rejects limits that are not positive integers or too small for the note', () => {
    expect(() => new ContextBudget({ maxTokens: 0, maxResultTokens: 100 })).toThrow(RangeError);
    expect(() => new ContextBudget({ maxTokens: 1000, maxResultTokens: 1.5 })).toThrow(RangeError);
    expect(() => new ContextBudget({ maxTokens: 1000, maxResultTokens: 10 })).toThrow(/truncation note/);
  });
});
