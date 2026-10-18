import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Where the suite runs. With APP_TEST_URL set it tests that running app (a container, for the
// @smoke set) and starts nothing; otherwise playwright.config.ts builds and starts the app on
// PORT with the fake Claude on FAKE_ANTHROPIC_PORT.

/** A running app to test instead of starting one, e.g. http://localhost:8080. */
export const target = process.env.APP_TEST_URL || undefined;

export const PORT = 18080;
export const FAKE_ANTHROPIC_PORT = 18081;
/** The only API key the fake Claude accepts (cmd/fake-anthropic's default). */
export const FAKE_ANTHROPIC_KEY = "sk-ant-e2e";

export const baseURL = target ?? `http://127.0.0.1:${PORT}`;

/** The started app's data directory, emptied before each run. */
export const dataDir = join(tmpdir(), "roster-mate-e2e");

/** The repo root, where the webServer commands run. */
export const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

/** The account to sign in with: the started app's, or the container's from the environment. */
export const credentials = {
  username: process.env.APP_TEST_USERNAME || "e2e",
  password: process.env.APP_TEST_PASSWORD || "e2e-password",
};

/**
 * The time zone of the started server and of every browser, so a developer's own TZ (which may
 * be a POSIX string Go rejects) changes nothing.
 */
export const TIMEZONE = "Australia/Sydney";

/**
 * "Today" in every browser: Monday 7 December 2026, the week before the fake roster's 8–12 Dec,
 * so the Calendar opens on December 2026. Local time, as the app reads it.
 */
export const TODAY = new Date("2026-12-07T09:00:00");
