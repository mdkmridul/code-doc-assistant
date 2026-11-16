export type { LoopOutcome } from '../events';

export interface LoopLimits {
  /** Most model calls for one question, including the final answer call. */
  maxIterations: number;
  /** Most tokens (input + output, summed over calls) one question may use. */
  tokenBudget: number;
}

export interface LoopState {
  /** Model calls made so far for this question. */
  iterations: number;
  /** Input + output tokens used so far for this question. */
  tokensUsed: number;
  /** The context budget refused a tool result: research is over, answer now. */
  contextExhausted?: boolean;
}

/**
 * What to do before the next model call:
 * - `call`: call the model with tools available.
 * - `final_call`: last allowed call (iteration cap, or the context budget is
 *   exhausted); tools are disabled so the model must answer.
 * - `stop`: no more calls; the token budget is spent.
 */
export type NextStep = 'call' | 'final_call' | 'stop';

/**
 * The rules of the agent loop, in one place: how many calls, how many tokens,
 * and when a question is done. Pure and deterministic.
 */
export class LoopPolicy {
  constructor(readonly limits: LoopLimits) {
    if (!Number.isInteger(limits.maxIterations) || limits.maxIterations < 1) {
      throw new RangeError(
        `maxIterations must be a positive integer, got ${String(limits.maxIterations)}`,
      );
    }
    if (!Number.isFinite(limits.tokenBudget) || limits.tokenBudget < 1) {
      throw new RangeError(`tokenBudget must be positive, got ${String(limits.tokenBudget)}`);
    }
  }

  nextStep(state: LoopState): NextStep {
    if (state.iterations >= this.limits.maxIterations) return 'stop';
    if (state.tokensUsed >= this.limits.tokenBudget) return 'stop';
    if (state.contextExhausted) return 'final_call';
    // Reserve the last call for an answer, so hitting the cap still answers.
    return state.iterations === this.limits.maxIterations - 1 ? 'final_call' : 'call';
  }

  /** Done when the model asks for no tools: its text is the answer. */
  isDone(response: { toolCalls: readonly unknown[] }): boolean {
    return response.toolCalls.length === 0;
  }
}
