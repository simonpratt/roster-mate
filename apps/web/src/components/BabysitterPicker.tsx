import { useEffect, useId, useRef } from "react";
import { BABYSITTER_NAME_MAX } from "../dates/repo";
import { CheckIcon } from "./icons";

// The babysitter picker, docs/ux-spec.md §5.8 and docs/designs/DateSheetNewSitter.dc.html (markup
// in Main.dc.html): "None", every name used before and "+ Someone else" as a radio group, then
// (when Someone else is chosen) a Name input. Typing a known name there selects its chip instead;
// the input stays open, as the code picker's Other input does.

/** What the picker holds: a name picked by its chip ("" for None), or an open Name input. */
export type BabysitterValue = {
  /** The name picked by its chip; "" is None. */
  name: string;
  /** The Name input's text while it is open, else null. */
  other: string | null;
};

/** The picker's value for a saved babysitter ("" for none). */
export function babysitterValueFor(name: string): BabysitterValue {
  return { name, other: null };
}

/** The known name matching text, trimmed and ignoring case, if any. */
function knownMatch(text: string, known: readonly string[]): string | undefined {
  const key = text.trim().toLocaleLowerCase();
  return key === "" ? undefined : known.find((n) => n.toLocaleLowerCase() === key);
}

/**
 * The name the picker holds: a chip's name, a known name typed under Someone else (in its known
 * spelling), the typed name trimmed, or null while Someone else is open with no name yet.
 */
export function pickedBabysitter(value: BabysitterValue, known: readonly string[]): string | null {
  if (value.other === null) return value.name;
  const typed = value.other.trim();
  if (typed === "") return null;
  return knownMatch(typed, known) ?? typed;
}

type BabysitterPickerProps = {
  value: BabysitterValue;
  onChange: (value: BabysitterValue) => void;
  /** Every name used on any date, A–Z. */
  known: readonly string[];
  /** Shows "Needs a babysitter" beside the label. */
  needed: boolean;
};

const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

export function BabysitterPicker({ value, onChange, known, needed }: BabysitterPickerProps) {
  const labelId = useId();
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const focusInput = useRef(false);
  const otherOpen = value.other !== null;
  // The chip shown as selected: a Name input holding a known name selects that name's chip.
  // A saved name differing from the known spelling only in case still selects its chip.
  const match = otherOpen ? knownMatch(value.other!, known) : undefined;
  const selected = (otherOpen ? (match ?? null) : value.name)?.toLocaleLowerCase() ?? null;

  // Choosing Someone else moves focus into its input.
  useEffect(() => {
    if (otherOpen && focusInput.current) input.current?.focus();
    focusInput.current = false;
  }, [otherOpen]);

  function pickOther() {
    if (otherOpen) {
      input.current?.focus();
      return;
    }
    focusInput.current = true;
    onChange({ name: value.name, other: "" });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span id={labelId} className="text-label text-text-soft">
          Babysitter
        </span>
        {needed && <span className="text-footnote font-medium text-warn">Needs a babysitter</span>}
      </div>
      <div role="radiogroup" aria-labelledby={labelId} className="flex flex-wrap gap-1.5">
        <Chip label="None" checked={selected === ""} onPick={() => onChange({ name: "", other: null })} />
        {known.map((n) => (
          <Chip key={n} label={n} checked={selected === n.toLocaleLowerCase()} onPick={() => onChange({ name: n, other: null })} />
        ))}
        <Chip label="Someone else" add checked={otherOpen && !match} onPick={pickOther} />
      </div>
      {otherOpen && (
        <div className="mt-0.5 flex flex-col gap-1.5">
          <label htmlFor={inputId} className="text-footnote text-text-muted">
            Name
          </label>
          <input
            ref={input}
            id={inputId}
            type="text"
            maxLength={BABYSITTER_NAME_MAX}
            autoCapitalize="words"
            autoComplete="off"
            placeholder="e.g. Aunty Bec"
            value={value.other!}
            onChange={(e) => onChange({ name: value.name, other: e.target.value })}
            className={`h-12 rounded-field border border-border-input bg-bg px-3.5 text-body text-text placeholder:text-text-disabled ${focus}`}
          />
        </div>
      )}
    </div>
  );
}

type ChipProps = {
  label: string;
  checked: boolean;
  /** The dashed "+ Someone else" chip. */
  add?: boolean;
  onPick: () => void;
};

// Selected: a text border, raised fill and a check, so selection doesn't rest on colour.
function Chip({ label, checked, add = false, onPick }: ChipProps) {
  const look = checked
    ? "border-solid border-text bg-surface-raised text-text"
    : add
      ? "border-dashed border-border bg-picker text-text-muted"
      : "border-solid border-border bg-picker text-text-soft";
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      aria-label={label}
      onClick={onPick}
      className={`flex h-11 max-w-full min-w-0 items-center gap-1.5 rounded-full border-[1.5px] px-4 text-callout font-medium ${look} ${focus}`}
    >
      {checked && <CheckIcon className="size-3.5 flex-none" />}
      <span className="truncate">{add && !checked ? `+ ${label}` : label}</span>
    </button>
  );
}
