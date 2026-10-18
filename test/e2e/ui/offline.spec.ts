import { decemberCell, expect, secondPhone, signIn, syncPill, test } from "../fixtures/test";

// 15 Dec 2026 is this smoke test's own date. The edit also adds an event, so it is a change even
// on a server that already has Early there from an earlier run.
test("keeps an offline edit in the outbox, then sends it once online @smoke", async ({ page, context, browser }) => {
  await signIn(page);
  // The service worker activates without claiming open pages, so the first page it controls is
  // the next one loaded: wait until it is active (its precache filled), then reload.
  await expect
    .poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.state))
    .toBe("activated");

  // Offline, the reload comes from the service worker's precache.
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "December 2026" })).toBeVisible();
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

  await decemberCell(page, 15).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("radio", { name: "E, Early" }).click();
  await sheet.getByRole("textbox", { name: "Add an event" }).fill("Car service");
  await sheet.getByRole("button", { name: "Save" }).click();
  const cell = decemberCell(page, 15);
  await expect(cell).toHaveAccessibleName(/^\w+ 15 December, Early, (no babysitter, )?\d+ events?$/);
  await expect(syncPill(page)).toHaveText("Offline");

  await context.setOffline(false);
  await expect(syncPill(page)).toHaveText("Synced");
  const shown = (await cell.getAttribute("aria-label"))!;

  const other = await secondPhone(browser);
  await expect(decemberCell(other, 15)).toHaveAccessibleName(shown);
  await expect(decemberCell(other, 15)).toContainText("E");
  await other.context().close();
});
