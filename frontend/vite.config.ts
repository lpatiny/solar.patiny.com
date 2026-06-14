import { resolve } from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // The backend loads the repo-root .env (node --env-file=../.env). Read the same
  // PORT here so the dev API proxy always targets the backend's actual port. Vite
  // runs with the frontend dir as cwd, so the repo root is one level up. Falls
  // back to 60504 (the default) when PORT is unset.
  const env = loadEnv(mode, resolve(process.cwd(), '..'), '');
  const backendPort = env.PORT || '60504';

  return {
    plugins: [react()],
    // Force a single React instance in dev pre-bundling so Blueprint and the app
    // never get separate copies (avoids "Invalid hook call" / null dispatcher).
    resolve: {
      dedupe: ['react', 'react-dom'],
    },
    build: {
      target: 'esnext',
    },
    server: {
      proxy: {
        '/api': `http://localhost:${backendPort}`,
      },
    },
  };
});
