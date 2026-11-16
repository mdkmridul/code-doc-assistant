import { Module } from '@nestjs/common';
import { GetUsageMetrics } from '@cda/domain';
import { PrismaModule } from '../infrastructure/prisma/prisma.module';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { PrismaUsageMetricsReader } from '../infrastructure/prisma/prisma-usage-metrics-reader';
import { MetricsController } from './metrics.controller';

/** GET /metrics: model-call usage from `llm_calls` (ADR 0020). */
@Module({
  imports: [PrismaModule],
  controllers: [MetricsController],
  providers: [
    {
      provide: GetUsageMetrics,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new GetUsageMetrics(new PrismaUsageMetricsReader(prisma)),
    },
  ],
})
export class MetricsModule {}
