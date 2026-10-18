import { credentials } from "../fixtures/env";
import { decemberCell, expect, signIn, test } from "../fixtures/test";

// The confirmation shows only when edits are pending (docs/ux-spec.md §10), so the test holds
// back one edit by failing its sync. The edit never reaches the server, so this needs no reset.
test("signs in, and signs out after confirming @smoke", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Username").fill(credentials.username);
  await page.getByLabel("Password").fill(`${credentials.password}-wrong`);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toHaveText("That username and password don’t match.");
  await expect(page).toHaveURL(/\/login$/);

  await signIn(page);

  await page.route("**/api/sync", (route) => route.abort());
  await decemberCell(page, 16).click();
  await page.getByRole("radio", { name: "L, Late" }).click();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(decemberCell(page, 16)).toHaveAccessibleName(/, Late/);

  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Sign out?" });
  await expect(dialog).toContainText("You have 1 pending edit.");
  await dialog.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);

  // The server forgot the session: opening the Calendar goes back to sign in.
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
});
