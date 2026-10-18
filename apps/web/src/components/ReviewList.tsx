import { codeInfo, OTHER_STYLE, STANDARD_CODES } from "../shifts/codes";
import { OTHER, pickCode, type Badge, type ReviewRow, type RowEdit } from "../shifts/review";
import { formatShortDate } from "../lib/dates";

// The import review list, docs/ux-spec.md §6.4 and the review stage of docs/designs/Import.dc.html:
// one row per proposed shift with a checkbox, the date and what it replaces, one badge, and a
// native <select> code picker (the compact form of §5.4) tinted in the code's colours. Choosing
// Other shows a two-letter input beside it.

type ReviewListProps = {
  rows: readonly ReviewRow[];
  onEdit: (date: string, edit: RowEdit) => void;
};

// Markers are outlined (Tokens.dc.html), so they never read as a shift chip.
const BADGES: Record<Badge, string> = {
  New: "bg-mark-new-surface text-mark-new border-mark-new-line",
  Changed: "text-caution border-mark-changed-line",
  Same: "text-text-faint border-border",
  Unsure: "text-mark-unsure border-mark-unsure-line",
  "Needs code": "bg-danger-surface text-mark-needs border-danger-line",
};

/** Short labels that fit the 96 px select (the design's "X Off"). */
const OPTION_LABELS: Record<string, string> = { X: "Off" };

const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

/** Upper-cases the letters and drops anything else, keeping at most two. */
function toCodeLetters(s: string): string {
  return s.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2);
}

function fieldClasses(row: ReviewRow): string {
  if (row.choice === OTHER) return OTHER_STYLE.field;
  if (row.code) return codeInfo(row.code).field;
  return "bg-danger-surface text-danger-soft border-danger-line";
}

export function ReviewList({ rows, onEdit }: ReviewListProps) {
  return (
    <ul className="m-0 list-none border-t border-cell-line p-0">
      {rows.map((row) => {
        const id = `review-${row.date}`;
        const date = formatShortDate(row.date);
        return (
          <li
            key={row.date}
            className={`flex min-h-16 items-center gap-2.5 border-b border-cell-line pr-4 pl-1 ${row.checked ? "" : "bg-row-unticked"}`}
          >
            <input
              type="checkbox"
              id={id}
              checked={row.checked}
              disabled={row.disabled}
              onChange={() => onEdit(row.date, { checked: !row.checked })}
              className={`ml-3 size-5 flex-none accent-primary ${focus}`}
            />
            <label htmlFor={id} className="flex min-h-11 min-w-0 flex-1 cursor-pointer flex-col justify-center gap-0.5">
              <span className={`text-callout font-semibold tabular-nums ${row.checked ? "text-text" : "text-text-muted"}`}>
                {date}
              </span>
              <span className="truncate text-caption font-normal text-text-muted">{row.status}</span>
            </label>
            <span
              className={`inline-flex h-6 flex-none items-center rounded-xl border px-2 text-caption font-semibold ${BADGES[row.badge]}`}
            >
              {row.badge}
            </span>
            <select
              aria-label={`Shift for ${date}`}
              value={row.choice}
              onChange={(e) => onEdit(row.date, pickCode(row, e.target.value))}
              className={`h-11 flex-none rounded-control border px-2 font-mono text-code ${row.choice === OTHER ? "w-19" : "w-24"} ${fieldClasses(row)} ${focus}`}
            >
              <option value="">Pick…</option>
              {STANDARD_CODES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} {OPTION_LABELS[c.code] ?? c.label}
                </option>
              ))}
              <option value={OTHER}>Other</option>
            </select>
            {row.choice === OTHER && (
              <input
                type="text"
                maxLength={2}
                autoCapitalize="characters"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                aria-label={`Other code for ${date}`}
                placeholder="··"
                value={row.other}
                onChange={(e) => onEdit(row.date, pickCode(row, OTHER, toCodeLetters(e.target.value)))}
                className={`h-11 w-12 flex-none rounded-control border-[1.5px] border-lime-line bg-lime-surface p-0 text-center font-mono text-callout font-bold text-lime ${focus}`}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}
