import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type { SourceFile } from '@cda/domain';
import ignore, { type Ignore } from 'ignore';
import { detectLanguage } from './languages';

export const DEFAULT_MAX_FILE_BYTES = 512 * 1024;

export type SkipReason =
  | 'vcs-metadata'
  | 'vendored'
  | 'gitignored'
  | 'lockfile'
  | 'binary'
  | 'too-large'
  | 'symlink'
  | 'not-a-file';

export interface SkippedEntry {
  path: string;
  reason: SkipReason;
}

export interface WalkOptions {
  /** Files larger than this are skipped. */
  maxFileBytes?: number;
  onSkip?: (entry: SkippedEntry) => void;
}

/** Dependency, build-output and tool directories: never source worth documenting. */
export const VENDORED_DIRECTORIES = new Set([
  'node_modules',
  'bower_components',
  'jspm_packages',
  'vendor',
  'third_party',
  'third-party',
  'Pods',
  '.venv',
  'venv',
  '__pycache__',
  '.tox',
  '.gradle',
  'target',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.cache',
  'coverage',
  '.idea',
  '.vscode',
]);

/** Machine-generated dependency locks: large, noisy, never documentation. */
export const LOCKFILES = new Set([
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'Cargo.lock',
  'poetry.lock',
  'Pipfile.lock',
  'Gemfile.lock',
  'composer.lock',
  'go.sum',
]);

export const BINARY_EXTENSIONS = new Set([
  // images
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.bmp',
  '.ico',
  '.webp',
  '.avif',
  '.tiff',
  '.psd',
  // fonts
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  // archives
  '.zip',
  '.gz',
  '.tgz',
  '.bz2',
  '.xz',
  '.7z',
  '.rar',
  '.tar',
  '.jar',
  '.war',
  // executables and objects
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.a',
  '.o',
  '.obj',
  '.class',
  '.pyc',
  '.wasm',
  '.node',
  // media and documents
  '.mp3',
  '.mp4',
  '.mov',
  '.avi',
  '.webm',
  '.wav',
  '.flac',
  '.ogg',
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  // data
  '.sqlite',
  '.db',
  '.bin',
  '.dat',
]);

/** Bytes inspected for NUL when sniffing binaries (same heuristic as git). */
const SNIFF_BYTES = 8000;

interface IgnoreScope {
  /** Directory the .gitignore lives in, relative to the root ('' = root). */
  base: string;
  rules: Ignore;
}

/** Decodes UTF-8 text, or returns null for content that looks binary. */
function decodeText(buffer: Buffer): string | null {
  if (buffer.subarray(0, SNIFF_BYTES).includes(0)) return null;
  try {
    // fatal: invalid UTF-8 throws instead of producing replacement characters.
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return null;
  }
}

function isGitignored(
  scopes: readonly IgnoreScope[],
  relPath: string,
  isDirectory: boolean,
): boolean {
  return scopes.some(({ base, rules }) => {
    const local = base === '' ? relPath : relPath.slice(base.length + 1);
    // A trailing slash lets directory-only patterns like `logs/` match.
    return rules.ignores(isDirectory ? `${local}/` : local);
  });
}

/**
 * Yields the indexable text files under `root`, depth-first in name order,
 * with repo-relative POSIX paths. Respects every .gitignore on the way down
 * and skips VCS metadata, vendored directories, lockfiles, symlinks, binaries
 * and files over the size cap.
 */
export async function* walkSourceFiles(
  root: string,
  options: WalkOptions = {},
): AsyncGenerator<SourceFile> {
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const skip = (path: string, reason: SkipReason) =>
    options.onSkip?.({ path, reason });

  async function* walk(
    relDir: string,
    inherited: readonly IgnoreScope[],
  ): AsyncGenerator<SourceFile> {
    const absDir = join(root, relDir);
    const entries = (await readdir(absDir, { withFileTypes: true })).sort(
      (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
    );

    let scopes = inherited;
    if (entries.some((e) => e.isFile() && e.name === '.gitignore')) {
      const rules = ignore().add(
        await readFile(join(absDir, '.gitignore'), 'utf8'),
      );
      scopes = [...inherited, { base: relDir, rules }];
    }

    for (const entry of entries) {
      const relPath = relDir === '' ? entry.name : `${relDir}/${entry.name}`;

      // Checked first: a symlink must never be followed, even to a directory.
      if (entry.isSymbolicLink()) {
        skip(relPath, 'symlink');
        continue;
      }

      if (entry.isDirectory()) {
        if (entry.name === '.git') skip(relPath, 'vcs-metadata');
        else if (VENDORED_DIRECTORIES.has(entry.name))
          skip(relPath, 'vendored');
        else if (isGitignored(scopes, relPath, true))
          skip(relPath, 'gitignored');
        else yield* walk(relPath, scopes);
        continue;
      }

      if (!entry.isFile()) {
        skip(relPath, 'not-a-file');
        continue;
      }
      if (isGitignored(scopes, relPath, false)) {
        skip(relPath, 'gitignored');
        continue;
      }
      if (LOCKFILES.has(entry.name)) {
        skip(relPath, 'lockfile');
        continue;
      }
      if (BINARY_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        skip(relPath, 'binary');
        continue;
      }

      const absPath = join(absDir, entry.name);
      if ((await stat(absPath)).size > maxFileBytes) {
        skip(relPath, 'too-large');
        continue;
      }
      const content = decodeText(await readFile(absPath));
      if (content === null) {
        skip(relPath, 'binary');
        continue;
      }

      yield { path: relPath, language: detectLanguage(relPath), content };
    }
  }

  yield* walk('', []);
}
