import { JsonLogger } from './json-logger';
import { requestIdFrom, runWithContext } from './request-context';

const capture = () => {
  const lines: Record<string, unknown>[] = [];
  const logger = new JsonLogger((line) =>
    lines.push(JSON.parse(line) as Record<string, unknown>),
  );
  return { lines, logger };
};

describe('JsonLogger', () => {
  it('writes one JSON object per line with level, context and message', () => {
    const { lines, logger } = capture();

    logger.log('Connected to Redis 8', 'RedisService');

    expect(lines).toEqual([
      {
        time: expect.any(String) as string,
        level: 'info',
        context: 'RedisService',
        msg: 'Connected to Redis 8',
      },
    ]);
  });

  it('adds the request id and job id of the current context', async () => {
    const { lines, logger } = capture();

    await runWithContext({ requestId: 'req-1', jobId: 'job-9' }, async () => {
      await Promise.resolve();
      logger.warn('inside', 'Worker');
    });
    logger.log('outside', 'Worker');

    expect(lines[0]).toMatchObject({ requestId: 'req-1', jobId: 'job-9' });
    expect(lines[1]).not.toHaveProperty('requestId');
  });

  it('merges structured fields and keeps error stacks', () => {
    const { lines, logger } = capture();

    logger.log({ msg: 'llm call', model: 'm', costUsd: 0.01 }, 'LlmCalls');
    logger.error('boom', 'Error: boom\n    at x', 'Bootstrap');

    expect(lines[0]).toMatchObject({
      msg: 'llm call',
      model: 'm',
      costUsd: 0.01,
      context: 'LlmCalls',
    });
    expect(lines[1]).toMatchObject({
      level: 'error',
      msg: 'boom',
      stack: 'Error: boom\n    at x',
      context: 'Bootstrap',
    });
  });
});

describe('requestIdFrom', () => {
  it('keeps a safe client id and replaces anything else with a UUID', () => {
    expect(requestIdFrom('trace-123_a.b')).toBe('trace-123_a.b');
    expect(requestIdFrom('bad id\nwith newline')).toMatch(/^[0-9a-f-]{36}$/);
    expect(requestIdFrom(undefined)).toMatch(/^[0-9a-f-]{36}$/);
    expect(requestIdFrom(['a', 'b'])).toMatch(/^[0-9a-f-]{36}$/);
  });
});
