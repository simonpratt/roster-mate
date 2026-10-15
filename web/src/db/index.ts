// The phone's copy of the shifts (docs/design.md § Data model, ADR 0001). The UI reads and writes
// only this database; the sync engine (src/sync/engine.ts) is the only code that talks to the
// server.
import Dexie, { type EntityTable } from "dexie";
import type { ShiftCode } from "../shifts/codes";

/**
 * A shift as stored on the phone, keyed by date (YYYY-MM-DD). `code: null` is a reserved marker
 * pulled from the server; it is shown as an unrostered date.
 */
export interface ShiftRow {
  date: string;
  code: ShiftCode | null;
  note: string;
  /** Milliseconds since the epoch, from the clock of the phone that made the edit. */
  editedAt: number;
  /** The server's rev for this row; absent until a sync pulls it. */
  rev?: number;
}

/** A pending edit: the latest local change for a date that the server hasn't confirmed. */
export type OutboxRow = Omit<ShiftRow, "rev">;

/** Sync bookkeeping: the server's `rev` at the last sync and the server database's ID. */
export type MetaRow = { key: "lastRev"; value: number } | { key: "dbId"; value: string };

export const db = new Dexie("roster-mate") as Dexie & {
  shifts: EntityTable<ShiftRow, "date">;
  outbox: EntityTable<OutboxRow, "date">;
  meta: EntityTable<MetaRow, "key">;
};

db.version(1).stores({
  shifts: "date",
  outbox: "date",
  meta: "key",
});

/** Deletes every row in every table. For tests and sign-out. */
export async function clearAll(): Promise<void> {
  await db.transaction("rw", db.shifts, db.outbox, db.meta, async () => {
    await Promise.all([db.shifts.clear(), db.outbox.clear(), db.meta.clear()]);
  });
}
