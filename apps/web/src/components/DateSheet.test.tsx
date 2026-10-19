import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveDate } from "../dates/repo";
import { db, type ShiftRow } from "../db";
import { renderApp, setOnline, stubFetch } from "../test-utils";

// saveDate stays real, wrapped so the tests can see how the sheet calls it.
vi.mock("../dates/repo", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../dates/repo")>();
  return { ...actual, saveDate: vi.fn(actual.saveDate) };
});

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

/** Seeds events as [id, date, text], added in that order. */
function seedEvents(rows: [string, string, string][]) {
  return db.events.bulkPut(rows.map(([id, date, text], i) => ({ id, date, text, createdAt: i + 1, editedAt: 1 })));
}

/** Opens the app offline, so pending edits stay in the outbox, and taps the date cell named. */
async function openSheet(cellName: string) {
  renderApp("/");
  await screen.findByText("Offline");
  const cell = await screen.findByRole("button", { name: cellName });
  fireEvent.click(cell);
  const sheet = await screen.findByRole("dialog");
  // The sheet takes focus once its effects have run; wait for that so it can't steal focus later.
  await waitFor(() => expect(sheet).toHaveFocus());
  return { cell, sheet };
}

const radio = (sheet: HTMLElement, name: string) => within(sheet).getByRole("radio", { name });
const saveButton = (sheet: HTMLElement) => within(sheet).getByRole("button", { name: "Save" });
const sitterGroup = (sheet: HTMLElement) => within(sheet).getByRole("radiogroup", { name: "Babysitter" });
const sitterChip = (sheet: HTMLElement, name: string) => within(sitterGroup(sheet)).getByRole("radio", { name });
const eventInputs = (sheet: HTMLElement) => within(sheet).queryAllByRole("textbox", { name: "Event" });
const addEvent = (sheet: HTMLElement) => within(sheet).getByRole("textbox", { name: "Add a note or event" });

beforeEach(() => {
  // Sunday 15 November 2026, 9 am local time; only Date is faked.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 15, 9, 0));
  vi.mocked(saveDate).mockClear();
  setOnline(false);
  stubFetch({});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Date sheet", () => {
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
    expect(within(sheet).queryByText("To remove a shift, set it to Day off.")).not.toBeInTheDocument();

    fireEvent.click(radio(sheet, "L, Late"));
    expect(radio(sheet, "L, Late")).toBeChecked();
    expect(radio(sheet, "E, Early")).not.toBeChecked();
    fireEvent.click(saveButton(sheet));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(saveDate).toHaveBeenCalledExactlyOnceWith("2026-11-03", { code: "L" });
    expect(await screen.findByRole("button", { name: "Tuesday 3 November, Late" })).toHaveTextContent("3L");
    expect(await db.outbox.get("2026-11-03")).toEqual({ date: "2026-11-03", code: "L", editedAt: expect.any(Number), source: "sheet" });
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
    const shiftGroup = within(sheet).getByRole("radiogroup", { name: "Shift" });
    expect(within(shiftGroup).queryByRole("radio", { checked: true })).not.toBeInTheDocument();
    expect(saveButton(sheet)).toBeDisabled();

    fireEvent.click(radio(sheet, "D, Day"));
    expect(saveButton(sheet)).toBeEnabled();
    fireEvent.click(saveButton(sheet));
    await waitFor(() => expect(saveDate).toHaveBeenCalledExactlyOnceWith("2026-11-05", { code: "D" }));
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

    expect(saveDate).not.toHaveBeenCalled();
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

    await waitFor(() => expect(saveDate).toHaveBeenCalledExactlyOnceWith("2026-11-05", { code: "SE" }));
    expect(await screen.findByRole("button", { name: "Thursday 5 November, SE" })).toHaveTextContent("5SE");
  });

  it("opens an Other code with Other selected, and typing a standard code selects its button", async () => {
    await seed({ "2026-11-20": "XD" });
    const { sheet } = await openSheet("Friday 20 November, XD, no babysitter");
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
    await waitFor(() => expect(saveDate).toHaveBeenCalledExactlyOnceWith("2026-11-20", { code: "D" }));
  });

  it("adds the year to the heading outside the current year", async () => {
    // In December, so January 2027 is the month after today's.
    vi.setSystemTime(new Date(2026, 11, 20, 9, 0));
    renderApp("/");
    await screen.findByText("Offline");
    fireEvent.click(screen.getByRole("button", { name: "Monday 4 January, no shift" }));
    expect(await screen.findByRole("dialog")).toHaveAccessibleName("Monday 4 January 2027");
  });

  it("adds, edits and removes events and sets the babysitter with one Save", async () => {
    await seed({ "2026-11-24": "N" });
    await seedBabysitters({ "2026-11-02": "Mum", "2026-11-09": "Dad" });
    await seedEvents([
      ["e1", "2026-11-24", "Dentist 3pm"],
      ["e2", "2026-11-24", "Dry cleaning"],
      ["e3", "2026-11-24", "Call Jo"],
    ]);
    const { sheet } = await openSheet("Tuesday 24 November, Night, no babysitter, Dentist 3pm, Dry cleaning, Call Jo");

    // Events in the order they were added, then the empty Add a note or event line.
    expect(eventInputs(sheet).map((i) => (i as HTMLInputElement).value)).toEqual(["Dentist 3pm", "Dry cleaning", "Call Jo"]);
    expect(addEvent(sheet)).toHaveValue("");
    expect(addEvent(sheet)).toHaveAttribute("placeholder", "Add a note or event");
    expect(within(sheet).getByText("Notes and events")).toBeInTheDocument();
    expect(within(sheet).queryByText("Events")).not.toBeInTheDocument();
    expect(eventInputs(sheet)[0]).toHaveAttribute("maxlength", "200");

    // None, the known names A–Z, then Someone else.
    expect(within(sitterGroup(sheet)).getAllByRole("radio").map((r) => r.textContent)).toEqual([
      "None",
      "Dad",
      "Mum",
      "+ Someone else",
    ]);
    expect(sitterChip(sheet, "None")).toBeChecked();
    fireEvent.click(sitterChip(sheet, "Mum"));
    expect(sitterChip(sheet, "Mum")).toBeChecked();
    expect(sitterChip(sheet, "None")).not.toBeChecked();

    fireEvent.change(eventInputs(sheet)[0]!, { target: { value: "Dentist 4pm " } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Remove event: Dry cleaning" }));
    fireEvent.change(eventInputs(sheet)[1]!, { target: { value: "  " } });
    fireEvent.change(addEvent(sheet), { target: { value: " Swimming" } });
    fireEvent.click(saveButton(sheet));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(saveDate).toHaveBeenCalledExactlyOnceWith("2026-11-24", {
      babysitter: { name: "Mum", confirmed: false },
      events: { added: ["Swimming"], changed: [{ id: "e1", text: "Dentist 4pm" }], removed: ["e2", "e3"] },
    });
    expect(
      await screen.findByRole("button", { name: "Tuesday 24 November, Night, babysitter Mum, tentative, Dentist 4pm, Swimming" }),
    ).toBeInTheDocument();
    expect((await db.events.where("date").equals("2026-11-24").sortBy("createdAt")).map((e) => e.text)).toEqual([
      "Dentist 4pm",
      "Swimming",
    ]);
    expect(await db.eventOutbox.get("e2")).toMatchObject({ deleted: true });
    expect(await db.babysitterOutbox.get("2026-11-24")).toMatchObject({ name: "Mum" });
  });

  it("changes and clears the babysitter", async () => {
    await seed({ "2026-11-24": "N", "2026-11-25": "D" });
    await seedBabysitters({ "2026-11-24": "Mum", "2026-11-25": "Dad" });
    let { sheet } = await openSheet("Tuesday 24 November, Night, babysitter Mum, tentative");
    expect(sitterChip(sheet, "Mum")).toBeChecked();
    expect(saveButton(sheet)).toBeDisabled();
    fireEvent.click(sitterChip(sheet, "Dad"));
    fireEvent.click(saveButton(sheet));
    expect(await screen.findByRole("button", { name: "Tuesday 24 November, Night, babysitter Dad, tentative" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Wednesday 25 November, Day, babysitter Dad, tentative" }));
    sheet = await screen.findByRole("dialog");
    fireEvent.click(sitterChip(sheet, "None"));
    fireEvent.click(saveButton(sheet));
    expect(await screen.findByRole("button", { name: "Wednesday 25 November, Day, no babysitter" })).toBeInTheDocument();
    expect(vi.mocked(saveDate).mock.calls).toEqual([
      ["2026-11-24", { babysitter: { name: "Dad", confirmed: false } }],
      ["2026-11-25", { babysitter: { name: "", confirmed: false } }],
    ]);
  });

  it("shows the Confirmed switch only while a name is picked, with the stored status", async () => {
    await seed({ "2026-11-24": "N" });
    await seedBabysitters({ "2026-11-24": ["Mum", true], "2026-11-25": "Dad" });
    const confirmedSwitch = (sheet: HTMLElement) => within(sheet).queryByRole("switch", { name: "Confirmed" });
    const { sheet } = await openSheet("Tuesday 24 November, Night, babysitter Mum, confirmed");

    // Opens with the stored status; a different name starts tentative, and the stored one is back.
    expect(confirmedSwitch(sheet)).toHaveAttribute("aria-checked", "true");
    expect(saveButton(sheet)).toBeDisabled();
    fireEvent.click(sitterChip(sheet, "Dad"));
    expect(confirmedSwitch(sheet)).toHaveAttribute("aria-checked", "false");
    fireEvent.click(sitterChip(sheet, "Mum"));
    expect(confirmedSwitch(sheet)).toHaveAttribute("aria-checked", "true");

    // Someone else: hidden until a name is typed; a typed name differing from the stored one is off.
    fireEvent.click(sitterChip(sheet, "Someone else"));
    expect(confirmedSwitch(sheet)).not.toBeInTheDocument();
    const name = within(sheet).getByRole("textbox", { name: "Name" });
    fireEvent.change(name, { target: { value: "Aunty Bec" } });
    expect(confirmedSwitch(sheet)).toHaveAttribute("aria-checked", "false");
    fireEvent.change(name, { target: { value: "MUM" } });
    expect(confirmedSwitch(sheet)).toHaveAttribute("aria-checked", "true");

    // None hides it.
    fireEvent.click(sitterChip(sheet, "None"));
    expect(confirmedSwitch(sheet)).not.toBeInTheDocument();

    // Toggling it alone enables Save and saves the same name with the new status.
    fireEvent.click(sitterChip(sheet, "Mum"));
    expect(saveButton(sheet)).toBeDisabled();
    fireEvent.click(confirmedSwitch(sheet)!);
    expect(confirmedSwitch(sheet)).toHaveAttribute("aria-checked", "false");
    expect(saveButton(sheet)).toBeEnabled();
    fireEvent.click(confirmedSwitch(sheet)!);
    expect(saveButton(sheet)).toBeDisabled();
    fireEvent.click(confirmedSwitch(sheet)!);
    fireEvent.click(saveButton(sheet));
    await waitFor(() =>
      expect(saveDate).toHaveBeenCalledExactlyOnceWith("2026-11-24", { babysitter: { name: "Mum", confirmed: false } }),
    );
    expect(await db.babysitterOutbox.get("2026-11-24")).toMatchObject({ name: "Mum", confirmed: false });
  });

  it("confirms a tentative babysitter, and None on a confirmed date saves tentative", async () => {
    await seed({ "2026-11-24": "N", "2026-11-25": "D" });
    await seedBabysitters({ "2026-11-24": "Mum", "2026-11-25": ["Dad", true] });
    let { sheet } = await openSheet("Tuesday 24 November, Night, babysitter Mum, tentative");
    const confirmedSwitch = within(sheet).getByRole("switch", { name: "Confirmed" });
    expect(confirmedSwitch).toHaveAttribute("aria-checked", "false");
    fireEvent.click(confirmedSwitch);
    fireEvent.click(saveButton(sheet));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await db.babysitters.get("2026-11-24")).toMatchObject({ name: "Mum", confirmed: true });

    fireEvent.click(screen.getByRole("button", { name: "Wednesday 25 November, Day, babysitter Dad, confirmed" }));
    sheet = await screen.findByRole("dialog");
    fireEvent.click(sitterChip(sheet, "None"));
    fireEvent.click(saveButton(sheet));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(vi.mocked(saveDate).mock.calls).toEqual([
      ["2026-11-24", { babysitter: { name: "Mum", confirmed: true } }],
      ["2026-11-25", { babysitter: { name: "", confirmed: false } }],
    ]);
  });

  it("writes nothing on Cancel after editing events and the babysitter", async () => {
    await seed({ "2026-11-24": "N" });
    await seedBabysitters({ "2026-11-02": "Mum" });
    await seedEvents([["e1", "2026-11-24", "Dentist 3pm"]]);
    const { sheet } = await openSheet("Tuesday 24 November, Night, no babysitter, Dentist 3pm");
    fireEvent.click(sitterChip(sheet, "Mum"));
    fireEvent.change(eventInputs(sheet)[0]!, { target: { value: "Dentist 4pm" } });
    fireEvent.change(addEvent(sheet), { target: { value: "Swimming" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    expect(saveDate).not.toHaveBeenCalled();
    expect(await db.eventOutbox.count()).toBe(0);
    expect(await db.babysitterOutbox.count()).toBe(0);
    expect(await db.events.get("e1")).toMatchObject({ text: "Dentist 3pm" });
  });

  it("saves an event and a babysitter on an unrostered date, which stays unrostered", async () => {
    const { sheet } = await openSheet("Thursday 26 November, no shift");
    expect(saveButton(sheet)).toBeDisabled();
    fireEvent.change(addEvent(sheet), { target: { value: "School concert" } });
    expect(saveButton(sheet)).toBeEnabled();
    fireEvent.click(sitterChip(sheet, "Someone else"));
    fireEvent.change(within(sheet).getByRole("textbox", { name: "Name" }), { target: { value: "Aunty Bec " } });
    fireEvent.click(saveButton(sheet));

    await waitFor(() =>
      expect(saveDate).toHaveBeenCalledExactlyOnceWith("2026-11-26", {
        babysitter: { name: "Aunty Bec", confirmed: false },
        events: { added: ["School concert"], changed: [], removed: [] },
      }),
    );
    expect(
      await screen.findByRole("button", { name: "Thursday 26 November, no shift, babysitter Aunty Bec, tentative, School concert" }),
    ).toBeInTheDocument();
    expect(await db.shifts.get("2026-11-26")).toBeUndefined();
    expect(await db.outbox.count()).toBe(0);
  });

  it("selects a known name typed under Someone else, and needs a name there", async () => {
    await seed({ "2026-11-24": "N" });
    await seedBabysitters({ "2026-11-02": "Mum" });
    const { sheet } = await openSheet("Tuesday 24 November, Night, no babysitter");
    expect(within(sheet).queryByRole("textbox", { name: "Name" })).not.toBeInTheDocument();

    fireEvent.click(sitterChip(sheet, "Someone else"));
    const name = within(sheet).getByRole("textbox", { name: "Name" });
    expect(name).toHaveFocus();
    expect(name).toHaveAttribute("maxlength", "40");
    expect(name).toHaveAttribute("autocapitalize", "words");
    expect(sitterChip(sheet, "Someone else")).toBeChecked();
    // A blank name can't be saved, even with another change.
    fireEvent.click(radio(sheet, "L, Late"));
    expect(saveButton(sheet)).toBeDisabled();
    fireEvent.change(name, { target: { value: "   " } });
    expect(saveButton(sheet)).toBeDisabled();

    fireEvent.change(name, { target: { value: " mum" } });
    expect(sitterChip(sheet, "Mum")).toBeChecked();
    expect(sitterChip(sheet, "Someone else")).not.toBeChecked();
    expect(name).toBeInTheDocument();
    expect(saveButton(sheet)).toBeEnabled();
    fireEvent.click(saveButton(sheet));
    // The known spelling is saved.
    await waitFor(() => expect(saveDate).toHaveBeenCalledExactlyOnceWith("2026-11-24", { code: "L", babysitter: { name: "Mum", confirmed: false } }));
  });

  it("shows Needs a babysitter while a weekday working shift from today on has none", async () => {
    await seed({ "2026-11-17": "D", "2026-11-13": "D", "2026-11-15": "D" });
    await seedBabysitters({ "2026-11-02": "Mum" });
    const needs = (sheet: HTMLElement) => within(sheet).queryByText("Needs a babysitter");

    let { sheet } = await openSheet("Tuesday 17 November, Day, no babysitter");
    expect(needs(sheet)).toBeInTheDocument();
    fireEvent.click(sitterChip(sheet, "Mum"));
    expect(needs(sheet)).not.toBeInTheDocument();
    fireEvent.click(sitterChip(sheet, "None"));
    expect(needs(sheet)).toBeInTheDocument();
    fireEvent.click(radio(sheet, "X, Day off"));
    expect(needs(sheet)).not.toBeInTheDocument();
    fireEvent.click(radio(sheet, "E, Early"));
    expect(needs(sheet)).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    // A past date never needs one.
    fireEvent.click(screen.getByRole("button", { name: "Friday 13 November, Day" }));
    sheet = await screen.findByRole("dialog");
    expect(needs(sheet)).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    // Nor does a weekend date, though it can still have one.
    fireEvent.click(screen.getByRole("button", { name: "Sunday 15 November, Day, today" }));
    sheet = await screen.findByRole("dialog");
    expect(needs(sheet)).not.toBeInTheDocument();
    fireEvent.click(sitterChip(sheet, "Mum"));
    expect(sitterChip(sheet, "Mum")).toBeChecked();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    // An unrostered date needs one once a working code is picked.
    fireEvent.click(screen.getByRole("button", { name: "Monday 16 November, no shift" }));
    sheet = await screen.findByRole("dialog");
    expect(needs(sheet)).not.toBeInTheDocument();
    fireEvent.click(radio(sheet, "N, Night"));
    expect(needs(sheet)).toBeInTheDocument();
  });

  it("turns the Add a note or event line into a row as it's typed in, and Enter moves to the next line", async () => {
    await seedEvents([["e1", "2026-11-24", "Dentist 3pm"]]);
    const { sheet } = await openSheet("Tuesday 24 November, no shift, Dentist 3pm");
    const add = addEvent(sheet);
    add.focus();
    fireEvent.change(add, { target: { value: "S" } });

    // The typed line is now an event row, still focused, with a new empty line below.
    expect(eventInputs(sheet)).toHaveLength(2);
    expect(eventInputs(sheet)[1]).toBe(add);
    expect(add).toHaveFocus();
    expect(within(sheet).getByRole("button", { name: "Remove event: S" })).toBeInTheDocument();
    const next = addEvent(sheet);
    expect(next).toHaveValue("");

    // Enter moves on without submitting.
    fireEvent.keyDown(eventInputs(sheet)[0]!, { key: "Enter" });
    expect(add).toHaveFocus();
    fireEvent.keyDown(add, { key: "Enter" });
    expect(next).toHaveFocus();
    expect(saveDate).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
