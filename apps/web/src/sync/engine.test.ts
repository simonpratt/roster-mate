import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db, type BabysitterOutboxRow, type EventOutboxRow, type OutboxRow } from "../db";
import { saveDate } from "../dates/repo";
import { setShift, useShift } from "../shifts/repo";
import { setOnline } from "../test-utils";
import { sync } from "./engine";
import { syncStatus, usePendingCount, useSyncStatus } from "./status";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

interface SyncBody {
  since: number;
  changes: OutboxRow[];
  events: EventOutboxRow[];
  babysitters: BabysitterOutboxRow[];
}

/** A response, or a value for fetch to throw (an Error or a DOMException). */
type Reply = { status: number; body?: unknown } | Error | DOMException;

/** Answers POST /api/sync with handler, which sees each parsed request body in turn. */
function serve(handler: (body: SyncBody, call: number) => Reply | Promise<Reply>) {
  const bodies: SyncBody[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(String(input)).toBe("/api/sync");
    const body = JSON.parse(String(init?.body)) as SyncBody;
    bodies.push(body);
    const reply = await handler(body, bodies.length);
    if (!("status" in reply)) throw reply;
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, bodies };
}

/** A 200 sync response. */
const ok = (rev: number, shifts: unknown[] = [], dbId = "db-1", events: unknown[] = [], babysitters: unknown[] = []) => ({
  status: 200,
  body: { rev, dbId, shifts, events, babysitters },
});

/** A 200 response echoing every item sent at rev, as the server stores them all. */
const echo = (rev: number) => (b: SyncBody) => ({
  status: 200,
  body: {
    rev,
    dbId: "db-1",
    shifts: b.changes.map((c) => ({ ...c, rev })),
    events: b.events.map((e) => ({ ...e, rev })),
    babysitters: b.babysitters.map((x) => ({ ...x, rev })),
  },
});

const ID_1 = "00000000-0000-4000-8000-000000000001";
const ID_2 = "00000000-0000-4000-8000-000000000002";
const ID_3 = "00000000-0000-4000-8000-000000000003";

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const meta = async (key: "lastRev" | "dbId") => (await db.meta.get(key))?.value;

describe("sync engine", () => {
  it("keeps an offline edit locally and in the outbox, then sends it once online", async () => {
    setOnline(false);
    const { fetchMock } = serve(() => ok(1));
    await setShift("2026-11-03", "L");
    await sync.idle();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(await db.outbox.count()).toBe(1);
    const { result } = renderHook(() => useShift("2026-11-03"));
    await waitFor(() => expect(result.current).toEqual({ date: "2026-11-03", code: "L" }));

    setOnline(true);
    const { bodies } = serve(echo(7));
    await sync.trigger();

    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ since: 0, changes: [{ date: "2026-11-03", code: "L" }] });
    expect(await db.outbox.count()).toBe(0);
    expect(await meta("lastRev")).toBe(7);
    expect(await meta("dbId")).toBe("db-1");
  });

  it("keeps an edit made during a sync and sends it in the follow-up run", async () => {
    const first = deferred<Reply>();
    let outboxAtSecondCall: string[] = [];
    const { bodies } = serve(async ({ changes }, call) => {
      if (call === 1) return first.promise;
      outboxAtSecondCall = (await db.outbox.toArray()).map((r) => r.date);
      return ok(2, changes.map((c) => ({ ...c, rev: 2 })));
    });

    await setShift("2026-11-03", "L");
    await waitFor(() => expect(bodies).toHaveLength(1));
    await setShift("2026-11-04", "E");
    first.resolve(ok(1, [{ date: "2026-11-03", code: "L", editedAt: bodies[0]!.changes[0]!.editedAt, rev: 1 }]));
    await sync.idle();

    expect(bodies.map((b) => b.changes.map((c) => c.date))).toEqual([["2026-11-03"], ["2026-11-04"]]);
    expect(bodies[1]!.since).toBe(1);
    expect(outboxAtSecondCall).toEqual(["2026-11-04"]);
    expect(await db.outbox.count()).toBe(0);
  });

  it("does not let a server shift overwrite a newer pending edit for the same date", async () => {
    const first = deferred<Reply>();
    let localAtSecondCall: string | null | undefined;
    serve(async (_body, call) => {
      if (call === 1) return first.promise;
      localAtSecondCall = (await db.shifts.get("2026-11-03"))?.code;
      return ok(3);
    });

    void sync.trigger();
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1));
    await setShift("2026-11-03", "N");
    first.resolve(ok(1, [{ date: "2026-11-03", code: "D", editedAt: 1000, rev: 1 }]));
    await sync.idle();

    expect(localAtSecondCall).toBe("N");
    expect(await db.shifts.get("2026-11-03")).toMatchObject({ code: "N" });
    expect(await meta("lastRev")).toBe(3);
  });

  it("stores a pulled server shift when no newer edit is pending, and a null code as unrostered", async () => {
    serve(() =>
      ok(2, [
        { date: "2026-11-03", code: "E", editedAt: 1000, rev: 1 },
        { date: "2026-11-04", code: null, editedAt: 1001, rev: 2 },
      ]),
    );
    await sync.trigger();
    expect(await db.shifts.get("2026-11-03")).toMatchObject({ code: "E", rev: 1 });
    expect(await db.shifts.get("2026-11-04")).toMatchObject({ code: null });
    const { result } = renderHook(() => useShift("2026-11-04"));
    await waitFor(() => expect(result.current).toBeNull());
  });

  it("sets unauthorized on a 401 and keeps the outbox", async () => {
    serve(() => ({ status: 401, body: { error: "unauthorized" } }));
    await setShift("2026-11-03", "L");
    await sync.idle();

    expect(sync.getOutcome()).toBe("unauthorized");
    expect(await db.outbox.count()).toBe(1);
    const { result } = renderHook(() => useSyncStatus());
    await waitFor(() => expect(result.current).toEqual({ status: "unauthorized", pendingCount: 1 }));
  });

  it("sets offline when the server can't be reached while navigator.onLine is true, keeping the count", async () => {
    setOnline(true);
    serve(() => new TypeError("Failed to fetch"));
    await setShift("2026-11-03", "L");
    await setShift("2026-11-04", "E");
    await sync.idle();

    expect(sync.getOutcome()).toBe("offline");
    const { result } = renderHook(() => ({ ...useSyncStatus(), count: usePendingCount() }));
    await waitFor(() => expect(result.current).toEqual({ status: "offline", pendingCount: 2, count: 2 }));
  });

  it("sets offline when the request times out", async () => {
    serve(() => new DOMException("The operation was aborted.", "AbortError"));
    await sync.trigger();
    expect(sync.getOutcome()).toBe("offline");
  });

  it("sets error on a 500", async () => {
    serve(() => ({ status: 500, body: { error: "internal error" } }));
    await setShift("2026-11-03", "L");
    await sync.idle();

    expect(sync.getOutcome()).toBe("error");
    expect(await db.outbox.count()).toBe(1);
  });

  it("goes back to ok after a failure once a sync succeeds", async () => {
    serve(() => ({ status: 500 }));
    await sync.trigger();
    expect(sync.getOutcome()).toBe("error");
    serve(() => ok(1));
    await sync.trigger();
    expect(sync.getOutcome()).toBe("ok");
  });

  describe("server reset", () => {
    async function seed(lastRev: number, dbId: string) {
      await db.shifts.bulkPut([
        { date: "2026-11-03", code: "D", editedAt: 111, rev: 4 },
        { date: "2026-11-04", code: "E", editedAt: 222, rev: 5 },
        { date: "2026-11-05", code: null, editedAt: 333, rev: 6 },
        { date: "2026-11-06", code: "L", editedAt: 444, rev: 7 },
      ]);
      await db.events.bulkPut([
        { id: ID_1, date: "2026-11-03", text: "Dentist 3pm", createdAt: 100, editedAt: 120, rev: 8 },
        { id: ID_2, date: "2026-11-04", text: "School concert", createdAt: 130, editedAt: 130, rev: 9 },
      ]);
      await db.babysitters.bulkPut([
        { date: "2026-11-03", name: "Mum", confirmed: true, editedAt: 140, rev: 10 },
        // Cleared: nothing to restore.
        { date: "2026-11-04", name: "", confirmed: false, editedAt: 150, rev: 11 },
      ]);
      // Pending edits newer than the stored rows stay as they are.
      await db.outbox.put({ date: "2026-11-06", code: "N", editedAt: 555 });
      await db.eventOutbox.put({ id: ID_2, date: "2026-11-04", text: "Concert", deleted: false, createdAt: 130, editedAt: 666 });
      await db.meta.bulkPut([
        { key: "lastRev", value: lastRev },
        { key: "dbId", value: dbId },
      ]);
    }

    const requeued = {
      since: 0,
      changes: [
        { date: "2026-11-03", code: "D", editedAt: 111 },
        { date: "2026-11-04", code: "E", editedAt: 222 },
        { date: "2026-11-06", code: "N", editedAt: 555 },
      ],
      events: [
        { id: ID_1, date: "2026-11-03", text: "Dentist 3pm", deleted: false, createdAt: 100, editedAt: 120 },
        { id: ID_2, date: "2026-11-04", text: "Concert", deleted: false, createdAt: 130, editedAt: 666 },
      ],
      babysitters: [{ date: "2026-11-03", name: "Mum", confirmed: true, editedAt: 140 }],
    };

    it("re-queues every local shift, live event and named babysitter when the dbId changes", async () => {
      await seed(10, "db-old");
      const { bodies } = serve((_b, call) => (call === 1 ? ok(0, [], "db-new") : ok(3, [], "db-new")));
      await sync.trigger();

      expect(bodies).toHaveLength(2);
      expect(bodies[0]).toEqual({
        since: 10,
        changes: [{ date: "2026-11-06", code: "N", editedAt: 555 }],
        events: [requeued.events[1]],
        babysitters: [],
      });
      expect(bodies[1]).toEqual(requeued);
      expect(await db.outbox.count()).toBe(0);
      expect(await db.eventOutbox.count()).toBe(0);
      expect(await db.babysitterOutbox.count()).toBe(0);
      expect(await meta("dbId")).toBe("db-new");
      expect(await meta("lastRev")).toBe(3);
      expect(sync.getOutcome()).toBe("ok");
    });

    it("re-queues every local shift when the rev is lower than since", async () => {
      await seed(10, "db-1");
      const { bodies } = serve((_b, call) => (call === 1 ? ok(2) : ok(5)));
      await sync.trigger();

      expect(bodies).toHaveLength(2);
      expect(bodies[1]).toEqual(requeued);
      expect(await db.outbox.count()).toBe(0);
      expect(await meta("lastRev")).toBe(5);
    });

    it("just stores the dbId on the first sync", async () => {
      await db.shifts.put({ date: "2026-11-03", code: "D", editedAt: 111 });
      const { bodies } = serve(() => ok(4, [], "db-first"));
      await sync.trigger();

      expect(bodies).toHaveLength(1);
      expect(await meta("dbId")).toBe("db-first");
      expect(await db.outbox.count()).toBe(0);
    });

    it("stops with error if the server resets twice in one run", async () => {
      await seed(10, "db-old");
      const { bodies } = serve((_b, call) => ok(0, [], `db-${call}`));
      await sync.trigger();
      expect(bodies).toHaveLength(2);
      expect(sync.getOutcome()).toBe("error");
    });
  });

  it("sends an outbox of 1500 entries in two requests", async () => {
    const start = Date.UTC(2020, 0, 1);
    const rows = Array.from({ length: 1500 }, (_, i) => ({
      date: new Date(start + i * 86_400_000).toISOString().slice(0, 10), // UTC on purpose: unique keys only
      code: "D",
      editedAt: 1000 + i,
    }));
    await db.outbox.bulkPut(rows);
    const { bodies } = serve((_b, call) => ok(call));
    await sync.trigger();

    expect(bodies.map((b) => b.changes.length)).toEqual([1000, 500]);
    expect(bodies[1]!.since).toBe(1);
    expect(await db.outbox.count()).toBe(0);
  });

  it("sends at most 1000 items per request across the three outboxes, until all are empty", async () => {
    const start = Date.UTC(2020, 0, 1);
    // UTC on purpose: unique keys only.
    const dateAt = (i: number) => new Date(start + i * 86_400_000).toISOString().slice(0, 10);
    const id = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
    await db.outbox.bulkPut(Array.from({ length: 600 }, (_, i) => ({ date: dateAt(i), code: "D", editedAt: 1 })));
    await db.eventOutbox.bulkPut(
      Array.from({ length: 600 }, (_, i) => ({
        id: id(i),
        date: dateAt(i),
        text: "x",
        deleted: false,
        createdAt: 1,
        editedAt: 1,
      })),
    );
    await db.babysitterOutbox.bulkPut(Array.from({ length: 300 }, (_, i) => ({ date: dateAt(i), name: "Mum", confirmed: false, editedAt: 1 })));
    const { bodies } = serve((_b, call) => ok(call));
    await sync.trigger();

    expect(bodies.map((b) => [b.changes.length, b.events.length, b.babysitters.length])).toEqual([
      [600, 400, 0],
      [0, 200, 300],
    ]);
    expect(await db.outbox.count()).toBe(0);
    expect(await db.eventOutbox.count()).toBe(0);
    expect(await db.babysitterOutbox.count()).toBe(0);
    expect(sync.getOutcome()).toBe("ok");
  });

  it("counts every queued item offline, then one sync empties all three outboxes", async () => {
    setOnline(false);
    const { fetchMock } = serve(() => ok(1));
    await saveDate("2026-11-03", { code: "L", babysitter: { name: "Mum", confirmed: true }, events: { added: ["Dentist 3pm", "Pick up parcel"] } });
    await sync.idle();
    expect(fetchMock).not.toHaveBeenCalled();
    const { result } = renderHook(() => ({ ...useSyncStatus(), count: usePendingCount() }));
    await waitFor(() => expect(result.current).toEqual({ status: "offline", pendingCount: 4, count: 4 }));

    setOnline(true);
    const { bodies } = serve(echo(4));
    await sync.trigger();

    expect(bodies).toHaveLength(1);
    expect(bodies[0]!.changes).toHaveLength(1);
    expect(bodies[0]!.events.map((e) => e.text)).toEqual(expect.arrayContaining(["Dentist 3pm", "Pick up parcel"]));
    expect(bodies[0]!.babysitters).toEqual([
      { date: "2026-11-03", name: "Mum", confirmed: true, editedAt: expect.any(Number) },
    ]);
    expect(await db.outbox.count()).toBe(0);
    expect(await db.eventOutbox.count()).toBe(0);
    expect(await db.babysitterOutbox.count()).toBe(0);
    expect(await db.events.where("date").equals("2026-11-03").count()).toBe(2);
    expect(await db.babysitters.get("2026-11-03")).toMatchObject({ name: "Mum", confirmed: true, rev: 4 });
    await waitFor(() => expect(result.current.count).toBe(0));
  });

  it("deletes the local event for a pulled tombstone, and stores pulled events and babysitters", async () => {
    await db.events.put({ id: ID_1, date: "2026-11-03", text: "Dentist 3pm", createdAt: 100, editedAt: 100, rev: 1 });
    serve(() =>
      ok(
        5,
        [],
        "db-1",
        [
          { id: ID_1, date: "2026-11-03", text: "", deleted: true, createdAt: 100, editedAt: 200, rev: 3 },
          { id: ID_2, date: "2026-11-04", text: "Concert", deleted: false, createdAt: 150, editedAt: 150, rev: 4 },
        ],
        [
          { date: "2026-11-04", name: "Dad", confirmed: true, editedAt: 160, rev: 5 },
          // From a server older than SIM-41: no confirmed, so tentative.
          { date: "2026-11-05", name: "Mum", editedAt: 170, rev: 6 },
        ],
      ),
    );
    await sync.trigger();

    expect(await db.events.get(ID_1)).toBeUndefined();
    expect(await db.events.get(ID_2)).toEqual({
      id: ID_2,
      date: "2026-11-04",
      text: "Concert",
      createdAt: 150,
      editedAt: 150,
      rev: 4,
    });
    expect(await db.babysitters.get("2026-11-04")).toEqual({
      date: "2026-11-04",
      name: "Dad",
      confirmed: true,
      editedAt: 160,
      rev: 5,
    });
    expect(await db.babysitters.get("2026-11-05")).toEqual({
      date: "2026-11-05",
      name: "Mum",
      confirmed: false,
      editedAt: 170,
      rev: 6,
    });
  });

  it("skips pulled events and babysitters older than a pending local edit", async () => {
    const first = deferred<Reply>();
    serve((_b, call) => (call === 1 ? first.promise : ok(9)));
    void sync.trigger();
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1));
    await db.events.put({ id: ID_1, date: "2026-11-03", text: "Mine", createdAt: 100, editedAt: 5000 });
    await db.eventOutbox.bulkPut([
      { id: ID_1, date: "2026-11-03", text: "Mine", deleted: false, createdAt: 100, editedAt: 5000 },
      { id: ID_3, date: "2026-11-03", text: "", deleted: true, createdAt: 100, editedAt: 5000 },
    ]);
    await db.babysitters.put({ date: "2026-11-03", name: "Mum", confirmed: false, editedAt: 5000 });
    await db.babysitterOutbox.put({ date: "2026-11-03", name: "Mum", confirmed: false, editedAt: 5000 });
    first.resolve(
      ok(
        3,
        [],
        "db-1",
        [
          { id: ID_1, date: "2026-11-03", text: "", deleted: true, createdAt: 100, editedAt: 1000, rev: 1 },
          // Deleted here, with the tombstone still pending: not brought back.
          { id: ID_3, date: "2026-11-03", text: "Old", deleted: false, createdAt: 100, editedAt: 1000, rev: 2 },
        ],
        [{ date: "2026-11-03", name: "Dad", editedAt: 1000, rev: 3 }],
      ),
    );
    await sync.idle();

    expect(await db.events.get(ID_1)).toMatchObject({ text: "Mine" });
    expect(await db.events.get(ID_3)).toBeUndefined();
    expect(await db.babysitters.get("2026-11-03")).toMatchObject({ name: "Mum" });
  });

  it("runs one follow-up however many times it is triggered during a run", async () => {
    const first = deferred<Reply>();
    const { bodies } = serve((_b, call) => (call === 1 ? first.promise : ok(2)));
    const run = sync.trigger();
    await waitFor(() => expect(bodies).toHaveLength(1));
    void sync.trigger();
    void sync.trigger();
    void sync.trigger();
    first.resolve(ok(1));
    await run;
    expect(bodies).toHaveLength(2);
  });
});

describe("syncStatus", () => {
  it("shows one status in the order unauthorized > error > offline > pending > synced", () => {
    expect(syncStatus("unauthorized", false, 3)).toBe("unauthorized");
    expect(syncStatus("error", false, 3)).toBe("error");
    expect(syncStatus("offline", true, 3)).toBe("offline");
    expect(syncStatus("ok", false, 3)).toBe("offline");
    expect(syncStatus("ok", true, 3)).toBe("pending");
    expect(syncStatus(null, true, 1)).toBe("pending");
    expect(syncStatus("ok", true, 0)).toBe("synced");
  });
});
