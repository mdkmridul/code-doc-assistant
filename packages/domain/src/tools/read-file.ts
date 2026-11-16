import { z } from 'zod';
import type { Excerpt } from '../events';
import type { SourceFileReader } from '../ports/source-file-reader';
import { normalizePathPrefix } from './search-code';
import { sourceIdFor } from './source-id';
import type { CitableSource, Tool, ToolContext } from './tool';

/** Most lines one call returns; enough for most functions, small enough to stay cheap. */
export const READ_FILE_MAX_LINES = 200;

/**
 * Hard cap on the numbered content one call returns, whatever the line count:
 * long or minified lines can't make a read large. About 5,300 estimated tokens,
 * under the context budget's per-result cap, so a read is never cut there.
 */
export const READ_FILE_MAX_CHARS = 16_000;

/** Appended to a single line longer than the whole cap (minified code). */
const LINE_CUT_NOTE = ' … [line truncated]';

export const readFileInputSchema = z
  .object({
    path: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .describe('Repo-relative file path exactly as search_code returned it, e.g. "src/core/client.ts".'),
    startLine: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe('First line to read (1-based). Defaults to 1.'),
    endLine: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe(
        `Last line to read (inclusive). At most ${String(READ_FILE_MAX_LINES)} lines are returned per call.`,
      ),
  })
  .strict()
  .refine((input) => input.endLine === undefined || input.endLine >= (input.startLine ?? 1), {
    message: 'endLine must be greater than or equal to startLine',
    path: ['endLine'],
  });

export type ReadFileInput = z.infer<typeof readFileInputSchema>;

export interface ReadFileOutput {
  /** What a final answer cites for these lines. */
  sourceId: string;
  path: string;
  language: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  /** The lines, each prefixed with its number: "851| return data;". */
  content: string;
  /** Set when the requested range was cut at READ_FILE_MAX_LINES: where to continue. */
  nextStartLine?: number;
}

/** The model asked for something that does not exist; it reads the message and adjusts. */
export class ReadFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReadFileError';
  }
}

function splitLines(content: string): string[] {
  const lines = content.split(/\r?\n/);
  // A trailing newline ends the last line; it does not start a new one.
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Reads exact lines of an indexed file, for when a search snippet is not enough. */
export class ReadFileTool implements Tool<ReadFileInput, ReadFileOutput> {
  readonly name = 'read_file';
  readonly description =
    'Read exact, numbered lines of a file in the current repository. Use it after search_code ' +
    'when a snippet is cut off or you need the surrounding code, such as the rest of a function ' +
    `or its callers. Returns up to ${String(READ_FILE_MAX_LINES)} lines and ` +
    `${String(READ_FILE_MAX_CHARS)} characters per call; if the range continues, nextStartLine ` +
    'tells you where to resume. Read only the lines you need.';
  readonly inputSchema = readFileInputSchema;

  constructor(private readonly files: SourceFileReader) {}

  async execute(input: ReadFileInput, context: ToolContext): Promise<ReadFileOutput> {
    const path = normalizePathPrefix(input.path);
    const file = await this.files.read(context.repoId, path);
    if (!file) {
      throw new ReadFileError(
        `File not found: ${path}. Use search_code to find the exact path of an indexed file.`,
      );
    }

    const lines = splitLines(file.content);
    const totalLines = lines.length;
    const startLine = input.startLine ?? 1;
    if (startLine > totalLines) {
      throw new ReadFileError(
        `${path} has ${String(totalLines)} lines; startLine ${String(startLine)} is past the end.`,
      );
    }

    const requestedEnd = Math.min(input.endLine ?? totalLines, totalLines);
    const lastAllowed = Math.min(requestedEnd, startLine + READ_FILE_MAX_LINES - 1);

    // Whole lines up to the character cap; a first line longer than the cap is cut.
    const numbered: string[] = [];
    let chars = 0;
    for (let n = startLine; n <= lastAllowed; n++) {
      let line = `${String(n)}| ${lines[n - 1]}`;
      const cost = line.length + (numbered.length > 0 ? 1 : 0); // + the joining newline
      if (chars + cost > READ_FILE_MAX_CHARS) {
        if (numbered.length > 0) break;
        line = line.slice(0, READ_FILE_MAX_CHARS - LINE_CUT_NOTE.length) + LINE_CUT_NOTE;
      }
      numbered.push(line);
      chars += cost;
    }
    const endLine = startLine + numbered.length - 1;
    const content = numbered.join('\n');

    return {
      sourceId: sourceIdFor('read', `${path}:${String(startLine)}-${String(endLine)}`),
      path,
      language: file.language,
      startLine,
      endLine,
      totalLines,
      content,
      ...(endLine < requestedEnd && { nextStartLine: endLine + 1 }),
    };
  }

  summarize(output: ReadFileOutput): string {
    return `${output.path}:${String(output.startLine)}-${String(output.endLine)} of ${String(output.totalLines)} lines`;
  }

  excerpts(output: ReadFileOutput): Excerpt[] {
    // The model saw numbered lines; the panel (and eval judges) get the code itself,
    // all of it: READ_FILE_MAX_CHARS already bounds its size.
    const text = output.content.replace(/^\d+\| /gm, '');
    return [
      {
        path: output.path,
        startLine: output.startLine,
        endLine: output.endLine,
        text,
        source: 'read',
      },
    ];
  }

  citations(output: ReadFileOutput): CitableSource[] {
    return [
      { id: output.sourceId, path: output.path, startLine: output.startLine, endLine: output.endLine },
    ];
  }
}
