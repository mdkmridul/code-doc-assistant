import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import {
  REQUEST_ID_HEADER,
  requestIdFrom,
  runWithContext,
} from './request-context';

const logger = new Logger('Http');

/**
 * Gives every HTTP request an id (the client's `x-request-id` if it is a safe
 * token, else a UUID), echoes it in the response header, runs the rest of the
 * request inside that context, and logs one line when the response finishes.
 */
export function requestIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const requestId = requestIdFrom(req.headers[REQUEST_ID_HEADER]);
  const started = process.hrtime.bigint();
  res.setHeader(REQUEST_ID_HEADER, requestId);

  runWithContext({ requestId }, () => {
    res.on('finish', () => {
      logger.log({
        msg: 'request completed',
        method: req.method,
        path: req.originalUrl.split('?')[0],
        status: res.statusCode,
        durationMs: Number(process.hrtime.bigint() - started) / 1e6,
      });
    });
    next();
  });
}
