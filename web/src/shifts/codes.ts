// Shift codes (ADR 0002, docs/ux-spec.md §4.2). Keep the standard codes in step with
// server/internal/store/codes.go.

/** One or two uppercase letters: a standard code or an Other code. */
export type ShiftCode = string;

/** Tailwind classes for a shift code's chip, from the theme colours in index.css. */
export interface CodeStyle {
  /** Fill (or outline) and text colour of the chip. */
  chip: string;
  /** Border colour for the selected state, the chip's text colour. */
  selected: string;
}

export interface CodeInfo extends CodeStyle {
  code: ShiftCode;
  /** "Late" for a standard code; an Other code's label is the code itself. */
  label: string;
  standard: boolean;
}

/** The five standard codes, in display order. */
export const STANDARD_CODES: readonly CodeInfo[] = [
  { code: "D", label: "Day", standard: true, chip: "bg-amber-surface text-amber", selected: "border-amber" },
  { code: "E", label: "Early", standard: true, chip: "bg-sky-surface text-sky", selected: "border-sky" },
  { code: "L", label: "Late", standard: true, chip: "bg-violet-surface text-violet", selected: "border-violet" },
  { code: "N", label: "Night", standard: true, chip: "bg-indigo-surface text-indigo", selected: "border-indigo" },
  {
    code: "X",
    label: "Day off",
    standard: true,
    chip: "border border-border-strong text-text-faint",
    selected: "border-text-faint",
  },
];

/** Every Other code shares one colour. */
export const OTHER_STYLE: CodeStyle = { chip: "bg-lime-surface text-lime", selected: "border-lime" };

const CODE_PATTERN = /^[A-Z]{1,2}$/;

/** Whether s is a shift code: one or two uppercase letters. */
export function isValidCode(s: string): boolean {
  return CODE_PATTERN.test(s);
}

/** Whether s is one of D, E, L, N and X. */
export function isStandardCode(s: string): boolean {
  return STANDARD_CODES.some((c) => c.code === s);
}

/** Label and classes for a valid shift code; any non-standard code is an Other code. */
export function codeInfo(code: ShiftCode): CodeInfo {
  return STANDARD_CODES.find((c) => c.code === code) ?? { code, label: code, standard: false, ...OTHER_STYLE };
}
