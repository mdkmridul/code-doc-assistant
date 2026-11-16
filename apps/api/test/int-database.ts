import { PrismaPg } from '@prisma/adapter-pg';
import { loadConfig } from '../src/config/load-config';
import { PrismaClient } from '../src/generated/prisma/client';

/**
 * Integration tests run against this database on the Compose Postgres, never
 * against the dev database in DATABASE_URL.
 */
export const TEST_DATABASE = 'cda_test';

/** DATABASE_URL from the root .env with the database name swapped. */
export function testDatabaseUrl(): string {
  const url = new URL(loadConfig().DATABASE_URL);
  url.pathname = `/${TEST_DATABASE}`;
  return url.href;
}

export function testPrismaClient(url = testDatabaseUrl()): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}
