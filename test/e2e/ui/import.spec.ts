import { fileURLToPath } from "node:url";
import { decemberCell, expect, signIn, syncPill, test } from "../fixtures/test";

// The fake Claude answers every photo with its fixture: 5 shifts on 8–12 Dec 2026 coded D, E, N,
// X and SE. Not @smoke: against the image this would call the real Claude API.
const roster = fileURLToPath(new URL("../fixtures/files/roster.jpg", import.meta.url));

test("imports shifts from a roster photo after review", async ({ page }) => {
  await signIn(page);
  await page.getByRole("link", { name: "Import", exact: true }).click();
  await page.getByLabel("Choose from library").setInputFiles(roster);

  const rows = page.getByRole("listitem");
  await expect(page.getByRole("heading", { name: "5 shifts found" })).toBeVisible();
  for (const date of ["Tue 8 Dec", "Wed 9 Dec", "Thu 10 Dec", "Fri 11 Dec", "Sat 12 Dec"]) {
    await expect(rows.filter({ hasText: date })).toHaveCount(1);
  }

  await rows.filter({ hasText: "Sat 12 Dec" }).getByRole("checkbox").uncheck();
  await page.getByRole("button", { name: "Save 4 shifts" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "December 2026" })).toBeVisible();
  for (const [day, code, label] of [
    [8, "D", "Day"],
    [9, "E", "Early"],
    [10, "N", "Night"],
    [11, "X", "Day off"],
  ] as const) {
    await expect(decemberCell(page, day)).toHaveAccessibleName(new RegExp(`, ${label}(,|$)`));
    await expect(decemberCell(page, day)).toContainText(code);
  }
  await expect(decemberCell(page, 12)).toHaveAccessibleName(/, no shift/);
  await expect(syncPill(page)).toHaveText("Synced");
});
