import { defineConfig, devices } from '@playwright/test';

const e2ePort = Number(process.env.GEOSCORE_E2E_PORT || 4174);
const e2eBaseUrl = `http://127.0.0.1:${e2ePort}`;
const localChrome = process.env.PLAYWRIGHT_CHROME_PATH;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 7_500 },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 2,
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'line',
  use: {
    baseURL: e2eBaseUrl,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    ...(localChrome ? { launchOptions: { executablePath: localChrome } } : {}),
  },
  webServer: {
    command: 'node scripts/serve-frontend.mjs',
    env: { ...process.env, PORT: String(e2ePort) },
    url: e2eBaseUrl,
    reuseExistingServer: false,
    timeout: 15_000,
  },
  projects: [
    {
      name: 'desktop-en',
      use: { ...devices['Desktop Chrome'], locale: 'en-US' },
    },
    {
      name: 'desktop-zh',
      use: { ...devices['Desktop Chrome'], locale: 'zh-CN' },
    },
    {
      name: 'desktop-hant',
      use: { ...devices['Desktop Chrome'], locale: 'zh-TW' },
    },
    {
      name: 'mobile-en',
      use: { ...devices['Pixel 7'], locale: 'en-US' },
    },
    {
      name: 'mobile-zh',
      use: { ...devices['Pixel 7'], locale: 'zh-CN' },
    },
    {
      name: 'mobile-hant',
      use: { ...devices['Pixel 7'], locale: 'zh-TW' },
    },
  ],
});
