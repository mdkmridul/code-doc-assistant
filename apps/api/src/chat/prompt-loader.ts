import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SystemPrompt } from '@cda/domain';

/**
 * Loads `prompts/<name>/<version>.md` from the repo root. The API runs with
 * cwd at either the repo root or apps/api (same lookup as the .env file).
 * Throws at boot if the file is missing, so a bad version never reaches a user.
 */
export function loadPrompt(name: string, version: string): SystemPrompt {
  const relative = join('prompts', name, `${version}.md`);
  const candidates = [
    resolve(process.cwd(), relative),
    resolve(process.cwd(), '../..', relative),
  ];
  const file = candidates.find((path) => existsSync(path));
  if (!file) {
    throw new Error(
      `Prompt ${name}@${version} not found; looked in ${candidates.join(', ')}`,
    );
  }
  return new SystemPrompt(name, version, readFileSync(file, 'utf8').trim());
}
