import { describe, expect, it } from 'vitest';
import type { SourceFileReader } from '../ports/source-file-reader';
import type { SourceFile } from '../source-file';
import { READ_FILE_MAX_LINES, ReadFileError, ReadFileTool } from './read-file';
import { invokeTool, ToolInputError } from './tool';

class FakeFiles implements SourceFileReader {
  readonly reads: { repoId: string; path: string }[] = [];
  constructor(private readonly files: Partial<Record<string, string>>) {}

  read(repoId: string, path: string): Promise<SourceFile | null> {
    this.reads.push({ repoId, path });
    const content = this.files[path];
    return Promise.resolve(
      content === undefined ? null : { path, language: 'typescript', content },
    );
  }
}

const numbered = (n: number) =>
  Array.from({ length: n }, (_, i) => `line ${String(i + 1)}`).join('\n') + '\n';

const setup = (files: Record<string, string> = { 'src/a.ts': numbered(10) }) => {
  const reader = new FakeFiles(files);
  return { reader, tool: new ReadFileTool(reader) };
};

const context = { repoId: 'repo-1' };

describe('ReadFileTool', () => {
  it('reads the whole file with numbered lines from the context repo', async () => {
    const { tool, reader } = setup({ 'src/a.ts': 'const a = 1;\nconst b = 2;\n' });

    const output = await invokeTool(tool, { path: 'src/a.ts' }, context);

    expect(output).toEqual({
      path: 'src/a.ts',
      language: 'typescript',
      startLine: 1,
      endLine: 2,
      totalLines: 2,
      content: '1| const a = 1;\n2| const b = 2;',
    });
    expect(reader.reads).toEqual([{ repoId: 'repo-1', path: 'src/a.ts' }]);
  });

  it('reads an exact range', async () => {
    const { tool } = setup();

    const output = await invokeTool(tool, { path: 'src/a.ts', startLine: 4, endLine: 6 }, context);

    expect(output).toMatchObject({ startLine: 4, endLine: 6, totalLines: 10 });
    expect(output.content).toBe('4| line 4\n5| line 5\n6| line 6');
    expect(output.nextStartLine).toBeUndefined();
  });

  it('clamps an endLine past the end of the file', async () => {
    const { tool } = setup();
    const output = await invokeTool(tool, { path: 'src/a.ts', startLine: 9, endLine: 500 }, context);
    expect(output).toMatchObject({ startLine: 9, endLine: 10 });
    expect(output.nextStartLine).toBeUndefined();
  });

  it(`returns at most ${String(READ_FILE_MAX_LINES)} lines and says where to continue`, async () => {
    const { tool } = setup({ 'big.ts': numbered(450) });

    const first = await invokeTool(tool, { path: 'big.ts' }, context);
    const second = await invokeTool(tool, { path: 'big.ts', startLine: 201, endLine: 260 }, context);

    expect(first).toMatchObject({ startLine: 1, endLine: 200, totalLines: 450, nextStartLine: 201 });
    expect(first.content.split('\n')).toHaveLength(200);
    expect(second).toMatchObject({ startLine: 201, endLine: 260 });
    expect(second.nextStartLine).toBeUndefined();
  });

  it('normalises the path like search filters do', async () => {
    const { tool, reader } = setup();
    await invokeTool(tool, { path: './src\\a.ts' }, context);
    expect(reader.reads[0].path).toBe('src/a.ts');
  });

  it('explains a missing file so the model can recover', async () => {
    const { tool } = setup();
    await expect(invokeTool(tool, { path: 'src/nope.ts' }, context)).rejects.toThrow(ReadFileError);
    await expect(invokeTool(tool, { path: 'src/nope.ts' }, context)).rejects.toThrow(
      /File not found: src\/nope\.ts\. Use search_code/,
    );
  });

  it('explains a start line past the end of the file', async () => {
    const { tool } = setup();
    await expect(invokeTool(tool, { path: 'src/a.ts', startLine: 11 }, context)).rejects.toThrow(
      'src/a.ts has 10 lines; startLine 11 is past the end.',
    );
  });

  it.each([
    [{ path: '' }, /path/],
    [{ path: 'a.ts', startLine: 0 }, /startLine/],
    [{ path: 'a.ts', startLine: 5, endLine: 4 }, /endLine must be greater/],
    [{ path: 'a.ts', repoId: 'other' }, /repoId/],
  ])('rejects invalid input %j', async (input, message) => {
    const { tool, reader } = setup();
    const error = await invokeTool(tool, input, context).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ToolInputError);
    expect((error as Error).message).toMatch(message);
    expect(reader.reads).toEqual([]);
  });

  it('cites exactly the lines it returned', async () => {
    const { tool } = setup();
    const output = await invokeTool(tool, { path: 'src/a.ts', startLine: 3, endLine: 5 }, context);
    expect(tool.citations(output)).toEqual([{ path: 'src/a.ts', startLine: 3, endLine: 5 }]);
  });

  it('documents its input for the model', () => {
    const { tool } = setup();
    expect(tool.name).toBe('read_file');
    for (const field of ['path', 'startLine', 'endLine'] as const) {
      expect(tool.inputSchema.shape[field].description).toBeTruthy();
    }
  });
});
