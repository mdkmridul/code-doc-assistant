import { Injectable } from '@nestjs/common';
import type { LlmCallLog, LlmCallRecord } from '@cda/domain';
import { PrismaService } from './prisma.service';

@Injectable()
export class PrismaLlmCallLog implements LlmCallLog {
  constructor(private readonly prisma: PrismaService) {}

  async record(call: LlmCallRecord): Promise<void> {
    await this.prisma.llmCall.create({
      data: {
        sessionId: call.sessionId,
        purpose: call.purpose,
        model: call.model,
        promptVersion: call.promptVersion,
        inputTokens: call.inputTokens,
        outputTokens: call.outputTokens,
        // Decimal(12, 6): pass a fixed-point string, never a float.
        costUsd: call.costUsd.toFixed(6),
        latencyMs: Math.round(call.latencyMs),
        status: call.status,
      },
    });
  }
}
