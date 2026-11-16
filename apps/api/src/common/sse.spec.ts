import { EventEmitter } from 'node:events';
import type { Response } from 'express';
import { formatSseEvent, openSse } from './sse';

/** Enough of an Express response to drive openSse. */
class FakeResponse extends EventEmitter {
  readonly headers: Record<string, string> = {};
  readonly written: string[] = [];
  statusCode = 0;
  ended = false;
  status(code: number) {
    this.statusCode = code;
    return this;
  }
  setHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  flushHeaders() {}
  write(chunk: string) {
    this.written.push(chunk);
    return true;
  }
  end() {
    this.ended = true;
    this.emit('close');
  }
}

const open = (res: FakeResponse, heartbeatMs?: number) =>
  openSse(res as unknown as Response, { heartbeatMs });

describe('formatSseEvent', () => {
  it('names the event by its type and sends the whole object as one data line', () => {
    expect(
      formatSseEvent({ type: 'token', text: 'a\nb' } as { type: string }),
    ).toBe('event: token\ndata: {"type":"token","text":"a\\nb"}\n\n');
  });
});

describe('openSse', () => {
  it('sends SSE headers and events', () => {
    const res = new FakeResponse();
    const sse = open(res);

    sse.send({ type: 'done' });
    sse.close();

    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toBe(
      'text/event-stream; charset=utf-8',
    );
    expect(res.headers['X-Accel-Buffering']).toBe('no');
    expect(res.written).toEqual(['event: done\ndata: {"type":"done"}\n\n']);
    expect(res.ended).toBe(true);
  });

  it('runs onClose listeners once when the client disconnects, and stops writing', () => {
    const res = new FakeResponse();
    const sse = open(res);
    const onClose = jest.fn();
    sse.onClose(onClose);

    res.emit('close'); // client went away
    sse.send({ type: 'token' });
    sse.close();

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(sse.closed).toBe(true);
    expect(res.written).toEqual([]);
    expect(res.ended).toBe(false); // nothing to end: the socket is gone
  });

  it('runs a listener registered after the close immediately', () => {
    const res = new FakeResponse();
    const sse = open(res);
    sse.close();
    const late = jest.fn();

    sse.onClose(late);

    expect(late).toHaveBeenCalledTimes(1);
  });

  it('writes heartbeat comments while open and stops after close', () => {
    jest.useFakeTimers();
    try {
      const res = new FakeResponse();
      const sse = open(res, 1_000);

      jest.advanceTimersByTime(2_500);
      sse.close();
      jest.advanceTimersByTime(5_000);

      expect(res.written).toEqual([': ping\n\n', ': ping\n\n']);
    } finally {
      jest.useRealTimers();
    }
  });
});
