import { afterEach, describe, expect, it, vi } from 'vitest';
import { systemClock } from './retry';

afterEach(() => {
  vi.useRealTimers();
});

describe('systemClock', () => {
  it('sleeps for the given time and draws jitter from [0, 1)', async () => {
    vi.useFakeTimers();
    let woke = false;
    const sleeping = systemClock.sleep(1_000).then(() => {
      woke = true;
    });

    await vi.advanceTimersByTimeAsync(999);
    expect(woke).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await sleeping;
    expect(woke).toBe(true);

    const r = systemClock.random();
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThan(1);
  });
});
