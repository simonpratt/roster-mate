import type { ButtonHTMLAttributes, Ref } from "react";
import { SpinnerIcon } from "./icons";

// Buttons, docs/ux-spec.md §5.6. Primary is the full-width 54 px action (Sign in, Save);
// outline is the compact 44 px action inside a banner (Back to calendar); outline-wide is the
// full-width Cancel beside a primary; compact is the 44 px primary in the Calendar header
// (Import); danger is the Sign in action on the sign-in banner.
export type Variant = "primary" | "secondary" | "ghost" | "outline" | "outline-wide" | "compact" | "danger";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  /** Shows a spinner, disables the button and sets aria-busy while a request runs. */
  busy?: boolean;
  ref?: Ref<HTMLButtonElement>;
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
  "outline-wide": "h-13.5 w-full rounded-card border border-border-input text-body text-text",
  compact: "h-11 rounded-field bg-primary pr-3.5 pl-3 text-callout text-on-primary",
  danger: "h-11 rounded-control bg-danger px-4 text-callout text-on-danger",
};

function primaryColours(busy: boolean, disabled: boolean) {
  if (busy) return "bg-text-soft text-on-primary";
  if (disabled) return "bg-surface-disabled text-text-disabled";
  return "bg-primary text-on-primary";
}

/** The classes for a button of this variant, also for links styled as buttons. */
export function buttonClassName(variant: Variant = "primary", busy = false, disabled = false): string {
  const colours =
    variant === "primary"
      ? primaryColours(busy, disabled)
      : disabled
        ? "text-text-disabled"
        : "";
  return `${base} ${variants[variant]} ${colours}`;
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
  return (
    <button
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={`${buttonClassName(variant, busy, disabled)} ${className}`}
      {...rest}
    >
      {busy && <SpinnerIcon className="size-4.5" />}
      {children}
    </button>
  );
}
