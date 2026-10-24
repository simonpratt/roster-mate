// The phone's copy of the shifts, events, babysitters and shift changes (docs/design.md § Data model, ADR 0001,
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

/**
 * Where a shift edit was made: the date sheet or an import's Save. `restore` marks the re-send
 * after a server reset, which the server applies without recording a shift change (ADR 0004).
 */
export type ShiftEditSource = "sheet" | "import" | "restore";

/** A pending edit: the latest local change for a date that the server hasn't confirmed. */
export type OutboxRow = Omit<ShiftRow, "rev"> & {
  /** Absent on rows queued before SIM-45; the server then records the change's source as unknown. */
  source?: ShiftEditSource;
};

/**
 * A shift change the server recorded (ADR 0004), keyed by the rev of the write. `from: null` is a
 * date that had no shift; `source: null` an edit from a client that didn't say.
 */
export interface ShiftChangeRow {
  rev: number;
  date: string;
  from: ShiftCode | null;
  to: ShiftCode | null;
  source: "sheet" | "import" | null;
  editedAt: number;
}

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

/** The babysitter for a date; `name: ""` means none. `confirmed: false` is a tentative babysitter. */
export interface BabysitterRow {
  date: string;
  name: string;
  confirmed: boolean;
  editedAt: number;
  rev?: number;
}

export type BabysitterOutboxRow = Omit<BabysitterRow, "rev">;

/**
 * Sync bookkeeping (the server's `rev` at the last sync and the server database's ID), and
 * whether the server last said roster emails are on (`/api/session`'s `email`), kept so the menu
 * stays right offline.
 */
export type MetaRow =
  | { key: "lastRev"; value: number }
  | { key: "dbId"; value: string }
  | { key: "emailEnabled"; value: boolean };

export const db = new Dexie("roster-mate") as Dexie & {
  shifts: EntityTable<ShiftRow, "date">;
  outbox: EntityTable<OutboxRow, "date">;
  events: EntityTable<EventRow, "id">;
  eventOutbox: EntityTable<EventOutboxRow, "id">;
  babysitters: EntityTable<BabysitterRow, "date">;
  babysitterOutbox: EntityTable<BabysitterOutboxRow, "date">;
  shiftChanges: EntityTable<ShiftChangeRow, "rev">;
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

// Version 3 adds the babysitter's confirmed status; every existing babysitter becomes tentative.
db.version(3).upgrade(async (tx) => {
  const tentative = (row: { confirmed?: boolean }) => {
    row.confirmed ??= false;
  };
  await tx.table("babysitters").toCollection().modify(tentative);
  await tx.table("babysitterOutbox").toCollection().modify(tentative);
});

// Version 4 adds the shift changes pulled from the server (SIM-45, ADR 0004).
db.version(4).stores({
  shiftChanges: "rev, editedAt",
});

/** Every table, for transactions that span them all. */
export function allTables(): Table[] {
  return [db.shifts, db.outbox, db.events, db.eventOutbox, db.babysitters, db.babysitterOutbox, db.shiftChanges, db.meta];
}

/** Deletes every row in every table. For tests and sign-out. */
export async function clearAll(): Promise<void> {
  await db.transaction("rw", allTables(), async () => {
    await Promise.all(allTables().map((t) => t.clear()));
  });
}
