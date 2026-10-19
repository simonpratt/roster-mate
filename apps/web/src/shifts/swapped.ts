// Swapped shifts (CONTEXT.md Swapped, docs/ux-spec.md §5.11): a shift whose code differs from the
// code the latest import saved for its date. Worked out on the phone from the synced shift
// changes and the pending edits; nothing about it is stored.
import { useLiveQuery } from "dexie-react-hooks";
import { db, type OutboxRow, type ShiftChangeRow } from "../db";
import type { ShiftCode } from "./codes";

/**
 * The code the latest import saved for each date an import has saved: the import shift change
 * with the highest rev, overridden by a pending import edit, which is newer than anything synced.
 */
export function importedCodes(
  changes: readonly ShiftChangeRow[],
  pending: readonly OutboxRow[],
): Map<string, ShiftCode | null> {
  const latest = new Map<string, ShiftChangeRow>();
  for (const change of changes) {
    if (change.source !== "import") continue;
    const seen = latest.get(change.date);
    if (!seen || change.rev > seen.rev) latest.set(change.date, change);
  }
  const codes = new Map([...latest].map(([date, change]) => [date, change.to]));
  for (const row of pending) if (row.source === "import") codes.set(row.date, row.code);
  return codes;
}

/**
 * The imported code a shift was swapped from, or null when it isn't swapped: it has no code, no
 * import has saved its date, or its code is the imported one.
 */
export function swappedFrom(code: ShiftCode | null | undefined, imported: ShiftCode | null | undefined): ShiftCode | null {
  return code && imported && code !== imported ? imported : null;
}

/** The code the latest import saved for each date; undefined while loading. */
export function useImportedCodes(): Map<string, ShiftCode | null> | undefined {
  // Small with one user, so the whole table is read and filtered here rather than indexed.
  return useLiveQuery(async () => importedCodes(await db.shiftChanges.toArray(), await db.outbox.toArray()), []);
}
