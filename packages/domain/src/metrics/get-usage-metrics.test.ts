import { describe, expect, it } from 'vitest';
import type { UsageMetricsReader, UsageSummary } from '../ports/usage-metrics-reader';
import { GetUsageMetrics, InvalidMetricsQueryError } from './get-usage-metrics';

const empty: UsageSummary = {
  totals: {
    calls: 0,
    failedCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    latencyMsAvg: null,
    latencyMsP95: null,
  },
  perDay: [],
  perSession: [],
};

class FakeReader implements UsageMetricsReader {
  readonly queries: { since: Date; sessionLimit: number }[] = [];
  summarize(query: { since: Date; sessionLimit: number }) {
    this.queries.push(query);
    return Promise.resolve(empty);
  }
}

const at = (iso: string) => () => new Date(iso);

describe('GetUsageMetrics', () => {
  it('covers the last N UTC days including today', async () => {
    const reader = new FakeReader();
    const metrics = await new GetUsageMetrics(reader, at('2026-11-16T20:30:00Z')).execute({ days: 7, sessions: 20 });

    expect(reader.queries).toEqual([{ since: new Date('2026-11-10T00:00:00Z'), sessionLimit: 20 }]);
    expect(metrics).toMatchObject({ from: '2026-11-10', days: 7, perDay: [], perSession: [] });
  });

  it('defaults to 7 days and 50 sessions, and today only for days=1', async () => {
    const reader = new FakeReader();
    const useCase = new GetUsageMetrics(reader, at('2026-11-16T00:00:01Z'));
    await useCase.execute();
    await useCase.execute({ days: 1 });
    expect(reader.queries.map((q) => [q.since.toISOString(), q.sessionLimit])).toEqual([
      ['2026-11-10T00:00:00.000Z', 50],
      ['2026-11-16T00:00:00.000Z', 50],
    ]);
  });

  it.each([{ days: 0 }, { days: 91 }, { days: 1.5 }, { sessions: 0 }, { sessions: 201 }])(
    'rejects %j',
    async (query) => {
      await expect(new GetUsageMetrics(new FakeReader()).execute(query)).rejects.toThrow(InvalidMetricsQueryError);
    },
  );
});
