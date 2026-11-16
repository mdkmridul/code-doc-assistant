import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Test code, and files that are only types (ports, wire types) or re-exports.
      exclude: ['src/**/*.test.ts', 'src/**/*.test-helpers.ts', 'src/index.ts'],
      reporter: ['text-summary', 'text'],
      // `npm run test:coverage -w @cda/domain` (and CI) fails below these.
      // Set just under the current numbers: raise them as coverage grows.
      thresholds: {
        statements: 97,
        branches: 90,
        functions: 97,
        lines: 98,
      },
    },
  },
});
