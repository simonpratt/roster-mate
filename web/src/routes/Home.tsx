import { codeInfo } from "../shifts/codes";
import { useShiftsInRange } from "../shifts/repo";
import { useSyncStatus } from "../sync/status";

// Placeholder home page until the Calendar screen (SIM-13) lands: a plain debug list of the
// shifts on the phone and the sync status, enough to check offline storage and sync by hand.
export function Home() {
  const shifts = useShiftsInRange("0000-01-01", "9999-12-31");
  const { status, pendingCount } = useSyncStatus();
  return (
    <main className="mx-auto flex min-h-dvh max-w-app flex-col justify-center px-4">
      <h1 className="text-display">Roster Mate</h1>
      <p className="mt-2 text-caption text-text-muted">
        Sync: {status}
        {pendingCount > 0 && ` · ${pendingCount} pending`}
      </p>
      {shifts && shifts.length > 0 ? (
        <ul className="mt-4 flex flex-col gap-1 font-mono text-label tabular-nums">
          {shifts.map((s) => {
            const info = codeInfo(s.code);
            return (
              <li key={s.date} className="flex items-center gap-3">
                <span>{s.date}</span>
                <span className={`rounded-control px-2 font-bold ${info.chip}`}>{s.code}</span>
                <span className="font-sans text-text-muted">{s.note}</span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-2 text-body text-text-muted">Your shifts will appear here.</p>
      )}
    </main>
  );
}
