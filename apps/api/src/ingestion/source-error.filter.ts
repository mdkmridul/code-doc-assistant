import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  UnprocessableEntityException,
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import {
  InvalidSourceError,
  SourceUnavailableError,
} from '../infrastructure/workspace/source-errors';

/** Maps source validation errors to HTTP: invalid → 400, unreachable → 422. */
@Catch(InvalidSourceError, SourceUnavailableError)
export class SourceErrorFilter
  extends BaseExceptionFilter
  implements ExceptionFilter
{
  catch(
    error: InvalidSourceError | SourceUnavailableError,
    host: ArgumentsHost,
  ): void {
    const http =
      error instanceof InvalidSourceError
        ? new BadRequestException(error.message)
        : new UnprocessableEntityException(error.message);
    super.catch(http, host);
  }
}
