import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 10000,
    hookTimeout: 10000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: [
        'server/middleware/**',
        'server/routes/**',
        'server/credentials/**'
      ]
    },
    // Run test files sequentially to avoid state sharing issues with rate limiting
    // Each file runs in isolation
    fileParallelism: false,
    sequence: {
      shuffle: false
    },
    // Include test files
    include: ['tests/**/*.test.ts']
  }
});
