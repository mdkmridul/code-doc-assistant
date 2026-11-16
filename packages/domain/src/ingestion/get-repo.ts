import type { RepoStore, RepoView } from '../ports/repo-store';

export class GetRepo {
  constructor(private readonly repos: RepoStore) {}

  execute(id: string): Promise<RepoView | null> {
    return this.repos.findById(id);
  }
}
