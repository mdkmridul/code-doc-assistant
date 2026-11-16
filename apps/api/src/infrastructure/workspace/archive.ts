import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { RepoSource } from '@cda/domain';
import * as yauzl from 'yauzl';
import { InvalidSourceError } from './source-errors';

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export interface ExtractLimits {
  /** Most entries (files + directories) an archive may contain. */
  maxEntries: number;
  /** Most bytes all entries may expand to (zip-bomb guard). */
  maxTotalBytes: number;
}

export const DEFAULT_EXTRACT_LIMITS: ExtractLimits = {
  maxEntries: 20_000,
  maxTotalBytes: 200 * 1024 * 1024,
};

/** Every zip starts with a local file header, or is an empty archive's end record. */
const isZip = (bytes: Buffer) =>
  bytes.length >= 4 &&
  bytes[0] === 0x50 &&
  bytes[1] === 0x4b &&
  ((bytes[2] === 0x03 && bytes[3] === 0x04) ||
    (bytes[2] === 0x05 && bytes[3] === 0x06));

/**
 * Validates an uploaded zip and writes it to a staging directory for the
 * ingest job. The staged name is unique per upload, so deleting it can never
 * affect another request's job.
 */
export async function stageUpload(
  bytes: Buffer,
  originalName: string,
  stagingDir = join(tmpdir(), 'cda-uploads'),
): Promise<Extract<RepoSource, { type: 'local' }>> {
  if (!isZip(bytes)) {
    throw new InvalidSourceError('The uploaded file must be a .zip archive');
  }
  const contentHash = createHash('sha256').update(bytes).digest('hex');
  await mkdir(stagingDir, { recursive: true });
  const archivePath = join(stagingDir, `${contentHash}-${randomUUID()}.zip`);
  await writeFile(archivePath, bytes);
  return {
    type: 'local',
    fileName: basename(originalName) || 'upload.zip',
    contentHash,
    archivePath,
  };
}

/** Resolves an entry path inside `root`, rejecting anything that escapes it (zip slip). */
function safeTarget(root: string, entryName: string): string {
  const name = entryName.replace(/\\/g, '/');
  const target = resolve(root, name);
  if (name.includes('\0') || !target.startsWith(resolve(root) + sep)) {
    throw new InvalidSourceError(
      `Archive entry escapes the extraction directory: ${entryName}`,
    );
  }
  return target;
}

const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;
/** Unix mode bits live in the high 16 bits of the external attributes. */
const isSymlink = (entry: yauzl.Entry) =>
  ((entry.externalFileAttributes >>> 16) & S_IFMT) === S_IFLNK;

const openZip = (path: string) =>
  new Promise<yauzl.ZipFile>((done, fail) => {
    yauzl.open(
      path,
      // validateEntrySizes: abort if an entry inflates past its declared size.
      { lazyEntries: true, autoClose: true, validateEntrySizes: true },
      (error, zip) => (error ? fail(error) : done(zip)),
    );
  });

const openEntry = (zip: yauzl.ZipFile, entry: yauzl.Entry) =>
  new Promise<Readable>((done, fail) => {
    zip.openReadStream(entry, (error, stream) =>
      error ? fail(error) : done(stream),
    );
  });

/**
 * Extracts a zip into `destDir`, refusing path traversal, symlinks and
 * archives over the entry-count or expanded-size limits.
 */
export async function extractZip(
  archivePath: string,
  destDir: string,
  limits: ExtractLimits = DEFAULT_EXTRACT_LIMITS,
): Promise<void> {
  let zip: yauzl.ZipFile;
  try {
    zip = await openZip(archivePath);
  } catch (error) {
    throw new InvalidSourceError(
      `Could not read the zip archive: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (zip.entryCount > limits.maxEntries) {
    zip.close();
    throw new InvalidSourceError(
      `The archive has ${zip.entryCount} entries; the limit is ${limits.maxEntries}`,
    );
  }

  let totalBytes = 0;
  const extractEntry = async (entry: yauzl.Entry) => {
    const target = safeTarget(destDir, entry.fileName);
    if (entry.fileName.endsWith('/')) {
      await mkdir(target, { recursive: true });
      return;
    }
    // A symlink entry could point anywhere on disk; its target text is not source.
    if (isSymlink(entry)) return;

    totalBytes += entry.uncompressedSize;
    if (totalBytes > limits.maxTotalBytes) {
      throw new InvalidSourceError(
        `The archive expands to more than ${limits.maxTotalBytes} bytes`,
      );
    }
    await mkdir(dirname(target), { recursive: true });
    // 'wx': fail rather than overwrite if two entries share a name.
    await pipeline(
      await openEntry(zip, entry),
      createWriteStream(target, { flags: 'wx' }),
    );
  };

  await new Promise<void>((done, fail) => {
    const abort = (error: unknown) => {
      zip.close();
      fail(
        error instanceof InvalidSourceError
          ? error
          : new InvalidSourceError(
              `Could not extract the zip archive: ${error instanceof Error ? error.message : String(error)}`,
            ),
      );
    };
    zip.on('error', abort);
    zip.on('end', () => done());
    zip.on('entry', (entry: yauzl.Entry) => {
      extractEntry(entry).then(() => zip.readEntry(), abort);
    });
    zip.readEntry();
  });
}
