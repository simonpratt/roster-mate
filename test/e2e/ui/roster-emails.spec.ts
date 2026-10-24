import { expect, signIn, test } from "../fixtures/test";

// The suite's server has email on (RESEND_API_KEY in playwright.config.ts) with Resend at a
// closed port. This spec never imports, so no roster email is sent.
test("adds a roster email recipient with a new babysitter, and still lists it after a reload", async ({ page }) => {
  await signIn(page);

  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Roster emails" }).click();
  await expect(page).toHaveURL(/\/emails$/);
  await expect(page.getByRole("heading", { level: 1, name: "Roster emails" })).toBeVisible();
  await expect(page.getByText("No one gets your roster yet.", { exact: false })).toBeVisible();

  await page.getByRole("button", { name: "Add recipient" }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("heading", { name: "Add recipient" })).toBeVisible();
  await sheet.getByRole("textbox", { name: "Email address" }).fill("nan@example.com");
  await sheet.getByRole("radio", { name: "Someone else" }).click();
  await sheet.getByRole("textbox", { name: "Name" }).fill("Nan");
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet).toBeHidden();

  const row = page.getByRole("button", { name: "nan@example.com, babysitter Nan" });
  await expect(row).toBeVisible();

  await page.reload();
  await expect(row).toBeVisible();
  await expect(row).toContainText("Babysitter: Nan");
});
