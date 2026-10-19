import { decemberCell, expect, secondPhone, signIn, syncPill, test } from "../fixtures/test";

// 14 Dec 2026 is this smoke test's own date. On a server that already has it from an earlier
// run, the shift and babysitter are unchanged and the event is one more of the same.
test("saves a date's shift, babysitter and event, and a second phone sees them @smoke", async ({ page, browser }) => {
  await signIn(page);

  await decemberCell(page, 14).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("radio", { name: "N, Night" }).click();
  await sheet.getByRole("radio", { name: "Someone else" }).click();
  await sheet.getByRole("textbox", { name: "Name" }).fill("Mum");
  await sheet.getByRole("textbox", { name: "Add a note or event" }).fill("Dentist 3pm");
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet).toBeHidden();

  const cell = decemberCell(page, 14);
  await expect(cell).toHaveAccessibleName(/^\w+ 14 December, Night, babysitter Mum, (tentative|confirmed), \d+ events?$/);
  await expect(cell).toContainText("N");
  await expect(syncPill(page)).toHaveText("Synced");
  const shown = (await cell.getAttribute("aria-label"))!;

  const other = await secondPhone(browser);
  const otherCell = decemberCell(other, 14);
  await expect(otherCell).toHaveAccessibleName(shown);
  await expect(otherCell).toContainText("N");
  await otherCell.click();
  const otherSheet = other.getByRole("dialog");
  await expect(otherSheet.getByRole("radio", { name: "Mum" })).toBeChecked();
  // Every event on this date is this test's "Dentist 3pm".
  await expect(otherSheet.getByRole("textbox", { name: "Event", exact: true }).first()).toHaveValue("Dentist 3pm");
  await other.context().close();
});

test("confirms a babysitter, and the date sheet still shows it confirmed after a reload", async ({ page }) => {
  await signIn(page);

  await decemberCell(page, 15).click();
  let sheet = page.getByRole("dialog");
  const confirmed = sheet.getByRole("switch", { name: "Confirmed" });
  await expect(confirmed).toBeHidden();
  await sheet.getByRole("radio", { name: "Someone else" }).click();
  await sheet.getByRole("textbox", { name: "Name" }).fill("Mum");
  await expect(confirmed).toHaveAttribute("aria-checked", "false");
  await confirmed.click();
  await expect(confirmed).toHaveAttribute("aria-checked", "true");
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet).toBeHidden();
  await expect(syncPill(page)).toHaveText("Synced");

  await page.reload();
  await decemberCell(page, 15).click();
  sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("radio", { name: "Mum" })).toBeChecked();
  await expect(sheet.getByRole("switch", { name: "Confirmed" })).toHaveAttribute("aria-checked", "true");
});
