import type { ReactNode } from "react";

// Banners and inline messages, docs/ux-spec.md §5.7: a rounded, tinted box with an icon, one
// sentence and an optional action.
//  - neutral: a status banner at the top of a screen (offline), with room for an action
//  - danger:  an error the user can fix (wrong username or password), or the Calendar's
//             sign-in banner
//  - caution: a problem outside the app (server unreachable)
// The stacked layout puts the action under the message; inline puts it to the right, as on the
// Calendar's sign-in banner (docs/designs/CalendarSignIn.dc.html).
type Tone = "neutral" | "danger" | "caution";

type BannerProps = {
  tone: Tone;
  icon?: ReactNode;
  children: ReactNode;
  /** Shown under the message (stacked) or beside it (inline), e.g. a Button. */
  action?: ReactNode;
  layout?: "stacked" | "inline";
  /** "alert" for errors (announced at once), "status" for state changes. */
  role?: "alert" | "status";
};

const tones: Record<Tone, { colour: string; shape: string; icon: string }> = {
  neutral: {
    colour: "border-border-input bg-surface text-callout text-text",
    shape: "gap-3 rounded-card p-3.5",
    icon: "size-5 text-text-muted",
  },
  danger: {
    colour: "border-danger-line bg-danger-surface text-label font-normal text-danger-soft",
    shape: "rounded-field px-3.5 py-3",
    icon: "size-4.5 text-danger",
  },
  caution: {
    colour: "border-caution-line bg-caution-surface text-label font-normal text-caution-soft",
    shape: "rounded-field px-3.5 py-3",
    icon: "size-4.5 text-caution",
  },
};

export function Banner({ tone, icon, children, action, layout = "stacked", role = "status" }: BannerProps) {
  const t = tones[tone];
  const iconEl = icon && <span className={`mt-px flex-none ${t.icon}`}>{icon}</span>;
  if (layout === "inline") {
    return (
      <div role={role} className={`flex items-center gap-3 rounded-card border py-2.5 pr-2.5 pl-3.5 ${t.colour}`}>
        {iconEl}
        <p className="m-0 flex-1">{children}</p>
        {action && <div className="flex-none">{action}</div>}
      </div>
    );
  }
  return (
    <div role={role} className={`flex flex-col border ${t.shape} ${t.colour}`}>
      <div className="flex items-start gap-2.5">
        {iconEl}
        <p className="m-0">{children}</p>
      </div>
      {action && <div className="self-start">{action}</div>}
    </div>
  );
}
