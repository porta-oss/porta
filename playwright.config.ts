import { defineConfig, devices } from '@playwright/test';

const sharedRuntimeEnv = {
  NODE_ENV: 'development',
  API_PORT: '3000',
  API_URL: 'http://localhost:3000',
  WEB_PORT: '5173',
  WEB_URL: 'http://localhost:5173',
  VITE_API_URL: 'http://localhost:3000',
  BETTER_AUTH_URL: 'http://localhost:3000',
  BETTER_AUTH_SECRET: '0123456789abcdef0123456789abcdef',
  DATABASE_URL: 'postgres://postgres:postgres@127.0.0.1:5432/founder_control_plane',
  REDIS_URL: 'redis://127.0.0.1:6379',
  MAGIC_LINK_SENDER_EMAIL: 'dev@founder-control-plane.local',
  AUTH_CONTEXT_TIMEOUT_MS: '4000',
  DATABASE_CONNECT_TIMEOUT_MS: '30000',
  DATABASE_POOL_MAX: '10'
};

export default defineConfig({
  testDir: './apps/web/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list']],
  outputDir: 'test-results/onboarding-e2e',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  webServer: [
    {
      command: 'bun run dev:api',
      url: 'http://localhost:3000/api/health',
      reuseExistingServer: true,
      timeout: 30_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        ...sharedRuntimeEnv
      }
    },
    {
      command: 'bun run dev:web',
      url: 'http://localhost:5173/auth/sign-in',
      reuseExistingServer: true,
      timeout: 30_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        ...sharedRuntimeEnv
      }
    }
  ],
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ]
});
