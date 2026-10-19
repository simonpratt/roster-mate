import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, type ShiftChangeRow } from "../db";
import { renderApp, setOnline, stubFetch } from "../test-utils";

// Thursday 15 October 2026, 9 am local time, as in docs/designs/History.dc.html.
const NOW = new Date(2026, 9, 15, 9, 0);
const at = (m: number, d: number, h: number, min: number) => new Date(2026, m - 1, d, h, min).getTime();

let rev = 0;
function change(date: string, from: string | null, to: string | null, editedAt: number, source: ShiftChangeRow["source"]) {
  return { rev: ++rev, date, from, to, source, editedAt };
}

/** The design's sample: four saves, the import changing six shifts. */
async function seedSample() {
  const imported = at(10, 2, 18, 3);
  await db.shiftChanges.bulkPut([
    change("2026-10-10", "L", "N", at(9, 28, 21, 30), "sheet"),
    change("2026-10-24", null, "N", imported, "import"),
    change("2026-10-22", "E", "D", imported, "import"),
    change("2026-10-25", null, "N", imported, "import"),
    change("2026-10-26", null, "N", imported, "import"),
    change("2026-10-27", null, "X", imported, "import"),
    change("2026-10-28", null, "X", imported, "import"),
    change("2026-10-20", "X", "E", at(10, 12, 19, 15), "sheet"),
    change("2026-10-23", "D", "SE", at(10, 15, 8, 42), "sheet"),
    change("2026-10-19", "D", "L", at(10, 14, 22, 0), null),
  ]);
}

async function open() {
  renderApp("/history");
  expect(await screen.findByRole("heading", { level: 1, name: "History" })).toBeInTheDocument();
}

const rows = (el: HTMLElement) => within(el).getAllByRole("button").filter((b) => b.hasAttribute("data-date"));
const rowNames = (el: HTMLElement) => rows(el).map((b) => b.getAttribute("aria-label"));
const groupTitles = () =>
  screen.getAllByRole("region").map((r) => within(r).getByRole("heading", { level: 2 }).textContent);

beforeEach(() => {
  rev = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  // Offline, so pending edits stay in the outbox.
  setOnline(false);
  stubFetch({});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("History screen", () => {
  it("groups the changes by save, newest first, with headings, summaries and rows by date", async () => {
    await seedSample();
    await open();

    expect(screen.getByText("Every change to a shift, newest first.")).toBeInTheDocument();
    await screen.findByRole("region", { name: "Today · 8:42 am" });
    expect(groupTitles()).toEqual([
      "Today · 8:42 am",
      "Yesterday · 10:00 pm",
      "Mon 12 Oct · 7:15 pm",
      "Fri 2 Oct · 6:03 pm",
      "Mon 28 Sep · 9:30 pm",
    ]);
    const today = screen.getByRole("region", { name: "Today · 8:42 am" });
    expect(within(today).getByText("Date sheet")).toBeInTheDocument();
    expect(rowNames(today)).toEqual(["Friday 23 October, Day to SE"]);
    expect(rows(today)[0]).toHaveTextContent("Fri 23 OctDSE");
    expect(rows(today)[0]).toHaveClass("h-13", "bg-cell", "border-cell-line");

    expect(within(screen.getByRole("region", { name: "Yesterday · 10:00 pm" })).getByText("Edit")).toBeInTheDocument();

    const imported = screen.getByRole("region", { name: "Fri 2 Oct · 6:03 pm" });
    expect(within(imported).getByText("Import · 6 shifts")).toBeInTheDocument();
    expect(rowNames(imported)).toEqual([
      "Thursday 22 October, Early to Day",
      "Saturday 24 October, not rostered to Night",
      "Sunday 25 October, not rostered to Night",
      "Monday 26 October, not rostered to Night",
      "Tuesday 27 October, not rostered to Day off",
      "Wednesday 28 October, not rostered to Day off",
    ]);
    // An unrostered side is the empty chip with a dashed border-strong outline.
    const unrostered = within(rows(imported)[1]!).getByTestId("unrostered-chip");
    expect(unrostered).toHaveClass("h-7", "w-8.5", "border", "border-dashed", "border-border-strong");
    expect(unrostered).toBeEmptyDOMElement();
    expect(within(rows(imported)[0]!).queryByTestId("unrostered-chip")).not.toBeInTheDocument();

    expect(screen.queryByText("Not synced yet")).not.toBeInTheDocument();
    expect(screen.queryByText(/No shift changes yet/)).not.toBeInTheDocument();
  });

  it("shows pending shift edits under Not synced yet until the outbox is empty", async () => {
    await seedSample();
    await db.outbox.bulkPut([
      { date: "2026-10-18", code: "D", editedAt: 1, source: "sheet" },
      { date: "2026-10-17", code: "L", editedAt: 1, source: "sheet" },
    ]);
    await open();

    const pending = await screen.findByRole("region", { name: "Not synced yet" });
    expect(groupTitles()[0]).toBe("Not synced yet");
    expect(within(pending).getByText("2 changes")).toBeInTheDocument();
    expect(within(pending).getByTestId("pending-dot").firstElementChild).toHaveClass("bg-warn");
    expect(rowNames(pending)).toEqual([
      "Saturday 17 October, Late, not synced yet",
      "Sunday 18 October, Day, not synced yet",
    ]);
    expect(rows(pending)[0]).toHaveTextContent("Sat 17 OctL");

    await db.outbox.delete("2026-10-18");
    await waitFor(() => expect(within(pending).getByText("1 change")).toBeInTheDocument());
    await db.outbox.clear();
    await waitFor(() => expect(screen.queryByRole("region", { name: "Not synced yet" })).not.toBeInTheDocument());
  });

  it("shows the empty copy with no changes and nothing pending", async () => {
    await open();
    expect(await screen.findByText("No shift changes yet. Shifts you change or import show here.")).toBeInTheDocument();
    expect(screen.queryAllByRole("region")).toHaveLength(0);

    // A pending edit alone hides it.
    await db.outbox.put({ date: "2026-10-17", code: "L", editedAt: 1, source: "sheet" });
    await screen.findByRole("region", { name: "Not synced yet" });
    expect(screen.queryByText(/No shift changes yet/)).not.toBeInTheDocument();
  });

  it("shows a year in the heading when the save wasn't this year", async () => {
    await db.shiftChanges.put(change("2025-12-30", "D", "N", new Date(2025, 11, 29, 7, 5).getTime(), "sheet"));
    await open();
    expect(await screen.findByRole("heading", { level: 2, name: "Mon 29 Dec 2025 · 7:05 am" })).toBeInTheDocument();
  });

  it("opens the date sheet from a row, and closing returns focus to that row", async () => {
    await seedSample();
    // The same date in two saves: focus goes back to the row tapped, not the first.
    await db.shiftChanges.put(change("2026-10-22", "D", "N", at(10, 13, 7, 0), "sheet"));
    await open();

    const older = within(await screen.findByRole("region", { name: "Fri 2 Oct · 6:03 pm" })).getByRole("button", {
      name: "Thursday 22 October, Early to Day",
    });
    fireEvent.click(older);
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByRole("heading", { name: "Thursday 22 October" })).toBeInTheDocument();
    await waitFor(() => expect(sheet).toHaveFocus());
    fireEvent.click(within(sheet).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(older).toHaveFocus());
  });

  it("goes back to the calendar", async () => {
    stubFetch({ "/api/sync": { status: 200, body: { rev: 0, dbId: "db-1", shifts: [], events: [], babysitters: [], shiftChanges: [] } } });
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Back to calendar" }));
    await waitFor(() => expect(screen.queryByRole("heading", { level: 1, name: "History" })).not.toBeInTheDocument());
  });
});
