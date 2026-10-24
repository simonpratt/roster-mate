// Reading shift history on the phone (docs/ux-spec.md §6.6, ADR 0004): the shift changes the
// server recorded, grouped by save, and the pending shift edits it hasn't recorded yet. Only the
// sync engine writes shiftChanges.
import { useLiveQuery } from "dexie-react-hooks";
import { db, type OutboxRow, type ShiftChangeRow } from "../db";
import { addDays, formatLongDate, formatShortDate, todayDate, type DateString } from "../lib/dates";
import { codeInfo, type ShiftCode } from "./codes";

/** One save: the shift changes with the same editedAt and source, by date. */
export interface ShiftChangeGroup {
  editedAt: number;
  source: ShiftChangeRow["source"];
  changes: ShiftChangeRow[];
}

/** Groups changes by save: newest first (editedAt, then highest rev), each group by date. */
export function groupShiftChanges(rows: readonly ShiftChangeRow[]): ShiftChangeGroup[] {
  const groups = new Map<string, ShiftChangeGroup & { maxRev: number }>();
  for (const row of rows) {
    const key = `${row.editedAt}|${row.source ?? ""}`;
    let group = groups.get(key);
    if (!group) {
      group = { editedAt: row.editedAt, source: row.source, changes: [], maxRev: row.rev };
      groups.set(key, group);
    }
    group.changes.push(row);
    group.maxRev = Math.max(group.maxRev, row.rev);
  }
  return [...groups.values()]
    .sort((a, b) => b.editedAt - a.editedAt || b.maxRev - a.maxRev)
    .map(({ editedAt, source, changes }) => ({
      editedAt,
      source,
      changes: changes.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.rev - b.rev)),
    }));
}

/** Every recorded shift change, grouped by save, newest first; undefined while loading. */
export function useShiftHistory(): ShiftChangeGroup[] | undefined {
  return useLiveQuery(async () => groupShiftChanges(await db.shiftChanges.toArray()), []);
}

/** The pending shift edits, by date; undefined while loading. */
export function usePendingShiftEdits(): OutboxRow[] | undefined {
  return useLiveQuery(() => db.outbox.orderBy("date").toArray(), []);
}

/** "8:42 am": the local time of day, en-AU style with lowercase am/pm. */
export function formatTime(at: Date): string {
  const h = at.getHours();
  return `${h % 12 || 12}:${String(at.getMinutes()).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

/**
 * The local date of an instant, from the phone's date today: "Today", "Yesterday" or
 * "Mon 12 Oct", with the year when it isn't this year. Also the Roster emails screen's last send.
 */
export function formatDayOf(at: Date, today: DateString): string {
  const date = todayDate(at);
  if (date === today) return "Today";
  if (date === addDays(today, -1)) return "Yesterday";
  return date.slice(0, 4) === today.slice(0, 4) ? formatShortDate(date) : `${formatShortDate(date)} ${date.slice(0, 4)}`;
}

/**
 * A group's heading from its editedAt and the phone's date today: "Today · 8:42 am",
 * "Yesterday · 9:05 pm" or "Mon 12 Oct · 7:15 pm", with the year when it isn't this year.
 */
export function groupHeading(editedAt: number, today: DateString): string {
  const at = new Date(editedAt);
  return `${formatDayOf(at, today)} · ${formatTime(at)}`;
}

const SOURCE_TEXT = { sheet: "Date sheet", import: "Import" } as const;

/** "Date sheet", "Import" or "Edit" (source unknown), then " · {n} shifts" when n > 1. */
export function groupSummary(source: ShiftChangeRow["source"], count: number): string {
  const text = source ? SOURCE_TEXT[source] : "Edit";
  return count > 1 ? `${text} · ${count} shifts` : text;
}

/** "{n} changes", or "1 change". */
export function pendingSummary(count: number): string {
  return count === 1 ? "1 change" : `${count} changes`;
}

const codeLabel = (code: ShiftCode | null) => (code === null ? "not rostered" : codeInfo(code).label);

/** "Friday 23 October, Day to SE"; an unrostered side reads "not rostered". */
export function changeLabel(date: DateString, from: ShiftCode | null, to: ShiftCode | null): string {
  return `${formatLongDate(date)}, ${codeLabel(from)} to ${codeLabel(to)}`;
}

/** "Saturday 17 October, Late, not synced yet". */
export function pendingLabel(date: DateString, code: ShiftCode | null): string {
  return `${formatLongDate(date)}, ${codeLabel(code)}, not synced yet`;
}
