import type { DailySpend, QuestionAdmission, UsageGuard } from '@cda/domain';
import type { Redis } from 'ioredis';

export interface UsageLimits {
  /** Questions one session may ask per minute. */
  questionsPerMinute: number;
  /** Most USD of model calls per UTC day, across all sessions. */
  dailySpendCapUsd: number;
}

const WINDOW_SECONDS = 60;
/** Spend counters outlive their day a little, for inspection; then Redis drops them. */
const SPEND_TTL_SECONDS = 2 * 24 * 60 * 60;

const utcDay = (now: Date) => now.toISOString().slice(0, 10);

const nextUtcMidnight = (now: Date) =>
  new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  );

/**
 * Usage limits in Redis (ADR 0020), shared by every API process:
 * - questions per session: a fixed one-minute window, `INCR` + `EXPIRE` on
 *   `<prefix>rate:<sessionId>:<window>`;
 * - spend per UTC day: `INCRBYFLOAT` on `<prefix>spend:<YYYY-MM-DD>`.
 * The cap is checked before each model call, so the call that crosses it
 * completes and the next one is refused: spend can exceed the cap by at most
 * one call.
 */
export class RedisUsageGuard implements UsageGuard {
  constructor(
    private readonly redis: Redis,
    private readonly limits: UsageLimits,
    private readonly prefix = 'usage:',
    private readonly now: () => Date = () => new Date(),
  ) {}

  async admitQuestion(sessionId: string): Promise<QuestionAdmission> {
    const nowMs = this.now().getTime();
    const window = Math.floor(nowMs / 1000 / WINDOW_SECONDS);
    const key = `${this.prefix}rate:${sessionId}:${String(window)}`;
    const results = await this.redis
      .multi()
      .incr(key)
      .expire(key, WINDOW_SECONDS * 2)
      .exec();
    const count = Number(results?.[0]?.[1] ?? 0);
    if (count <= this.limits.questionsPerMinute) return { allowed: true };
    const windowEndMs = (window + 1) * WINDOW_SECONDS * 1000;
    return {
      allowed: false,
      limit: this.limits.questionsPerMinute,
      windowSeconds: WINDOW_SECONDS,
      retryAfterSeconds: Math.max(1, Math.ceil((windowEndMs - nowMs) / 1000)),
    };
  }

  async dailySpend(): Promise<DailySpend> {
    const now = this.now();
    const spent = await this.redis.get(this.spendKey(now));
    return {
      spentUsd: spent === null ? 0 : Number(spent),
      capUsd: this.limits.dailySpendCapUsd,
      resetsAt: nextUtcMidnight(now),
    };
  }

  async recordSpend(costUsd: number): Promise<void> {
    if (!(costUsd > 0)) return;
    const key = this.spendKey(this.now());
    await this.redis
      .multi()
      .incrbyfloat(key, costUsd)
      .expire(key, SPEND_TTL_SECONDS)
      .exec();
  }

  private spendKey(now: Date): string {
    return `${this.prefix}spend:${utcDay(now)}`;
  }
}
