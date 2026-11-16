import { PrismaPg } from '@prisma/adapter-pg';
import { z } from 'zod';
import { loadEnvFile } from '../src/config/load-config';
import { PrismaClient } from '../src/generated/prisma/client';

/**
 * Integration tests run against this database on the Compose Postgres, never
 * against the dev database in DATABASE_URL.
 */
export const TEST_DATABASE = 'cda_test';

/** DATABASE_URL from the root .env, the only variable these tests need. */
export function devDatabaseUrl(): string {
  loadEnvFile();
  return z.url({ protocol: /^postgres(ql)?$/ }).parse(process.env.DATABASE_URL);
}

/** DATABASE_URL with the database name swapped for the test database. */
export function testDatabaseUrl(): string {
  const url = new URL(devDatabaseUrl());
  url.pathname = `/${TEST_DATABASE}`;
  return url.href;
}

export function testPrismaClient(url = testDatabaseUrl()): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}
