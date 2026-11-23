import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

// Uses the installed Google Chrome when there is one (no browser download
// on a Mac); otherwise Playwright's Chromium (`npx playwright install chromium`).
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 5299;

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    timezoneId: 'Asia/Kolkata',
    launchOptions: existsSync(chrome) ? { executablePath: chrome } : {},
  },
  webServer: {
    command: `npx vite --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    env: { VITE_API_MODE: 'mock' },
  },
});
