import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    // Config and the Supabase/inference clients are module-level singletons, so
    // suites that set different env must not share a worker.
    pool: 'forks',
    restoreMocks: true,
  },
});
