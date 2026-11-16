import type { UsageMetricsReader, UsageSummary } from '../ports/usage-metrics-reader';

export const METRICS_MAX_DAYS = 90;
export const METRICS_MAX_SESSIONS = 200;

export interface UsageMetrics extends UsageSummary {
  /** First UTC day included, YYYY-MM-DD; the window runs to now. */
  from: string;
  days: number;
}

export class InvalidMetricsQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidMetricsQueryError';
  }
}

/**
 * Model calls, tokens, cost and latency per day and per session, over the
 * last `days` UTC days including today.
 */
export class GetUsageMetrics {
  constructor(
    private readonly reader: UsageMetricsReader,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute({ days = 7, sessions = 50 }: { days?: number; sessions?: number } = {}): Promise<UsageMetrics> {
    if (!Number.isInteger(days) || days < 1 || days > METRICS_MAX_DAYS) {
      throw new InvalidMetricsQueryError(`days must be a whole number from 1 to ${String(METRICS_MAX_DAYS)}`);
    }
    if (!Number.isInteger(sessions) || sessions < 1 || sessions > METRICS_MAX_SESSIONS) {
      throw new InvalidMetricsQueryError(
        `sessions must be a whole number from 1 to ${String(METRICS_MAX_SESSIONS)}`,
      );
    }
    const now = this.now();
    const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (days - 1)));
    const summary = await this.reader.summarize({ since, sessionLimit: sessions });
    return { from: since.toISOString().slice(0, 10), days, ...summary };
  }
}
