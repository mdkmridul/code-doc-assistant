import {
  ArgumentsHost,
  BadGatewayException,
  Catch,
  ConflictException,
  ExceptionFilter,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import Anthropic from '@anthropic-ai/sdk';
import {
  RepoNotFoundError,
  RepoNotReadyError,
  SessionNotFoundError,
} from '@cda/domain';

/**
 * Domain errors → HTTP. A failure of the model provider is a 502: the API is
 * fine, the upstream it depends on is not (after the SDK's own retries).
 */
@Catch(
  SessionNotFoundError,
  RepoNotFoundError,
  RepoNotReadyError,
  Anthropic.APIError,
)
export class ChatErrorFilter
  extends BaseExceptionFilter
  implements ExceptionFilter
{
  catch(error: Error, host: ArgumentsHost): void {
    super.catch(this.toHttp(error), host);
  }

  private toHttp(error: Error): HttpException {
    if (
      error instanceof SessionNotFoundError ||
      error instanceof RepoNotFoundError
    ) {
      return new NotFoundException(error.message);
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
