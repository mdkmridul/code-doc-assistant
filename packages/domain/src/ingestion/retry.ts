import { EmbeddingError } from '../ports/embedder';

export interface RetryOptions {
  /** Total tries, including the first. */
  maxAttempts: number;
  /** Delay before the second try; doubles each time. */
  baseDelayMs: number;
  /** Cap on any single delay. */
  maxDelayMs: number;
}

export interface RetryClock {
  sleep(ms: number): Promise<void>;
  /** Returns a number in [0, 1). Used for jitter. */
  random(): number;
}

export const systemClock: RetryClock = {
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random: Math.random,
};

function isRetryable(error: unknown): boolean {
  // Unknown errors (network resets, timeouts) are assumed transient.
  return !(error instanceof EmbeddingError) || error.retryable;
}

/**
 * Runs `operation`, retrying transient failures with exponential backoff and
 * jitter. Honours a server-sent retry-after when it is longer than the backoff.
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions,
  clock: RetryClock = systemClock,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= options.maxAttempts || !isRetryable(error)) throw error;

      const backoff = Math.min(
        options.maxDelayMs,
        options.baseDelayMs * 2 ** (attempt - 1),
      );
      // "Equal jitter": half fixed, half random, so retries spread out but never collapse to 0.
      const jittered = backoff / 2 + clock.random() * (backoff / 2);
      const retryAfter =
        error instanceof EmbeddingError ? (error.retryAfterMs ?? 0) : 0;
      await clock.sleep(Math.max(jittered, retryAfter));
    }
  }
}
