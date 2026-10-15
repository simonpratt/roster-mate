import type { ReactNode } from "react";

// Banners and inline messages, docs/ux-spec.md §5.7: a rounded, tinted box with an icon, one
// sentence and an optional action.
//  - neutral: a status banner at the top of a screen (offline), with room for an action
//  - danger:  an error the user can fix (wrong username or password)
//  - caution: a problem outside the app (server unreachable)
type Tone = "neutral" | "danger" | "caution";

type BannerProps = {
  tone: Tone;
  icon: ReactNode;
  children: ReactNode;
  /** Shown under the message, e.g. a Button. */
  action?: ReactNode;
  /** "alert" for errors (announced at once), "status" for state changes. */
  role?: "alert" | "status";
};

const tones: Record<Tone, { box: string; icon: string }> = {
  neutral: {
    box: "gap-3 rounded-card border-border-input bg-surface p-3.5 text-callout text-text",
    icon: "size-5 text-text-muted",
  },
  danger: {
    box: "rounded-field border-danger-line bg-danger-surface px-3.5 py-3 text-label font-normal text-danger-soft",
    icon: "size-4.5 text-danger",
  },
  caution: {
    box: "rounded-field border-caution-line bg-caution-surface px-3.5 py-3 text-label font-normal text-caution-soft",
    icon: "size-4.5 text-caution",
  },
};

export function Banner({ tone, icon, children, action, role = "status" }: BannerProps) {
  const t = tones[tone];
  return (
    <div role={role} className={`flex flex-col border ${t.box}`}>
      <div className="flex items-start gap-2.5">
        <span className={`mt-px flex-none ${t.icon}`}>{icon}</span>
        <p className="m-0">{children}</p>
      </div>
      {action && <div className="self-start">{action}</div>}
    </div>
  );
}
