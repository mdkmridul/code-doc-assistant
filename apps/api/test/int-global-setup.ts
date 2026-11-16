import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import {
  devDatabaseUrl,
  TEST_DATABASE,
  testDatabaseUrl,
  testPrismaClient,
} from './int-database';

/**
 * Creates the `cda_test` database on the Compose Postgres if needed and applies
 * every migration to it. Requires `docker compose up -d`.
 */
export default async function globalSetup(): Promise<void> {
  const admin = testPrismaClient(devDatabaseUrl());
  try {
    const existing = await admin.$queryRaw<unknown[]>`
      SELECT 1 FROM pg_database WHERE datname = ${TEST_DATABASE}`;
    if (existing.length === 0) {
      await admin.$executeRawUnsafe(`CREATE DATABASE "${TEST_DATABASE}"`);
    }
    // On tiny test data the planner prefers exact search (filter the repo's
    // chunks, sort by distance), which can never miss results. Production
    // switches to the approximate HNSW scan once a repo is large; that is the
    // path where filtering can lose results. Disabling explicit sorts leaves
    // the HNSW index as the only way to get rows in distance order, so every
    // test here exercises it. Applies to new cda_test connections only.
    await admin.$executeRawUnsafe(
      `ALTER DATABASE "${TEST_DATABASE}" RESET enable_seqscan`,
    );
    await admin.$executeRawUnsafe(
      `ALTER DATABASE "${TEST_DATABASE}" SET enable_sort = off`,
    );
  } finally {
    await admin.$disconnect();
  }

  execSync('npx prisma migrate deploy', {
    cwd: resolve(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: testDatabaseUrl() },
    stdio: 'pipe',
  });
}
