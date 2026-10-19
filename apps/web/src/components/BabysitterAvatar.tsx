import type { ShiftCode } from "../shifts/codes";
import { CodeChip } from "./CodeChip";
import { SwapIcon } from "./icons";

// The babysitter avatar, docs/ux-spec.md §5.10, docs/designs/Main.dc.html (cellLook) and
// Babysitters.dc.html: a small circle on a shift chip's top-right corner showing the date's
// babysitter state in neutral greys, so the shift's colour stays the loudest thing. "large" is
// the 28 px circle by a section heading on the Babysitters screen. Always aria-hidden: the
// date's accessible name carries the babysitter and status.

export type AvatarStatus = "needs" | "tentative" | "confirmed";

/** The colour behind the avatar, which its 2 px ring matches. */
export type AvatarRing = "cell" | "surface";

type BabysitterAvatarProps = {
  status: AvatarStatus;
  /** The initials; unused for "needs". */
  initials?: string;
  size?: "small" | "large";
  ring?: AvatarRing;
  className?: string;
};

const rings: Record<AvatarRing, string> = {
  cell: "ring-2 ring-cell",
  surface: "ring-2 ring-surface",
};

const looks: Record<"small" | "large", Record<AvatarStatus, string>> = {
  small: {
    needs: "size-2 bg-babysitter-need",
    tentative: "size-4 border border-dashed border-text-disabled bg-cell text-initials text-text-muted",
    confirmed: "size-4 bg-border-strong text-initials text-text",
  },
  large: {
    needs: "size-7 border border-dashed border-text-dim",
    tentative: "size-7 border border-dashed border-text-disabled bg-cell text-caption font-bold text-text-muted",
    confirmed: "size-7 bg-border-strong text-caption font-bold text-text",
  },
};

export function BabysitterAvatar({ status, initials = "", size = "small", ring, className = "" }: BabysitterAvatarProps) {
  return (
    <span
      aria-hidden="true"
      data-testid="babysitter-avatar"
      data-status={status}
      className={`flex flex-none items-center justify-center rounded-full font-mono leading-none ${looks[size][status]} ${ring ? rings[ring] : ""} ${className}`}
    >
      {status === "needs" ? size === "large" && <span className="size-2.5 rounded-full bg-babysitter-need" /> : initials}
    </span>
  );
}

type ChipWithAvatarProps = {
  /** The shift code, or null on an unrostered date. */
  code: ShiftCode | null;
  size: "grid" | "row";
  /** The avatar to show, or none. */
  avatar: { status: AvatarStatus; initials?: string } | null;
  /** Whether to show the swap badge (§5.11); only the month grid does. Ignored with no shift. */
  swapped?: boolean;
  ring: AvatarRing;
  className?: string;
};

/**
 * A shift chip with the avatar on its top-right corner: 3 px past it for the needs dot, 7 px for
 * initials. With no shift the avatar sits centred where the chip would be. A swapped shift has
 * the swap badge 5 px past its bottom-left corner, opposite the avatar.
 */
export function ChipWithAvatar({ code, size, avatar, swapped = false, ring, className = "" }: ChipWithAvatarProps) {
  const box = size === "grid" ? "h-8 w-8.5" : "h-7 w-8.5";
  const place = !avatar
    ? ""
    : avatar.status === "needs"
      ? "absolute -top-0.75 -right-0.75"
      : code
        ? "absolute -top-1.75 -right-1.75"
        : "absolute top-1/2 right-1/2 translate-x-1/2 -translate-y-1/2";
  return (
    <span aria-hidden="true" className={`relative flex ${className}`}>
      {code ? <CodeChip code={code} size={size} /> : <span className={box} />}
      {avatar && <BabysitterAvatar status={avatar.status} initials={avatar.initials} ring={ring} className={place} />}
      {code && swapped && <SwapBadge ring={ring} />}
    </span>
  );
}

/**
 * The swap badge, docs/ux-spec.md §5.11: a 15 px circle in the import review's Changed colours
 * with a ⇄ glyph. aria-hidden: the date's accessible name says what the shift was swapped from.
 */
function SwapBadge({ ring }: { ring: AvatarRing }) {
  return (
    <span
      aria-hidden="true"
      data-testid="swap-badge"
      className={`absolute -bottom-1.25 -left-1.25 flex size-3.75 items-center justify-center rounded-full border border-mark-changed-line bg-caution-surface text-caution ${rings[ring]}`}
    >
      <SwapIcon className="size-2.25" />
    </span>
  );
}
