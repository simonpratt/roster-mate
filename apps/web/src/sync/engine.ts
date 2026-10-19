// The sync engine (docs/design.md § Sync protocol, ADR 0001): the only code that talks to
// /api/sync. It sends the three outboxes (shifts, events, babysitters), pulls every row changed
// since lastRev, and settles clashes by last-write-wins on editedAt, for each kind on its own.
import { ApiError, request, UnauthorizedError } from "../api";
import {
  allTables,
  db,
  type BabysitterOutboxRow,
  type BabysitterRow,
  type EventOutboxRow,
  type OutboxRow,
  type ShiftChangeRow,
  type ShiftRow,
} from "../db";

/** At most this many items per request, across the three kinds (the server's limit). */
export const BATCH_SIZE = 1000;

/** A request that takes longer than this counts as the server being unreachable. */
const TIMEOUT_MS = 20_000;

/**
 * How the last run ended: `ok`, or why it stopped. `offline` covers both `navigator.onLine`
 * being false and a server that can't be reached (such as on mobile data away from home).
 */
export type Outcome = "ok" | "offline" | "unauthorized" | "error";

interface SyncResponse {
  rev: number;
  dbId: string;
  shifts: (ShiftRow & { rev: number })[];
  // Always sent by the server; read as [] when missing, as from a server older than ADR 0003.
  events?: (EventOutboxRow & { rev: number })[];
  // confirmed is read as false when missing, as from a server older than SIM-41.
  babysitters?: (Omit<BabysitterRow, "confirmed"> & { confirmed?: boolean; rev: number })[];
  // Read as [] when missing, as from a server older than SIM-45.
  shiftChanges?: ShiftChangeRow[];
}

/** One request's worth of pending edits. */
interface Batch {
  changes: OutboxRow[];
  events: EventOutboxRow[];
  babysitters: BabysitterOutboxRow[];
}

type Listener = () => void;

export class SyncEngine {
  private running: Promise<void> | null = null;
  private again = false;
  private outcome: Outcome | null = null;
  private listeners = new Set<Listener>();

  /**
   * Starts a sync, or, while one runs, schedules exactly one follow-up run however many times
   * it is called. The promise settles when the runs are done; it never rejects.
   */
  trigger(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        do {
          this.again = false;
          this.setOutcome(await this.run());
        } while (this.again);
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  /** Settles once no sync is running. */
  idle(): Promise<void> {
    return this.running ?? Promise.resolve();
  }

  /** Forgets how the last run ended, as after signing out. */
  reset() {
    this.setOutcome(null);
  }

  /** How the last run ended, or null before the first. */
  getOutcome = (): Outcome | null => this.outcome;

  /** Calls onChange whenever the outcome changes; returns the unsubscribe function. */
  subscribe = (onChange: Listener): (() => void) => {
    this.listeners.add(onChange);
    return () => this.listeners.delete(onChange);
  };

  private setOutcome(outcome: Outcome | null) {
    if (outcome === this.outcome) return;
    this.outcome = outcome;
    for (const l of this.listeners) l();
  }

  private async run(): Promise<Outcome> {
    if (!navigator.onLine) return "offline";
    try {
      // Each pass sends one batch. A full batch may have left entries behind, so go again; edits
      // made during this run are sent by the follow-up run that their trigger scheduled.
      let requeued = false;
      for (;;) {
        const since = await getMeta<number>("lastRev", 0);
        const dbId = await getMeta<string | undefined>("dbId", undefined);
        const sent = await takeBatch();
        const res = await post(since, sent);
        if (dbId !== undefined && (res.dbId !== dbId || res.rev < since)) {
          // The server lost data (wiped or restored). Re-send the phone's copy and pull it all.
          // A second reset in one run means the server is misbehaving; stop rather than loop.
          if (requeued) return "error";
          requeued = true;
          await requeueAll(res.dbId);
          continue;
        }
        await apply(sent, res);
        // A batch with room to spare took everything left in all three outboxes.
        if (size(sent) < BATCH_SIZE) return "ok";
      }
    } catch (err) {
      if (err instanceof UnauthorizedError) return "unauthorized";
      if (err instanceof ApiError) return "error";
      // fetch couldn't reach the server (TypeError) or timed out (AbortError). Checked by name,
      // since a DOMException isn't always an instance of this realm's classes.
      const name = (err as { name?: unknown } | null)?.name;
      if (name === "TypeError" || name === "AbortError") return "offline";
      console.error("sync", err);
      return "error";
    }
  }
}

/** Up to BATCH_SIZE pending edits: shifts first, then events, then babysitters. */
async function takeBatch(): Promise<Batch> {
  return db.transaction("r", db.outbox, db.eventOutbox, db.babysitterOutbox, async () => {
    const changes = await db.outbox.orderBy("date").limit(BATCH_SIZE).toArray();
    const events = await db.eventOutbox.orderBy("id").limit(BATCH_SIZE - changes.length).toArray();
    const babysitters = await db.babysitterOutbox
      .orderBy("date")
      .limit(BATCH_SIZE - changes.length - events.length)
      .toArray();
    return { changes, events, babysitters };
  });
}

const size = (b: Batch) => b.changes.length + b.events.length + b.babysitters.length;

async function post(since: number, batch: Batch): Promise<SyncResponse> {
  const body = {
    since,
    changes: batch.changes.map(({ date, code, editedAt, source }) =>
      source ? { date, code, editedAt, source } : { date, code, editedAt },
    ),
    events: batch.events.map(({ id, date, text, deleted, createdAt, editedAt }) => ({
      id,
      date,
      text,
      deleted,
      createdAt,
      editedAt,
    })),
    babysitters: batch.babysitters.map(({ date, name, confirmed, editedAt }) => ({ date, name, confirmed, editedAt })),
  };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await request<SyncResponse>("/api/sync", {
      method: "POST",
      body,
      signal: ctl.signal,
    });
    if (!res) throw new ApiError(204);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function getMeta<T>(key: "lastRev" | "dbId", fallback: T): Promise<T> {
  const row = await db.meta.get(key);
  return row ? (row.value as T) : fallback;
}

/**
 * Removes each sent outbox entry that hasn't been replaced since, stores the returned shifts,
 * events and babysitters except where a newer local edit is pending, stores the returned shift
 * changes, and records the server's rev and dbId. A returned event tombstone deletes the local
 * event.
 */
async function apply(sent: Batch, res: SyncResponse) {
  await db.transaction("rw", allTables(), async () => {
    for (const s of sent.changes) {
      const current = await db.outbox.get(s.date);
      if (current && current.editedAt === s.editedAt) await db.outbox.delete(s.date);
    }
    for (const e of sent.events) {
      const current = await db.eventOutbox.get(e.id);
      if (current && current.editedAt === e.editedAt) await db.eventOutbox.delete(e.id);
    }
    for (const b of sent.babysitters) {
      const current = await db.babysitterOutbox.get(b.date);
      if (current && current.editedAt === b.editedAt) await db.babysitterOutbox.delete(b.date);
    }

    for (const s of res.shifts) {
      const pending = await db.outbox.get(s.date);
      if (pending && pending.editedAt > s.editedAt) continue;
      await db.shifts.put({ date: s.date, code: s.code, editedAt: s.editedAt, rev: s.rev });
    }
    for (const e of res.events ?? []) {
      const pending = await db.eventOutbox.get(e.id);
      if (pending && pending.editedAt > e.editedAt) continue;
      if (e.deleted) await db.events.delete(e.id);
      else
        await db.events.put({
          id: e.id,
          date: e.date,
          text: e.text,
          createdAt: e.createdAt,
          editedAt: e.editedAt,
          rev: e.rev,
        });
    }
    for (const b of res.babysitters ?? []) {
      const pending = await db.babysitterOutbox.get(b.date);
      if (pending && pending.editedAt > b.editedAt) continue;
      await db.babysitters.put({
        date: b.date,
        name: b.name,
        confirmed: b.confirmed ?? false,
        editedAt: b.editedAt,
        rev: b.rev,
      });
    }

    const changes = res.shiftChanges ?? [];
    if (changes.length > 0) {
      await db.shiftChanges.bulkPut(
        changes.map(({ rev, date, from, to, source, editedAt }) => ({ rev, date, from, to, source, editedAt })),
      );
    }

    await db.meta.bulkPut([
      { key: "lastRev", value: res.rev },
      { key: "dbId", value: res.dbId },
    ]);
  });
}

/**
 * After a server reset: queues every local shift with a code (as a `restore`, so the server
 * records no shift change), every live event and every babysitter with a name, keeping their
 * editedAt (a newer pending edit stays), drops the old server's shift changes, whose revs are
 * void, and starts again from rev 0 against the new dbId.
 */
async function requeueAll(dbId: string) {
  await db.transaction("rw", allTables(), async () => {
    for (const s of await db.shifts.toArray()) {
      if (s.code === null) continue;
      const pending = await db.outbox.get(s.date);
      if (pending && pending.editedAt >= s.editedAt) continue;
      await db.outbox.put({ date: s.date, code: s.code, editedAt: s.editedAt, source: "restore" });
    }
    for (const e of await db.events.toArray()) {
      const pending = await db.eventOutbox.get(e.id);
      if (pending && pending.editedAt >= e.editedAt) continue;
      const { id, date, text, createdAt, editedAt } = e;
      await db.eventOutbox.put({ id, date, text, deleted: false, createdAt, editedAt });
    }
    for (const b of await db.babysitters.toArray()) {
      if (b.name === "") continue;
      const pending = await db.babysitterOutbox.get(b.date);
      if (pending && pending.editedAt >= b.editedAt) continue;
      await db.babysitterOutbox.put({ date: b.date, name: b.name, confirmed: b.confirmed, editedAt: b.editedAt });
    }
    await db.shiftChanges.clear();
    await db.meta.bulkPut([
      { key: "lastRev", value: 0 },
      { key: "dbId", value: dbId },
    ]);
  });
}

/** The app's one sync engine. */
export const sync = new SyncEngine();
