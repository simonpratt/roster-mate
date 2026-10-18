// The phone's copy of the shifts, events and babysitters (docs/design.md § Data model, ADR 0001,
// ADR 0003). The UI reads and writes only this database; the sync engine (src/sync/engine.ts) is
// the only code that talks to the server.
import Dexie, { type EntityTable, type Table } from "dexie";
import type { ShiftCode } from "../shifts/codes";

/**
 * A shift as stored on the phone, keyed by date (YYYY-MM-DD). `code: null` is a reserved marker
 * pulled from the server; it is shown as an unrostered date.
 */
export interface ShiftRow {
  date: string;
  code: ShiftCode | null;
  /** Milliseconds since the epoch, from the clock of the phone that made the edit. */
  editedAt: number;
  /** The server's rev for this row; absent until a sync pulls it. */
  rev?: number;
}

/** A pending edit: the latest local change for a date that the server hasn't confirmed. */
export type OutboxRow = Omit<ShiftRow, "rev">;

/** A live event, keyed by its UUID. A deleted event is removed from this table. */
export interface EventRow {
  id: string;
  date: string;
  text: string;
  /** Orders the events within a date. */
  createdAt: number;
  editedAt: number;
  rev?: number;
}

/** A pending event edit; `deleted: true` (with `text: ""`) is a removal. */
export interface EventOutboxRow {
  id: string;
  date: string;
  text: string;
  deleted: boolean;
  createdAt: number;
  editedAt: number;
}

/** The babysitter for a date; `name: ""` means none. */
export interface BabysitterRow {
  date: string;
  name: string;
  editedAt: number;
  rev?: number;
}

export type BabysitterOutboxRow = Omit<BabysitterRow, "rev">;

/** Sync bookkeeping: the server's `rev` at the last sync and the server database's ID. */
export type MetaRow = { key: "lastRev"; value: number } | { key: "dbId"; value: string };

export const db = new Dexie("roster-mate") as Dexie & {
  shifts: EntityTable<ShiftRow, "date">;
  outbox: EntityTable<OutboxRow, "date">;
  events: EntityTable<EventRow, "id">;
  eventOutbox: EntityTable<EventOutboxRow, "id">;
  babysitters: EntityTable<BabysitterRow, "date">;
  babysitterOutbox: EntityTable<BabysitterOutboxRow, "date">;
  meta: EntityTable<MetaRow, "key">;
};

db.version(1).stores({
  shifts: "date",
  outbox: "date",
  meta: "key",
});

// Version 2 adds events and babysitters, and drops the shift note (ADR 0003).
db.version(2)
  .stores({
    events: "id, date",
    eventOutbox: "id",
    babysitters: "date",
    babysitterOutbox: "date",
  })
  .upgrade(async (tx) => {
    const dropNote = (row: { note?: unknown }) => {
      delete row.note;
    };
    await tx.table("shifts").toCollection().modify(dropNote);
    await tx.table("outbox").toCollection().modify(dropNote);
  });

/** Every table, for transactions that span them all. */
export function allTables(): Table[] {
  return [db.shifts, db.outbox, db.events, db.eventOutbox, db.babysitters, db.babysitterOutbox, db.meta];
}

/** Deletes every row in every table. For tests and sign-out. */
export async function clearAll(): Promise<void> {
  await db.transaction("rw", allTables(), async () => {
    await Promise.all(allTables().map((t) => t.clear()));
  });
}
