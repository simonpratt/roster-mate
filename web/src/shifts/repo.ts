// Reading and writing shifts on the phone. Every write is a pending edit: it goes to `shifts` and
// `outbox` in one transaction and then triggers a sync (docs/design.md § Sync protocol).
import { useLiveQuery } from "dexie-react-hooks";
import { db, type ShiftRow } from "../db";
import { sync } from "../sync/engine";
import { isValidCode, type ShiftCode } from "./codes";

/** A shift on a date. Rows with the reserved `code: null` marker are unrostered, not shifts. */
export interface Shift {
  date: string;
  code: ShiftCode;
  note: string;
}

export interface ShiftEdit {
  date: string;
  code: ShiftCode;
  note?: string;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function toRow(edit: ShiftEdit, editedAt: number): ShiftRow {
  if (!DATE_PATTERN.test(edit.date)) throw new Error(`invalid date: ${edit.date}`);
  if (!isValidCode(edit.code)) throw new Error(`invalid shift code: ${edit.code}`);
  return { date: edit.date, code: edit.code, note: edit.note ?? "", editedAt };
}

/** Saves one shift. The UI always writes a code; Day off (X) is how a shift is removed. */
export async function setShift(date: string, code: ShiftCode, note = ""): Promise<void> {
  await setShifts([{ date, code, note }]);
}

/** Saves many shifts in one transaction with one sync trigger, as an import does. */
export async function setShifts(edits: ShiftEdit[]): Promise<void> {
  const editedAt = Date.now();
  const rows = edits.map((e) => toRow(e, editedAt));
  await db.transaction("rw", db.shifts, db.outbox, async () => {
    await db.shifts.bulkPut(rows);
    await db.outbox.bulkPut(rows);
  });
  void sync.trigger();
}

function toShift(row: ShiftRow | undefined): Shift | undefined {
  if (!row || row.code === null) return undefined;
  return { date: row.date, code: row.code, note: row.note };
}

/**
 * The shifts dated from..to (inclusive, YYYY-MM-DD), in date order; undefined while loading.
 * Unrostered dates are absent.
 */
export function useShiftsInRange(from: string, to: string): Shift[] | undefined {
  return useLiveQuery(async () => {
    const rows = await db.shifts.where("date").between(from, to, true, true).toArray();
    return rows.map(toShift).filter((s): s is Shift => s !== undefined);
  }, [from, to]);
}

/**
 * The shifts on the given dates, keyed by date, as the import review compares against them;
 * undefined while loading. Unrostered dates are absent.
 */
export function useShiftsOn(dates: readonly string[]): Map<string, Shift> | undefined {
  const key = dates.join(",");
  const result = useLiveQuery(async () => {
    const rows = await db.shifts.bulkGet(key ? key.split(",") : []);
    const shifts = rows.map(toShift).filter((s): s is Shift => s !== undefined);
    return { key, shifts: new Map(shifts.map((s) => [s.date, s])) };
  }, [key]);
  // useLiveQuery keeps the previous answer while a new query runs; never show it for other dates.
  return result?.key === key ? result.shifts : undefined;
}

/** The shift on date: undefined while loading, null for an unrostered date. */
export function useShift(date: string): Shift | null | undefined {
  return useLiveQuery(async () => toShift(await db.shifts.get(date)) ?? null, [date]);
}

/** Whether the phone holds any shifts (rostered or not); undefined while loading. */
export function useHasLocalShifts(): boolean | undefined {
  return useLiveQuery(async () => (await db.shifts.count()) > 0, []);
}

/** The next shift: the first working shift dated today or later; undefined while loading. */
export function useNextShift(today: string): Shift | null | undefined {
  return useLiveQuery(async () => {
    const row = await db.shifts
      .where("date")
      .aboveOrEqual(today)
      // A working shift: any code except X (Day off), Other codes included.
      .filter((r) => r.code !== null && r.code !== "X")
      .first();
    return toShift(row) ?? null;
  }, [today]);
}
