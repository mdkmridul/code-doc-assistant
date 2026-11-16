export class SessionNotFoundError extends Error {
  constructor(readonly sessionId: string) {
    super(`Chat session ${sessionId} not found`);
    this.name = 'SessionNotFoundError';
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
