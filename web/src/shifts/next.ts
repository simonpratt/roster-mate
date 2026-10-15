// How the Next shift (CONTEXT.md) reads; repo.ts useNextShift finds it.
import { daysBetween, formatShortDate, type DateString } from "../lib/dates";
import { codeInfo } from "./codes";
import type { Shift } from "./repo";

/**
 * "Today · Day", "Tomorrow · Late", "Fri 6 Nov · Night", "Tomorrow · SE" (an Other code shows
 * its letters), or "No upcoming shifts".
 */
export function nextShiftText(next: Shift | undefined, today: DateString): string {
  if (!next) return "No upcoming shifts";
  const days = daysBetween(today, next.date);
  const when = days === 0 ? "Today" : days === 1 ? "Tomorrow" : formatShortDate(next.date);
  return `${when} · ${codeInfo(next.code).label}`;
}
