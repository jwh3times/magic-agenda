import { defineConfig } from 'vitest/config'

// Integration tests against a REAL local Supabase stack (`npm run test:rls:up`).
//
// Deliberately a separate project from vite.config.ts, whose suite is hermetic: that one injects
// dummy Supabase env precisely so a unit test can never reach a live database. These tests are
// the opposite -- they exist to exercise the real one -- so the two must never share a config.
export default defineConfig({
  test: {
    include: ['tests/rls/**/*.test.ts'],
    environment: 'node',
    globals: true,
    globalSetup: ['tests/rls/globalSetup.ts'],
    // One shared database. Parallel files would race on rows, users, and roles.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
