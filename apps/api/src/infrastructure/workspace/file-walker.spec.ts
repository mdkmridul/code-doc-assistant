import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { SourceFile } from '@cda/domain';
import { walkSourceFiles, type SkippedEntry } from './file-walker';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'cda-walker-test-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** Creates files from a { 'relative/path': content } map. */
async function tree(files: Record<string, string | Buffer>): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    const abs = join(root, path);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content);
  }
}

async function walk(maxFileBytes?: number) {
  const files: SourceFile[] = [];
  const skipped: SkippedEntry[] = [];
  for await (const file of walkSourceFiles(root, {
    maxFileBytes,
    onSkip: (entry) => skipped.push(entry),
  })) {
    files.push(file);
  }
  return {
    paths: files.map((f) => f.path),
    files,
    skipped: Object.fromEntries(skipped.map((s) => [s.path, s.reason])),
  };
}

describe('walkSourceFiles', () => {
  it('yields text files with POSIX relative paths, language and content, in name order', async () => {
    await tree({
      'src/index.ts': 'export {};\n',
      'src/util/math.py': 'x = 1\n',
      'README.md': '# Hello\n',
      Dockerfile: 'FROM node\n',
    });

    const { files } = await walk();

    expect(files).toEqual([
      { path: 'Dockerfile', language: 'dockerfile', content: 'FROM node\n' },
      { path: 'README.md', language: 'markdown', content: '# Hello\n' },
      { path: 'src/index.ts', language: 'typescript', content: 'export {};\n' },
      { path: 'src/util/math.py', language: 'python', content: 'x = 1\n' },
    ]);
  });

  it('skips the .git directory', async () => {
    await tree({ '.git/config': '[core]\n', 'a.ts': '1' });

    const { paths, skipped } = await walk();

    expect(paths).toEqual(['a.ts']);
    expect(skipped).toEqual({ '.git': 'vcs-metadata' });
  });

  it.each([
    'node_modules',
    'vendor',
    'third_party',
    'dist',
    'build',
    '.next',
    'coverage',
    '__pycache__',
  ])('skips the vendored/generated directory %s at any depth', async (dir) => {
    await tree({
      [`${dir}/lib.js`]: 'x',
      [`packages/app/${dir}/lib.js`]: 'x',
      'packages/app/index.ts': 'x',
    });

    const { paths, skipped } = await walk();

    expect(paths).toEqual(['packages/app/index.ts']);
    expect(skipped).toEqual({
      [dir]: 'vendored',
      [`packages/app/${dir}`]: 'vendored',
    });
  });

  it('respects .gitignore file, directory and negation patterns', async () => {
    await tree({
      '.gitignore': '*.log\nsecrets/\n*.env\n!example.env\n',
      'app.log': 'x',
      'secrets/key.txt': 'x',
      'prod.env': 'x',
      'example.env': 'x',
      'src/debug.log': 'x',
      'src/main.ts': 'x',
    });

    const { paths, skipped } = await walk();

    expect(paths).toEqual(['.gitignore', 'example.env', 'src/main.ts']);
    expect(skipped).toEqual({
      'app.log': 'gitignored',
      'prod.env': 'gitignored',
      secrets: 'gitignored',
      'src/debug.log': 'gitignored',
    });
  });

  it('applies a nested .gitignore only inside its own directory', async () => {
    await tree({
      'pkg/.gitignore': 'generated.ts\n',
      'pkg/generated.ts': 'x',
      'pkg/deep/generated.ts': 'x',
      'generated.ts': 'x',
    });

    const { paths } = await walk();

    expect(paths).toEqual(['generated.ts', 'pkg/.gitignore']);
  });

  it('anchors root-relative patterns to the .gitignore directory', async () => {
    await tree({
      'pkg/.gitignore': '/local-only.ts\n',
      'pkg/local-only.ts': 'x',
      'pkg/sub/local-only.ts': 'x',
    });

    const { paths } = await walk();

    expect(paths).toEqual(['pkg/.gitignore', 'pkg/sub/local-only.ts']);
  });

  it('skips lockfiles', async () => {
    await tree({
      'package-lock.json': '{}',
      'yarn.lock': 'x',
      'pnpm-lock.yaml': 'x',
      'go.sum': 'x',
      'package.json': '{}',
    });

    const { paths, skipped } = await walk();

    expect(paths).toEqual(['package.json']);
    expect(Object.values(skipped)).toEqual([
      'lockfile',
      'lockfile',
      'lockfile',
      'lockfile',
    ]);
  });

  it('skips binaries by extension even when the bytes look like text', async () => {
    await tree({
      'logo.png': 'not really a png',
      'font.woff2': 'x',
      'a.ts': 'x',
    });

    const { paths, skipped } = await walk();

    expect(paths).toEqual(['a.ts']);
    expect(skipped).toEqual({ 'font.woff2': 'binary', 'logo.png': 'binary' });
  });

  it('skips binaries detected by content: NUL bytes or invalid UTF-8', async () => {
    await tree({
      'data.custom': Buffer.from([0x68, 0x69, 0x00, 0x01]),
      'latin1.txt': Buffer.from([0x63, 0x61, 0x66, 0xe9]), // "café" in Latin-1
      'utf8.txt': 'café ✓',
    });

    const { files, skipped } = await walk();

    expect(files.map((f) => [f.path, f.content])).toEqual([
      ['utf8.txt', 'café ✓'],
    ]);
    expect(skipped).toEqual({
      'data.custom': 'binary',
      'latin1.txt': 'binary',
    });
  });

  it('skips files over the size cap and keeps files exactly at it', async () => {
    await tree({
      'at-cap.ts': 'x'.repeat(100),
      'over-cap.ts': 'x'.repeat(101),
    });

    const { paths, skipped } = await walk(100);

    expect(paths).toEqual(['at-cap.ts']);
    expect(skipped).toEqual({ 'over-cap.ts': 'too-large' });
  });

  it('never follows symlinks', async () => {
    await tree({ 'real/a.ts': 'x' });
    try {
      await symlink(join(root, 'real'), join(root, 'link-dir'), 'junction');
    } catch {
      // Creating links can need extra privileges (e.g. on Windows): nothing to test.
      return;
    }

    const { paths, skipped } = await walk();

    expect(paths).toEqual(['real/a.ts']);
    expect(skipped).toEqual({ 'link-dir': 'symlink' });
  });
});
