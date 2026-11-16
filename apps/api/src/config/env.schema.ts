import { z } from 'zod';

/**
 * Every environment variable the API reads.
 * Adding a variable here means adding it to the root `.env.example` too.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  API_PORT: z.coerce.number().int().min(1).max(65535),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  OLLAMA_URL: z.url({ protocol: /^https?$/ }),
  ANTHROPIC_API_KEY: z.string().trim().min(1),
  WEB_ORIGIN: z.url({ protocol: /^https?$/ }),
  ANTHROPIC_MODEL: z.string().trim().min(1),
  CHAT_MAX_ITERATIONS: z.coerce.number().int().min(1).max(50),
  CHAT_TOKEN_BUDGET: z.coerce.number().int().min(1_000),
});

export type AppConfig = z.infer<typeof envSchema>;
