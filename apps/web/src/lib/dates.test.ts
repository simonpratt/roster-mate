// Runs under a non-UTC timezone: a date that went through UTC would come out a day early here.
// Node re-reads TZ when it is assigned, so this applies to every Date made below.
process.env.TZ = "Australia/Sydney";

import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  daysBetween,
  formatDateRange,
  formatDayMonth,
  formatHeadingDate,
  formatLongDate,
  formatMonth,
  formatShortDate,
  monthDates,
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

describe("month dates", () => {
  it("runs the 1st to the last of the month", () => {
    const dates = monthDates("2026-11");
    expect(dates).toHaveLength(30);
    expect(dates[0]).toBe("2026-11-01");
    expect(weekdayIndex(dates[0]!)).toBe(6);
    expect(dates[29]).toBe("2026-11-30");
  });

  it("knows February's length", () => {
    expect(monthDates("2027-02")).toHaveLength(28);
    expect(monthDates("2028-02").at(-1)).toBe("2028-02-29");
  });
});

describe("formatting and months", () => {
  it("formats en-AU style", () => {
    expect(formatShortDate("2026-11-06")).toBe("Fri 6 Nov");
    expect(formatLongDate("2026-11-03")).toBe("Tuesday 3 November");
    expect(formatMonth("2026-11")).toBe("November 2026");
  });

  it("adds the year to a heading date only outside today's year", () => {
    expect(formatHeadingDate("2026-11-04", "2026-11-15")).toBe("Wednesday 4 November");
    expect(formatHeadingDate("2027-01-04", "2026-11-15")).toBe("Monday 4 January 2027");
  });

  it("formats a range with the year only on an end outside today's year", () => {
    expect(formatDayMonth("2026-08-24", "2026-10-18")).toBe("24 Aug");
    expect(formatDateRange("2026-08-24", "2026-10-18", "2026-10-18")).toBe("24 Aug – 18 Oct");
    expect(formatDateRange("2026-11-30", "2027-01-24", "2026-12-07")).toBe("30 Nov – 24 Jan 2027");
    expect(formatDateRange("2026-11-30", "2027-01-24", "2027-01-02")).toBe("30 Nov 2026 – 24 Jan");
  });

  it("moves across years", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});
