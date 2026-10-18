// The sync engine (docs/design.md § Sync protocol, ADR 0001): the only code that talks to
// /api/sync. It sends the outbox, pulls every shift changed since lastRev, and settles clashes by
// last-write-wins on editedAt.
import { ApiError, request, UnauthorizedError } from "../api";
import { db, type OutboxRow, type ShiftRow } from "../db";

/** At most this many changes per request (the server's limit). */
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
        const sent = await db.outbox.orderBy("date").limit(BATCH_SIZE).toArray();
        const res = await post({ since, changes: sent });
        if (dbId !== undefined && (res.dbId !== dbId || res.rev < since)) {
          // The server lost data (wiped or restored). Re-send the phone's copy and pull it all.
          // A second reset in one run means the server is misbehaving; stop rather than loop.
          if (requeued) return "error";
          requeued = true;
          await requeueAll(res.dbId);
          continue;
        }
        await apply(sent, res);
        if (sent.length < BATCH_SIZE) return "ok";
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

async function post(body: { since: number; changes: OutboxRow[] }): Promise<SyncResponse> {
  const changes = body.changes.map(({ date, code, note, editedAt }) => ({ date, code, note, editedAt }));
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await request<SyncResponse>("/api/sync", {
      method: "POST",
      body: { since: body.since, changes },
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
 * Removes each sent outbox entry that hasn't been replaced since, stores the returned shifts
 * except where a newer local edit is pending, and records the server's rev and dbId.
 */
async function apply(sent: OutboxRow[], res: SyncResponse) {
  await db.transaction("rw", db.shifts, db.outbox, db.meta, async () => {
    for (const s of sent) {
      const current = await db.outbox.get(s.date);
      if (current && current.editedAt === s.editedAt) await db.outbox.delete(s.date);
    }
    for (const s of res.shifts) {
      const pending = await db.outbox.get(s.date);
      if (pending && pending.editedAt > s.editedAt) continue;
      await db.shifts.put({ date: s.date, code: s.code, note: s.note, editedAt: s.editedAt, rev: s.rev });
    }
    await db.meta.bulkPut([
      { key: "lastRev", value: res.rev },
      { key: "dbId", value: res.dbId },
    ]);
  });
}

/**
 * After a server reset: queues every local shift with a code, keeping its editedAt (a newer
 * pending edit for the date stays), and starts again from rev 0 against the new dbId.
 */
async function requeueAll(dbId: string) {
  await db.transaction("rw", db.shifts, db.outbox, db.meta, async () => {
    const shifts = await db.shifts.toArray();
    for (const s of shifts) {
      if (s.code === null) continue;
      const pending = await db.outbox.get(s.date);
      if (pending && pending.editedAt >= s.editedAt) continue;
      await db.outbox.put({ date: s.date, code: s.code, note: s.note, editedAt: s.editedAt });
    }
    await db.meta.bulkPut([
      { key: "lastRev", value: 0 },
      { key: "dbId", value: dbId },
    ]);
  });
}

/** The app's one sync engine. */
export const sync = new SyncEngine();
