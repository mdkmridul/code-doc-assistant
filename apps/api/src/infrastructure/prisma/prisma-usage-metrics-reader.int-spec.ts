/**
 * Runs the metrics SQL against the Compose Postgres (database `cda_test`).
 * Run with `npm run test:integration`.
 */
import { testPrismaClient } from '../../../test/int-database';
import type { PrismaClient } from '../../generated/prisma/client';
import { PrismaUsageMetricsReader } from './prisma-usage-metrics-reader';

const KEY = 'int-test:usage-metrics';
let prisma: PrismaClient;
let reader: PrismaUsageMetricsReader;

beforeAll(() => {
  prisma = testPrismaClient();
  reader = new PrismaUsageMetricsReader(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.llmCall.deleteMany({});
  await prisma.repo.deleteMany({ where: { ingestKey: { startsWith: KEY } } });
});

let next = 0;
async function session(): Promise<string> {
  const repo = await prisma.repo.create({
    data: {
      sourceType: 'local',
      localPath: '/int/m',
      ingestKey: `${KEY}:${String(next++)}`,
      status: 'ready',
    },
  });
  return (await prisma.chatSession.create({ data: { repoId: repo.id } })).id;
}

const call = (
  sessionId: string | null,
  createdAt: string,
  latencyMs: number,
  status: 'succeeded' | 'failed' = 'succeeded',
) => ({
  sessionId,
  purpose: 'answer_question',
  model: 'claude-opus-5-5',
  promptVersion: 'answer-question@v4',
  inputTokens: status === 'failed' ? 0 : 1000,
  outputTokens: status === 'failed' ? 0 : 100,
  costUsd: status === 'failed' ? '0' : '0.006000',
  latencyMs,
  status,
  createdAt: new Date(createdAt),
});

describe('PrismaUsageMetricsReader', () => {
  it('sums calls, tokens, cost and latency overall, per UTC day and per session', async () => {
    const a = await session();
    const b = await session();
    await prisma.llmCall.createMany({
      data: [
        call(a, '2026-11-15T23:30:00Z', 1000),
        call(a, '2026-11-16T00:30:00Z', 2000),
        call(b, '2026-11-16T10:00:00Z', 3000),
        call(b, '2026-11-16T10:01:00Z', 500, 'failed'),
        call(null, '2026-11-16T11:00:00Z', 4000),
        call(a, '2026-11-01T00:00:00Z', 9999), // before the window
      ],
    });

    const summary = await reader.summarize({
      since: new Date('2026-11-15T00:00:00Z'),
      sessionLimit: 10,
    });

    expect(summary.totals).toEqual({
      calls: 5,
      failedCalls: 1,
      inputTokens: 4000,
      outputTokens: 400,
      costUsd: 0.024,
      latencyMsAvg: 2100,
      latencyMsP95: 3800,
    });
    expect(summary.perDay.map((d) => [d.day, d.calls, d.costUsd])).toEqual([
      ['2026-11-15', 1, 0.006],
      ['2026-11-16', 4, 0.018],
    ]);
    // Most recently active first; calls outside a session are grouped as null.
    expect(
      summary.perSession.map((s) => [s.sessionId, s.calls, s.failedCalls]),
    ).toEqual([
      [null, 1, 0],
      [b, 2, 1],
      [a, 2, 0],
    ]);
    expect(summary.perSession[2]).toMatchObject({
      firstCallAt: '2026-11-15T23:30:00.000Z',
      lastCallAt: '2026-11-16T00:30:00.000Z',
    });
  });

  it('limits the session list and reports an empty window as zeros', async () => {
    const a = await session();
    await prisma.llmCall.createMany({
      data: [
        call(a, '2026-11-16T10:00:00Z', 100),
        call(null, '2026-11-16T11:00:00Z', 100),
      ],
    });

    const limited = await reader.summarize({
      since: new Date('2026-11-16T00:00:00Z'),
      sessionLimit: 1,
    });
    expect(limited.perSession).toHaveLength(1);

    const empty = await reader.summarize({
      since: new Date('2030-01-01T00:00:00Z'),
      sessionLimit: 5,
    });
    expect(empty).toEqual({
      totals: {
        calls: 0,
        failedCalls: 0,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        latencyMsAvg: null,
        latencyMsP95: null,
      },
      perDay: [],
      perSession: [],
    });
  });
});
