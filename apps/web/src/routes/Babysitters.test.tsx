import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, type ShiftRow } from "../db";
import { renderApp, setOnline, stubFetch } from "../test-utils";

function seed(rows: Record<string, string>) {
  const shifts: ShiftRow[] = Object.entries(rows).map(([date, code]) => ({ date, code, editedAt: 1 }));
  return db.shifts.bulkPut(shifts);
}

/** Seeds babysitters by date: a name (tentative) or [name, confirmed]. */
function seedBabysitters(rows: Record<string, string | [string, boolean]>) {
  return db.babysitters.bulkPut(
    Object.entries(rows).map(([date, v]) => {
      const [name, confirmed] = typeof v === "string" ? [v, false] : v;
      return { date, name, confirmed, editedAt: 1 };
    }),
  );
}

/** Opens /babysitters offline, so pending edits stay in the outbox. */
async function open() {
  renderApp("/babysitters");
  expect(await screen.findByRole("heading", { level: 1, name: "Babysitters" })).toBeInTheDocument();
}

const section = (name: string) => screen.findByRole("region", { name });
const rowNames = (el: HTMLElement) =>
  within(el)
    .getAllByRole("button")
    .filter((b) => b.hasAttribute("data-date"))
    .map((b) => b.getAttribute("aria-label"));

beforeEach(() => {
  // Sunday 15 November 2026, 9 am local time; only Date is faked.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 15, 9, 0));
  setOnline(false);
  stubFetch({});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Babysitters screen", () => {
  it("lists each babysitter's dates from today on, A–Z and by date, with their status", async () => {
    await seed({ "2026-11-10": "D", "2026-11-15": "E", "2026-11-17": "L", "2026-11-20": "N", "2026-11-22": "X" });
    await seedBabysitters({
      "2026-11-10": "Mum", // past: left out
      "2026-11-20": "mum",
      "2026-11-15": ["Mum", true],
      "2026-11-17": ["Dad", true],
      "2026-11-22": "Mel",
      "2026-11-24": "Dad", // unrostered
    });
    await open();

    const regions = await screen.findAllByRole("region");
    expect(regions.map((r) => within(r).getByRole("heading", { level: 2 }).textContent)).toEqual(["Dad", "Mel", "Mum"]);

    const dad = await section("Dad");
    expect(rowNames(dad)).toEqual([
      "Tuesday 17 November, Late, babysitter Dad, confirmed",
      "Tuesday 24 November, no shift, babysitter Dad, tentative",
    ]);
    expect(within(dad).getByText("1 to confirm")).toBeInTheDocument();
    const [confirmedRow, tentativeRow] = within(dad).getAllByRole("button").filter((b) => b.hasAttribute("data-date"));
    expect(confirmedRow).toHaveTextContent("Tue 17 NovLDConfirmed");
    expect(within(confirmedRow!).getByTestId("babysitter-avatar")).toHaveAttribute("data-status", "confirmed");
    expect(tentativeRow).toHaveTextContent("Tue 24 NovDTentative");
    const unrosteredAvatar = within(tentativeRow!).getByTestId("babysitter-avatar");
    expect(unrosteredAvatar).toHaveAttribute("data-status", "tentative");
    expect(unrosteredAvatar).toHaveClass("top-1/2", "right-1/2");

    // Mum and Mel share an initial; the past date is left out; mum and Mum are one babysitter.
    const mum = await section("Mum");
    expect(rowNames(mum)).toEqual([
      "Sunday 15 November, Early, babysitter Mum, confirmed",
      "Friday 20 November, Night, babysitter mum, tentative",
    ]);
    expect(within(mum).getAllByTestId("babysitter-avatar").map((a) => a.textContent)).toEqual(["Mu", "Mu", "Mu"]);
    expect(within(await section("Mel")).getByText("1 to confirm")).toBeInTheDocument();
  });

  it("lists the dates that need a babysitter, and hides the section when there are none", async () => {
    await seed({ "2026-11-14": "D", "2026-11-15": "E", "2026-11-16": "X", "2026-11-18": "SE", "2026-11-19": "L" });
    await seedBabysitters({ "2026-11-19": "Mum" });
    await open();

    const needs = await section("Needs a babysitter");
    expect(within(needs).getByText("2 dates")).toBeInTheDocument();
    expect(rowNames(needs)).toEqual([
      "Sunday 15 November, Early, no babysitter",
      "Wednesday 18 November, SE, no babysitter",
    ]);
    expect(within(needs).getAllByText("No babysitter")).toHaveLength(2);
    expect(within(needs).getAllByText("No babysitter")[0]).toHaveClass("text-sitter-need");
    for (const row of within(needs).getAllByRole("button")) {
      expect(row).toHaveClass("h-13", "bg-cell", "border-cell-line");
      expect(row.className).not.toMatch(/dashed|warn/);
    }

    // Giving both a babysitter hides the section.
    await seedBabysitters({ "2026-11-15": "Mum", "2026-11-18": "Dad" });
    await waitFor(() => expect(screen.queryByRole("region", { name: "Needs a babysitter" })).not.toBeInTheDocument());
  });

  it("confirms all of a babysitter's upcoming tentative dates at once", async () => {
    await seed({ "2026-11-14": "D", "2026-11-16": "L", "2026-11-17": "N", "2026-11-18": "E" });
    await seedBabysitters({ "2026-11-14": "Mum", "2026-11-16": "Mum", "2026-11-17": "Mum", "2026-11-18": "Dad" });
    vi.spyOn(Date, "now").mockReturnValue(9000);
    await open();

    const mum = await section("Mum");
    expect(within(mum).getByText("2 to confirm")).toBeInTheDocument();
    fireEvent.click(within(mum).getByRole("button", { name: "Confirm all dates with Mum" }));

    await waitFor(() => expect(within(mum).getByText("All confirmed")).toBeInTheDocument());
    expect(within(mum).queryByRole("button", { name: /Confirm all/ })).not.toBeInTheDocument();
    expect(within(mum).getAllByText("Confirmed")).toHaveLength(2);
    expect(await db.babysitterOutbox.toArray()).toEqual([
      { date: "2026-11-16", name: "Mum", confirmed: true, editedAt: 9000 },
      { date: "2026-11-17", name: "Mum", confirmed: true, editedAt: 9000 },
    ]);
    // The past date and the other babysitter are left alone.
    expect(await db.babysitters.get("2026-11-14")).toMatchObject({ confirmed: false, editedAt: 1 });
    expect(await db.babysitters.get("2026-11-18")).toMatchObject({ confirmed: false, editedAt: 1 });
    expect(within(await section("Dad")).getByRole("button", { name: "Confirm all dates with Dad" })).toBeInTheDocument();
  });

  it("opens the date sheet from a row, and a save updates the list in place", async () => {
    await seed({ "2026-11-16": "L", "2026-11-17": "N" });
    await seedBabysitters({ "2026-11-16": "Mum" });
    await open();

    const row = await screen.findByRole("button", { name: "Tuesday 17 November, Night, no babysitter" });
    fireEvent.click(row);
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByRole("heading", { name: "Tuesday 17 November" })).toBeInTheDocument();
    await waitFor(() => expect(sheet).toHaveFocus());
    fireEvent.click(within(within(sheet).getByRole("radiogroup", { name: "Babysitter" })).getByRole("radio", { name: "Mum" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const mum = await section("Mum");
    await waitFor(() =>
      expect(rowNames(mum)).toEqual([
        "Monday 16 November, Late, babysitter Mum, tentative",
        "Tuesday 17 November, Night, babysitter Mum, tentative",
      ]),
    );
    expect(screen.queryByRole("region", { name: "Needs a babysitter" })).not.toBeInTheDocument();
  });

  it("shows the empty text with no babysitter from today on, and the needs list still", async () => {
    await seed({ "2026-11-10": "D", "2026-11-16": "L" });
    await seedBabysitters({ "2026-11-10": "Mum" });
    await open();

    expect(await screen.findByText("No upcoming babysitters. Choose one for a date in the calendar.")).toBeInTheDocument();
    expect(await section("Needs a babysitter")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Mum" })).not.toBeInTheDocument();
  });

  it("goes back to the Calendar", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Back to calendar" }));
    expect(await screen.findByRole("heading", { level: 2, name: "November 2026" })).toBeInTheDocument();
  });
});
