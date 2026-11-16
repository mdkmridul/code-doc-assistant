import { Injectable } from '@nestjs/common';
import type {
  DailyUsage,
  SessionUsage,
  UsageMetricsReader,
  UsageSummary,
  UsageTotals,
} from '@cda/domain';
import { Prisma, type PrismaClient } from '../../generated/prisma/client';
import { PrismaService } from './prisma.service';

/** Aggregates as Postgres returns them: counts are bigint, sums numeric (Decimal). */
interface TotalsRow {
  calls: bigint;
  failed_calls: bigint;
  input_tokens: bigint | null;
  output_tokens: bigint | null;
  cost_usd: Prisma.Decimal | null;
  latency_ms_avg: number | null;
  latency_ms_p95: number | null;
}

const TOTALS = Prisma.sql`
  count(*) AS calls,
  count(*) FILTER (WHERE status = 'failed') AS failed_calls,
  sum(input_tokens) AS input_tokens,
  sum(output_tokens) AS output_tokens,
  sum(cost_usd) AS cost_usd,
  avg(latency_ms)::float8 AS latency_ms_avg,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)::float8 AS latency_ms_p95`;

const round = (value: number | null, digits: number) =>
  value === null ? null : Number(value.toFixed(digits));

function totals(row: TotalsRow): UsageTotals {
  return {
    calls: Number(row.calls),
    failedCalls: Number(row.failed_calls),
    inputTokens: Number(row.input_tokens ?? 0),
    outputTokens: Number(row.output_tokens ?? 0),
    costUsd: Number(row.cost_usd ?? 0),
    latencyMsAvg: round(row.latency_ms_avg, 1),
    latencyMsP95: round(row.latency_ms_p95, 1),
  };
}

/** `GET /metrics` data: totals, per UTC day and per session, from `llm_calls`. */
@Injectable()
export class PrismaUsageMetricsReader implements UsageMetricsReader {
  constructor(private readonly prisma: PrismaService | PrismaClient) {}

  async summarize({
    since,
    sessionLimit,
  }: {
    since: Date;
    sessionLimit: number;
  }): Promise<UsageSummary> {
    const [all, days, sessions] = await Promise.all([
      this.prisma.$queryRaw<TotalsRow[]>`
        SELECT ${TOTALS} FROM llm_calls WHERE created_at >= ${since}`,
      this.prisma.$queryRaw<(TotalsRow & { day: string })[]>`
        SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, ${TOTALS}
        FROM llm_calls WHERE created_at >= ${since}
        GROUP BY day ORDER BY day`,
      this.prisma.$queryRaw<
        (TotalsRow & {
          session_id: string | null;
          first_call_at: Date;
          last_call_at: Date;
        })[]
      >`
        SELECT session_id, min(created_at) AS first_call_at, max(created_at) AS last_call_at, ${TOTALS}
        FROM llm_calls WHERE created_at >= ${since}
        GROUP BY session_id ORDER BY last_call_at DESC
        LIMIT ${sessionLimit}::int`,
    ]);

    return {
      totals: totals(all[0]),
      perDay: days.map((row): DailyUsage => ({ day: row.day, ...totals(row) })),
      perSession: sessions.map((row): SessionUsage => ({
        sessionId: row.session_id,
        firstCallAt: row.first_call_at.toISOString(),
        lastCallAt: row.last_call_at.toISOString(),
        ...totals(row),
      })),
    };
  }
}
