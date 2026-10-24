import { defineConfig, devices } from "@playwright/test";
import { baseURL, dataDir, TIMEZONE, FAKE_ANTHROPIC_KEY, FAKE_ANTHROPIC_PORT, PORT, repoRoot, target } from "./fixtures/env";

// The browser suite, on a phone, against a production build: the Go binary with the web app
// embedded (so the service worker is the real one) and the shared fake Claude, with roster emails
// on. With APP_TEST_URL set it starts nothing and tests that URL instead; CI's smoke job aims the
// @smoke tests at the image that way. One server and one database, reset before each test, so
// tests run one at a time.

const fakeURL = `http://127.0.0.1:${FAKE_ANTHROPIC_PORT}`;

// Email is on, so the Roster emails screen is offered, with Resend at a port nothing listens on:
// no spec adds a recipient and then imports, so nothing is ever sent.
const closedResendURL = "http://127.0.0.1:18082";

export default defineConfig({
  forbidOnly: !!process.env.CI,
  workers: 1,
  fullyParallel: false,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL, timezoneId: TIMEZONE, trace: "retain-on-failure" },
  projects: [{ name: "ui", testDir: "./ui", use: { ...devices["Pixel 7"] } }],
  webServer: target
    ? undefined
    : [
        {
          name: "fake-anthropic",
          command: "go run ./apps/server/cmd/fake-anthropic",
          cwd: repoRoot,
          url: `${fakeURL}/health`,
          env: { FAKE_ANTHROPIC_ADDR: `127.0.0.1:${FAKE_ANTHROPIC_PORT}`, FAKE_ANTHROPIC_KEY },
          // A fresh module cache compiles the Anthropic SDK first, which takes minutes.
          timeout: 600_000,
          reuseExistingServer: false,
          gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
        },
        {
          name: "roster-mate",
          // Builds first, so the suite never runs against a stale web app or binary.
          command:
            "pnpm --filter ./apps/web build && go build -o bin/roster-mate ./apps/server/cmd/roster-mate" +
            ` && rm -rf '${dataDir}' && bin/roster-mate`,
          cwd: repoRoot,
          url: `http://127.0.0.1:${PORT}/api/health`,
          env: {
            APP_TEST_MODE: "1",
            PORT: String(PORT),
            DATA_DIR: dataDir,
            APP_USERNAME: "e2e",
            APP_PASSWORD: "e2e-password",
            ROSTER_NAME: "E2E",
            ANTHROPIC_API_KEY: FAKE_ANTHROPIC_KEY,
            ANTHROPIC_BASE_URL: fakeURL,
            RESEND_API_KEY: "re_e2e",
            EMAIL_FROM: "e2e@example.com",
            RESEND_BASE_URL: closedResendURL,
            TZ: TIMEZONE,
          },
          timeout: 600_000,
          reuseExistingServer: false,
          gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
        },
      ],
});
