import Dexie from "dexie";
import { expect, it } from "vitest";
import { db } from ".";

it("opens a v1 database as v2 with the same shifts and outbox rows, minus the note", async () => {
  db.close({ disableAutoOpen: false });
  await Dexie.delete("roster-mate");
  const v1 = new Dexie("roster-mate");
  v1.version(1).stores({ shifts: "date", outbox: "date", meta: "key" });
  await v1.table("shifts").bulkPut([
    { date: "2026-11-03", code: "L", note: "swapped with Sam", editedAt: 1, rev: 4 },
    { date: "2026-11-04", code: "X", note: "", editedAt: 2 },
  ]);
  await v1.table("outbox").put({ date: "2026-11-04", code: "X", note: "", editedAt: 2 });
  await v1.table("meta").put({ key: "lastRev", value: 4 });
  v1.close();

  await db.open();
  expect(db.verno).toBe(2);
  expect(await db.shifts.toArray()).toEqual([
    { date: "2026-11-03", code: "L", editedAt: 1, rev: 4 },
    { date: "2026-11-04", code: "X", editedAt: 2 },
  ]);
  expect(await db.outbox.toArray()).toEqual([{ date: "2026-11-04", code: "X", editedAt: 2 }]);
  expect(await db.meta.get("lastRev")).toEqual({ key: "lastRev", value: 4 });
  expect(await db.events.count()).toBe(0);
  expect(await db.babysitters.count()).toBe(0);
});
