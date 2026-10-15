import { useEffect, useRef, type ReactNode } from "react";
import { isStandardCode, OTHER_STYLE, STANDARD_CODES, type CodeStyle, type ShiftCode } from "../shifts/codes";
import { CheckIcon } from "./icons";

// The code picker, docs/ux-spec.md §5.4 and the edit sheet in docs/designs/Main.dc.html: the five
// standard codes and "Other" as a radio group, then (when Other is chosen) a two-letter input.
// Typing a standard code in that input selects its button instead of Other; the input stays
// open so a longer Other code that starts with one (XD) can still be typed.

/** What the picker holds: a standard code picked by its button, or an open Other input. */
export type PickerValue = {
  /** The standard code picked by its button; null before anything is picked. */
  standard: ShiftCode | null;
  /** The Other input's letters while it is open, else null. */
  other: string | null;
};

/** The picker's value for a saved code (or none, on an unrostered date). */
export function pickerValueFor(code: ShiftCode | null): PickerValue {
  if (code === null) return { standard: null, other: null };
  return isStandardCode(code) ? { standard: code, other: null } : { standard: null, other: code };
}

/** The code the picker holds: a standard code, the Other letters (maybe "" or one letter), or null. */
export function pickedCode(value: PickerValue): ShiftCode | null {
  return value.other ?? value.standard;
}

/** Upper-cases the letters and drops anything else, keeping at most two. */
function toCodeLetters(s: string): string {
  return s.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2);
}

type CodePickerProps = {
  value: PickerValue;
  onChange: (value: PickerValue) => void;
  /** Shown under the buttons, above the Other input. */
  hint?: ReactNode;
};

const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

export function CodePicker({ value, onChange, hint }: CodePickerProps) {
  const otherInput = useRef<HTMLInputElement>(null);
  const focusOther = useRef(false);
  const otherOpen = value.other !== null;
  // The button shown as selected: an Other input holding a standard code selects that code.
  const selected = otherOpen ? (isStandardCode(value.other!) ? value.other : "other") : value.standard;

  // Picking Other moves focus into its input; opening on a saved Other code doesn't.
  useEffect(() => {
    if (otherOpen && focusOther.current) otherInput.current?.focus();
    focusOther.current = false;
  }, [otherOpen]);

  function pickOther() {
    if (otherOpen) return;
    focusOther.current = true;
    onChange({ standard: value.standard, other: "" });
  }

  const otherLetters = otherOpen && !isStandardCode(value.other!) ? value.other! : "";

  return (
    <>
      <div className="flex flex-col gap-2.5">
        <div role="radiogroup" aria-label="Shift" className="grid grid-cols-6 gap-1.5">
          {STANDARD_CODES.map((c) => (
            <CodeButton
              key={c.code}
              letters={c.code}
              label={c.label}
              name={`${c.code}, ${c.label}`}
              style={c}
              checked={selected === c.code}
              onPick={() => onChange({ standard: c.code, other: null })}
            />
          ))}
          <CodeButton
            letters={otherLetters || "··"}
            label="Other"
            name={otherLetters ? `Other, ${otherLetters}` : "Other"}
            style={OTHER_STYLE}
            checked={selected === "other"}
            onPick={pickOther}
          />
        </div>
        {hint}
      </div>

      {otherOpen && (
        <div className="flex items-center gap-3.5">
          <input
            ref={otherInput}
            id="shift-code"
            type="text"
            maxLength={2}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            placeholder="SE"
            value={value.other!}
            onChange={(e) => onChange({ standard: value.standard, other: toCodeLetters(e.target.value) })}
            className={`h-13 w-19 flex-none rounded-field border-[1.5px] border-lime-line bg-lime-surface p-0 text-center font-mono text-code-xl text-lime placeholder:text-lime/40 ${focus}`}
          />
          <label htmlFor="shift-code" className="flex flex-col gap-0.5">
            <span className="text-label text-text-soft">Code</span>
            <span className="text-footnote text-text-muted">1–2 letters, as on your roster</span>
          </label>
        </div>
      )}
    </>
  );
}

type CodeButtonProps = {
  letters: string;
  label: string;
  /** The accessible name, "L, Late". */
  name: string;
  style: CodeStyle;
  checked: boolean;
  onPick: () => void;
};

// Selected: a border in the code's colour and a check badge, so selection doesn't rest on colour.
function CodeButton({ letters, label, name, style, checked, onPick }: CodeButtonProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      aria-label={name}
      onClick={onPick}
      className={
        "relative flex h-18 min-w-0 flex-col items-center justify-center gap-1 rounded-card border-[1.5px] p-0 " +
        (checked ? `${style.selected} ${style.pickedFill}` : "border-border bg-picker") +
        ` ${focus}`
      }
    >
      {checked && (
        <span
          aria-hidden="true"
          className={`absolute top-1.25 right-1.25 flex size-4 items-center justify-center rounded-full text-bg ${style.badge}`}
        >
          <CheckIcon className="size-2.5" />
        </span>
      )}
      <span className={`font-mono text-code-lg ${style.text}`}>{letters}</span>
      <span className={`text-caption ${checked ? "text-text" : "text-text-muted"}`}>{label}</span>
    </button>
  );
}
