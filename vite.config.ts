/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // In http mode the app calls /v1 on its own origin; the dev server
    // forwards it to the local Brain server (`make run` in ../Server).
    proxy: { '/v1': 'http://127.0.0.1:8080' },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test-setup.ts'],
    restoreMocks: true,
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
