import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { DateSheet } from "../components/DateSheet";
import { ScreenHeader } from "../components/ScreenHeader";
import { ShiftChangeRow, ShiftChangeSection } from "../components/ShiftChangeRow";
import { formatShortDate, type DateString } from "../lib/dates";
import { useToday } from "../lib/useToday";
import {
  changeLabel,
  groupHeading,
  groupSummary,
  pendingLabel,
  pendingSummary,
  usePendingShiftEdits,
  useShiftHistory,
} from "../shifts/history";

// The History screen (/history), docs/ux-spec.md §6.6 and docs/designs/History.dc.html,
// HistoryEmpty.dc.html: the pending shift edits under Not synced yet, then every shift change the
// server recorded, one group per save, newest first. It reads only IndexedDB, so it works offline.
// Tapping a row opens the date sheet over the screen, and focus returns to that row on close.
export function History() {
  const navigate = useNavigate();
  const today = useToday();
  const groups = useShiftHistory();
  const pending = usePendingShiftEdits();
  const [editing, setEditing] = useState<DateString | null>(null);
  // A date can appear in more than one row, so remember the row tapped.
  const tapped = useRef<HTMLButtonElement | null>(null);
  const onSelect = useCallback((date: string, row: HTMLButtonElement) => {
    tapped.current = row;
    setEditing(date);
  }, []);
  const onCloseSheet = useCallback(() => setEditing(null), []);
  const returnFocus = useCallback(() => {
    const row = tapped.current;
    // The row tapped, unless a save moved it (a pending row that synced meanwhile).
    if (row?.isConnected) return row;
    return editing ? document.querySelector<HTMLElement>(`[data-date="${editing}"]`) : null;
  }, [editing]);

  const loaded = groups !== undefined && pending !== undefined;

  return (
    <main className="mx-auto flex min-h-dvh max-w-app flex-col pt-[env(safe-area-inset-top)] pb-[max(32px,env(safe-area-inset-bottom))]">
      <ScreenHeader title="History" onBack={() => navigate("/")} />
      <p className="mx-4 mt-1 mb-0 text-callout text-text-muted">Every change to a shift, newest first.</p>

      {loaded && pending.length > 0 && (
        <ShiftChangeSection pending title="Not synced yet" summary={pendingSummary(pending.length)}>
          {pending.map((p) => (
            <ShiftChangeRow
              key={p.date}
              date={p.date}
              dateText={formatShortDate(p.date)}
              label={pendingLabel(p.date, p.code)}
              to={p.code}
              onSelect={onSelect}
            />
          ))}
        </ShiftChangeSection>
      )}

      {loaded &&
        groups.map((g) => (
          <ShiftChangeSection
            key={`${g.editedAt}|${g.source ?? ""}`}
            title={groupHeading(g.editedAt, today)}
            summary={groupSummary(g.source, g.changes.length)}
          >
            {g.changes.map((c) => (
              <ShiftChangeRow
                key={c.rev}
                date={c.date}
                dateText={formatShortDate(c.date)}
                label={changeLabel(c.date, c.from, c.to)}
                from={c.from}
                to={c.to}
                onSelect={onSelect}
              />
            ))}
          </ShiftChangeSection>
        ))}

      {loaded && groups.length === 0 && pending.length === 0 && (
        <p className="mx-4 mt-7 mb-0 text-callout text-text-muted">
          No shift changes yet. Shifts you change or import show here.
        </p>
      )}

      {editing && <DateSheet date={editing} today={today} onClose={onCloseSheet} returnFocus={returnFocus} />}
    </main>
  );
}
