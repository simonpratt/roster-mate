import { decemberCell, expect, secondPhone, signIn, syncPill, test } from "../fixtures/test";

// History lists shift changes the server recorded, so a change saved on one phone shows on
// another once it syncs.
test("a shift saved in the date sheet shows in History on a second phone", async ({ page, browser }) => {
  await signIn(page);

  await decemberCell(page, 16).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("radio", { name: "L, Late" }).click();
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet).toBeHidden();
  await expect(syncPill(page)).toHaveText("Synced");

  const other = await secondPhone(browser);
  await other.getByRole("button", { name: "More" }).click();
  await other.getByRole("menuitem", { name: "History" }).click();
  await expect(other.getByRole("heading", { level: 1, name: "History" })).toBeVisible();
  // The browser clock starts on 7 December (TODAY in the fixtures), the edit's date.
  const group = other.getByRole("region", { name: /^Today · \d{1,2}:\d\d [ap]m$/ });
  await expect(group.getByText("Date sheet", { exact: true })).toBeVisible();
  const row = group.getByRole("button", { name: "Wednesday 16 December, not rostered to Late" });
  await expect(row).toBeVisible();

  await row.click();
  const otherSheet = other.getByRole("dialog");
  await expect(otherSheet.getByRole("heading", { name: "Wednesday 16 December" })).toBeVisible();
  await otherSheet.getByRole("button", { name: "Cancel" }).click();
  await expect(otherSheet).toBeHidden();
  await expect(row).toBeFocused();
  await other.context().close();
});
