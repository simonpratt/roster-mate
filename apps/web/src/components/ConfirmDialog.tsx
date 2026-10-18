import { useEffect, useId, type ReactNode } from "react";
import { Button } from "./Button";

// A centred confirmation dialog over a scrim, as for "Sign out?"
// (docs/designs/CalendarSignOut.dc.html): a title, one paragraph, then Cancel and the action.
type ConfirmDialogProps = {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** Disables both buttons while the action runs. */
  busy?: boolean;
};

export function ConfirmDialog({ title, children, confirmLabel, onConfirm, onCancel, busy = false }: ConfirmDialogProps) {
  const id = useId();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-scrim px-5">
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-body`}
        className="flex w-full max-w-app flex-col gap-3 rounded-dialog border border-border bg-surface px-5 pt-6 pb-5"
      >
        <h2 id={`${id}-title`} className="m-0 text-heading">
          {title}
        </h2>
        <p id={`${id}-body`} className="m-0 text-callout text-pretty text-text-soft">
          {children}
        </p>
        <div className="mt-2.5 grid grid-cols-2 gap-2.5">
          <Button variant="outline-wide" onClick={onCancel} disabled={busy} autoFocus>
            Cancel
          </Button>
          <Button onClick={onConfirm} busy={busy}>
            {confirmLabel}
          </Button>
        </div>
      </section>
    </div>
  );
}
