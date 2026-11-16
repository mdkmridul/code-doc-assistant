import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import type { RepoSource, Workspace, WorkspaceFactory } from '@cda/domain';
import { extractZip } from './archive';
import { walkSourceFiles, type SkipReason } from './file-walker';
import { checkoutCommit } from './git';

export const WORKSPACE_PREFIX = 'cda-ingest-';

/** GitHub's "Download ZIP" wraps everything in one `<repo>-<branch>/` folder. */
async function unwrapSingleDirectory(dir: string): Promise<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.length === 1 && entries[0].isDirectory()
    ? join(dir, entries[0].name)
    : dir;
}

/**
 * Materialises a source in a fresh OS temp directory: a depth-1 fetch of the
 * pinned commit for git, extraction for uploaded archives. Disposing deletes
 * the directory and the staged archive.
 */
@Injectable()
export class TempWorkspaceFactory implements WorkspaceFactory {
  private readonly logger = new Logger(TempWorkspaceFactory.name);

  async open(source: RepoSource): Promise<Workspace> {
    const dir = await mkdtemp(join(tmpdir(), WORKSPACE_PREFIX));
    const cleanup = async () => {
      await rm(dir, { recursive: true, force: true, maxRetries: 3 });
      if (source.type === 'local')
        await rm(source.archivePath, { force: true });
    };

    try {
      let root = dir;
      let commitSha: string | null = null;
      if (source.type === 'git') {
        commitSha = await checkoutCommit(source.url, source.commitSha, dir);
        if (commitSha !== source.commitSha) {
          throw new Error(
            `Checked out ${commitSha}, expected ${source.commitSha}`,
          );
        }
      } else {
        await extractZip(source.archivePath, dir);
        root = await unwrapSingleDirectory(dir);
      }
      this.logger.log(`Opened workspace ${dir}`);

      const skipped = new Map<SkipReason, number>();
      let disposed = false;
      return {
        commitSha,
        files: () =>
          walkSourceFiles(root, {
            onSkip: ({ reason }) =>
              skipped.set(reason, (skipped.get(reason) ?? 0) + 1),
          }),
        dispose: async () => {
          if (disposed) return;
          disposed = true;
          await cleanup();
          const summary =
            [...skipped].map(([reason, n]) => `${reason}=${n}`).join(', ') ||
            'none';
          this.logger.log(`Removed workspace ${dir} (skipped: ${summary})`);
        },
      };
    } catch (error) {
      await cleanup();
      throw error;
    }
  }
}
