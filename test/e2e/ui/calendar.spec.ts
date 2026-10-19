import { expect, signIn, test } from "../fixtures/test";

// The Calendar scrolls through stacked months, from one month back with no end ahead
// (docs/ux-spec.md §5.3). It opens on December 2026, today's month.
test("scrolls through stacked months, one month back and more ahead, and Today scrolls back", async ({ page }) => {
  await signIn(page);
  const scroll = page.getByTestId("month-scroll");
  const bar = page.getByRole("heading", { level: 1 });

  // December's dates start at the top, with its title just above the view.
  await expect(page.getByRole("button", { name: /^Tuesday 1 December/ })).toBeInViewport();
  await expect(page.getByRole("button", { name: /^\w+ 7 December/ })).toHaveAttribute("aria-current", "date");
  const [cellHeight] = await page.getByRole("button", { name: /^\w+ 2 December/ }).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  expect(cellHeight).toBe(84);

  // Part of two months at once: the end of December and the start of January.
  await scroll.evaluate((el) => el.scrollBy(0, 420));
  await expect(page.getByRole("button", { name: /^\w+ 31 December/ })).toBeInViewport();
  await expect(page.getByRole("heading", { level: 2, name: "January 2027" })).toBeInViewport();

  // Down: later months keep arriving.
  for (let i = 0; i < 6; i++) await scroll.evaluate((el) => el.scrollBy(0, 1200));
  await expect(page.getByRole("region", { name: "May 2027" })).toBeAttached();
  await expect(bar).not.toHaveText("December 2026");

  // Up to the top: November is the first month, and nothing arrives above it.
  await scroll.evaluate((el) => el.scrollTo(0, 0));
  await expect(bar).toHaveText("November 2026");
  await expect(page.getByRole("region").first()).toHaveAccessibleName("November 2026");
  await expect(page.getByRole("region", { name: "October 2026" })).toHaveCount(0);

  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(bar).toHaveText("December 2026");
  await expect(page.getByRole("button", { name: /^Tuesday 1 December/ })).toBeInViewport();
});
