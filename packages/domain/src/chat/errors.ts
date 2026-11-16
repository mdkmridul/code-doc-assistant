export class SessionNotFoundError extends Error {
  constructor(readonly sessionId: string) {
    super(`Chat session ${sessionId} not found`);
    this.name = 'SessionNotFoundError';
  }
}

/** The session asked more questions in the current window than the rate limit allows. */
export class SessionRateLimitedError extends Error {
  constructor(
    readonly sessionId: string,
    readonly limit: number,
    readonly windowSeconds: number,
    readonly retryAfterSeconds: number,
  ) {
    const per = windowSeconds === 60 ? 'minute' : `${String(windowSeconds)} seconds`;
    super(
      `Too many questions: this conversation allows ${String(limit)} per ${per}. ` +
        `Try again in ${String(retryAfterSeconds)} second${retryAfterSeconds === 1 ? '' : 's'}.`,
    );
    this.name = 'SessionRateLimitedError';
  }
}

/** Today's spend on model calls reached the daily cap: no more model calls until it resets. */
export class DailySpendCapReachedError extends Error {
  constructor(
    readonly spentUsd: number,
    readonly capUsd: number,
    readonly resetsAt: Date,
  ) {
    super(
      `The daily spending limit for answering questions ($${capUsd.toFixed(2)}) has been reached ` +
        `($${spentUsd.toFixed(2)} spent today). Questions can be asked again after ` +
        `${resetsAt.toISOString().slice(11, 16)} UTC.`,
    );
    this.name = 'DailySpendCapReachedError';
  }
}

export class RepoNotFoundError extends Error {
  constructor(readonly repoId: string) {
    super(`Repo ${repoId} not found`);
    this.name = 'RepoNotFoundError';
  }
}

/** A request asked for a prompt version this server has not loaded. */
export class UnknownPromptVersionError extends Error {
  constructor(
    readonly version: string,
    readonly available: readonly string[],
  ) {
    super(`Unknown prompt version ${version}; available: ${available.join(', ')}`);
    this.name = 'UnknownPromptVersionError';
  }
}

/** Questions need an indexed repo: no session until ingestion has finished. */
export class RepoNotReadyError extends Error {
  constructor(
    readonly repoId: string,
    readonly status: string,
    /** What was attempted, for the message: "used for a session" by default. */
    action = 'used for a session',
  ) {
    super(`Repo ${repoId} is ${status}; only a ready repo can be ${action}`);
    this.name = 'RepoNotReadyError';
  }
}
