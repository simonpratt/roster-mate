import type { InputHTMLAttributes, Ref } from "react";

// A labelled single-line input, as on the Login design: 52 px tall, 16 px text (no iOS zoom).
// The "sunken" tone is the edit sheet's note: 48 px tall on the page background, as the sheet
// itself is on `surface`.
type TextFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  id: string;
  label: string;
  tone?: "surface" | "sunken";
  /** Draws the border in the danger colour and sets aria-invalid. */
  invalid?: boolean;
  ref?: Ref<HTMLInputElement>;
};

export function TextField({
  id,
  label,
  tone = "surface",
  invalid = false,
  disabled,
  className = "",
  ...rest
}: TextFieldProps) {
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <label htmlFor={id} className="text-label text-text-soft">
        {label}
      </label>
      <input
        id={id}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        className={
          (tone === "sunken" ? "h-12 bg-bg " : "h-13 bg-surface ") +
          "rounded-field border px-3.5 text-body " +
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus " +
          (invalid ? "border-danger-line " : "border-border-input ") +
          (disabled ? "text-text-muted" : "text-text")
        }
        {...rest}
      />
    </div>
  );
}
