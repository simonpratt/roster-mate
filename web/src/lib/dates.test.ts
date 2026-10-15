// Runs under a non-UTC timezone: a date that went through UTC would come out a day early here.
// Node re-reads TZ when it is assigned, so this applies to every Date made below.
process.env.TZ = "Australia/Sydney";

import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  daysBetween,
  formatLongDate,
  formatMonth,
  formatShortDate,
  monthGridDates,
  todayDate,
  weekdayIndex,
} from "./dates";

describe("dates under TZ=Australia/Sydney", () => {
  it("is really running ahead of UTC", () => {
    expect(new Date(2026, 3, 5).getTimezoneOffset()).toBeLessThan(0);
  });

  it("keeps 2026-04-05 as 2026-04-05", () => {
    // 2026-04-05 is the day daylight saving ends in Sydney.
    expect(addDays("2026-04-05", 0)).toBe("2026-04-05");
    expect(addDays("2026-04-04", 1)).toBe("2026-04-05");
    expect(addDays("2026-04-06", -1)).toBe("2026-04-05");
    expect(addDays("2026-04-05", 1)).toBe("2026-04-06");
    expect(formatShortDate("2026-04-05")).toBe("Sun 5 Apr");
    expect(daysBetween("2026-04-04", "2026-04-06")).toBe(2);
  });

  it("reads today from the local clock, not UTC", () => {
    // 00:30 on 5 April in Sydney is still 4 April in UTC.
    const justAfterMidnight = new Date(2026, 3, 5, 0, 30);
    expect(justAfterMidnight.toISOString().slice(0, 10)).toBe("2026-04-04");
    expect(todayDate(justAfterMidnight)).toBe("2026-04-05");
  });
});

describe("month grid", () => {
  it("runs Monday 26 Oct to Sunday 6 Dec for November 2026", () => {
    const dates = monthGridDates("2026-11");
    expect(dates).toHaveLength(42);
    expect(dates[0]).toBe("2026-10-26");
    expect(weekdayIndex(dates[0]!)).toBe(0);
    expect(dates[41]).toBe("2026-12-06");
    expect(weekdayIndex(dates[41]!)).toBe(6);
  });

  it("starts on the 1st when the month starts on a Monday", () => {
    expect(monthGridDates("2026-06")[0]).toBe("2026-06-01");
  });
});

describe("formatting and months", () => {
  it("formats en-AU style", () => {
    expect(formatShortDate("2026-11-06")).toBe("Fri 6 Nov");
    expect(formatLongDate("2026-11-03")).toBe("Tuesday 3 November");
    expect(formatMonth("2026-11")).toBe("November 2026");
  });

  it("moves across years", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});
