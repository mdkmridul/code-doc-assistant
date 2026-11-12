import { describe, expect, it } from 'vitest';
import type { Chunk } from './index';

describe('Chunk', () => {
  it('is exported from the package entrypoint and describes a code chunk', () => {
    const chunk: Chunk = {
      id: 'chunk-1',
      repoId: 'repo-1',
      path: 'src/index.ts',
      language: 'typescript',
      symbol: null,
      kind: 'block',
      startLine: 1,
      endLine: 1,
      content: 'export * from "./chunk";',
      contentHash: 'abc123',
    };

    expect(chunk.endLine).toBeGreaterThanOrEqual(chunk.startLine);
  });
});
