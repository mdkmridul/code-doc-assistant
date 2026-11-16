import { describe, expect, it } from 'vitest';
import { isTerminalStatus } from './events';

describe('isTerminalStatus', () => {
  it('ends the progress stream on ready and failed only', () => {
    expect(['queued', 'running', 'ready', 'failed'].map((s) => isTerminalStatus(s as never))).toEqual([
      false,
      false,
      true,
      true,
    ]);
  });
});
