import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { db } from "../db";
import { daysBetween } from "../lib/dates";
import { babysitterShare, shareWindow, useBabysitterShare } from "./share";

const spans56 = ({ start, end }: { start: string; end: string }) => daysBetween(start, end) + 1 === 56;

describe("shareWindow", () => {
  it("ends on the last working shift when that is after today", () => {
    const window = shareWindow("2026-10-18", [
      { date: "2026-10-10", code: "D" },
      { date: "2026-11-08", code: "N" },
      { date: "2026-10-30", code: "SE" },
    ]);
    expect(window).toEqual({ start: "2026-09-14", end: "2026-11-08" });
    expect(spans56(window)).toBe(true);
  });

  it("ends on today when every working shift is earlier, or there are none", () => {
    expect(shareWindow("2026-10-18", [{ date: "2026-10-01", code: "L" }])).toEqual({
      start: "2026-08-24",
      end: "2026-10-18",
    });
    expect(shareWindow("2026-10-18", [])).toEqual({ start: "2026-08-24", end: "2026-10-18" });
  });

  it("isn't extended by a Day off or an unrostered date after the last working shift", () => {
    const window = shareWindow("2026-10-18", [
      { date: "2026-10-25", code: "E" },
      { date: "2026-10-30", code: "X" },
      { date: "2026-11-02", code: null },
    ]);
    expect(window.end).toBe("2026-10-25");
  });

  it("spans 56 dates across a month and a year boundary", () => {
    const window = shareWindow("2026-12-07", [{ date: "2027-01-24", code: "D" }]);
    expect(window).toEqual({ start: "2026-11-30", end: "2027-01-24" });
    expect(spans56(window)).toBe(true);
    const march = shareWindow("2027-03-01", []);
    expect(march).toEqual({ start: "2027-01-05", end: "2027-03-01" });
    expect(spans56(march)).toBe(true);
  });
});

describe("babysitterShare", () => {
  const window = { start: "2026-08-24", end: "2026-10-18" };

  it("counts each named date in the window once, ignoring case, and leaves out the rest", () => {
    const share = babysitterShare(
      [
        { date: "2026-08-23", name: "Dad" }, // before the window
        { date: "2026-08-24", name: "Mum" }, // first date
        { date: "2026-09-01", name: "mum" },
        { date: "2026-09-02", name: "" }, // cleared
        { date: "2026-09-03", name: "Dad" },
        { date: "2026-10-18", name: "MUM" }, // last date
        { date: "2026-10-19", name: "Dad" }, // after
      ],
      window,
    );
    expect(share).toEqual({
      ...window,
      entries: [
        { name: "Mum", count: 3, percent: 75 },
        { name: "Dad", count: 1, percent: 25 },
      ],
    });
  });

  it("uses the spelling knownBabysitters picks, from the earliest date overall", () => {
    const share = babysitterShare(
      [
        { date: "2026-01-01", name: "mum" },
        { date: "2026-09-01", name: "Mum" },
      ],
      window,
    );
    expect(share.entries).toEqual([{ name: "mum", count: 1, percent: 100 }]);
  });

  it("sorts by count, then A–Z, with whole percentages left unadjusted", () => {
    const rows = [
      ["2026-09-01", "Zoe"],
      ["2026-09-02", "Mum"],
      ["2026-09-03", "Dad"],
    ].map(([date, name]) => ({ date: date!, name: name! }));
    expect(babysitterShare(rows, window).entries).toEqual([
      { name: "Dad", count: 1, percent: 33 },
      { name: "Mum", count: 1, percent: 33 },
      { name: "Zoe", count: 1, percent: 33 },
    ]);

    const more = [...rows, { date: "2026-09-04", name: "Zoe" }, { date: "2026-09-05", name: "Zoe" }];
    expect(babysitterShare(more, window).entries).toEqual([
      { name: "Zoe", count: 3, percent: 60 },
      { name: "Dad", count: 1, percent: 20 },
      { name: "Mum", count: 1, percent: 20 },
    ]);
  });

  it("has no entries with no named date in the window", () => {
    expect(babysitterShare([{ date: "2026-01-01", name: "Mum" }], window).entries).toEqual([]);
    expect(babysitterShare([], window).entries).toEqual([]);
  });
});

describe("useBabysitterShare", () => {
  it("reads the window and counts from IndexedDB, tentative and confirmed, with or without a shift", async () => {
    await db.shifts.bulkPut([
      { date: "2026-10-10", code: "D", editedAt: 1 },
      { date: "2026-10-25", code: "L", editedAt: 1 },
      { date: "2026-10-28", code: "X", editedAt: 1 },
      { date: "2026-10-29", code: null, editedAt: 1 },
    ]);
    await db.babysitters.bulkPut([
      { date: "2026-08-30", name: "Dad", confirmed: true, editedAt: 1 }, // the day before the window
      { date: "2026-10-10", name: "Mum", confirmed: false, editedAt: 1 },
      { date: "2026-10-12", name: "Mum", confirmed: true, editedAt: 1 }, // no shift
      { date: "2026-10-28", name: "Dad", confirmed: false, editedAt: 1 }, // after the window
    ]);

    const { result } = renderHook(() => useBabysitterShare("2026-10-18"));
    await waitFor(() =>
      expect(result.current).toEqual({
        start: "2026-08-31",
        end: "2026-10-25",
        entries: [{ name: "Mum", count: 2, percent: 100 }],
      }),
    );
  });
});
