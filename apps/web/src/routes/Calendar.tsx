import { useCallback, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { request } from "../api";
import { AppHeader } from "../components/AppHeader";
import { Banner } from "../components/Banner";
import { buttonClassName } from "../components/Button";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { DateSheet } from "../components/DateSheet";
import { CameraIcon } from "../components/icons";
import { MonthGrid } from "../components/MonthGrid";
import { NextShift } from "../components/NextShift";
import { SyncIndicator } from "../components/SyncIndicator";
import { useBabysittersInRange, useEventCounts } from "../dates/repo";
import { monthGridDates, monthOf, type DateString } from "../lib/dates";
import { useToday } from "../lib/useToday";
import { useHasLocalShifts, useNextShift, useShiftsInRange } from "../shifts/repo";
import { sync } from "../sync/engine";
import { countPendingEdits, usePendingCount, useSyncStatus } from "../sync/status";

// The Calendar (/), the home screen: docs/ux-spec.md §6.2 and docs/designs/Main.dc.html with
// its Calendar* states. Tapping a date opens the date sheet (§6.3).
export function Calendar() {
  const navigate = useNavigate();
  const today = useToday();
  // Returning from Import opens on the month of the first saved date (§6.2).
  const returnMonth = (useLocation().state as { month?: string } | null)?.month;
  const [month, setMonth] = useState(() => returnMonth ?? monthOf(today));
  const dates = monthGridDates(month);
  const [first, last] = [dates[0]!, dates[dates.length - 1]!];
  const shifts = useShiftsInRange(first, last);
  const eventCounts = useEventCounts(first, last);
  const babysitters = useBabysittersInRange(first, last);
  const next = useNextShift(today);
  const hasShifts = useHasLocalShifts();
  const { status } = useSyncStatus();
  const pendingCount = usePendingCount();
  const [userSyncing, setUserSyncing] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [editing, setEditing] = useState<DateString | null>(null);

  async function syncNow() {
    if (userSyncing) return;
    setUserSyncing(true);
    try {
      await sync.trigger();
    } finally {
      setUserSyncing(false);
    }
  }

  // The server forgets the session; the shifts and pending edits stay on the phone and sync
  // after the next sign-in. A logout that can't reach the server still goes to sign in.
  async function signOut() {
    setSigningOut(true);
    try {
      await request("/api/logout", { method: "POST" });
    } catch {
      // Offline or unreachable: nothing more to do here.
    }
    sync.reset();
    navigate("/login", { replace: true });
  }

  // Counted afresh rather than from the live count, which may not have loaded yet.
  async function askSignOut() {
    if ((await countPendingEdits()) > 0) setConfirmSignOut(true);
    else await signOut();
  }

  const onCancelSignOut = useCallback(() => setConfirmSignOut(false), []);
  const onCloseSheet = useCallback(() => setEditing(null), []);

  return (
    <main className="mx-auto flex min-h-dvh max-w-app flex-col pb-[max(24px,env(safe-area-inset-bottom))]">
      <AppHeader
        sync={
          <SyncIndicator
            status={userSyncing ? "syncing" : status}
            pendingCount={pendingCount}
            onSync={() => void syncNow()}
            onSignIn={() => navigate("/login")}
          />
        }
        onSignOut={() => void askSignOut()}
      />

      {status === "unauthorized" && (
        <div className="mx-4 my-1">
          <Banner
            tone="danger"
            layout="inline"
            action={
              <Link to="/login" className={buttonClassName("danger")}>
                Sign in
              </Link>
            }
          >
            Sign in to sync. Your edits are kept on this phone until then.
          </Banner>
        </div>
      )}

      <NextShift shift={next} today={today} onShow={(date) => setMonth(monthOf(date))} />

      <MonthGrid
        month={month}
        today={today}
        shifts={shifts}
        eventCounts={eventCounts}
        babysitters={babysitters}
        onMonthChange={setMonth}
        onSelectDay={setEditing}
      />

      {hasShifts === false && (
        <div className="mx-4 mt-4 flex flex-col gap-3.5 rounded-panel border border-border-subtle bg-surface p-4.5">
          <p className="m-0 text-body text-text">Import a photo of your roster to get started.</p>
          <Link to="/import" className={`${buttonClassName("compact")} self-start`}>
            <CameraIcon className="size-4.5" />
            Import roster
          </Link>
        </div>
      )}

      {editing && <DateSheet date={editing} today={today} onClose={onCloseSheet} />}

      {confirmSignOut && (
        <ConfirmDialog
          title="Sign out?"
          confirmLabel="Sign out"
          busy={signingOut}
          onCancel={onCancelSignOut}
          onConfirm={() => void signOut()}
        >
          {pendingEditsText(pendingCount)} Signing out keeps them on this phone, but they won’t sync until you
          sign in again.
        </ConfirmDialog>
      )}
    </main>
  );
}

// The count can reach 0 while the dialog is open, if a sync finishes; it still reads as one.
function pendingEditsText(count: number): string {
  const n = Math.max(count, 1);
  return `You have ${n} pending ${n === 1 ? "edit" : "edits"}.`;
}
