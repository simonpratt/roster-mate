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
const shareRows = (el: HTMLElement) => within(el).queryAllByRole("listitem").map((li) => li.textContent);
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

    await section("Mum");
    const regions = screen.getAllByRole("region");
    expect(regions.map((r) => within(r).getByRole("heading", { level: 2 }).textContent)).toEqual([
      "Share",
      "Dad",
      "Mel",
      "Mum",
    ]);

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
    expect(within(needs).getAllByText("No babysitter")[0]).toHaveClass("text-babysitter-need");
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
    const shareBefore = await section("Share");
    await waitFor(() => expect(shareRows(shareBefore)).toEqual(["Mum1 date · 100%"]));
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
    await waitFor(() => expect(screen.queryByRole("region", { name: "Needs a babysitter" })).not.toBeInTheDocument());
    // The share counts the new date too.
    const share = await section("Share");
    await waitFor(() => expect(shareRows(share)).toEqual(["Mum2 dates · 100%"]));
  });

  it("shows each babysitter's share of the eight weeks ending on the last working shift", async () => {
    // The last working shift is Mon 30 Nov (the Day off after it doesn't count), so the window
    // runs from Tue 6 Oct.
    await seed({ "2026-11-16": "D", "2026-11-30": "N", "2026-12-02": "X" });
    const rows: Record<string, string | [string, boolean]> = {
      "2026-10-05": "Mel", // the date before the window
      "2026-12-02": "Mel", // after it
      "2026-10-06": ["Mel", true],
    };
    for (let d = 1; d <= 9; d++) rows[`2026-10-${String(10 + d)}`] = d % 2 ? "Mum" : ["mum", true];
    for (let d = 1; d <= 7; d++) rows[`2026-11-${String(15 + d)}`] = "Dad";
    await seedBabysitters(rows);
    await open();

    const share = await section("Share");
    expect(within(share).getByText("6 Oct – 30 Nov")).toBeInTheDocument();
    await waitFor(() =>
      expect(shareRows(share)).toEqual(["Mum9 dates · 53%", "Dad7 dates · 41%", "Mel1 date · 6%"]),
    );
    const bar = within(share).getByTestId("share-bar");
    expect(bar).toHaveAttribute("aria-hidden", "true");
    expect([...bar.children].map((c) => [(c as HTMLElement).style.flex, c.className.match(/bg-[\w-]+/)?.[0]])).toEqual([
      ["9 1 0px", "bg-text"],
      ["7 1 0px", "bg-text-muted"],
      ["1 1 0px", "bg-text-dim"],
    ]);
    // Each row's swatch matches its segment.
    expect(within(share).getAllByRole("listitem").map((li) => li.firstElementChild?.className.match(/bg-[\w-]+/)?.[0])).toEqual([
      "bg-text",
      "bg-text-muted",
      "bg-text-dim",
    ]);
  });

  it("shows 9 dates · 56% with two babysitters", async () => {
    await seedBabysitters(
      Object.fromEntries([
        ...Array.from({ length: 9 }, (_, i) => [`2026-10-${String(20 + i)}`, "Mum"]),
        ...Array.from({ length: 7 }, (_, i) => [`2026-11-0${i + 1}`, "Dad"]),
      ]),
    );
    await open();
    const share = await section("Share");
    expect(within(share).getByText("21 Sep – 15 Nov")).toBeInTheDocument();
    await waitFor(() => expect(shareRows(share)).toEqual(["Mum9 dates · 56%", "Dad7 dates · 44%"]));
  });

  it("shows the share card's empty line with no babysitter in the window", async () => {
    await seedBabysitters({ "2026-09-01": "Mum" });
    await open();
    const share = await section("Share");
    expect(within(share).getByText("21 Sep – 15 Nov")).toBeInTheDocument();
    expect(within(share).getByText("No babysitters in these eight weeks.")).toBeInTheDocument();
    expect(within(share).queryByTestId("share-bar")).not.toBeInTheDocument();
    expect(within(share).queryByRole("listitem")).not.toBeInTheDocument();
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
