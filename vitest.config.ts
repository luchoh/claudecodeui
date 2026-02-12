import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts', './tests/frontend/setup.ts'],
    testTimeout: 10000,
    hookTimeout: 10000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: [
        'server/middleware/**',
        'server/routes/**',
        'server/credentials/**',
        'src/utils/**',
        'src/hooks/**',
        'src/components/chat/**'
      ]
    },
    // Run test files sequentially to avoid state sharing issues with rate limiting
    // Each file runs in isolation
    fileParallelism: false,
    sequence: {
      shuffle: false
    },
    // Include test files
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx', 'tests/**/*.test.js', 'tests/**/*.test.jsx'],
    // Frontend tests use jsdom, server tests use node
    environmentMatchGlobs: [
      ['tests/frontend/**', 'jsdom']
    ]
  }
});
