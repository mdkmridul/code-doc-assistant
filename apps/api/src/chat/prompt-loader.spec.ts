import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadPrompt, loadPromptVersions } from './prompt-loader';
import { ANSWER_QUESTION_PROMPT } from './chat.constants';

describe('loadPrompt', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'cda-prompts-'));
    mkdirSync(join(root, 'prompts', 'demo'), { recursive: true });
    writeFileSync(join(root, 'prompts', 'demo', 'v1.md'), 'Hello {{name}}.\n');
    writeFileSync(join(root, 'prompts', 'demo', 'v2.md'), 'Hi {{name}}.\n');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('loads a version that has a changelog entry, with its id for llm_calls', () => {
    writeFileSync(
      join(root, 'prompts', 'demo', 'CHANGELOG.md'),
      '# demo\n\n## v1\n\n- First.\n',
    );

    const prompt = loadPrompt('demo', 'v1', [root]);

    expect(prompt.id).toBe('demo@v1');
    expect(prompt.render({ name: 'Ada' })).toBe('Hello Ada.');
  });

  it('refuses a version missing from the changelog, or a missing changelog', () => {
    expect(() => loadPrompt('demo', 'v1', [root])).toThrow(/no "## v1" entry/);
    writeFileSync(
      join(root, 'prompts', 'demo', 'CHANGELOG.md'),
      '## v1\n\n- First. Mentions v2 in passing.\n',
    );
    expect(() => loadPrompt('demo', 'v2', [root])).toThrow(/no "## v2" entry/);
  });

  it('lists every version with a changelog entry and a file', () => {
    writeFileSync(
      join(root, 'prompts', 'demo', 'CHANGELOG.md'),
      [
        '## v2',
        '- Second.',
        '## v1',
        '- First.',
        '## v9',
        '- Planned, no file yet.',
      ].join('\n'),
    );
    expect(loadPromptVersions('demo', [root]).map((p) => p.id)).toEqual([
      'demo@v2',
      'demo@v1',
    ]);
  });

  it('refuses a missing prompt file', () => {
    expect(() => loadPrompt('demo', 'v9', [root])).toThrow(/not found/);
  });

  it('loads the prompt the API uses from the repository', () => {
    const repoRoot = resolve(__dirname, '../../../..');
    const prompt = loadPrompt(
      ANSWER_QUESTION_PROMPT.name,
      ANSWER_QUESTION_PROMPT.version,
      [repoRoot],
    );
    expect(prompt.id).toBe(`answer-question@${ANSWER_QUESTION_PROMPT.version}`);
  });
});
