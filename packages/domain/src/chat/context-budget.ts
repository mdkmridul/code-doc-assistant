/**
 * Characters per token for estimates. Code and JSON tokenize denser than prose
 * (about 3-3.5 characters per token with Claude's tokenizer), so 3 errs on the
 * side of overestimating, which keeps the budget conservative.
 */
export const CHARS_PER_TOKEN = 3;

/** Estimated tokens for a text: no tokenizer dependency in the domain (ADR 0016). */
export const estimateTokens = (text: string): number => Math.ceil(text.length / CHARS_PER_TOKEN);

/** Most tokens one tool result may add; larger results are truncated to this. */
export const DEFAULT_MAX_RESULT_TOKENS = 8_000;

export interface ContextBudgetLimits {
  /** Most tokens all tool results of one question may add to the context, together. */
  maxTokens: number;
  /** Most tokens a single tool result may add; longer results are truncated first. */
  maxResultTokens: number;
}

/** A tool result's content, as it may enter the context. */
export type Admission =
  | {
      admitted: true;
      /** The content to send: the original, or its truncated head plus a note. */
      content: string;
      /** Estimated tokens this result adds (after truncation). */
      tokens: number;
      /** Estimated tokens of the original content. */
      originalTokens: number;
      truncated: boolean;
    }
  | {
      admitted: false;
      /** Estimated tokens the result would have added (after truncation). */
      tokens: number;
      /** Tokens left in the budget when it was refused. */
      remaining: number;
      /** What the model gets instead of the result. */
      content: string;
    };

/** Marker appended to truncated results; its length is reserved inside the per-result cap. */
const truncationNote = (shownTokens: number, totalTokens: number) =>
  `\n[Truncated: showing about ${String(shownTokens)} of ${String(totalTokens)} tokens. ` +
  'Ask for less (a smaller line range, fewer results or a filter) to see the rest.]';

const NOTE_RESERVE_CHARS = 200;

/**
 * Keeps the tool results of one question inside a token budget. Each result
 * is first truncated to the per-result cap; then it is admitted only if it fits
 * in what is left of the total budget, and its tokens are added to the running
 * spend. A result that doesn't fit is refused whole (never cut to fit), and the
 * budget counts as exhausted from then on: the loop then asks for an answer.
 *
 * One instance per question. Token counts are estimates (estimateTokens).
 */
export class ContextBudget {
  private spentTokens = 0;
  private refusedOnce = false;

  constructor(readonly limits: ContextBudgetLimits) {
    for (const [name, value] of Object.entries(limits)) {
      if (!Number.isInteger(value) || value < 1) {
        throw new RangeError(`${name} must be a positive integer, got ${String(value)}`);
      }
    }
    if (limits.maxResultTokens * CHARS_PER_TOKEN <= NOTE_RESERVE_CHARS) {
      throw new RangeError('maxResultTokens is too small to hold a truncation note');
    }
  }

  /** Estimated tokens admitted so far. */
  get spent(): number {
    return this.spentTokens;
  }

  get remaining(): number {
    return Math.max(0, this.limits.maxTokens - this.spentTokens);
  }

  /** True once a result has been refused: no more tool results should be requested. */
  get exhausted(): boolean {
    return this.refusedOnce;
  }

  /** Truncates `content` to the per-result cap, then admits it if it fits the remaining budget. */
  admit(content: string): Admission {
    const originalTokens = estimateTokens(content);
    const fitted = this.truncate(content, originalTokens);
    const tokens = estimateTokens(fitted.content);

    if (tokens > this.remaining) {
      const remaining = this.remaining;
      this.refusedOnce = true;
      return {
        admitted: false,
        tokens,
        remaining,
        content:
          `Not added: this result is about ${String(tokens)} tokens and only ${String(remaining)} ` +
          'tokens of the context budget for this question remain. Do not call more tools; ' +
          'answer with what you have already found.',
      };
    }

    this.spentTokens += tokens;
    return { admitted: true, content: fitted.content, tokens, originalTokens, truncated: fitted.truncated };
  }

  private truncate(content: string, originalTokens: number): { content: string; truncated: boolean } {
    if (originalTokens <= this.limits.maxResultTokens) return { content, truncated: false };
    const maxChars = this.limits.maxResultTokens * CHARS_PER_TOKEN - NOTE_RESERVE_CHARS;
    // Cut at a line break when there is one in the last fifth, so lines stay whole.
    const head = content.slice(0, maxChars);
    const lastBreak = head.lastIndexOf('\n');
    const cut = lastBreak > maxChars * 0.8 ? head.slice(0, lastBreak) : head;
    return {
      content: cut + truncationNote(estimateTokens(cut), originalTokens),
      truncated: true,
    };
  }
}
