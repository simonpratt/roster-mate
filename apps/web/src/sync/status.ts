// The sync status the UI shows (docs/ux-spec.md, sync indicator), derived from how the last run
// ended, the browser's connection state and the number of pending edits.
import { useLiveQuery } from "dexie-react-hooks";
import { useSyncExternalStore } from "react";
import { db } from "../db";
import { useOnline } from "../useOnline";
import { sync, type Outcome } from "./engine";

export type SyncStatus = "synced" | "pending" | "offline" | "unauthorized" | "error";

/**
 * One status at a time, in the precedence unauthorized > error > offline > pending > synced.
 * `pending` means pendingCount > 0 with nothing worse to report.
 */
export function syncStatus(outcome: Outcome | null, online: boolean, pendingCount: number): SyncStatus {
  if (outcome === "unauthorized") return "unauthorized";
  if (outcome === "error") return "error";
  if (outcome === "offline" || !online) return "offline";
  if (pendingCount > 0) return "pending";
  return "synced";
}

/** Reads the number of pending edits once: shifts, events and babysitters together. */
export async function countPendingEdits(): Promise<number> {
  const counts = await Promise.all([db.outbox.count(), db.eventOutbox.count(), db.babysitterOutbox.count()]);
  return counts.reduce((a, b) => a + b, 0);
}

/** The number of pending edits, whatever the status (the sign-out dialog needs it offline). */
export function usePendingCount(): number {
  return useLiveQuery(countPendingEdits, [], 0);
}

/** The current sync status and pending-edit count, updated live. */
export function useSyncStatus(): { status: SyncStatus; pendingCount: number } {
  const outcome = useSyncExternalStore(sync.subscribe, sync.getOutcome, sync.getOutcome);
  const online = useOnline();
  const pendingCount = usePendingCount();
  return { status: syncStatus(outcome, online, pendingCount), pendingCount };
}
