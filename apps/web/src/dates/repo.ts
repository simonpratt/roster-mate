// Reading and writing a date's shift, babysitter and events on the phone (ADR 0003). A save is
// a pending edit for each part it changes: it goes to each part's table and outbox in one
// transaction and then triggers one sync (docs/design.md § Sync protocol).
import { useLiveQuery } from "dexie-react-hooks";
import type { Table } from "dexie";
import { db, type EventRow } from "../db";
import { newId } from "../lib/uuid";
import type { ShiftCode } from "../shifts/codes";
import { checkCode, checkDate, toShift, type Shift } from "../shifts/repo";
import { sync } from "../sync/engine";

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

/** What a save changes on a date; absent parts are left as they are. */
export interface DateEdit {
  code?: ShiftCode;
  /** The babysitter's name; "" clears it. */
  babysitter?: string;
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
  const babysitter = edit.babysitter?.trim();
  if (babysitter !== undefined) checkText(babysitter, BABYSITTER_NAME_MAX, "babysitter name");
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
      await db.outbox.put(row);
    }
    if (babysitter !== undefined) {
      const row = { date, name: babysitter, editedAt };
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
  /** The babysitter's name, or "" for none. */
  babysitter: string;
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
        babysitter: babysitter?.name ?? "",
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

/** The babysitter's name on each date from..to (inclusive) that has one; undefined while loading. */
export function useBabysittersInRange(from: string, to: string): Map<string, string> | undefined {
  return useLiveQuery(async () => {
    const rows = await db.babysitters.where("date").between(from, to, true, true).toArray();
    return new Map(rows.filter((b) => b.name !== "").map((b) => [b.date, b.name]));
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

/** Whether a date needs a babysitter: a working shift, dated today or later, with no babysitter. */
export function needsBabysitter(
  shift: Pick<Shift, "code"> | null | undefined,
  babysitter: string,
  date: string,
  today: string,
): boolean {
  return !!shift && shift.code !== "X" && date >= today && babysitter === "";
}
