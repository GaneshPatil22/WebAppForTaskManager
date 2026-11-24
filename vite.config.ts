/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { serviceWorkerSource, versionOf } from './src/pwa/swSource';

/** Files in public/ the app shell needs offline, besides the build output. */
const PUBLIC_SHELL = ['/manifest.webmanifest', '/favicon.svg', '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png', '/apple-touch-icon.png'];

/**
 * Emits sw.js from src/pwa/swSource.ts with the exact list of built files
 * to precache, and a version that changes whenever any of them does. No
 * plugin dependency: the list is the bundle, nothing is guessed.
 */
function brainServiceWorker(): Plugin {
  return {
    name: 'brain-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      // The mock server is only ever loaded in mock mode, so it is not precached.
      const built = Object.keys(bundle).filter((f) => !f.endsWith('.map') && f !== 'index.html' && !/(^|\/)mockClient-/.test(f)).map((f) => `/${f}`);
      const precache = ['/', ...built, ...PUBLIC_SHELL];
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: serviceWorkerSource(versionOf(precache), precache) });
    },
  };
}

export default defineConfig({
  plugins: [react(), brainServiceWorker()],
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
