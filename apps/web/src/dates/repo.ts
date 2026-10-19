// Reading and writing a date's shift, babysitter and events on the phone (ADR 0003). A save is
// a pending edit for each part it changes: it goes to each part's table and outbox in one
// transaction and then triggers one sync (docs/design.md § Sync protocol). A shift edit made here
// carries `source: "sheet"` for its shift change (ADR 0004).
import { useLiveQuery } from "dexie-react-hooks";
import type { Table } from "dexie";
import { db, type EventRow } from "../db";
import { weekdayIndex } from "../lib/dates";
import { newId } from "../lib/uuid";
import { isWorkingCode, type ShiftCode } from "../shifts/codes";
import { checkCode, checkDate, toShift, type Shift } from "../shifts/repo";
import { sync } from "../sync/engine";
import type { DatedBabysitter } from "./babysitters";

/** An event on a date, as the UI shows it. */
export interface Event {
  id: string;
  date: string;
  text: string;
  createdAt: number;
}

/** The server's limits, in Unicode code points (docs/design.md § Sync protocol). */
export const EVENT_TEXT_MAX = 200;
export const BABYSITTER_NAME_MAX = 40;

/** A date's babysitter: `name: ""` is none, and `confirmed: false` is tentative. */
export interface BabysitterStatus {
  name: string;
  confirmed: boolean;
}

/** None: no babysitter on the date. */
export const NO_BABYSITTER: BabysitterStatus = { name: "", confirmed: false };

/** What a save changes on a date; absent parts are left as they are. */
export interface DateEdit {
  code?: ShiftCode;
  /** The babysitter; name "" clears it, and is always sent with `confirmed: false`. */
  babysitter?: BabysitterStatus;
  events?: {
    added?: string[];
    changed?: { id: string; text: string }[];
    removed?: string[];
  };
}

const length = (s: string) => [...s].length;

function checkText(text: string, max: number, what: string) {
  if (length(text) > max) throw new Error(`${what} longer than ${max} characters`);
}

function checkEventText(text: string) {
  if (text === "") throw new Error("empty event text");
  checkText(text, EVENT_TEXT_MAX, "event text");
}

/**
 * Saves the given parts of a date with one editedAt, in one transaction over the tables they
 * touch, then triggers one sync. Text and names are trimmed. A removed event is deleted locally
 * and queued as a tombstone.
 */
export async function saveDate(date: string, edit: DateEdit): Promise<void> {
  checkDate(date);
  if (edit.code !== undefined) checkCode(edit.code);
  const babysitter = edit.babysitter && { ...edit.babysitter, name: edit.babysitter.name.trim() };
  if (babysitter !== undefined) checkText(babysitter.name, BABYSITTER_NAME_MAX, "babysitter name");
  const added = (edit.events?.added ?? []).map((t) => t.trim());
  const changed = (edit.events?.changed ?? []).map((c) => ({ id: c.id, text: c.text.trim() }));
  const removed = edit.events?.removed ?? [];
  added.forEach(checkEventText);
  changed.forEach((c) => checkEventText(c.text));

  const tables: Table[] = [];
  if (edit.code !== undefined) tables.push(db.shifts, db.outbox);
  if (babysitter !== undefined) tables.push(db.babysitters, db.babysitterOutbox);
  const touchesEvents = added.length + changed.length + removed.length > 0;
  if (touchesEvents) tables.push(db.events, db.eventOutbox);
  if (tables.length === 0) return;

  const editedAt = Date.now();
  await db.transaction("rw", tables, async () => {
    if (edit.code !== undefined) {
      const row = { date, code: edit.code, editedAt };
      await db.shifts.put(row);
      await db.outbox.put({ ...row, source: "sheet" });
    }
    if (babysitter !== undefined) {
      const row = { date, name: babysitter.name, confirmed: babysitter.confirmed, editedAt };
      await db.babysitters.put(row);
      await db.babysitterOutbox.put(row);
    }
    for (const text of added) {
      const row: EventRow = { id: newId(), date, text, createdAt: editedAt, editedAt };
      await db.events.put(row);
      await db.eventOutbox.put({ ...row, deleted: false });
    }
    for (const { id, text } of changed) {
      // An event a sync has just deleted is put back: this edit is the newer one.
      const createdAt = (await db.events.get(id))?.createdAt ?? editedAt;
      const row: EventRow = { id, date, text, createdAt, editedAt };
      await db.events.put(row);
      await db.eventOutbox.put({ ...row, deleted: false });
    }
    for (const id of removed) {
      const createdAt = (await db.events.get(id))?.createdAt ?? editedAt;
      await db.events.delete(id);
      await db.eventOutbox.put({ id, date, text: "", deleted: true, createdAt, editedAt });
    }
  });
  void sync.trigger();
}

const byCreated = (a: EventRow, b: EventRow) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const toEvent = ({ id, date, text, createdAt }: EventRow): Event => ({ id, date, text, createdAt });

export interface DateContents {
  shift: Shift | null;
  /** The babysitter, or NO_BABYSITTER for none. */
  babysitter: BabysitterStatus;
  /** In the order they were added. */
  events: Event[];
}

/** Everything on a date; undefined while loading. */
export function useDate(date: string): DateContents | undefined {
  const result = useLiveQuery(async () => {
    const [shift, babysitter, events] = await Promise.all([
      db.shifts.get(date),
      db.babysitters.get(date),
      db.events.where("date").equals(date).toArray(),
    ]);
    return {
      date,
      contents: {
        shift: toShift(shift) ?? null,
        babysitter: babysitter ? { name: babysitter.name, confirmed: babysitter.confirmed } : NO_BABYSITTER,
        events: events.sort(byCreated).map(toEvent),
      },
    };
  }, [date]);
  // useLiveQuery keeps the previous answer while a new query runs; never show it for another date.
  return result?.date === date ? result.contents : undefined;
}

/** The number of events on each date from..to (inclusive) that has any; undefined while loading. */
export function useEventCounts(from: string, to: string): Map<string, number> | undefined {
  return useLiveQuery(async () => {
    const counts = new Map<string, number>();
    await db.events
      .where("date")
      .between(from, to, true, true)
      .each((e) => counts.set(e.date, (counts.get(e.date) ?? 0) + 1));
    return counts;
  }, [from, to]);
}

/** The babysitter on each date from..to (inclusive) that has one; undefined while loading. */
export function useBabysittersInRange(from: string, to: string): Map<string, BabysitterStatus> | undefined {
  return useLiveQuery(async () => {
    const rows = await db.babysitters.where("date").between(from, to, true, true).toArray();
    return new Map(
      rows.filter((b) => b.name !== "").map((b) => [b.date, { name: b.name, confirmed: b.confirmed }]),
    );
  }, [from, to]);
}

/**
 * Every babysitter name used on any date, once each ignoring case (the earliest date's spelling
 * wins), sorted A–Z; undefined while loading.
 */
export function useKnownBabysitters(): string[] | undefined {
  return useLiveQuery(async () => knownBabysitters((await db.babysitters.toArray()).map((b) => b.name)), []);
}

/** The distinct non-empty names, ignoring case (first spelling wins), sorted A–Z. */
export function knownBabysitters(names: readonly string[]): string[] {
  const byKey = new Map<string, string>();
  for (const name of names) {
    if (name === "") continue;
    const key = name.toLocaleLowerCase();
    if (!byKey.has(key)) byKey.set(key, name);
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b));
}

/**
 * Whether a date needs a babysitter: a working shift on a weekday (Monday to Friday), dated today
 * or later, with no babysitter. A weekend date never needs one, though it can still have one.
 */
export function needsBabysitter(
  shift: Pick<Shift, "code"> | null | undefined,
  babysitter: string,
  date: string,
  today: string,
): boolean {
  return !!shift && isWorkingCode(shift.code) && weekdayIndex(date) < 5 && date >= today && babysitter === "";
}

/**
 * Every babysitter dated today or later, with its date's shift code, in date order; undefined
 * while loading. Dates whose babysitter was cleared (name "") are left out.
 */
export function useUpcomingBabysitters(today: string): DatedBabysitter[] | undefined {
  return useLiveQuery(async () => {
    const rows = (await db.babysitters.where("date").aboveOrEqual(today).toArray()).filter((b) => b.name !== "");
    const shifts = await db.shifts.bulkGet(rows.map((b) => b.date));
    return rows.map((b, i) => ({
      date: b.date,
      name: b.name,
      confirmed: b.confirmed,
      code: toShift(shifts[i])?.code ?? null,
    }));
  }, [today]);
}

/** Every date from today on that needs a babysitter, as its shift, in date order; undefined while loading. */
export function useDatesNeedingBabysitter(today: string): Shift[] | undefined {
  return useLiveQuery(async () => {
    const shifts = (await db.shifts.where("date").aboveOrEqual(today).toArray())
      .map(toShift)
      .filter((s): s is Shift => s !== undefined);
    const sitters = await db.babysitters.bulkGet(shifts.map((s) => s.date));
    return shifts.filter((s, i) => needsBabysitter(s, sitters[i]?.name ?? "", s.date, today));
  }, [today]);
}

/**
 * Confirms a babysitter on the given dates in one save: one editedAt, one transaction over
 * `babysitters` and `babysitterOutbox`, then one sync. Each date keeps its stored spelling of the
 * name. A date whose stored name no longer matches (ignoring case), or that is already confirmed,
 * is left alone.
 */
export async function confirmBabysitter(name: string, dates: readonly string[]): Promise<void> {
  dates.forEach(checkDate);
  const key = name.trim().toLocaleLowerCase();
  const editedAt = Date.now();
  let changed = 0;
  await db.transaction("rw", db.babysitters, db.babysitterOutbox, async () => {
    const rows = await db.babysitters.bulkGet([...dates]);
    for (const row of rows) {
      if (!row || row.name === "" || row.name.toLocaleLowerCase() !== key || row.confirmed) continue;
      const next = { date: row.date, name: row.name, confirmed: true, editedAt };
      await db.babysitters.put(next);
      await db.babysitterOutbox.put(next);
      changed++;
    }
  });
  if (changed > 0) void sync.trigger();
}
