/** Turns text into vectors. Implemented in infrastructure (e.g. Voyage). */
export interface Embedder {
  /** Length of every returned vector. */
  readonly dimensions: number;
  /** Most inputs one `embed` call accepts. */
  readonly maxBatchSize: number;
  /** Returns one vector per input, in input order. */
  embed(texts: readonly string[]): Promise<number[][]>;
}

/**
 * Raised by embedders. `retryable` separates transient failures (rate limits,
 * 5xx, network) from ones that will fail again (bad request, auth).
 */
export class EmbeddingError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    /** Server-requested wait before retrying, if it sent one. */
    readonly retryAfterMs?: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'EmbeddingError';
  }
}
