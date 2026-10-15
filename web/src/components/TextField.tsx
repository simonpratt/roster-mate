import type { InputHTMLAttributes, Ref } from "react";

// A labelled single-line input, as on the Login design: 52 px tall, 16 px text (no iOS zoom).
type TextFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  id: string;
  label: string;
  /** Draws the border in the danger colour and sets aria-invalid. */
  invalid?: boolean;
  ref?: Ref<HTMLInputElement>;
};

export function TextField({ id, label, invalid = false, disabled, className = "", ...rest }: TextFieldProps) {
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
          "h-13 rounded-field border bg-surface px-3.5 text-body " +
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus " +
          (invalid ? "border-danger-line " : "border-border-input ") +
          (disabled ? "text-text-muted" : "text-text")
        }
        {...rest}
      />
    </div>
  );
}
