import { useId, type ReactNode } from "react";
import type { ShiftCode } from "../shifts/codes";
import { CodeChip } from "./CodeChip";
import { ArrowRightIcon } from "./icons";

// The History screen's sections and rows, docs/ux-spec.md §6.6 and docs/designs/History.dc.html:
// a section heading (h2) with its summary, then one 52 px row per shift change, styled like a
// Babysitters row: the date, the code it had, an arrow and the code it got.

const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

type ShiftChangeSectionProps = {
  title: string;
  summary: string;
  /** "pending" adds the warn dot in a dashed circle, for Not synced yet. */
  pending?: boolean;
  children: ReactNode;
};

export function ShiftChangeSection({ title, summary, pending = false, children }: ShiftChangeSectionProps) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="mx-4 mt-6 flex flex-col gap-2">
      <div className="flex min-h-11 items-center gap-3">
        {pending && (
          <span
            aria-hidden="true"
            data-testid="pending-dot"
            className="flex size-7 flex-none items-center justify-center rounded-full border border-dashed border-text-dim"
          >
            <span className="size-2.5 rounded-full bg-warn" />
          </span>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-px">
          <h2 id={titleId} className="m-0 truncate text-title tabular-nums">
            {title}
          </h2>
          <p className="m-0 text-footnote text-text-muted">{summary}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

/** A 34 × 28 px chip, or for an unrostered side an empty one with a dashed outline. */
function ChangeChip({ code }: { code: ShiftCode | null }) {
  if (code === null)
    return (
      <span
        aria-hidden="true"
        data-testid="unrostered-chip"
        className="h-7 w-8.5 rounded-chip-sm border border-dashed border-border-strong"
      />
    );
  return <CodeChip code={code} size="row" />;
}

type ShiftChangeRowProps = {
  date: string;
  /** "Fri 23 Oct". */
  dateText: string;
  /** The accessible name: "Friday 23 October, Day to SE". */
  label: string;
  /** The code it had; omitted for a pending edit, whose old code the server records. */
  from?: ShiftCode | null;
  to: ShiftCode | null;
  onSelect: (date: string, row: HTMLButtonElement) => void;
};

export function ShiftChangeRow({ date, dateText, label, from, to, onSelect }: ShiftChangeRowProps) {
  const pending = from === undefined;
  return (
    <button
      type="button"
      data-date={date}
      aria-label={label}
      onClick={(e) => onSelect(date, e.currentTarget)}
      className={`grid h-13 items-center gap-2.5 rounded-field border border-cell-line bg-cell px-3.5 text-left text-callout font-medium text-text ${
        pending
          ? "grid-cols-[minmax(0,1fr)_calc(var(--spacing)*4)_calc(var(--spacing)*8.5)]"
          : "grid-cols-[minmax(0,1fr)_calc(var(--spacing)*8.5)_calc(var(--spacing)*4)_calc(var(--spacing)*8.5)]"
      } ${focus}`}
    >
      <span className="tabular-nums">{dateText}</span>
      {!pending && <ChangeChip code={from} />}
      <ArrowRightIcon className="size-4 text-text-faint" />
      <ChangeChip code={to} />
    </button>
  );
}
