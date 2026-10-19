// Runs under a non-UTC timezone, so a heading that went through UTC would show the wrong date.
process.env.TZ = "Australia/Sydney";

import { describe, expect, it } from "vitest";
import type { ShiftChangeRow } from "../db";
import {
  changeLabel,
  formatTime,
  groupHeading,
  groupShiftChanges,
  groupSummary,
  pendingLabel,
  pendingSummary,
} from "./history";

const at = (y: number, m: number, d: number, h: number, min: number) => new Date(y, m - 1, d, h, min).getTime();

const row = (rev: number, date: string, editedAt: number, source: ShiftChangeRow["source"]): ShiftChangeRow => ({
  rev,
  date,
  from: null,
  to: "D",
  source,
  editedAt,
});

describe("groupShiftChanges", () => {
  it("groups by editedAt and source, newest first, each group by date", () => {
    const groups = groupShiftChanges([
      row(1, "2026-10-24", 100, "import"),
      row(2, "2026-10-22", 100, "import"),
      row(3, "2026-10-20", 300, "sheet"),
      // Same editedAt as the import but a different source: its own group.
      row(4, "2026-10-21", 100, null),
      row(5, "2026-10-23", 400, "sheet"),
    ]);
    expect(groups.map((g) => [g.editedAt, g.source, g.changes.map((c) => c.date)])).toEqual([
      [400, "sheet", ["2026-10-23"]],
      [300, "sheet", ["2026-10-20"]],
      // Equal editedAt: the group with the highest rev first.
      [100, null, ["2026-10-21"]],
      [100, "import", ["2026-10-22", "2026-10-24"]],
    ]);
  });

  it("is empty for no changes", () => {
    expect(groupShiftChanges([])).toEqual([]);
  });
});

describe("headings and summaries", () => {
  const today = "2026-10-15";

  it("heads a group Today, Yesterday or the short date, then the local time", () => {
    expect(groupHeading(at(2026, 10, 15, 8, 42), today)).toBe("Today · 8:42 am");
    expect(groupHeading(at(2026, 10, 14, 21, 5), today)).toBe("Yesterday · 9:05 pm");
    expect(groupHeading(at(2026, 10, 12, 19, 15), today)).toBe("Mon 12 Oct · 7:15 pm");
    expect(groupHeading(at(2025, 12, 31, 0, 1), today)).toBe("Wed 31 Dec 2025 · 12:01 am");
    // 00:30 local is still the previous day in UTC: the local date counts.
    expect(groupHeading(at(2026, 10, 15, 0, 30), today)).toBe("Today · 12:30 am");
  });

  it("formats noon and midnight", () => {
    expect(formatTime(new Date(2026, 0, 1, 12, 0))).toBe("12:00 pm");
    expect(formatTime(new Date(2026, 0, 1, 0, 0))).toBe("12:00 am");
  });

  it("summarises the source and the count", () => {
    expect(groupSummary("sheet", 1)).toBe("Date sheet");
    expect(groupSummary("import", 6)).toBe("Import · 6 shifts");
    expect(groupSummary(null, 1)).toBe("Edit");
    expect(groupSummary(null, 2)).toBe("Edit · 2 shifts");
    expect(pendingSummary(1)).toBe("1 change");
    expect(pendingSummary(3)).toBe("3 changes");
  });

  it("labels rows", () => {
    expect(changeLabel("2026-10-23", "D", "SE")).toBe("Friday 23 October, Day to SE");
    expect(changeLabel("2026-10-24", null, "N")).toBe("Saturday 24 October, not rostered to Night");
    expect(changeLabel("2026-10-27", "X", null)).toBe("Tuesday 27 October, Day off to not rostered");
    expect(pendingLabel("2026-10-17", "L")).toBe("Saturday 17 October, Late, not synced yet");
  });
});
