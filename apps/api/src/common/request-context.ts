import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

/**
 * What every log line and LLM call of one unit of work shares: the HTTP
 * request's id, carried into the ingest job it queues (ADR 0020).
 */
export interface RequestContext {
  requestId: string;
  /** Set inside a queue worker: the BullMQ job being processed. */
  jobId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Runs `fn` with `context` visible to everything it awaits (logs, LLM call records). */
export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function currentContext(): RequestContext | undefined {
  return storage.getStore();
}

/** Header a client may send to choose the id (echoed back on every response). */
export const REQUEST_ID_HEADER = 'x-request-id';

/** Up to 128 characters of letters, digits, `.`, `_`, `-`: safe to log and echo. */
const VALID_ID = /^[\w.-]{1,128}$/;

/** The client's id when it is a safe token, otherwise a fresh UUID. */
export function requestIdFrom(header: unknown): string {
  return typeof header === 'string' && VALID_ID.test(header)
    ? header
    : randomUUID();
}
