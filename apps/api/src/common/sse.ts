import type { Response } from 'express';

/** One Server-Sent Event: the event name is the payload's `type`. */
export function formatSseEvent(event: { type: string }): string {
  // JSON.stringify never emits raw newlines, so one `data:` line is enough.
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

export interface SseStream {
  send<E extends { type: string }>(event: E): void;
  /** Ends the response. Safe to call more than once or after the client left. */
  close(): void;
  /** Runs once when the stream ends for any reason, including a client disconnect. */
  onClose(listener: () => void): void;
  readonly closed: boolean;
}

/**
 * Turns an Express response into an SSE stream. A comment line every
 * `heartbeatMs` keeps idle proxies from dropping the connection and makes a
 * dead client show up as a closed socket.
 */
export function openSse(
  res: Response,
  { heartbeatMs = 15_000 }: { heartbeatMs?: number } = {},
): SseStream {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  // Tell reverse proxies (nginx) not to buffer the stream.
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  let closed = false;
  const listeners: (() => void)[] = [];
  const heartbeat = setInterval(() => res.write(': ping\n\n'), heartbeatMs);

  const finish = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    for (const listener of listeners) listener();
  };
  // 'close' fires both when we end the response and when the client goes away.
  res.on('close', finish);

  return {
    send(event) {
      if (!closed) res.write(formatSseEvent(event));
    },
    close() {
      if (!closed) res.end();
      finish();
    },
    onClose(listener) {
      if (closed) listener();
      else listeners.push(listener);
    },
    get closed() {
      return closed;
    },
  };
}
