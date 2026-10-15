import type { SyncStatus } from "../sync/status";
import { RetryIcon } from "./icons";

// The sync indicator, docs/ux-spec.md §5.2 and docs/designs/Calendar{Pending,Offline,SignIn,
// Failed}.dc.html: a pill with a dot and a short text. "syncing" is shown only while a sync the
// user asked for runs; background runs keep the current text so the pill doesn't flicker.
export type IndicatorStatus = SyncStatus | "syncing";

type SyncIndicatorProps = {
  status: IndicatorStatus;
  pendingCount: number;
  /** Starts a sync: tapping Synced, N pending or Sync failed. */
  onSync: () => void;
  /** Goes to sign in: tapping Sign in needed. */
  onSignIn: () => void;
};

/** The pill's text for a status. */
export function syncLabel(status: IndicatorStatus, pendingCount: number): string {
  switch (status) {
    case "synced":
      return "Synced";
    case "pending":
      return `${pendingCount} pending`;
    case "offline":
      return "Offline";
    case "unauthorized":
      return "Sign in needed";
    case "error":
      return "Sync failed";
    case "syncing":
      return "Syncing…";
  }
}

// Dot fill and ring per status; offline and syncing are hollow.
const dots: Record<Exclude<IndicatorStatus, "error">, string> = {
  synced: "bg-ok ring-ok",
  pending: "bg-warn ring-warn",
  offline: "ring-text-faint",
  unauthorized: "bg-danger ring-danger",
  syncing: "ring-focus",
};

const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

export function SyncIndicator({ status, pendingCount, onSync, onSignIn }: SyncIndicatorProps) {
  const label = syncLabel(status, pendingCount);
  let pill;
  if (status === "error") {
    pill = (
      // The visible pill is 36 px; the button around it keeps a 44 px tap target.
      <button type="button" onClick={onSync} aria-label="Sync failed. Retry" className={`flex h-11 items-center rounded-full ${focus}`}>
        <span className="flex h-9 items-center gap-2 rounded-full border border-failed-line bg-failed-surface px-3 text-footnote font-semibold text-failed-soft">
          <span aria-hidden="true" className="size-2 rounded-full bg-failed" />
          <span>{label}</span>
          <span aria-hidden="true" className="inline-flex items-center gap-1 text-failed-action">
            <RetryIcon className="size-3.25" />
            Retry
          </span>
        </span>
      </button>
    );
  } else {
    const visual = (
      <span className="flex h-8 items-center gap-2 rounded-full border border-border-subtle bg-surface px-3 text-footnote font-medium text-text-soft">
        <span aria-hidden="true" className={`size-2 rounded-full ring-[1.5px] ring-inset ${dots[status]}`} />
        <span>{label}</span>
      </span>
    );
    const action =
      status === "synced" || status === "pending"
        ? { onClick: onSync, name: `${label}. Sync now` }
        : status === "unauthorized"
          ? { onClick: onSignIn, name: `${label}. Sign in` }
          : null;
    pill = action ? (
      <button type="button" onClick={action.onClick} aria-label={action.name} className={`flex h-11 items-center rounded-full ${focus}`}>
        {visual}
      </button>
    ) : (
      <p aria-label={`Sync status: ${label}`} className="m-0 flex h-11 items-center">
        {visual}
      </p>
    );
  }
  return (
    <div role="status" className="flex">
      {pill}
    </div>
  );
}
