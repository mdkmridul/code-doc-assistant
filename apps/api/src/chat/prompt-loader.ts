import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { SystemPrompt } from '@cda/domain';

/**
 * Loads `prompts/<name>/<version>.md` from the repo root. The API runs with
 * cwd at either the repo root or apps/api (same lookup as the .env file).
 * Throws at boot if the file is missing, or if `prompts/<name>/CHANGELOG.md`
 * has no `## <version>` entry for it, so an unrecorded version never runs.
 */
export function loadPrompt(
  name: string,
  version: string,
  roots: readonly string[] = [process.cwd(), resolve(process.cwd(), '../..')],
): SystemPrompt {
  const relative = join('prompts', name, `${version}.md`);
  const candidates = roots.map((root) => resolve(root, relative));
  const file = candidates.find((path) => existsSync(path));
  if (!file) {
    throw new Error(
      `Prompt ${name}@${version} not found; looked in ${candidates.join(', ')}`,
    );
  }

  const changelog = join(dirname(file), 'CHANGELOG.md');
  const entry = new RegExp(
    `^## ${version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`,
    'm',
  );
  if (!existsSync(changelog) || !entry.test(readFileSync(changelog, 'utf8'))) {
    throw new Error(
      `Prompt ${name}@${version} has no "## ${version}" entry in ${changelog}. ` +
        'Describe what changed in this version before using it.',
    );
  }
  return new SystemPrompt(name, version, readFileSync(file, 'utf8').trim());
}

/**
 * Every version of a prompt that has a changelog entry and a file, e.g. for
 * evals that compare versions (AnswerQuestion's otherPrompts). Each one is
 * loaded with loadPrompt, so the same boot-time checks apply.
 */
export function loadPromptVersions(
  name: string,
  roots: readonly string[] = [process.cwd(), resolve(process.cwd(), '../..')],
): SystemPrompt[] {
  const changelog = roots
    .map((root) => resolve(root, 'prompts', name, 'CHANGELOG.md'))
    .find((path) => existsSync(path));
  if (!changelog) return [];
  const versions = [
    ...readFileSync(changelog, 'utf8').matchAll(/^## (v\d+)\s*$/gm),
  ].map((match) => match[1]);
  return versions
    .filter((version) => existsSync(join(dirname(changelog), `${version}.md`)))
    .map((version) => loadPrompt(name, version, roots));
}
