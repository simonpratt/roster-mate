import { ChevronRightIcon } from "./icons";

// A row of the Roster emails screen, docs/ux-spec.md §6.7 and docs/designs/RosterEmails.dc.html:
// a 64 px-minimum button on `cell` with the address (truncated) over its babysitter line, and a
// chevron. Tapping it opens the recipient sheet.
type RecipientRowProps = {
  email: string;
  /** "Babysitter: Nan" or "No babysitter". */
  summary: string;
  /** The accessible name, "nan@example.com, babysitter Nan". */
  label: string;
  onSelect: (row: HTMLButtonElement) => void;
};

export function RecipientRow({ email, summary, label, onSelect }: RecipientRowProps) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={(e) => onSelect(e.currentTarget)}
      className="grid min-h-16 grid-cols-[minmax(0,1fr)_16px] items-center gap-2.5 rounded-field border border-cell-line bg-cell px-3.5 py-2.5 text-left text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
    >
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-callout font-medium">{email}</span>
        <span className="text-footnote text-text-muted">{summary}</span>
      </span>
      <ChevronRightIcon className="size-4 text-text-faint" />
    </button>
  );
}
