import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, type ShiftRow } from "../db";
import { setShift } from "../shifts/repo";
import { renderApp, setOnline, stubFetch } from "../test-utils";

// setShift stays real, wrapped so the tests can see how the sheet calls it.
vi.mock("../shifts/repo", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../shifts/repo")>();
  return { ...actual, setShift: vi.fn(actual.setShift) };
});

function seed(rows: Record<string, string>) {
  const shifts: ShiftRow[] = Object.entries(rows).map(([date, code]) => ({ date, code, editedAt: 1 }));
  return db.shifts.bulkPut(shifts);
}

/** Opens the app offline, so pending edits stay in the outbox, and taps the date cell named. */
async function openSheet(cellName: string) {
  renderApp("/");
  await screen.findByText("Offline");
  const cell = await screen.findByRole("button", { name: cellName });
  fireEvent.click(cell);
  return { cell, sheet: await screen.findByRole("dialog") };
}

const radio = (sheet: HTMLElement, name: string) => within(sheet).getByRole("radio", { name });
const saveButton = (sheet: HTMLElement) => within(sheet).getByRole("button", { name: "Save" });

beforeEach(() => {
  // Sunday 15 November 2026, 9 am local time; only Date is faked.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 15, 9, 0));
  vi.mocked(setShift).mockClear();
  setOnline(false);
  stubFetch({});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Edit sheet", () => {
  it("shows the edit as pending until it syncs", async () => {
    // Online, with /api/sync held until answered.
    setOnline(true);
    let answer: ((r: Response) => void) | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === "/api/session") return Response.json({ username: "simon" });
        return new Promise<Response>((resolve) => (answer = resolve));
      }),
    );
    const answerSync = async () => {
      await waitFor(() => expect(answer).not.toBeNull());
      answer!(Response.json({ rev: 1, dbId: "db", shifts: [] }));
      answer = null;
    };
    await seed({ "2026-11-03": "E" });
    renderApp("/");
    await answerSync();
    expect(await screen.findByText("Synced")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Tuesday 3 November, Early" }));
    const sheet = await screen.findByRole("dialog");
    fireEvent.click(radio(sheet, "L, Late"));
    fireEvent.click(saveButton(sheet));

    expect(await screen.findByRole("button", { name: "Tuesday 3 November, Late" })).toBeInTheDocument();
    expect(await screen.findByText("1 pending")).toBeInTheDocument();
    await answerSync();
    expect(await screen.findByText("Synced")).toBeInTheDocument();
  });


  it("changes E to L, and the grid shows L", async () => {
    await seed({ "2026-11-03": "E" });
    const { cell, sheet } = await openSheet("Tuesday 3 November, Early");

    expect(sheet).toHaveAccessibleName("Tuesday 3 November");
    expect(within(sheet).getByText("Currently Early")).toBeInTheDocument();
    expect(radio(sheet, "E, Early")).toBeChecked();
    expect(within(sheet).getByText("To remove a shift, set it to Day off.")).toBeInTheDocument();

    fireEvent.click(radio(sheet, "L, Late"));
    expect(radio(sheet, "L, Late")).toBeChecked();
    expect(radio(sheet, "E, Early")).not.toBeChecked();
    fireEvent.click(saveButton(sheet));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(setShift).toHaveBeenCalledExactlyOnceWith("2026-11-03", "L");
    expect(await screen.findByRole("button", { name: "Tuesday 3 November, Late" })).toHaveTextContent("3L");
    expect(await db.outbox.get("2026-11-03")).toEqual({ date: "2026-11-03", code: "L", editedAt: expect.any(Number) });
    // Focus is back on the tapped date.
    expect(cell).toHaveFocus();
  });

  it("sets L to Day off, and the grid shows Day off", async () => {
    await seed({ "2026-11-04": "L" });
    const { sheet } = await openSheet("Wednesday 4 November, Late");
    fireEvent.click(radio(sheet, "X, Day off"));
    fireEvent.click(saveButton(sheet));

    expect(await screen.findByRole("button", { name: "Wednesday 4 November, Day off" })).toHaveTextContent("4X");
    expect(await db.shifts.get("2026-11-04")).toMatchObject({ code: "X" });
  });

  it("needs a code on an unrostered date", async () => {
    const { sheet } = await openSheet("Thursday 5 November, no shift");
    expect(within(sheet).getByText("Not rostered yet")).toBeInTheDocument();
    expect(within(sheet).queryByRole("radio", { checked: true })).not.toBeInTheDocument();
    expect(saveButton(sheet)).toBeDisabled();

    fireEvent.click(radio(sheet, "D, Day"));
    expect(saveButton(sheet)).toBeEnabled();
    fireEvent.click(saveButton(sheet));
    await waitFor(() => expect(setShift).toHaveBeenCalledExactlyOnceWith("2026-11-05", "D"));
  });

  it("keeps Save disabled until something changes", async () => {
    await seed({ "2026-11-03": "E" });
    const { sheet } = await openSheet("Tuesday 3 November, Early");
    expect(saveButton(sheet)).toBeDisabled();

    // Tapping the selected code again changes nothing.
    fireEvent.click(radio(sheet, "E, Early"));
    expect(saveButton(sheet)).toBeDisabled();
    fireEvent.click(radio(sheet, "N, Night"));
    expect(saveButton(sheet)).toBeEnabled();
    fireEvent.click(radio(sheet, "E, Early"));
    expect(saveButton(sheet)).toBeDisabled();
  });

  it("closes without writing on Cancel, a backdrop tap or Escape", async () => {
    await seed({ "2026-11-03": "E" });
    const { cell, sheet } = await openSheet("Tuesday 3 November, Early");
    fireEvent.click(radio(sheet, "L, Late"));
    fireEvent.click(within(sheet).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(cell).toHaveFocus();

    fireEvent.click(cell);
    fireEvent.click(radio(await screen.findByRole("dialog"), "L, Late"));
    fireEvent.click(screen.getByTestId("sheet-backdrop"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    fireEvent.click(cell);
    fireEvent.click(radio(await screen.findByRole("dialog"), "L, Late"));
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    expect(setShift).not.toHaveBeenCalled();
    expect(await db.outbox.count()).toBe(0);
    expect(await db.shifts.get("2026-11-03")).toMatchObject({ code: "E" });
  });

  it("keeps Tab inside the sheet", async () => {
    await seed({ "2026-11-03": "E" });
    const { sheet } = await openSheet("Tuesday 3 November, Early");
    expect(sheet).toHaveFocus();
    // Save is disabled, so Cancel is last and Tab wraps to the first code.
    const cancel = within(sheet).getByRole("button", { name: "Cancel" });
    cancel.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(radio(sheet, "D, Day")).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(cancel).toHaveFocus();
  });

  it("saves an Other code from its letters, upper-cased", async () => {
    const { sheet } = await openSheet("Thursday 5 November, no shift");
    expect(within(sheet).queryByLabelText(/Code/)).not.toBeInTheDocument();
    fireEvent.click(radio(sheet, "Other"));
    const input = within(sheet).getByLabelText(/Code/);
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute("maxlength", "2");
    // Other with no letters yet can't be saved.
    expect(radio(sheet, "Other")).toBeChecked();
    expect(saveButton(sheet)).toBeDisabled();

    fireEvent.change(input, { target: { value: "s3e" } });
    expect(input).toHaveValue("SE");
    expect(radio(sheet, "Other, SE")).toBeChecked();
    fireEvent.click(saveButton(sheet));

    await waitFor(() => expect(setShift).toHaveBeenCalledExactlyOnceWith("2026-11-05", "SE"));
    expect(await screen.findByRole("button", { name: "Thursday 5 November, SE" })).toHaveTextContent("5SE");
  });

  it("opens an Other code with Other selected, and typing a standard code selects its button", async () => {
    await seed({ "2026-11-20": "XD" });
    const { sheet } = await openSheet("Friday 20 November, XD");
    expect(within(sheet).getByText("Currently Other · XD")).toBeInTheDocument();
    expect(radio(sheet, "Other, XD")).toBeChecked();
    const input = within(sheet).getByLabelText(/Code/);
    expect(input).toHaveValue("XD");
    expect(input).not.toHaveFocus();

    fireEvent.change(input, { target: { value: "d" } });
    expect(radio(sheet, "D, Day")).toBeChecked();
    expect(radio(sheet, "Other")).not.toBeChecked();

    fireEvent.change(input, { target: { value: "" } });
    expect(radio(sheet, "Other")).toBeChecked();
    expect(saveButton(sheet)).toBeDisabled();

    // The input stays open, so an Other code starting with a standard letter can be typed.
    fireEvent.change(input, { target: { value: "X" } });
    expect(radio(sheet, "X, Day off")).toBeChecked();
    fireEvent.change(input, { target: { value: "XA" } });
    expect(radio(sheet, "Other, XA")).toBeChecked();

    fireEvent.change(input, { target: { value: "D" } });
    fireEvent.click(saveButton(sheet));
    await waitFor(() => expect(setShift).toHaveBeenCalledExactlyOnceWith("2026-11-20", "D"));
  });

  it("adds the year to the heading outside the current year", async () => {
    renderApp("/");
    await screen.findByText("Offline");
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    fireEvent.click(screen.getByRole("button", { name: "Monday 4 January, no shift" }));
    expect(await screen.findByRole("dialog")).toHaveAccessibleName("Monday 4 January 2027");
  });
});
