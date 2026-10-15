// Dates are local calendar dates: `YYYY-MM-DD` strings with no time or zone (CONTEXT.md, Date).
// Arithmetic runs on the calendar date alone, as a count of days on a UTC timeline, so neither the
// phone's timezone nor a daylight-saving change can move a date. Only todayDate reads the local
// clock. Never use toISOString() or new Date("YYYY-MM-DD") for a date: both go through UTC.

/** A calendar date, `YYYY-MM-DD`. */
export type DateString = string;

/** A calendar month, `YYYY-MM`. */
export type MonthString = string;

const DAY_MS = 86_400_000;

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

function parts(date: DateString): [number, number, number] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new Error(`invalid date: ${date}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Days since 1970-01-01 for the calendar date. */
function dayNumber(date: DateString): number {
  const [y, m, d] = parts(date);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

function fromDayNumber(n: number): DateString {
  const t = new Date(n * DAY_MS);
  return `${pad(t.getUTCFullYear(), 4)}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** The phone's local date at `now`. */
export function todayDate(now: Date = new Date()): DateString {
  return `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** date moved by n days (n may be negative). */
export function addDays(date: DateString, n: number): DateString {
  return fromDayNumber(dayNumber(date) + n);
}

/** Whole days from a to b: 1 when b is the day after a. */
export function daysBetween(a: DateString, b: DateString): number {
  return dayNumber(b) - dayNumber(a);
}

/** 0 for Monday through 6 for Sunday. */
export function weekdayIndex(date: DateString): number {
  // 1970-01-01 was a Thursday (index 3).
  return (((dayNumber(date) + 3) % 7) + 7) % 7;
}

/** The month a date falls in. */
export function monthOf(date: DateString): MonthString {
  return date.slice(0, 7);
}

/** month moved by n months (n may be negative). */
export function addMonths(month: MonthString, n: number): MonthString {
  const [y, m] = parts(`${month}-01`);
  const index = y * 12 + (m - 1) + n;
  return `${pad(Math.floor(index / 12), 4)}-${pad((index % 12) + 1)}`;
}

/**
 * The 42 dates of a six-row, Monday-first month grid: the Monday on or before the 1st, then
 * 41 more, including the adjacent months' leading and trailing dates.
 */
export function monthGridDates(month: MonthString): DateString[] {
  const first = `${month}-01`;
  const start = addDays(first, -weekdayIndex(first));
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

function weekdayName(date: DateString): string {
  return WEEKDAYS[weekdayIndex(date)] ?? "";
}

/** The name of month m, 1–12. */
function monthName(m: number): string {
  return MONTHS[m - 1] ?? "";
}

/** "Fri 6 Nov", en-AU style. */
export function formatShortDate(date: DateString): string {
  const [, m, d] = parts(date);
  return `${weekdayName(date).slice(0, 3)} ${d} ${monthName(m).slice(0, 3)}`;
}

/** "Friday 6 November", en-AU style. */
export function formatLongDate(date: DateString): string {
  const [, m, d] = parts(date);
  return `${weekdayName(date)} ${d} ${monthName(m)}`;
}

/**
 * "Wednesday 4 November", with the year added when it isn't today's year:
 * "Monday 4 January 2027".
 */
export function formatHeadingDate(date: DateString, today: DateString): string {
  const year = parts(date)[0];
  return year === parts(today)[0] ? formatLongDate(date) : `${formatLongDate(date)} ${year}`;
}

/** "November 2026". */
export function formatMonth(month: MonthString): string {
  const [y, m] = parts(`${month}-01`);
  return `${monthName(m)} ${y}`;
}

/** The day of the month, 1–31. */
export function dayOfMonth(date: DateString): number {
  return parts(date)[2];
}
