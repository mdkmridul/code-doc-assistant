// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'eslint.config.mjs'] },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // The domain is pure: no framework, database, queue or app code (CLAUDE.md).
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@nestjs/*', '@prisma/*', 'prisma', 'pg', 'ioredis', 'redis', 'bullmq', 'express'],
              message: 'The domain package must not depend on infrastructure. Define a port instead.',
            },
            {
              group: ['**/apps/**', 'api', 'web'],
              message: 'The domain package must not import application code.',
            },
          ],
        },
      ],
    },
  },
);
