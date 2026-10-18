import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, type ShiftRow } from "../db";
import { setShifts } from "../shifts/repo";
import { renderApp, setOnline, stubFetch } from "../test-utils";

// jsdom has no canvas: the photo goes up as chosen. image.test.ts covers the downscale.
vi.mock("../lib/image", () => ({ downscaleImage: vi.fn(async (file: Blob) => file) }));

// Wraps setShifts so a test can count its calls while it still writes to IndexedDB.
vi.mock("../shifts/repo", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../shifts/repo")>();
  return { ...mod, setShifts: vi.fn(mod.setShifts) };
});

const SESSION = { status: 200, body: { username: "simon" } };
const SYNCED = { status: 200, body: { rev: 0, dbId: "db", shifts: [] } };
const HEALTHY = { status: 200, body: { ok: true } };
const EVENT_ID = "0b6f3e1c-2f4a-4c1d-9e8b-1a2b3c4d5e6f";

// Mon 7 Dec to Sat 12 Dec 2026, a month after "today" (Sun 15 Nov).
const RESULT = {
  personFound: true,
  shifts: [
    // Out of order on purpose: the list sorts by date.
    { date: "2026-12-12", code: "L", rawCode: "L", uncertain: true }, // new, uncertain
    { date: "2026-12-07", code: "D", rawCode: "D", uncertain: false }, // new
    { date: "2026-12-08", code: "E", rawCode: "E", uncertain: false }, // changed from X
    { date: "2026-12-09", code: "N", rawCode: "N", uncertain: false }, // same
    { date: "2026-12-10", code: "SE", rawCode: "se", uncertain: false }, // Other code, new
    { date: "2026-12-11", code: null, rawCode: "A/L", uncertain: false }, // unmapped
  ],
  warnings: ["Week of 7 Dec is partly obscured."],
};

function seed(rows: Record<string, string>) {
  const shifts: ShiftRow[] = Object.entries(rows).map(([date, code]) => ({ date, code, editedAt: 1 }));
  return db.shifts.bulkPut(shifts);
}

function fileInput() {
  return document.querySelector<HTMLInputElement>('input[type="file"]');
}

/** Waits for the picker, then chooses a photo. */
async function choosePhoto() {
  await waitFor(() => expect(fileInput()).not.toBeNull());
  fireEvent.change(fileInput()!, { target: { files: [new File(["jpeg"], "roster.jpg", { type: "image/jpeg" })] } });
}

/** The review row for a date, by the start of its checkbox's label ("Mon 7 Dec"). */
function row(date: string) {
  const checkbox = screen.getByRole("checkbox", { name: new RegExp(`^${date}`) });
  return { checkbox, li: checkbox.closest("li")! };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 15, 9, 0));
  URL.createObjectURL = vi.fn(() => "blob:roster");
  URL.revokeObjectURL = vi.fn();
  vi.mocked(setShifts).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Import review", () => {
  async function openReview() {
    stubFetch({
      "/api/session": SESSION,
      "/api/sync": SYNCED,
      "/api/health": HEALTHY,
      "/api/extract": { status: 200, body: RESULT },
    });
    await seed({ "2026-12-08": "X", "2026-12-09": "N" });
    // The dates' events and babysitters are records of their own, which an import leaves alone.
    await db.events.put({ id: EVENT_ID, date: "2026-12-08", text: "Dentist 3pm", createdAt: 5, editedAt: 5, rev: 1 });
    await db.babysitters.put({ date: "2026-12-08", name: "Mum", editedAt: 5, rev: 2 });
    renderApp("/import");
    await choosePhoto();
    expect(await screen.findByRole("heading", { name: "6 shifts found" })).toBeInTheDocument();
  }

  it("shows each row's badge, status line and default checkbox", async () => {
    await openReview();
    expect(screen.getByText("Mon 7 Dec – Sat 12 Dec · 3 new · 1 changed · 1 same · 1 needs a code")).toBeInTheDocument();
    expect(screen.getByText("Week of 7 Dec is partly obscured.")).toBeInTheDocument();

    const expected: [string, string, string, "checked" | "unchecked" | "disabled"][] = [
      ["Mon 7 Dec", "New", "Not rostered", "checked"],
      ["Tue 8 Dec", "Changed", "Was Day off", "checked"],
      ["Wed 9 Dec", "Same", "Already Night", "unchecked"],
      ["Thu 10 Dec", "New", "Not rostered", "checked"],
      ["Fri 11 Dec", "Needs code", "Read as “A/L”", "disabled"],
      ["Sat 12 Dec", "Unsure", "Not rostered", "checked"],
    ];
    const items = screen.getAllByRole("listitem");
    expect(items.map((li) => within(li).getByRole("checkbox"))).toEqual(
      expected.map(([date]) => row(date).checkbox),
    );
    for (const [date, badge, status, state] of expected) {
      const { checkbox, li } = row(date);
      expect(within(li).getByText(badge)).toBeInTheDocument();
      expect(within(li).getByText(status)).toBeInTheDocument();
      if (state === "checked") expect(checkbox).toBeChecked();
      else expect(checkbox).not.toBeChecked();
      if (state === "disabled") expect(checkbox).toBeDisabled();
      else expect(checkbox).toBeEnabled();
    }
    // The Other code shows in the Other input beside the picker.
    expect(within(row("Thu 10 Dec").li).getByRole("combobox")).toHaveValue("O");
    expect(screen.getByRole("textbox", { name: "Other code for Thu 10 Dec" })).toHaveValue("SE");
    expect(screen.getByRole("button", { name: "Save 4 shifts" })).toBeEnabled();
  });

  it("enables and ticks an unmapped row once a code is picked, then saves the ticked rows in one write", async () => {
    await openReview();
    const { checkbox, li } = row("Fri 11 Dec");
    fireEvent.change(screen.getByRole("combobox", { name: "Shift for Fri 11 Dec" }), { target: { value: "X" } });
    expect(checkbox).toBeEnabled();
    expect(checkbox).toBeChecked();
    expect(within(li).getByText("New")).toBeInTheDocument();

    // Untick the uncertain row: it is left as it is.
    fireEvent.click(row("Sat 12 Dec").checkbox);
    fireEvent.click(screen.getByRole("button", { name: "Save 4 shifts" }));

    // Back on the Calendar, on the month of the first saved date.
    expect(await screen.findByRole("heading", { level: 2, name: "December 2026" })).toBeInTheDocument();
    expect(setShifts).toHaveBeenCalledTimes(1);
    expect(vi.mocked(setShifts).mock.calls[0]![0]).toEqual([
      { date: "2026-12-07", code: "D" },
      { date: "2026-12-08", code: "E" },
      { date: "2026-12-10", code: "SE" },
      { date: "2026-12-11", code: "X" },
    ]);
    const saved = await db.shifts.bulkGet(["2026-12-08", "2026-12-09", "2026-12-12"]);
    expect(saved.map((s) => s?.code)).toEqual(["E", "N", undefined]);
    expect(saved[0]).toEqual({ date: "2026-12-08", code: "E", editedAt: expect.any(Number) });
    expect(await db.events.toArray()).toEqual([
      { id: EVENT_ID, date: "2026-12-08", text: "Dentist 3pm", createdAt: 5, editedAt: 5, rev: 1 },
    ]);
    expect(await db.babysitters.toArray()).toEqual([{ date: "2026-12-08", name: "Mum", editedAt: 5, rev: 2 }]);
    expect(await db.eventOutbox.count()).toBe(0);
    expect(await db.babysitterOutbox.count()).toBe(0);
  });

  it("re-evaluates a row when its code changes", async () => {
    await openReview();
    const select = screen.getByRole("combobox", { name: "Shift for Tue 8 Dec" });
    fireEvent.change(select, { target: { value: "X" } });
    expect(within(row("Tue 8 Dec").li).getByText("Same")).toBeInTheDocument();
    expect(row("Tue 8 Dec").checkbox).not.toBeChecked();
    expect(screen.getByText("Already Day off")).toBeInTheDocument();

    fireEvent.change(select, { target: { value: "O" } });
    expect(row("Tue 8 Dec").checkbox).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "Other code for Tue 8 Dec" }), { target: { value: "xd" } });
    expect(screen.getByRole("textbox", { name: "Other code for Tue 8 Dec" })).toHaveValue("XD");
    expect(within(row("Tue 8 Dec").li).getByText("Changed")).toBeInTheDocument();
    expect(row("Tue 8 Dec").checkbox).toBeChecked();
  });

  it("shows Nothing selected when no row is ticked", async () => {
    await openReview();
    for (const date of ["Mon 7 Dec", "Tue 8 Dec", "Thu 10 Dec", "Sat 12 Dec"]) fireEvent.click(row(date).checkbox);
    expect(screen.getByRole("button", { name: "Nothing selected" })).toBeDisabled();
  });
});

describe("Import outcomes", () => {
  function stubExtract(reply: Parameters<typeof stubFetch>[0][string]) {
    return stubFetch({ "/api/session": SESSION, "/api/sync": SYNCED, "/api/health": HEALTHY, "/api/extract": reply });
  }

  it("sends the photo as the multipart field image", async () => {
    const fetchMock = stubExtract({ status: 200, body: RESULT });
    renderApp("/import");
    await choosePhoto();
    await screen.findByRole("heading", { name: "6 shifts found" });
    const call = fetchMock.mock.calls.find(([input]) => String(input) === "/api/extract")!;
    const init = (call as unknown as [string, RequestInit])[1];
    expect(init.method).toBe("POST");
    expect((init.body as FormData).get("image")).toBeInstanceOf(Blob);
  });

  it("says when you aren't on the roster, with no Save", async () => {
    stubExtract({ status: 200, body: { personFound: false, shifts: [], warnings: [] } });
    renderApp("/import");
    await choosePhoto();
    expect(await screen.findByRole("heading", { name: "Couldn’t find you on this roster." })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Save|Nothing selected/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try another photo" }));
    expect(screen.getByRole("heading", { name: "Photograph your roster" })).toBeInTheDocument();
  });

  it("says when no shifts could be read", async () => {
    stubExtract({ status: 200, body: { personFound: true, shifts: [], warnings: [] } });
    renderApp("/import");
    await choosePhoto();
    expect(await screen.findByRole("heading", { name: "Found you, but no shifts could be read." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try another photo" })).toBeInTheDocument();
  });

  it.each([
    ["a proxy's 504", { status: 504 }, "Couldn’t read the roster."],
    ["the server's 502", { status: 502, body: { error: "extraction failed" } }, "Couldn’t read the roster."],
    ["413", { status: 413, body: { error: "too large" } }, "That image is too large or not a supported format."],
    ["415", { status: 415, body: { error: "bad type" } }, "That image is too large or not a supported format."],
    ["a network failure", new TypeError("Failed to fetch"), "Lost connection while reading."],
  ] as const)("shows the error for %s, with Try again and Choose another photo", async (_name, reply, title) => {
    stubExtract(reply);
    renderApp("/import");
    await choosePhoto();
    expect(await screen.findByRole("heading", { name: title })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose another photo" })).toBeInTheDocument();
  });

  it("tries the same photo again", async () => {
    const fetchMock = stubExtract({ status: 504 });
    renderApp("/import");
    await choosePhoto();
    await screen.findByRole("heading", { name: "Couldn’t read the roster." });
    stubFetch({ "/api/sync": SYNCED, "/api/extract": { status: 200, body: RESULT } });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "6 shifts found" })).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([input]) => String(input) === "/api/extract")).toHaveLength(1);
  });

  it("goes to sign in on 401", async () => {
    stubExtract({ status: 401, body: { error: "unauthorized" } });
    renderApp("/import");
    await choosePhoto();
    expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });

  it("cancels a running extraction and returns to the picker", async () => {
    let aborted = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        if (path === "/api/health") return Response.json({ ok: true });
        if (path === "/api/extract")
          return new Promise<Response>((_resolve, reject) =>
            init?.signal?.addEventListener("abort", () => {
              aborted = true;
              reject(new DOMException("aborted", "AbortError"));
            }),
          );
        return Response.json(SYNCED.body);
      }),
    );
    renderApp("/import");
    await choosePhoto();
    expect(await screen.findByRole("heading", { name: "Extracting…" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("heading", { name: "Photograph your roster" })).toBeInTheDocument();
    expect(aborted).toBe(true);
  });
});

describe("Import connection check", () => {
  it("needs a connection when the phone is offline, with no file input", async () => {
    setOnline(false);
    const fetchMock = stubFetch({ "/api/sync": SYNCED });
    renderApp("/import");
    expect(await screen.findByRole("heading", { name: "Import needs a connection" })).toBeInTheDocument();
    expect(fileInput()).toBeNull();
    expect(screen.getByRole("link", { name: "Back to calendar" })).toHaveAttribute("href", "/");
    expect(fetchMock.mock.calls.some(([input]) => String(input) === "/api/health")).toBe(false);
  });

  it.each([
    ["can't be reached", new TypeError("Failed to fetch")],
    ["answers with an error", { status: 502 }],
  ] as const)("needs a connection when online but the server %s", async (_name, health) => {
    setOnline(true);
    stubFetch({ "/api/session": SESSION, "/api/sync": SYNCED, "/api/health": health });
    renderApp("/import");
    expect(await screen.findByRole("heading", { name: "Import needs a connection" })).toBeInTheDocument();
    expect(fileInput()).toBeNull();
  });

  it("shows the picker with disabled buttons while checking", async () => {
    let answer: (r: Response) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input) === "/api/health"
          ? new Promise<Response>((resolve) => (answer = resolve))
          : Response.json(String(input) === "/api/sync" ? SYNCED.body : SESSION.body),
      ),
    );
    renderApp("/import");
    expect(screen.getByRole("button", { name: "Take photo" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Choose from library" })).toBeDisabled();
    expect(fileInput()).toBeNull();
    answer(Response.json({ ok: true }));
    await waitFor(() => expect(fileInput()).not.toBeNull());
    expect(fileInput()).toHaveAttribute("capture", "environment");
    expect(fileInput()).toHaveAttribute("accept", "image/*");
  });
});
