import type { ButtonHTMLAttributes } from "react";
import { SpinnerIcon } from "./icons";

// Buttons, docs/ux-spec.md §5.6. Primary is the full-width 54 px action (Sign in, Save);
// outline is the compact 44 px action inside a banner (Back to calendar).
type Variant = "primary" | "secondary" | "ghost" | "outline";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  /** Shows a spinner, disables the button and sets aria-busy while a request runs. */
  busy?: boolean;
};

const base =
  "inline-flex items-center justify-center gap-2.5 font-semibold transition-transform " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus " +
  "enabled:active:scale-95";

const variants: Record<Variant, string> = {
  primary: "h-13.5 w-full rounded-card text-body",
  secondary: "h-11 rounded-control bg-surface-raised px-4 text-callout text-text",
  ghost: "h-11 rounded-control px-4 text-callout text-text-muted",
  outline: "h-11 rounded-control border border-border-strong px-4 text-callout text-text",
};

function primaryColours(busy: boolean, disabled: boolean) {
  if (busy) return "bg-text-soft text-on-primary";
  if (disabled) return "bg-surface-disabled text-text-disabled";
  return "bg-primary text-on-primary";
}

export function Button({
  variant = "primary",
  busy = false,
  disabled = false,
  className = "",
  type = "button",
  children,
  ...rest
}: ButtonProps) {
  const colours =
    variant === "primary"
      ? primaryColours(busy, disabled)
      : disabled
        ? "text-text-disabled"
        : "";
  return (
    <button
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={`${base} ${variants[variant]} ${colours} ${className}`}
      {...rest}
    >
      {busy && <SpinnerIcon className="size-4.5" />}
      {children}
    </button>
  );
}
