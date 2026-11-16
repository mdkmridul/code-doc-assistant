import type { LoggerService, LogLevel } from '@nestjs/common';
import { currentContext } from './request-context';

type Level = 'error' | 'warn' | 'info' | 'debug' | 'verbose' | 'fatal';

/** Where lines go; stdout by default, replaceable in tests. */
export type LogSink = (line: string) => void;

const stdout: LogSink = (line) => {
  process.stdout.write(`${line}\n`);
};

/**
 * Nest's LoggerService writing one JSON object per line (ADR 0020):
 * `{"time", "level", "context", "msg", "requestId"?, "jobId"?, ...fields}`.
 * The request id and job id come from the async request context, so any
 * `new Logger(...)` call made while handling a request or a job carries them.
 *
 * Structured fields: log an object with a `msg` key, e.g.
 * `logger.log({ msg: 'llm call', model, costUsd })`. Errors keep their stack.
 */
export class JsonLogger implements LoggerService {
  constructor(private readonly sink: LogSink = stdout) {}

  log(message: unknown, ...optional: unknown[]): void {
    this.write('info', message, optional);
  }
  error(message: unknown, ...optional: unknown[]): void {
    this.write('error', message, optional);
  }
  warn(message: unknown, ...optional: unknown[]): void {
    this.write('warn', message, optional);
  }
  debug(message: unknown, ...optional: unknown[]): void {
    this.write('debug', message, optional);
  }
  verbose(message: unknown, ...optional: unknown[]): void {
    this.write('verbose', message, optional);
  }
  fatal(message: unknown, ...optional: unknown[]): void {
    this.write('fatal', message, optional);
  }
  setLogLevels?(levels: LogLevel[]): void {
    void levels; // every level is written; filter downstream if needed
  }

  private write(level: Level, message: unknown, optional: unknown[]): void {
    // Nest passes the context name last; error() may pass a stack before it.
    const args = [...optional];
    const context =
      typeof args.at(-1) === 'string' ? (args.pop() as string) : undefined;
    const stack =
      level === 'error' && typeof args[0] === 'string' ? args[0] : undefined;

    const request = currentContext();
    const entry: Record<string, unknown> = {
      time: new Date().toISOString(),
      level,
      ...(context !== undefined && { context }),
      ...(request && { requestId: request.requestId }),
      ...(request?.jobId !== undefined && { jobId: request.jobId }),
    };

    if (message instanceof Error) {
      entry.msg = message.message;
      entry.stack = message.stack;
    } else if (message !== null && typeof message === 'object') {
      Object.assign(entry, message);
    } else {
      entry.msg = String(message);
    }
    if (stack !== undefined) entry.stack = stack;

    this.sink(JSON.stringify(entry));
  }
}
