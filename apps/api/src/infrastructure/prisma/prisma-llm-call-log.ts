import { Injectable, Logger } from '@nestjs/common';
import type { LlmCallLog, LlmCallRecord } from '@cda/domain';
import { currentContext } from '../../common/request-context';
import { PrismaService } from './prisma.service';

/**
 * Every model call: one `llm_calls` row and one JSON log line, both with the
 * id of the HTTP request that caused it (ADR 0020).
 */
@Injectable()
export class PrismaLlmCallLog implements LlmCallLog {
  private readonly logger = new Logger('LlmCall');

  constructor(private readonly prisma: PrismaService) {}

  async record(call: LlmCallRecord): Promise<void> {
    const requestId = currentContext()?.requestId ?? null;
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
        requestId,
      },
    });
    const line = {
      msg: 'llm call',
      sessionId: call.sessionId,
      purpose: call.purpose,
      model: call.model,
      promptVersion: call.promptVersion,
      status: call.status,
      inputTokens: call.inputTokens,
      outputTokens: call.outputTokens,
      costUsd: call.costUsd,
      latencyMs: Math.round(call.latencyMs),
    };
    if (call.status === 'failed') this.logger.warn(line);
    else this.logger.log(line);
  }
}
