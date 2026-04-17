import { defineConfig, devices } from '@playwright/test'

// End-to-end configuration for visibility tests. The app is an Electron
// desktop player that depends on a live FTP/SFTP stream, so the e2e suite
// instead drives a standalone harness that reuses the real stylesheet and
// layout markup from the Player page.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    trace: 'retain-on-failure'
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ]
})
