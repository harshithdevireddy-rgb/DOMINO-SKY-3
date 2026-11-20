import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

// Use a system Chrome when PLAYWRIGHT_CHROME is set (or the common Linux path exists);
// otherwise fall back to the browser installed by `npx playwright install chromium`.
const chrome = process.env.PLAYWRIGHT_CHROME ?? (existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined);
const PORT = Number(process.env.E2E_PORT ?? 5199);

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1600, height: 1000 },
    acceptDownloads: true,
    trace: 'retain-on-failure',
    launchOptions: { executablePath: chrome, args: ['--no-sandbox'] },
  },
  webServer: {
    command: `npx vite --port ${PORT} --host 127.0.0.1 --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
