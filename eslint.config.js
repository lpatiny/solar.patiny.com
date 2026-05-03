import { defineConfig, globalIgnores } from 'eslint/config';
import react from 'eslint-config-cheminfo-react/base';
import cheminfo from 'eslint-config-cheminfo-typescript';
import globals from 'globals';

export default defineConfig([
  globalIgnores([
    '**/dist',
    '**/node_modules',
    'backend/coverage',
    'backend/vitest.config.ts',
  ]),
  cheminfo,
  {
    rules: {
      'new-cap': ['error', { capIsNew: false }],
    },
  },
  {
    files: ['backend/**'],
    languageOptions: {
      globals: {
        ...globals.nodeBuiltin,
      },
    },
  },
  {
    files: ['frontend/**'],
    extends: react,
  },
]);
