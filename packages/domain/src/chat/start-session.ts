import type { ChatStore } from '../ports/chat-store';
import type { RepoStore } from '../ports/repo-store';
import { RepoNotFoundError, RepoNotReadyError } from './errors';

/** Opens a conversation about one ingested repository. */
export class StartSession {
  constructor(
    private readonly repos: RepoStore,
    private readonly chats: ChatStore,
  ) {}

  async execute(repoId: string): Promise<{ id: string; repoId: string }> {
    const repo = await this.repos.findById(repoId);
    if (!repo) throw new RepoNotFoundError(repoId);
    if (repo.status !== 'ready') throw new RepoNotReadyError(repoId, repo.status);

    const session = await this.chats.createSession(repoId);
    return { id: session.id, repoId };
  }
}
