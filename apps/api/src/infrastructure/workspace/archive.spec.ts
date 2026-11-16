import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ZipFile } from 'yazl';
import { extractZip, stageUpload, uploadFileName } from './archive';
import { InvalidSourceError } from './source-errors';

let work: string;

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), 'cda-archive-test-'));
});

afterEach(async () => {
  await rm(work, { recursive: true, force: true });
});

/** Builds a zip in memory from { name: content }. */
function zipOf(entries: Record<string, string>): Promise<Buffer> {
  const zip = new ZipFile();
  for (const [name, content] of Object.entries(entries)) {
    zip.addBuffer(Buffer.from(content), name);
  }
  zip.end();
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    zip.outputStream.on('data', (c: Buffer) => chunks.push(c));
    zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
    zip.outputStream.on('error', reject);
  });
}

async function stageAndExtract(
  bytes: Buffer,
  limits?: Parameters<typeof extractZip>[2],
) {
  const staged = await stageUpload(bytes, 'repo.zip', join(work, 'staging'));
  const dest = join(work, 'out');
  await extractZip(staged.archivePath, dest, limits);
  return dest;
}

describe('uploadFileName', () => {
  it('drops Windows and POSIX directories whatever the server runs on', () => {
    expect(uploadFileName(String.raw`C:\Users\me\repo.zip`)).toBe('repo.zip');
    expect(uploadFileName('/home/me/repo.zip')).toBe('repo.zip');
    expect(uploadFileName('repo.zip')).toBe('repo.zip');
    expect(uploadFileName(String.raw`C:\fakepath\ `)).toBe('upload.zip');
    expect(uploadFileName('')).toBe('upload.zip');
  });
});

describe('stageUpload', () => {
  it('stages a zip under a unique name and records its content hash', async () => {
    const bytes = await zipOf({ 'a.ts': 'x' });

    const first = await stageUpload(
      bytes,
      'C:\\Users\\me\\repo.zip',
      join(work, 's'),
    );
    const second = await stageUpload(bytes, 'repo.zip', join(work, 's'));

    expect(first.fileName).toBe('repo.zip');
    expect(first.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(second.contentHash).toBe(first.contentHash);
    expect(second.archivePath).not.toBe(first.archivePath);
    expect(await readFile(first.archivePath)).toEqual(bytes);
  });

  it('rejects files that are not zip archives', async () => {
    await expect(
      stageUpload(Buffer.from('hello'), 'notes.zip', work),
    ).rejects.toThrow(InvalidSourceError);
  });
});

describe('extractZip', () => {
  it('extracts files and nested directories', async () => {
    const dest = await stageAndExtract(
      await zipOf({
        'repo/src/index.ts': 'export {};',
        'repo/README.md': '# hi',
      }),
    );

    expect(await readFile(join(dest, 'repo/src/index.ts'), 'utf8')).toBe(
      'export {};',
    );
    expect(await readdir(join(dest, 'repo'))).toEqual(['README.md', 'src']);
  });

  it('rejects entries that escape the extraction directory (zip slip)', async () => {
    // yazl refuses "../" names, so build "aa/evil.txt" and patch both copies of the name.
    const honest = await zipOf({ 'aa/evil.txt': 'pwned' });
    const evil = Buffer.from(
      honest.toString('latin1').replaceAll('aa/evil.txt', '../evil.txt'),
      'latin1',
    );

    await expect(stageAndExtract(evil)).rejects.toThrow(InvalidSourceError);
    expect(existsSync(join(work, 'evil.txt'))).toBe(false);
  });

  it('rejects archives with too many entries', async () => {
    const bytes = await zipOf({ 'a.ts': '1', 'b.ts': '2', 'c.ts': '3' });

    await expect(
      stageAndExtract(bytes, { maxEntries: 2, maxTotalBytes: 1_000 }),
    ).rejects.toThrow(/3 entries; the limit is 2/);
  });

  it('rejects archives that expand past the size limit', async () => {
    const bytes = await zipOf({ 'big.txt': 'x'.repeat(5_000) });

    await expect(
      stageAndExtract(bytes, { maxEntries: 10, maxTotalBytes: 1_000 }),
    ).rejects.toThrow(/expands to more than 1000 bytes/);
  });

  it('rejects corrupt archives', async () => {
    const bytes = await zipOf({ 'a.ts': 'x' });
    const corrupt = bytes.subarray(0, bytes.length - 10); // truncated end record

    await expect(stageAndExtract(corrupt)).rejects.toThrow(InvalidSourceError);
  });
});
