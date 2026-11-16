import {
  ArgumentsHost,
  BadGatewayException,
  BadRequestException,
  HttpStatus,
  Catch,
  ConflictException,
  ExceptionFilter,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import Anthropic from '@anthropic-ai/sdk';
import {
  DailySpendCapReachedError,
  RepoNotFoundError,
  RepoNotReadyError,
  SessionNotFoundError,
  SessionRateLimitedError,
  ToolInputError,
  UnknownPromptVersionError,
} from '@cda/domain';

/**
 * Domain errors → HTTP. A failure of the model provider is a 502: the API is
 * fine, the upstream it depends on is not (after the SDK's own retries).
 */
@Catch(
  SessionNotFoundError,
  RepoNotFoundError,
  RepoNotReadyError,
  UnknownPromptVersionError,
  ToolInputError,
  SessionRateLimitedError,
  DailySpendCapReachedError,
  Anthropic.APIError,
)
export class ChatErrorFilter
  extends BaseExceptionFilter
  implements ExceptionFilter
{
  catch(error: Error, host: ArgumentsHost): void {
    if (error instanceof SessionRateLimitedError) {
      host
        .switchToHttp()
        .getResponse<{ setHeader(name: string, value: string): void }>()
        .setHeader('Retry-After', String(error.retryAfterSeconds));
    }
    super.catch(this.toHttp(error), host);
  }

  private toHttp(error: Error): HttpException {
    // Usage limits (ADR 0020): 429 with the readable message the UI shows.
    if (
      error instanceof SessionRateLimitedError ||
      error instanceof DailySpendCapReachedError
    ) {
      return new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: error.name,
          message: error.message,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (
      error instanceof SessionNotFoundError ||
      error instanceof RepoNotFoundError
    ) {
      return new NotFoundException(error.message);
    }
    if (
      error instanceof UnknownPromptVersionError ||
      error instanceof ToolInputError
    ) {
      return new BadRequestException(error.message);
    }
    if (error instanceof RepoNotReadyError) {
      return new ConflictException(error.message);
    }
    const status: number | undefined =
      error instanceof Anthropic.APIError
        ? (error.status as number | undefined)
        : undefined;
    return new BadGatewayException(
      `The language model request failed${status ? ` (HTTP ${status})` : ''}: ${error.message}`,
    );
  }
}
