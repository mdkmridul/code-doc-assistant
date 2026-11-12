import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, env } from 'prisma/config';

// Prisma 7 does not load .env itself. Use the root .env, like the API does.
// The CLI runs with cwd at apps/api (npm -w api) or the repo root.
const envFile = [
  resolve(process.cwd(), '.env'),
  resolve(process.cwd(), '../../.env'),
].find((file) => existsSync(file));
if (envFile) process.loadEnvFile(envFile);

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
