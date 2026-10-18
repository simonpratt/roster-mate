import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, type ShiftRow } from "../db";
import { renderApp, setOnline, stubFetch } from "../test-utils";

const SESSION = { status: 200, body: { username: "simon" } };
const SYNCED = { status: 200, body: { rev: 0, dbId: "db", shifts: [] } };

function seed(rows: Record<string, string | null>) {
  const shifts: ShiftRow[] = Object.entries(rows).map(([date, code]) => ({ date, code, editedAt: 1 }));
  return db.shifts.bulkPut(shifts);
}

/**
 * Stubs fetch so each /api/sync waits until answerSync() (or fails with a 500 while failing).
 * answerSync waits for the request to arrive, then answers it as synced.
 */
function stubHeldSync(initiallyFailing: boolean) {
  let failing = initiallyFailing;
  let answer: ((r: Response) => void) | null = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/session") return Response.json(SESSION.body);
      if (failing) return Response.json({ error: "boom" }, { status: 500 });
      return new Promise<Response>((resolve) => (answer = resolve));
    }),
  );
  return {
    setFailing: (f: boolean) => (failing = f),
    answerSync: async () => {
      await waitFor(() => expect(answer).not.toBeNull());
      answer!(Response.json(SYNCED.body));
      answer = null;
    },
  };
}

beforeEach(() => {
  // A fixed clock: Sunday 15 November 2026, 9 am local time. Only Date is faked, so Dexie's and
  // React's timers still run.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 15, 9, 0));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Calendar month grid", () => {
  it("shows November 2026 from Mon 26 Oct to Sun 6 Dec with the seeded codes", async () => {
    stubFetch({ "/api/session": SESSION, "/api/sync": SYNCED });
    await seed({ "2026-10-26": "D", "2026-11-03": "L", "2026-11-04": "X", "2026-11-20": "SE", "2026-12-06": "N" });
    renderApp("/");

    expect(await screen.findByRole("heading", { level: 2, name: "November 2026" })).toBeInTheDocument();
    const cells = within(screen.getByTestId("month-grid")).getAllByRole("button");
    expect(cells).toHaveLength(42);
    await waitFor(() => expect(cells[0]).toHaveAccessibleName("Monday 26 October, Day"));
    expect(cells[0]).toHaveTextContent("26D");
    // A working shift from today on with no babysitter says so.
    await waitFor(() => expect(cells[41]).toHaveAccessibleName("Sunday 6 December, Night, no babysitter"));
    expect(cells[41]).toHaveTextContent("6N");

    expect(screen.getByRole("button", { name: "Tuesday 3 November, Late" })).toHaveTextContent("3L");
    expect(screen.getByRole("button", { name: "Wednesday 4 November, Day off" })).toHaveTextContent("4X");
    expect(screen.getByRole("button", { name: "Friday 20 November, SE, no babysitter" })).toHaveTextContent("20SE");
    expect(screen.getByRole("button", { name: "Thursday 5 November, no shift" })).toHaveTextContent(/^5$/);
    expect(screen.getByRole("button", { name: "Sunday 15 November, no shift, today" })).toHaveAttribute(
      "aria-current",
      "date",
    );
  });

  it("marks event dots and dates that need a babysitter", async () => {
    stubFetch({ "/api/session": SESSION, "/api/sync": SYNCED });
    await seed({
      "2026-11-10": "D", // past
      "2026-11-15": "E", // today
      "2026-11-16": "D",
      "2026-11-17": "L",
      "2026-11-18": "X",
      "2026-11-21": "SE",
      "2026-12-01": "N", // next month
      "2026-12-02": "D",
    });
    await db.babysitters.bulkPut([
      { date: "2026-11-17", name: "Mum", editedAt: 1 },
      { date: "2026-12-02", name: "Dad", editedAt: 1 },
      { date: "2026-11-21", name: "", editedAt: 1 }, // cleared
    ]);
    const events = (date: string, n: number) =>
      Array.from({ length: n }, (_, i) => ({ id: `${date}-${i}`, date, text: `Event ${i}`, createdAt: i, editedAt: 1 }));
    await db.events.bulkPut([...events("2026-11-17", 1), ...events("2026-11-19", 6), ...events("2026-11-10", 2)]);
    renderApp("/");

    const cell = (name: string) => screen.findByRole("button", { name });
    const dots = (el: HTMLElement) => within(el).getByTestId("event-dots").children;

    const today = await cell("Sunday 15 November, Early, no babysitter, today");
    expect(today).toHaveClass("border-dashed", "border-warn", "bg-warn-fill", "ring-text");
    const needs = await cell("Monday 16 November, Day, no babysitter");
    expect(needs).toHaveClass("border-dashed", "border-warn", "bg-warn-fill");
    expect(dots(needs)).toHaveLength(0);
    const minded = await cell("Tuesday 17 November, Late, babysitter Mum, 1 event");
    expect(minded).not.toHaveClass("border-dashed");
    expect(dots(minded)).toHaveLength(1);
    expect(dots(minded)[0]).toHaveClass("bg-text");
    expect(await cell("Saturday 21 November, SE, no babysitter")).toHaveClass("border-dashed");
    expect(await cell("Wednesday 18 November, Day off")).not.toHaveClass("border-dashed");
    const past = await cell("Tuesday 10 November, Day, 2 events");
    expect(past).not.toHaveClass("border-dashed");
    expect(dots(past)).toHaveLength(2);
    // At most four dots.
    const busy = await cell("Thursday 19 November, no shift, 6 events");
    expect(dots(busy)).toHaveLength(4);
    // Outside the month: the dim border, no fill.
    const next = await cell("Tuesday 1 December, Night, no babysitter");
    expect(next).toHaveClass("border-dashed", "border-warn-dim");
    expect(next).not.toHaveClass("bg-warn-fill");
    expect(await cell("Wednesday 2 December, Day, babysitter Dad")).not.toHaveClass("border-dashed");

    // The dashed border is on exactly the cells that need a babysitter.
    for (const c of within(screen.getByTestId("month-grid")).getAllByRole("button")) {
      expect(c.classList.contains("border-dashed")).toBe(c.getAttribute("aria-label")!.includes("no babysitter"));
    }
    expect(screen.getAllByRole("button", { name: /no babysitter/ })).toHaveLength(4);
  });

  it("changes month with the buttons, a swipe and Today", async () => {
    stubFetch({ "/api/session": SESSION, "/api/sync": SYNCED });
    renderApp("/");
    const title = () => screen.getByRole("heading", { level: 2 });
    expect(await screen.findByRole("heading", { level: 2, name: "November 2026" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(title()).toHaveTextContent("December 2026");
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    expect(title()).toHaveTextContent("October 2026");

    const grid = screen.getByTestId("month-grid");
    // Swipe left: the next month.
    fireEvent.touchStart(grid, { touches: [{ clientX: 300, clientY: 200 }] });
    fireEvent.touchEnd(grid, { changedTouches: [{ clientX: 200, clientY: 210 }] });
    expect(title()).toHaveTextContent("November 2026");
    // Swipe right: the previous month. A mostly vertical drag does nothing.
    fireEvent.touchStart(grid, { touches: [{ clientX: 100, clientY: 200 }] });
    fireEvent.touchEnd(grid, { changedTouches: [{ clientX: 200, clientY: 220 }] });
    expect(title()).toHaveTextContent("October 2026");
    fireEvent.touchStart(grid, { touches: [{ clientX: 100, clientY: 100 }] });
    fireEvent.touchEnd(grid, { changedTouches: [{ clientX: 160, clientY: 300 }] });
    expect(title()).toHaveTextContent("October 2026");

    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(title()).toHaveTextContent("November 2026");
  });
});

describe("Next shift", () => {
  const cases: [string, Record<string, string | null>, string][] = [
    ["today", { "2026-11-14": "L", "2026-11-15": "D" }, "Today · Day"],
    ["tomorrow", { "2026-11-15": "X", "2026-11-16": "L" }, "Tomorrow · Late"],
    ["later", { "2026-11-10": "D", "2026-11-15": "X", "2026-11-16": null, "2026-11-20": "N" }, "Fri 20 Nov · Night"],
    ["an Other code", { "2026-11-15": "X", "2026-11-16": "SE" }, "Tomorrow · SE"],
    ["only days off ahead", { "2026-11-01": "D", "2026-11-15": "X", "2026-11-16": "X" }, "No upcoming shifts"],
    ["no shifts", {}, "No upcoming shifts"],
  ];

  it.each(cases)("reads right for %s", async (_name, rows, text) => {
    stubFetch({ "/api/session": SESSION, "/api/sync": SYNCED });
    await seed(rows);
    renderApp("/");
    expect(await screen.findByRole("heading", { level: 1, name: text })).toBeInTheDocument();
  });

  it("shows the next shift's month when tapped", async () => {
    stubFetch({ "/api/session": SESSION, "/api/sync": SYNCED });
    await seed({ "2027-01-04": "E" });
    renderApp("/");
    fireEvent.click(await screen.findByRole("button", { name: "Mon 4 Jan · Early" }));
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("January 2027");
  });

  it("offers an import on first run only", async () => {
    stubFetch({ "/api/session": SESSION, "/api/sync": SYNCED });
    const { unmount } = renderApp("/");
    expect(await screen.findByText("Import a photo of your roster to get started.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Import roster" })).toHaveAttribute("href", "/import");
    unmount();

    await seed({ "2026-11-20": "D" });
    renderApp("/");
    await screen.findByRole("heading", { level: 1, name: "Fri 20 Nov · Day" });
    expect(screen.queryByText("Import a photo of your roster to get started.")).not.toBeInTheDocument();
  });
});

describe("Sync pill and sign-in banner", () => {
  const BANNER = "Sign in to sync. Your edits are kept on this phone until then.";

  it("shows Sign in needed and the banner for unauthorized", async () => {
    stubFetch({ "/api/session": SESSION, "/api/sync": { status: 401, body: { error: "unauthorized" } } });
    renderApp("/");
    expect(await screen.findByText(BANNER)).toBeInTheDocument();
    expect(screen.getByText("Sign in needed")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
  });

  it("shows Synced without the banner", async () => {
    stubFetch({ "/api/session": SESSION, "/api/sync": SYNCED });
    renderApp("/");
    expect(await screen.findByText("Synced")).toBeInTheDocument();
    expect(screen.queryByText(BANNER)).not.toBeInTheDocument();
  });

  it("shows Offline without the banner", async () => {
    setOnline(false);
    stubFetch({});
    renderApp("/");
    expect(await screen.findByText("Offline")).toBeInTheDocument();
    expect(screen.queryByText(BANNER)).not.toBeInTheDocument();
  });

  it("shows Sync failed, and Syncing… after Retry until that run ends", async () => {
    const { answerSync, setFailing } = stubHeldSync(true);
    renderApp("/");
    const retry = await screen.findByRole("button", { name: "Sync failed. Retry" });
    expect(screen.queryByText(BANNER)).not.toBeInTheDocument();

    setFailing(false);
    fireEvent.click(retry);
    expect(await screen.findByText("Syncing…")).toBeInTheDocument();
    await answerSync();
    expect(await screen.findByText("Synced")).toBeInTheDocument();
  });

  it("shows the pending count while edits wait to sync", async () => {
    const { answerSync } = stubHeldSync(false);
    await db.outbox.bulkPut([
      { date: "2026-11-20", code: "D", editedAt: 1 },
      { date: "2026-11-21", code: "L", editedAt: 1 },
    ]);
    renderApp("/");
    expect(await screen.findByText("2 pending")).toBeInTheDocument();
    expect(screen.queryByText(BANNER)).not.toBeInTheDocument();
    await answerSync();
    expect(await screen.findByText("Synced")).toBeInTheDocument();
  });
});

describe("Sign out", () => {
  it("signs out straight away with no pending edits", async () => {
    const fetchMock = stubFetch({ "/api/session": SESSION, "/api/sync": SYNCED, "/api/logout": { status: 204 } });
    renderApp("/");
    fireEvent.click(await screen.findByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
    expect(await screen.findByLabelText("Password")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/logout", expect.objectContaining({ method: "POST" }));
  });

  it("asks first when edits are pending, even offline", async () => {
    setOnline(false);
    const fetchMock = stubFetch({ "/api/logout": { status: 204 } });
    await db.outbox.put({ date: "2026-11-20", code: "D", editedAt: 1 });
    renderApp("/");
    await screen.findByText("Offline");
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));

    const dialog = await screen.findByRole("alertdialog", { name: "Sign out?" });
    expect(dialog).toHaveAccessibleDescription(
      "You have 1 pending edit. Signing out keeps them on this phone, but they won’t sync until you sign in again.",
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Sign out" }));
    expect(await screen.findByLabelText("Password")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/logout", expect.objectContaining({ method: "POST" }));
    // The pending edit stays on the phone.
    expect(await db.outbox.count()).toBe(1);
  });
});
