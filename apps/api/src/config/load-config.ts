import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { envSchema, type AppConfig } from './env.schema';

export class ConfigValidationError extends Error {
  constructor(public readonly problems: string[]) {
    super(
      `Invalid environment configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}\n` +
        'Copy .env.example to .env at the repo root and fill in every variable.',
    );
    this.name = 'ConfigValidationError';
  }
}

/** Validates an environment object. Throws listing every missing or invalid variable. */
export function parseConfig(
  env: Record<string, string | undefined>,
): AppConfig {
  const result = envSchema.safeParse(env);
  if (result.success) return result.data;

  const problems = result.error.issues.map((issue) => {
    const name = issue.path.join('.');
    return env[name] === undefined || env[name] === ''
      ? `${name} is missing`
      : `${name} is invalid: ${issue.message}`;
  });
  throw new ConfigValidationError(problems);
}

/**
 * Loads the root `.env` (the API runs with cwd at either the repo root or apps/api),
 * then validates `process.env`. Variables already set in the environment win.
 */
export function loadConfig(): AppConfig {
  const candidates = [
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '../../.env'),
  ];
  const envFile = candidates.find((file) => existsSync(file));
  if (envFile) {
    // Not process.loadEnvFile(): it writes to the real process.env, which Jest
    // sandboxes away from test code. Copying keys works in both.
    const fileEnv = parseEnv(readFileSync(envFile, 'utf8'));
    for (const [key, value] of Object.entries(fileEnv)) {
      process.env[key] ??= value;
    }
  }
  return parseConfig(process.env);
}
