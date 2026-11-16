import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import {
  GetUsageMetrics,
  InvalidMetricsQueryError,
  type UsageMetrics,
} from '@cda/domain';
import { z } from 'zod';

const metricsQuery = z
  .object({
    days: z.coerce.number().optional(),
    sessions: z.coerce.number().optional(),
  })
  .strict();

@Controller('metrics')
export class MetricsController {
  constructor(private readonly getUsageMetrics: GetUsageMetrics) {}

  /**
   * `GET /metrics?days=7&sessions=50` → model calls, failed calls, tokens,
   * cost and latency (mean, p95): totals, per UTC day, and per session (most
   * recently active first). 400 for days outside 1-90 or sessions outside 1-200.
   */
  @Get()
  async metrics(@Query() query: unknown): Promise<UsageMetrics> {
    const parsed = metricsQuery.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      );
    }
    try {
      return await this.getUsageMetrics.execute(parsed.data);
    } catch (error) {
      if (error instanceof InvalidMetricsQueryError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }
}
