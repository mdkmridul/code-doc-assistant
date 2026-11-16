/**
 * Runs the usage guard against the Compose Redis, under a key prefix of its
 * own. Run with `npm run test:integration`.
 */
import { Redis } from 'ioredis';
import { loadEnvFile } from '../../config/load-config';
import { RedisUsageGuard } from './redis-usage-guard';

const PREFIX = 'int-test:usage:';
let redis: Redis;

beforeAll(() => {
  loadEnvFile();
  redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
});

afterAll(async () => {
  await redis.quit();
});

beforeEach(async () => {
  const keys = await redis.keys(`${PREFIX}*`);
  if (keys.length > 0) await redis.del(...keys);
});

const at = (iso: string) => () => new Date(iso);

describe('RedisUsageGuard', () => {
  it('allows N questions per session per minute, then says how long to wait', async () => {
    const guard = new RedisUsageGuard(
      redis,
      { questionsPerMinute: 2, dailySpendCapUsd: 10 },
      PREFIX,
      at('2026-11-16T12:00:18.000Z'),
    );

    expect(await guard.admitQuestion('s1')).toEqual({ allowed: true });
    expect(await guard.admitQuestion('s1')).toEqual({ allowed: true });
    expect(await guard.admitQuestion('s1')).toEqual({
      allowed: false,
      limit: 2,
      windowSeconds: 60,
      retryAfterSeconds: 42,
    });
    // Other sessions have their own count.
    expect(await guard.admitQuestion('s2')).toEqual({ allowed: true });
  });

  it('starts a fresh count in the next minute', async () => {
    const limits = { questionsPerMinute: 1, dailySpendCapUsd: 10 };
    const first = new RedisUsageGuard(
      redis,
      limits,
      PREFIX,
      at('2026-11-16T12:00:59.000Z'),
    );
    const next = new RedisUsageGuard(
      redis,
      limits,
      PREFIX,
      at('2026-11-16T12:01:00.000Z'),
    );

    expect(await first.admitQuestion('s1')).toEqual({ allowed: true });
    expect((await first.admitQuestion('s1')).allowed).toBe(false);
    expect(await next.admitQuestion('s1')).toEqual({ allowed: true });
  });

  it('adds up spend per UTC day, with the cap and the next reset', async () => {
    const limits = { questionsPerMinute: 5, dailySpendCapUsd: 2.5 };
    const today = new RedisUsageGuard(
      redis,
      limits,
      PREFIX,
      at('2026-11-16T23:59:00.000Z'),
    );
    const tomorrow = new RedisUsageGuard(
      redis,
      limits,
      PREFIX,
      at('2026-11-17T00:00:01.000Z'),
    );

    expect(await today.dailySpend()).toEqual({
      spentUsd: 0,
      capUsd: 2.5,
      resetsAt: new Date('2026-11-17T00:00:00.000Z'),
    });
    await today.recordSpend(0.123456);
    await today.recordSpend(1);
    await today.recordSpend(0); // free calls (failed ones) add nothing

    expect((await today.dailySpend()).spentUsd).toBeCloseTo(1.123456, 6);
    expect((await tomorrow.dailySpend()).spentUsd).toBe(0);
    expect(await redis.ttl(`${PREFIX}spend:2026-11-16`)).toBeGreaterThan(0);
  });
});
