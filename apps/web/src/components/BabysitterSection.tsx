import { useId, type ReactNode } from "react";
import type { ShiftCode } from "../shifts/codes";
import { BabysitterAvatar, ChipWithAvatar, type AvatarStatus } from "./BabysitterAvatar";
import { CheckIcon } from "./icons";

// A section of the Babysitters screen and its date rows, docs/ux-spec.md §6.5 and
// docs/designs/Babysitters.dc.html: a 28 px avatar, the h2 title, a summary and, while any date is
// tentative, a compact "Confirm all"; then one 52 px row per date.

const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

type BabysitterSectionProps = {
  /** "needs" for the Needs a babysitter section. */
  status: AvatarStatus;
  initials?: string;
  title: string;
  summary: string;
  /** Shows Confirm all, labelled "Confirm all dates with {title}". */
  onConfirmAll?: () => void;
  children: ReactNode;
};

export function BabysitterSection({ status, initials, title, summary, onConfirmAll, children }: BabysitterSectionProps) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="mx-4 mt-7 flex flex-col gap-2">
      <div className="flex min-h-11 items-center gap-3">
        <BabysitterAvatar status={status} initials={initials} size="large" />
        <div className="flex min-w-0 flex-1 flex-col gap-px">
          <h2 id={titleId} className="m-0 truncate text-title">
            {title}
          </h2>
          <p className="m-0 text-footnote text-text-muted">{summary}</p>
        </div>
        {onConfirmAll && (
          <button
            type="button"
            aria-label={`Confirm all dates with ${title}`}
            onClick={onConfirmAll}
            className={`flex h-11 flex-none items-center rounded-full ${focus}`}
          >
            <span className="flex h-9 items-center gap-1.5 rounded-full border border-border bg-surface-raised px-3.5 text-label font-semibold text-text">
              <CheckIcon className="size-3.5" />
              Confirm all
            </span>
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

type BabysitterDateRowProps = {
  date: string;
  /** "Fri 23 Oct". */
  dateText: string;
  /** The accessible name, as on a calendar cell. */
  label: string;
  code: ShiftCode | null;
  status: AvatarStatus;
  initials?: string;
  onSelect: (date: string) => void;
};

const statusText: Record<AvatarStatus, ReactNode> = {
  needs: <span className="text-babysitter-need">No babysitter</span>,
  tentative: <span className="text-text-muted">Tentative</span>,
  confirmed: (
    <span className="flex items-center gap-1.5 text-text">
      <CheckIcon className="size-3.5" />
      Confirmed
    </span>
  ),
};

/** A date row: the date, the chip with the avatar, and the status. Tapping it opens the date. */
export function BabysitterDateRow({ date, dateText, label, code, status, initials, onSelect }: BabysitterDateRowProps) {
  return (
    <button
      type="button"
      data-date={date}
      aria-label={label}
      onClick={() => onSelect(date)}
      className={`grid h-13 grid-cols-[minmax(0,1fr)_auto_calc(var(--spacing)*28)] items-center gap-3 rounded-field border border-cell-line bg-cell px-3.5 text-left text-callout font-medium text-text ${focus}`}
    >
      <span className="tabular-nums">{dateText}</span>
      <ChipWithAvatar code={code} size="row" avatar={{ status, initials }} ring="cell" />
      <span className="justify-self-end text-label">{statusText[status]}</span>
    </button>
  );
}
