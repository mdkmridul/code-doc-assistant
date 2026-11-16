/** Model-call totals over some set of `llm_calls` rows. */
export interface UsageTotals {
  calls: number;
  failedCalls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  /** Mean and 95th percentile of call latency, in milliseconds (null without calls). */
  latencyMsAvg: number | null;
  latencyMsP95: number | null;
}

export interface DailyUsage extends UsageTotals {
  /** UTC day, YYYY-MM-DD. */
  day: string;
}

export interface SessionUsage extends UsageTotals {
  /** null for calls made outside a chat session. */
  sessionId: string | null;
  firstCallAt: string;
  lastCallAt: string;
}

export interface UsageSummary {
  totals: UsageTotals;
  /** Oldest day first. */
  perDay: DailyUsage[];
  /** Most recently active session first, at most `sessionLimit`. */
  perSession: SessionUsage[];
}

/** Aggregates the model-call log (`llm_calls`). */
export interface UsageMetricsReader {
  summarize(query: { since: Date; sessionLimit: number }): Promise<UsageSummary>;
}
