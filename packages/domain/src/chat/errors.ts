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

/** Questions need an indexed repo: no session until ingestion has finished. */
export class RepoNotReadyError extends Error {
  constructor(
    readonly repoId: string,
    readonly status: string,
  ) {
    super(`Repo ${repoId} is ${status}; sessions can only be started on a ready repo`);
    this.name = 'RepoNotReadyError';
  }
}
