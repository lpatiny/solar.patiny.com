import { defineConfig, globalIgnores } from 'eslint/config';
import { globals } from 'eslint-config-zakodium';
import react from 'eslint-config-zakodium/react';
import ts from 'eslint-config-zakodium/ts';
import unicorn from 'eslint-config-zakodium/unicorn';

export default defineConfig(
  globalIgnores(['**/dist', '**/coverage', 'backend/vitest.config.ts']),
  ts,
  unicorn,
  {
    // TypeBox, Fastify and similar use uppercase non-constructor calls.
    rules: { 'new-cap': ['error', { capIsNew: false }] },
  },
  {
    files: ['backend/**'],
    languageOptions: { globals: { ...globals.nodeBuiltin } },
  },
  { files: ['frontend/**'], extends: [react] },
);
