import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    // Provide the required env vars so config/env.ts passes zod validation in tests.
    // Individual test files mock db/client with an in-memory DB as needed.
    env: {
      DISCORD_TOKEN: 'test-token-placeholder',
      DISCORD_CLIENT_ID: '000000000000000000',
      DATABASE_PATH: ':memory:',
      NODE_ENV: 'development',
    },
  },
});
