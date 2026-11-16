/** Whether a session may ask another question now. */
export type QuestionAdmission =
  | { allowed: true }
  | {
      allowed: false;
      /** Questions allowed per window. */
      limit: number;
      windowSeconds: number;
      /** Seconds until the current window ends. */
      retryAfterSeconds: number;
    };

/** Spend on model calls today (UTC) against the daily cap. */
export interface DailySpend {
  spentUsd: number;
  capUsd: number;
  /** When today's spend resets (next 00:00 UTC). */
  resetsAt: Date;
}

/**
 * Usage limits the agent loop enforces (ADR 0020): a per-session rate limit
 * on questions and a daily spend cap across all sessions.
 */
export interface UsageGuard {
  /** Counts a new question against the session's rate limit. */
  admitQuestion(sessionId: string): Promise<QuestionAdmission>;
  dailySpend(): Promise<DailySpend>;
  /** Adds a finished model call's cost to today's spend. */
  recordSpend(costUsd: number): Promise<void>;
}

/** Allows everything: for callers and tests that don't enforce limits. */
export const unlimitedUsage: UsageGuard = {
  admitQuestion: () => Promise.resolve({ allowed: true }),
  dailySpend: () =>
    Promise.resolve({ spentUsd: 0, capUsd: Number.POSITIVE_INFINITY, resetsAt: new Date(8.64e15) }),
  recordSpend: () => Promise.resolve(),
};
