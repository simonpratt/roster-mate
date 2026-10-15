import type { Shift } from "../shifts/repo";
import { nextShiftText } from "../shifts/next";
import { CodeChip } from "./CodeChip";

// The next-shift block under the app header (docs/ux-spec.md §5.1): a "Next shift" caption, the
// code chip and the text. Tapping it shows that shift's month.
type NextShiftProps = {
  /** The next shift, null when there is none, undefined while loading. */
  shift: Shift | null | undefined;
  today: string;
  onShow: (date: string) => void;
};

export function NextShift({ shift, today, onShow }: NextShiftProps) {
  const text = shift === undefined ? "" : nextShiftText(shift ?? undefined, today);
  const content = (
    <>
      <CodeChip code={shift?.code ?? null} size="large" />
      <span>{text}</span>
    </>
  );
  return (
    <section aria-labelledby="next-shift" className="px-4 pt-4 pb-5">
      <p className="m-0 text-footnote font-medium tracking-[0.04em] text-text-muted uppercase">Next shift</p>
      <h1 id="next-shift" className="m-0 mt-2.5 text-display">
        {shift ? (
          <button
            type="button"
            onClick={() => onShow(shift.date)}
            className="flex items-center gap-3.5 rounded-card text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            {content}
          </button>
        ) : (
          <span className="flex items-center gap-3.5">{content}</span>
        )}
      </h1>
    </section>
  );
}
