// The import review (docs/ux-spec.md §6.4, docs/design.md § Review and apply): each proposed
// shift compared with the shift saved on its date, with the badge, status line and checkbox the
// review list shows. The user's changes are kept as overrides, so a sync that changes a saved
// shift while the list is open re-evaluates every row the user hasn't touched.
import type { ProposedShift } from "../api";
import { codeInfo, isStandardCode, isValidCode, type ShiftCode } from "./codes";
import type { Shift } from "./repo";

/** The comparison of a row's code with the saved shift. */
export type Kind = "New" | "Changed" | "Same" | "Needs code";

/** The one badge a row shows: Unsure takes precedence while the proposed code is unchanged. */
export type Badge = Kind | "Unsure";

/** The native select's value: "" for Pick…, a standard code, or OTHER. */
export type Choice = string;
export const OTHER = "O";

/** What the user changed on a row; absent fields keep their defaults. */
export interface RowEdit {
  choice?: Choice;
  other?: string;
  checked?: boolean;
}

export interface ReviewRow {
  date: string;
  proposed: ProposedShift;
  /** The shift saved on the phone for this date, if any. */
  existing: Shift | undefined;
  choice: Choice;
  /** The Other input's letters (shown while choice is OTHER). */
  other: string;
  /** The code that would be saved, or null while none is picked. */
  code: ShiftCode | null;
  kind: Kind;
  badge: Badge;
  /** "Already Night", "Was Day off", "Not rostered" or "Read as “A/L”". */
  status: string;
  checked: boolean;
  /** No code is picked, so the row can't be ticked. */
  disabled: boolean;
}

function initialChoice(p: ProposedShift): Choice {
  if (p.code === null) return "";
  return isStandardCode(p.code) ? p.code : OTHER;
}

function codeFor(choice: Choice, other: string): ShiftCode | null {
  const code = choice === OTHER ? other : choice;
  return isValidCode(code) ? code : null;
}

function kindOf(code: ShiftCode | null, existing: Shift | undefined): Kind {
  if (code === null) return "Needs code";
  if (!existing) return "New";
  return existing.code === code ? "Same" : "Changed";
}

function statusLine(p: ProposedShift, code: ShiftCode | null, existing: Shift | undefined): string {
  if (p.code === null) return `Read as “${p.rawCode}”`;
  if (!existing) return "Not rostered";
  const label = codeInfo(existing.code).label;
  return existing.code === code ? `Already ${label}` : `Was ${label}`;
}

/** Whether a row of this kind is ticked until the user says otherwise. */
const tickedByDefault = (kind: Kind) => kind === "New" || kind === "Changed";

/** The review rows in date order, from the proposed shifts, the saved shifts and the user's edits. */
export function reviewRows(
  proposed: readonly ProposedShift[],
  saved: ReadonlyMap<string, Shift>,
  edits: Readonly<Record<string, RowEdit>>,
): ReviewRow[] {
  return [...proposed]
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map((p) => {
      const edit = edits[p.date] ?? {};
      const existing = saved.get(p.date);
      const choice = edit.choice ?? initialChoice(p);
      const other = edit.other ?? (p.code !== null && !isStandardCode(p.code) ? p.code : "");
      const code = codeFor(choice, other);
      const kind = kindOf(code, existing);
      const disabled = code === null;
      return {
        date: p.date,
        proposed: p,
        existing,
        choice,
        other,
        code,
        kind,
        badge: p.uncertain && code === p.code ? "Unsure" : kind,
        status: statusLine(p, code, existing),
        checked: !disabled && (edit.checked ?? tickedByDefault(kind)),
        disabled,
      };
    });
}

/**
 * The edit for picking choice (and, for Other, typing other) on row: the row is re-evaluated
 * against the saved shift and ticked if it is now new or changed, so picking a code on a Needs
 * code row enables and ticks it.
 */
export function pickCode(row: ReviewRow, choice: Choice, other = row.other): RowEdit {
  const code = codeFor(choice, other);
  return { choice, other, checked: tickedByDefault(kindOf(code, row.existing)) };
}

/** The shifts a Save writes: every ticked row, keeping the saved shift's note. */
export function shiftsToSave(rows: readonly ReviewRow[]): { date: string; code: ShiftCode; note: string }[] {
  return rows
    .filter((r) => r.checked && r.code !== null)
    .map((r) => ({ date: r.date, code: r.code!, note: r.existing?.note ?? "" }));
}

/** "10 new · 1 changed · 2 same · 1 needs a code"; Unsure rows count by what they would do. */
export function summary(rows: readonly ReviewRow[]): string {
  const count = (k: Kind) => rows.filter((r) => r.kind === k).length;
  const parts: string[] = [];
  if (count("New")) parts.push(`${count("New")} new`);
  if (count("Changed")) parts.push(`${count("Changed")} changed`);
  if (count("Same")) parts.push(`${count("Same")} same`);
  if (count("Needs code")) parts.push(`${count("Needs code")} needs a code`);
  return parts.join(" · ");
}
