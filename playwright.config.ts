import { defineConfig, devices } from '@playwright/test';

const PORT = 4321;

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  // One timing flake should not redden a whole run of 200+ browser tests. Local
  // runs keep 0 retries so a flake is visible while you work on it.
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // The Netlify adapter has no `astro preview` support, so tests run
    // against `astro dev`. It exercises the same code paths (prerendered
    // pages, JIT-compiled instead of built ahead of time).
    //
    // Run the suite with `npm test`, never `playwright test` on its own. Its
    // `pretest` builds and then starts the server, which matters twice over:
    // the Netlify dev emulation reads _redirects and netlify.toml header rules
    // from the publish dir (dist/), and it reads them once at startup, so a
    // server started before the build serves stale pages and skips the
    // redirect rules entirely. `posttest` then restores a clean dev server.
    //
    // Locally, `pretest` has already started the server, so reuse it: Astro
    // runs `astro dev` as a background daemon, and the foreground process
    // exiting immediately would otherwise read as "Process from
    // config.webServer exited early". In CI nothing is listening and `astro
    // dev` blocks in the foreground, so Playwright manages the server itself,
    // exactly as it did before.
    command: `PUBLIC_GTM_ID=GTM-TEST0000 astro dev --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
