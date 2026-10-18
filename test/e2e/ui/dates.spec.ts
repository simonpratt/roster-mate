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
  await sheet.getByRole("textbox", { name: "Add an event" }).fill("Dentist 3pm");
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet).toBeHidden();

  const cell = decemberCell(page, 14);
  await expect(cell).toHaveAccessibleName(/^\w+ 14 December, Night, babysitter Mum, \d+ events?$/);
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
