import { test as base, devices, expect, type Browser, type Page } from "@playwright/test";
import { credentials, TIMEZONE, TODAY, target } from "./env";

// Every spec imports test and expect from here. Each test gets a fresh browser context (so empty
// IndexedDB) and, against the app this suite starts, a server emptied by POST /api/test/reset.
// Against APP_TEST_URL there is no reset: the @smoke tests are written to pass on a server
// that already holds data, including their own from an earlier run. Every run's browser clock
// starts at the same instant, so a re-run's edit to a shift is never newer than the earlier
// run's and loses last-write-wins; each smoke test therefore also adds an event (always new),
// and checks the second phone against what the first one shows rather than against a count.

export const test = base.extend<{ pinnedState: void }>({
  pinnedState: [
    async ({ page, request }, use) => {
      if (!target) {
        const res = await request.post("/api/test/reset");
        expect(res.status(), "POST /api/test/reset").toBe(204);
      }
      await pinClock(page);
      await use();
    },
    { auto: true },
  ],
});

export { expect };

/** Starts the page's clock at TODAY. Time keeps moving from there; timers are not frozen. */
async function pinClock(page: Page): Promise<void> {
  await page.clock.setSystemTime(TODAY);
}

/** Signs in through the login form and waits for the Calendar and its first sync. */
export async function signIn(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Username").fill(credentials.username);
  await page.getByLabel("Password").fill(credentials.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "December 2026" })).toBeVisible();
  await expect(syncPill(page)).toHaveText("Synced");
}

/**
 * A second phone: a new context on the same device, signed in, on the Calendar. Its IndexedDB
 * starts empty, so whatever it shows came from the server.
 */
export async function secondPhone(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ ...devices["Pixel 7"], timezoneId: TIMEZONE });
  const page = await context.newPage();
  await pinClock(page);
  await signIn(page);
  return page;
}

/** The Calendar's date cell for a day of December 2026, e.g. 14. */
export function decemberCell(page: Page, day: number) {
  return page.getByRole("button", { name: new RegExp(`^\\w+ ${day} December(,|$)`) });
}

/**
 * The sync indicator; its text is "Synced", "N pending", "Offline", … The "Sign in to sync."
 * banner is the Calendar's other status region.
 */
export function syncPill(page: Page) {
  return page.getByRole("status").filter({ hasNotText: "Sign in to sync." });
}
