// The babysitter share on the Babysitters screen (CONTEXT.md, Share and Share window;
// docs/ux-spec.md §6.5): how many dates each babysitter has in the eight weeks ending on the last
// working shift, or today if that is later.
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import { addDays, type DateString } from "../lib/dates";
import { isWorkingCode, type ShiftCode } from "../shifts/codes";
import { knownBabysitters } from "./repo";

/** The share window's first and last dates, both inclusive. */
export interface ShareWindow {
  start: DateString;
  end: DateString;
}

/** The share window's length in dates. */
export const SHARE_WINDOW_DATES = 56;

/**
 * The share window for today: it ends on the last date with a working shift (any code but Day
 * off; an unrostered date doesn't count), or on today if that is later, and spans 56 dates.
 */
export function shareWindow(
  today: DateString,
  shifts: readonly { date: DateString; code: ShiftCode | null }[],
): ShareWindow {
  let end = today;
  for (const s of shifts) {
    if (isWorkingCode(s.code) && s.date > end) end = s.date;
  }
  return { start: addDays(end, -(SHARE_WINDOW_DATES - 1)), end };
}

export interface ShareEntry {
  name: string;
  /** Dates in the window with this babysitter. */
  count: number;
  /** count as a whole-number percentage of all the window's dates with a babysitter. */
  percent: number;
}

export interface BabysitterShare extends ShareWindow {
  /** Most dates first, then A–Z. */
  entries: ShareEntry[];
}

/**
 * Each babysitter's dates in the window, whatever their status and whether or not they have a
 * shift. rows are every babysitter row in date order: names group ignoring case, under the
 * spelling knownBabysitters picks from all of them. Percentages are rounded and left unadjusted,
 * so they may not sum to 100.
 */
export function babysitterShare(
  rows: readonly { date: DateString; name: string }[],
  window: ShareWindow,
): BabysitterShare {
  const spelling = new Map(knownBabysitters(rows.map((r) => r.name)).map((n) => [n.toLocaleLowerCase(), n]));
  const counts = new Map<string, number>();
  let total = 0;
  for (const { date, name } of rows) {
    if (name === "" || date < window.start || date > window.end) continue;
    const key = name.toLocaleLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
    total++;
  }
  const entries = [...counts].map(([key, count]) => ({
    name: spelling.get(key) ?? key,
    count,
    percent: Math.round((100 * count) / total),
  }));
  entries.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return { ...window, entries };
}

/** The share for today, live from IndexedDB; undefined while loading. */
export function useBabysitterShare(today: DateString): BabysitterShare | undefined {
  const result = useLiveQuery(async () => {
    const lastWorking = await db.shifts
      .orderBy("date")
      .reverse()
      .filter((s) => isWorkingCode(s.code))
      .first();
    const rows = await db.babysitters.orderBy("date").toArray();
    return { today, share: babysitterShare(rows, shareWindow(today, lastWorking ? [lastWorking] : [])) };
  }, [today]);
  // useLiveQuery keeps the previous answer while a new query runs; never show it for another today.
  return result?.today === today ? result.share : undefined;
}
