import { decemberCell, expect, signIn, syncPill, test } from "../fixtures/test";

test("confirms all of a babysitter's dates from the Babysitters screen, and the calendar shows them confirmed", async ({
  page,
}) => {
  await signIn(page);

  // Give 14 and 16 December to Mum, tentative.
  await decemberCell(page, 14).click();
  let sheet = page.getByRole("dialog");
  await sheet.getByRole("radio", { name: "L, Late" }).click();
  await sheet.getByRole("radio", { name: "Someone else" }).click();
  await sheet.getByRole("textbox", { name: "Name" }).fill("Mum");
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet).toBeHidden();

  await decemberCell(page, 16).click();
  sheet = page.getByRole("dialog");
  await sheet.getByRole("radio", { name: "N, Night" }).click();
  await sheet.getByRole("radio", { name: "Mum" }).click();
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet).toBeHidden();
  await expect(decemberCell(page, 16)).toHaveAccessibleName("Wednesday 16 December, Night, babysitter Mum, tentative");

  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Babysitters" }).click();
  await expect(page).toHaveURL(/\/babysitters$/);
  const mum = page.getByRole("region", { name: "Mum" });
  await expect(mum.getByText("2 to confirm")).toBeVisible();
  await mum.getByRole("button", { name: "Confirm all dates with Mum" }).click();

  await expect(mum.getByText("All confirmed")).toBeVisible();
  await expect(mum.getByRole("button", { name: /Confirm all/ })).toBeHidden();
  await expect(mum.getByRole("button", { name: "Monday 14 December, Late, babysitter Mum, confirmed" })).toContainText(
    "Confirmed",
  );
  await expect(
    mum.getByRole("button", { name: "Wednesday 16 December, Night, babysitter Mum, confirmed" }),
  ).toContainText("Confirmed");

  await page.getByRole("button", { name: "Back to calendar" }).click();
  await expect(syncPill(page)).toHaveText("Synced");
  for (const day of [14, 16]) {
    const cell = decemberCell(page, day);
    await expect(cell).toHaveAccessibleName(/babysitter Mum, confirmed$/);
    await expect(cell.getByTestId("babysitter-avatar")).toHaveAttribute("data-status", "confirmed");
    await expect(cell.getByTestId("babysitter-avatar")).toHaveText("M");
  }
});
