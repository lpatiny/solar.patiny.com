import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  build: {
    target: 'esnext',
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
