import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.ata/scripts',
  testMatch: '*.spec.ts',
  timeout: 60000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [
    ['list'],
    ['json', { outputFile: '.ata/results/results.json' }],
    ['html', { outputFolder: 'reports/html', open: 'on-failure' }],
  ],
  use: {
    screenshot: 'only-on-failure',
    video: 'off',
    trace: 'off',
    actionTimeout: 10000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
