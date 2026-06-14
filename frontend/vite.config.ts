import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
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
      '/api': 'http://localhost:3000',
    },
  },
});
