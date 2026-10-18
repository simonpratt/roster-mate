import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../db";
import { sync } from "../sync/engine";
import {
  confirmBabysitter,
  knownBabysitters,
  needsBabysitter,
  saveDate,
  useBabysittersInRange,
  useDate,
  useDatesNeedingBabysitter,
  useEventCounts,
  useKnownBabysitters,
  useUpcomingBabysitters,
} from "./repo";

const ID_1 = "00000000-0000-4000-8000-000000000001";
const ID_2 = "00000000-0000-4000-8000-000000000002";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

beforeEach(() => {
  // Sync is out of the picture here: the engine has its own tests.
  vi.spyOn(sync, "trigger").mockResolvedValue();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("saveDate", () => {
  it("writes the code, babysitter and added, changed and removed events in one transaction with one editedAt", async () => {
    await db.events.bulkPut([
      { id: ID_1, date: "2026-11-03", text: "Dentist 3pm", createdAt: 100, editedAt: 100, rev: 1 },
      { id: ID_2, date: "2026-11-03", text: "Parcel", createdAt: 200, editedAt: 200, rev: 2 },
    ]);
    vi.spyOn(Date, "now").mockReturnValue(5000);
    const transaction = vi.spyOn(db, "transaction");

    await saveDate("2026-11-03", {
      code: "L",
      babysitter: { name: "  Mum ", confirmed: true },
      events: { added: [" School concert "], changed: [{ id: ID_1, text: "Dentist 4pm " }], removed: [ID_2] },
    });

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(sync.trigger).toHaveBeenCalledTimes(1);
    expect(await db.shifts.get("2026-11-03")).toEqual({ date: "2026-11-03", code: "L", editedAt: 5000 });
    expect(await db.outbox.get("2026-11-03")).toEqual({ date: "2026-11-03", code: "L", editedAt: 5000 });
    expect(await db.babysitters.get("2026-11-03")).toEqual({ date: "2026-11-03", name: "Mum", confirmed: true, editedAt: 5000 });
    expect(await db.babysitterOutbox.get("2026-11-03")).toEqual({
      date: "2026-11-03",
      name: "Mum",
      confirmed: true,
      editedAt: 5000,
    });

    const events = await db.events.toArray();
    const added = events.find((e) => e.id !== ID_1)!;
    expect(added.id).toMatch(UUID);
    expect(events).toEqual(
      expect.arrayContaining([
        { id: ID_1, date: "2026-11-03", text: "Dentist 4pm", createdAt: 100, editedAt: 5000 },
        { id: added.id, date: "2026-11-03", text: "School concert", createdAt: 5000, editedAt: 5000 },
      ]),
    );
    expect(events).toHaveLength(2);
    expect(await db.eventOutbox.toArray()).toEqual(
      expect.arrayContaining([
        { id: ID_1, date: "2026-11-03", text: "Dentist 4pm", deleted: false, createdAt: 100, editedAt: 5000 },
        { id: added.id, date: "2026-11-03", text: "School concert", deleted: false, createdAt: 5000, editedAt: 5000 },
        { id: ID_2, date: "2026-11-03", text: "", deleted: true, createdAt: 200, editedAt: 5000 },
      ]),
    );
    expect(await db.eventOutbox.count()).toBe(3);
  });

  it("writes only the parts given", async () => {
    await saveDate("2026-11-03", { babysitter: { name: "", confirmed: false } });
    expect(await db.babysitters.get("2026-11-03")).toMatchObject({ name: "", confirmed: false });
    expect(await db.shifts.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
    expect(await db.eventOutbox.count()).toBe(0);
  });

  it("rejects an invalid date, code, empty event or over-long text, writing nothing", async () => {
    await expect(saveDate("3/11/2026", { code: "L" })).rejects.toThrow("invalid date");
    await expect(saveDate("2026-11-03", { code: "l" as never })).rejects.toThrow("invalid shift code");
    await expect(saveDate("2026-11-03", { code: "L", events: { added: ["  "] } })).rejects.toThrow("empty");
    await expect(saveDate("2026-11-03", { events: { added: ["a".repeat(201)] } })).rejects.toThrow("longer");
    await expect(saveDate("2026-11-03", { babysitter: { name: "b".repeat(41), confirmed: false } })).rejects.toThrow("longer");
    expect(await db.shifts.count()).toBe(0);
    expect(await db.events.count()).toBe(0);
    expect(sync.trigger).not.toHaveBeenCalled();
  });
});

describe("date queries", () => {
  it("useDate gives the shift, babysitter and events in the order they were added", async () => {
    await db.shifts.put({ date: "2026-11-03", code: "E", editedAt: 1 });
    await db.babysitters.put({ date: "2026-11-03", name: "Mum", confirmed: true, editedAt: 1 });
    await db.events.bulkPut([
      { id: ID_2, date: "2026-11-03", text: "Second", createdAt: 200, editedAt: 1 },
      { id: ID_1, date: "2026-11-03", text: "First", createdAt: 100, editedAt: 1 },
      { id: "00000000-0000-4000-8000-000000000009", date: "2026-11-04", text: "Other date", createdAt: 1, editedAt: 1 },
    ]);
    const { result, rerender } = renderHook(({ date }) => useDate(date), { initialProps: { date: "2026-11-03" } });
    await waitFor(() =>
      expect(result.current).toEqual({
        shift: { date: "2026-11-03", code: "E" },
        babysitter: { name: "Mum", confirmed: true },
        events: [
          { id: ID_1, date: "2026-11-03", text: "First", createdAt: 100 },
          { id: ID_2, date: "2026-11-03", text: "Second", createdAt: 200 },
        ],
      }),
    );
    rerender({ date: "2026-11-05" });
    await waitFor(() => expect(result.current).toEqual({ shift: null, babysitter: { name: "", confirmed: false }, events: [] }));
  });

  it("useEventCounts and useBabysittersInRange cover the range, with named babysitters only", async () => {
    await db.events.bulkPut([
      { id: ID_1, date: "2026-11-03", text: "a", createdAt: 1, editedAt: 1 },
      { id: ID_2, date: "2026-11-03", text: "b", createdAt: 2, editedAt: 1 },
      { id: "00000000-0000-4000-8000-000000000003", date: "2026-11-30", text: "c", createdAt: 1, editedAt: 1 },
      { id: "00000000-0000-4000-8000-000000000004", date: "2026-12-01", text: "d", createdAt: 1, editedAt: 1 },
    ]);
    await db.babysitters.bulkPut([
      { date: "2026-11-03", name: "Mum", confirmed: true, editedAt: 1 },
      { date: "2026-11-04", name: "", confirmed: false, editedAt: 1 },
      { date: "2026-12-01", name: "Dad", confirmed: false, editedAt: 1 },
    ]);
    const { result } = renderHook(() => ({
      counts: useEventCounts("2026-11-01", "2026-11-30"),
      sitters: useBabysittersInRange("2026-11-01", "2026-11-30"),
    }));
    await waitFor(() =>
      expect(result.current).toEqual({
        counts: new Map([
          ["2026-11-03", 2],
          ["2026-11-30", 1],
        ]),
        sitters: new Map([["2026-11-03", { name: "Mum", confirmed: true }]]),
      }),
    );
  });

  it("useKnownBabysitters gives each name once, ignoring case, sorted A–Z", async () => {
    await db.babysitters.bulkPut([
      { date: "2026-11-03", name: "Mum", confirmed: false, editedAt: 1 },
      { date: "2026-11-04", name: "mum", confirmed: false, editedAt: 1 },
      { date: "2026-11-05", name: "Dad", confirmed: false, editedAt: 1 },
      { date: "2026-11-06", name: "", confirmed: false, editedAt: 1 },
    ]);
    const { result } = renderHook(() => useKnownBabysitters());
    await waitFor(() => expect(result.current).toEqual(["Dad", "Mum"]));
    expect(knownBabysitters(["nan", "Aunty Jo", "Nan"])).toEqual(["Aunty Jo", "nan"]);
  });
});

describe("babysitter queries", () => {
  const today = "2026-11-15";

  beforeEach(async () => {
    await db.shifts.bulkPut([
      { date: "2026-11-14", code: "D", editedAt: 1 }, // past
      { date: "2026-11-15", code: "E", editedAt: 1 },
      { date: "2026-11-16", code: "X", editedAt: 1 }, // day off
      { date: "2026-11-17", code: "L", editedAt: 1 },
      { date: "2026-11-18", code: "SE", editedAt: 1 },
      { date: "2026-11-19", code: null, editedAt: 1 }, // unrostered
      { date: "2026-11-20", code: "N", editedAt: 1 },
    ]);
    await db.babysitters.bulkPut([
      { date: "2026-11-14", name: "Mum", confirmed: false, editedAt: 1 },
      { date: "2026-11-17", name: "Mum", confirmed: true, editedAt: 1 },
      { date: "2026-11-18", name: "", confirmed: false, editedAt: 1 }, // cleared
      { date: "2026-11-19", name: "Dad", confirmed: false, editedAt: 1 },
      { date: "2026-11-21", name: "mum", confirmed: false, editedAt: 1 }, // no shift row at all
    ]);
  });

  it("useUpcomingBabysitters gives each named babysitter from today on, with its shift code", async () => {
    const { result } = renderHook(() => useUpcomingBabysitters(today));
    await waitFor(() =>
      expect(result.current).toEqual([
        { date: "2026-11-17", name: "Mum", confirmed: true, code: "L" },
        { date: "2026-11-19", name: "Dad", confirmed: false, code: null },
        { date: "2026-11-21", name: "mum", confirmed: false, code: null },
      ]),
    );
  });

  it("useDatesNeedingBabysitter gives working shifts from today on with no named babysitter", async () => {
    const { result } = renderHook(() => useDatesNeedingBabysitter(today));
    await waitFor(() =>
      expect(result.current).toEqual([
        { date: "2026-11-15", code: "E" },
        { date: "2026-11-18", code: "SE" },
        { date: "2026-11-20", code: "N" },
      ]),
    );
  });
});

describe("confirmBabysitter", () => {
  it("confirms the matching tentative dates with one editedAt in one transaction, then syncs once", async () => {
    await db.babysitters.bulkPut([
      { date: "2026-11-14", name: "Mum", confirmed: false, editedAt: 1 }, // not asked for
      { date: "2026-11-17", name: "Mum", confirmed: false, editedAt: 1 },
      { date: "2026-11-18", name: "mum", confirmed: false, editedAt: 1 },
      { date: "2026-11-19", name: "Dad", confirmed: false, editedAt: 1 }, // renamed since
      { date: "2026-11-20", name: "Mum", confirmed: true, editedAt: 2 }, // already confirmed
      { date: "2026-11-21", name: "", confirmed: false, editedAt: 1 }, // cleared
    ]);
    vi.spyOn(Date, "now").mockReturnValue(7000);
    const transaction = vi.spyOn(db, "transaction");

    await confirmBabysitter("Mum", ["2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"]);

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(sync.trigger).toHaveBeenCalledTimes(1);
    expect(await db.babysitters.toArray()).toEqual([
      { date: "2026-11-14", name: "Mum", confirmed: false, editedAt: 1 },
      { date: "2026-11-17", name: "Mum", confirmed: true, editedAt: 7000 },
      { date: "2026-11-18", name: "mum", confirmed: true, editedAt: 7000 },
      { date: "2026-11-19", name: "Dad", confirmed: false, editedAt: 1 },
      { date: "2026-11-20", name: "Mum", confirmed: true, editedAt: 2 },
      { date: "2026-11-21", name: "", confirmed: false, editedAt: 1 },
    ]);
    expect(await db.babysitterOutbox.toArray()).toEqual([
      { date: "2026-11-17", name: "Mum", confirmed: true, editedAt: 7000 },
      { date: "2026-11-18", name: "mum", confirmed: true, editedAt: 7000 },
    ]);
  });

  it("writes nothing and doesn't sync when nothing matches", async () => {
    await confirmBabysitter("Mum", ["2026-11-17"]);
    expect(await db.babysitterOutbox.count()).toBe(0);
    expect(sync.trigger).not.toHaveBeenCalled();
    await expect(confirmBabysitter("Mum", ["17/11/2026"])).rejects.toThrow("invalid date");
  });
});

describe("needsBabysitter", () => {
  const today = "2026-11-15";
  it("is true only for a working shift dated today or later with no babysitter", () => {
    expect(needsBabysitter({ code: "D" }, "", today, today)).toBe(true);
    expect(needsBabysitter({ code: "SE" }, "", "2026-11-20", today)).toBe(true);
    expect(needsBabysitter({ code: "D" }, "Mum", today, today)).toBe(false);
    expect(needsBabysitter({ code: "X" }, "", today, today)).toBe(false);
    expect(needsBabysitter(null, "", today, today)).toBe(false);
    expect(needsBabysitter({ code: "N" }, "", "2026-11-14", today)).toBe(false);
  });
});
