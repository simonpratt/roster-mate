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
  /** A selected code button's fill in the date sheet. */
  pickedFill: string;
  /** The code's text colour, for the letters on a code button. */
  text: string;
  /** Fill of the check badge on a selected code button, the code's text colour. */
  badge: string;
  /** Fill, text and border of the review list's native code picker. */
  field: string;
}

export interface CodeInfo extends CodeStyle {
  code: ShiftCode;
  /** "Late" for a standard code; an Other code's label is the code itself. */
  label: string;
  standard: boolean;
}

/** The five standard codes, in display order. */
export const STANDARD_CODES: readonly CodeInfo[] = [
  {
    code: "D",
    label: "Day",
    standard: true,
    chip: "bg-amber-surface text-amber",
    selected: "border-amber",
    pickedFill: "bg-amber-surface",
    text: "text-amber",
    badge: "bg-amber",
    field: "bg-amber-surface text-amber border-amber-line",
  },
  {
    code: "E",
    label: "Early",
    standard: true,
    chip: "bg-sky-surface text-sky",
    selected: "border-sky",
    pickedFill: "bg-sky-surface",
    text: "text-sky",
    badge: "bg-sky",
    field: "bg-sky-surface text-sky border-sky-line",
  },
  {
    code: "L",
    label: "Late",
    standard: true,
    chip: "bg-violet-surface text-violet",
    selected: "border-violet",
    pickedFill: "bg-violet-surface",
    text: "text-violet",
    badge: "bg-violet",
    field: "bg-violet-surface text-violet border-violet-line",
  },
  {
    code: "N",
    label: "Night",
    standard: true,
    chip: "bg-indigo-surface text-indigo",
    selected: "border-indigo",
    pickedFill: "bg-indigo-surface",
    text: "text-indigo",
    badge: "bg-indigo",
    field: "bg-indigo-surface text-indigo border-indigo-line",
  },
  {
    code: "X",
    label: "Day off",
    standard: true,
    chip: "border border-border-strong text-text-faint",
    selected: "border-text-faint",
    pickedFill: "bg-surface-disabled",
    text: "text-text-faint",
    badge: "bg-text-faint",
    field: "bg-surface text-text-faint border-border-strong",
  },
];

/** Every Other code shares one colour. */
export const OTHER_STYLE: CodeStyle = {
  chip: "bg-lime-surface text-lime",
  selected: "border-lime",
  pickedFill: "bg-lime-surface",
  text: "text-lime",
  badge: "bg-lime",
  field: "bg-lime-surface text-lime border-lime-line",
};

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
