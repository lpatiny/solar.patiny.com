import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Database.ts opens a single on-disk SQLite (WAL) file at module load, so
    // running test files in parallel forks (vitest 4 default) makes them race
    // for the write lock. Run files serially until the DB is moved to the lazy
    // dbFactory + getTempDB() pattern (see rules/database.md).
    fileParallelism: false,
    coverage: {
      include: ['src/**/*.ts'],
      provider: 'v8',
    },
    snapshotFormat: {
      maxOutputLength: Number.MAX_SAFE_INTEGER,
    },
  },
});
