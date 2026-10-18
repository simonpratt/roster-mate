import { codeInfo, type ShiftCode } from "../shifts/codes";

// A shift code's chip (docs/ux-spec.md §4.2): the letters in mono bold on the code's colours.
// "grid" is the chip in a calendar cell; "row" is the smaller chip in a Babysitters row
// (docs/designs/Babysitters.dc.html); "large" is the next-shift chip. Without a code, the
// large chip shows a dash on the plain surface.
type CodeChipProps = {
  code: ShiftCode | null;
  size: "grid" | "row" | "large";
  className?: string;
};

const sizes = {
  grid: "h-8 w-8.5 rounded-control text-code",
  row: "h-7 w-8.5 rounded-chip-sm text-code-sm",
  large: "size-12 rounded-card text-code-lg",
};

export function CodeChip({ code, size, className = "" }: CodeChipProps) {
  const colours = code ? codeInfo(code).chip : "border border-border bg-surface text-text-faint";
  return (
    <span aria-hidden="true" className={`flex flex-none items-center justify-center font-mono ${sizes[size]} ${colours} ${className}`}>
      {code ?? "–"}
    </span>
  );
}
