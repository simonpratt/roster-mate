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
  it("stacks each month's own dates, opening on November 2026", async () => {
    stubFetch({ "/api/session": SESSION, "/api/sync": SYNCED });
    await seed({ "2026-10-26": "D", "2026-11-03": "L", "2026-11-04": "X", "2026-11-20": "SE", "2026-12-06": "N" });
    renderApp("/");

    // The bar names the month at the top of the scroll; no Next shift and no month buttons.
    expect(await screen.findByRole("heading", { level: 1, name: "November 2026" })).toBeInTheDocument();
    expect(screen.queryByText("Next shift")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next month" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Previous month" })).not.toBeInTheDocument();

    // One month either side, earliest first, each titled.
    const months = screen.getAllByRole("region");
    expect(months.map((m) => m.getAttribute("aria-label"))).toEqual(["October 2026", "November 2026", "December 2026"]);
    const november = screen.getByRole("region", { name: "November 2026" });
    expect(within(november).getByRole("heading", { level: 2 })).toHaveTextContent("November 2026");
    // Only November's dates: 1 November is a Sunday, after six blanks.
    const cells = within(november).getAllByRole("button");
    expect(cells).toHaveLength(30);
    expect(cells[0]).toHaveAccessibleName("Sunday 1 November, no shift");
    expect(cells[0]!.parentElement!.children).toHaveLength(36);
    expect(cells[29]).toHaveAccessibleName("Monday 30 November, no shift");
    expect(cells.every((c) => c.classList.contains("h-21"))).toBe(true);

    // Each date appears once, in its own month.
    const october = screen.getByRole("region", { name: "October 2026" });
    expect(await within(october).findByRole("button", { name: "Monday 26 October, Day" })).toHaveTextContent("26D");
    // A working shift from today on with no babysitter says so.
    const december = screen.getByRole("region", { name: "December 2026" });
    expect(await within(december).findByRole("button", { name: "Sunday 6 December, Night, no babysitter" })).toHaveTextContent("6N");
    expect(screen.getAllByRole("button", { name: /^\w+ 6 December/ })).toHaveLength(1);

    expect(screen.getByRole("button", { name: "Tuesday 3 November, Late" })).toHaveTextContent("3L");
    expect(screen.getByRole("button", { name: "Wednesday 4 November, Day off" })).toHaveTextContent("4X");
    expect(screen.getByRole("button", { name: "Friday 20 November, SE, no babysitter" })).toHaveTextContent("20SE");
    expect(screen.getByRole("button", { name: "Thursday 5 November, no shift" })).toHaveTextContent(/^5$/);
    expect(screen.getByRole("button", { name: "Sunday 15 November, no shift, today" })).toHaveAttribute(
      "aria-current",
      "date",
    );
  });

  it("marks event dots and each date's babysitter with its avatar", async () => {
    stubFetch({ "/api/session": SESSION, "/api/sync": SYNCED });
    await seed({
      "2026-11-10": "D", // past
      "2026-11-15": "E", // today
      "2026-11-16": "D",
      "2026-11-17": "L",
      "2026-11-18": "X",
      "2026-11-21": "SE",
      "2026-11-09": "N", // past, with a babysitter
      "2026-12-01": "N", // next month
      "2026-12-02": "D",
    });
    await db.babysitters.bulkPut([
      { date: "2026-11-09", name: "Mel", confirmed: true, editedAt: 1 },
      { date: "2026-11-17", name: "Mum", confirmed: false, editedAt: 1 },
      { date: "2026-11-24", name: "Mum", confirmed: true, editedAt: 1 }, // unrostered
      { date: "2026-12-02", name: "Dad", confirmed: true, editedAt: 1 },
      { date: "2026-11-21", name: "", confirmed: false, editedAt: 1 }, // cleared
    ]);
    const events = (date: string, n: number) =>
      Array.from({ length: n }, (_, i) => ({ id: `${date}-${i}`, date, text: `Event ${i}`, createdAt: i, editedAt: 1 }));
    await db.events.bulkPut([...events("2026-11-17", 1), ...events("2026-11-19", 6), ...events("2026-11-10", 2)]);
    renderApp("/");

    const cell = (name: string) => screen.findByRole("button", { name });
    const dots = (el: HTMLElement) => within(el).getByTestId("event-dots").children;
    const avatar = (el: HTMLElement) => within(el).queryByTestId("babysitter-avatar");

    const today = await cell("Sunday 15 November, Early, no babysitter, today");
    expect(today).toHaveClass("border-text", "bg-surface", "ring-text");
    expect(avatar(today)).toHaveAttribute("data-status", "needs");
    expect(avatar(today)).toHaveClass("size-2", "bg-babysitter-need", "ring-surface", "-top-0.75", "-right-0.75");
    expect(avatar(today)).toHaveTextContent("");
    const needs = await cell("Monday 16 November, Day, no babysitter");
    expect(needs).toHaveClass("border-cell-line", "bg-cell");
    expect(avatar(needs)).toHaveClass("bg-babysitter-need", "ring-cell");
    expect(dots(needs)).toHaveLength(0);

    // Tentative: dashed initials, 7 px past the chip's corner. Mum and Mel share an initial.
    const tentative = await cell("Tuesday 17 November, Late, babysitter Mum, tentative, 1 event");
    expect(avatar(tentative)).toHaveAttribute("data-status", "tentative");
    expect(avatar(tentative)).toHaveClass("size-4", "border-dashed", "border-text-disabled", "bg-cell", "text-text-muted");
    expect(avatar(tentative)).toHaveClass("-top-1.75", "-right-1.75");
    expect(avatar(tentative)).toHaveTextContent(/^Mu$/);
    expect(dots(tentative)).toHaveLength(1);
    expect(dots(tentative)[0]).toHaveClass("bg-text");

    // Confirmed, and on a past date too.
    const past = await cell("Monday 9 November, Night, babysitter Mel, confirmed");
    expect(avatar(past)).toHaveAttribute("data-status", "confirmed");
    expect(avatar(past)).toHaveClass("bg-border-strong", "text-text");
    expect(avatar(past)).not.toHaveClass("border-dashed");
    expect(avatar(past)).toHaveTextContent(/^Me$/);

    // An unrostered date with a babysitter: the avatar alone, centred where the chip would be.
    const unrostered = await cell("Tuesday 24 November, no shift, babysitter Mum, confirmed");
    expect(avatar(unrostered)).toHaveClass("top-1/2", "right-1/2");
    expect(unrostered).toHaveTextContent(/^24Mu$/);

    // No avatar: a day off, a past shift, a date with no shift.
    expect(avatar(await cell("Wednesday 18 November, Day off"))).toBeNull();
    const pastShift = await cell("Tuesday 10 November, Day, 2 events");
    expect(avatar(pastShift)).toBeNull();
    expect(dots(pastShift)).toHaveLength(2);
    expect(avatar(await cell("Saturday 21 November, SE, no babysitter"))).toHaveAttribute("data-status", "needs");
    // At most four dots.
    const busy = await cell("Thursday 19 November, no shift, 6 events");
    expect(dots(busy)).toHaveLength(4);
    expect(avatar(busy)).toBeNull();

    // The next month's cells look like any other.
    const next = await cell("Tuesday 1 December, Night, no babysitter");
    expect(next).toHaveClass("bg-cell");
    expect(avatar(next)).toHaveClass("ring-cell");
    expect(avatar(await cell("Wednesday 2 December, Day, babysitter Dad, confirmed"))).toHaveTextContent(/^D$/);

    // No cell has a dashed or warn border any more; the needs dot is on exactly the cells that need one.
    for (const c of within(screen.getByTestId("month-scroll")).getAllByRole("button")) {
      expect(c.className).not.toMatch(/dashed|warn/);
      const needsDot = within(c).queryByTestId("babysitter-avatar")?.getAttribute("data-status") === "needs";
      expect(needsDot).toBe(c.getAttribute("aria-label")!.includes("no babysitter"));
    }
    expect(screen.getAllByRole("button", { name: /no babysitter/ })).toHaveLength(4);
  });

  it("adds months near the bottom, and none above", async () => {
    stubFetch({ "/api/session": SESSION, "/api/sync": SYNCED });
    renderApp("/");
    await screen.findByRole("region", { name: "December 2026" });
    const scroll = screen.getByTestId("month-scroll");
    const region = (name: string) => screen.queryByRole("region", { name });

    // jsdom has no layout: an 800 px view over 1000 px per month.
    Object.defineProperty(scroll, "clientHeight", { configurable: true, value: 800 });
    Object.defineProperty(scroll, "scrollHeight", {
      configurable: true,
      get: () => scroll.querySelectorAll("section").length * 1000,
    });
    // At the top: no months before October.
    scroll.scrollTop = 0;
    fireEvent.scroll(scroll);
    expect(region("September 2026")).toBeNull();
    expect(region("January 2027")).toBeNull();

    // Near the bottom: three more after December.
    scroll.scrollTop = 1_500;
    fireEvent.scroll(scroll);
    expect(await screen.findByRole("region", { name: "March 2027" })).toBeInTheDocument();
    expect(region("April 2027")).toBeNull();
    // In the middle: nothing more.
    scroll.scrollTop = 2_000;
    fireEvent.scroll(scroll);
    expect(region("April 2027")).toBeNull();
    expect(region("September 2026")).toBeNull();
  });

  it("fills a view taller than the months shown", async () => {
    stubFetch({ "/api/session": SESSION, "/api/sync": SYNCED });
    // A 4000 px view over 1000 px per month, set before the first layout.
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: 4000 });
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get(this: HTMLElement) {
        return this.querySelectorAll("section").length * 1000;
      },
    });
    try {
      renderApp("/");
      // 3 months, then 6, then 9: the first count whose bottom is more than a view below the top.
      expect(await screen.findByRole("region", { name: "June 2027" })).toBeInTheDocument();
      expect(screen.queryByRole("region", { name: "July 2027" })).toBeNull();
    } finally {
      delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
      delete (HTMLElement.prototype as { scrollHeight?: number }).scrollHeight;
    }
  });

  it("opens on the month Import returns to, and Today scrolls back to today's month", async () => {
    stubFetch({ "/api/session": SESSION, "/api/sync": SYNCED });
    const scrollTo = vi.spyOn(Element.prototype, "scrollTo");
    renderApp({ pathname: "/", state: { month: "2027-03" } });
    expect(await screen.findByRole("heading", { level: 1, name: "March 2027" })).toBeInTheDocument();
    // Today's month is in reach, from the month before it to the month after March.
    const months = screen.getAllByRole("region").map((m) => m.getAttribute("aria-label"));
    expect(months[0]).toBe("October 2026");
    expect(months[months.length - 1]).toBe("April 2027");

    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ top: expect.any(Number), behavior: "smooth" });
  });
});

describe("First run", () => {
  it("offers an import on first run only", async () => {
    stubFetch({ "/api/session": SESSION, "/api/sync": SYNCED });
    const { unmount } = renderApp("/");
    expect(await screen.findByText("Import a photo of your roster to get started.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Import roster" })).toHaveAttribute("href", "/import");
    unmount();

    await seed({ "2026-11-20": "D" });
    renderApp("/");
    await screen.findByRole("button", { name: "Friday 20 November, Day, no babysitter" });
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

describe("Menu", () => {
  it("shows Babysitters above Sign out, and Babysitters opens /babysitters", async () => {
    stubFetch({ "/api/session": SESSION, "/api/sync": SYNCED });
    renderApp("/");
    fireEvent.click(await screen.findByRole("button", { name: "More" }));
    const items = within(screen.getByRole("menu", { name: "More" })).getAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual(["Babysitters", "Sign out"]);
    fireEvent.click(items[0]!);
    expect(await screen.findByRole("heading", { level: 1, name: "Babysitters" })).toBeInTheDocument();
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
