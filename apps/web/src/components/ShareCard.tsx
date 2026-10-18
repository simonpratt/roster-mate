import { useId } from "react";
import type { ShareEntry } from "../dates/share";

// The Share card at the top of the Babysitters screen, docs/ux-spec.md §6.5 and
// docs/designs/Babysitters.dc.html: the caption and the share window, a split bar with one grey
// segment per babysitter, then one row per babysitter with a matching swatch and its numbers.

/** The segments' greys, in turn and then repeating. */
const GREYS = ["bg-text", "bg-text-muted", "bg-text-dim"];

const grey = (i: number) => GREYS[i % GREYS.length];

type ShareCardProps = {
  /** "24 Aug – 18 Oct". */
  windowText: string;
  /** Most dates first. */
  entries: readonly ShareEntry[];
};

export function ShareCard({ windowText, entries }: ShareCardProps) {
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      className="mx-4 mt-2 flex flex-col gap-3.5 rounded-panel border border-border-subtle bg-surface p-4"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={titleId} className="m-0 text-footnote font-medium tracking-[0.04em] text-text-muted uppercase">
          Share
        </h2>
        <p className="m-0 text-footnote font-medium text-text-muted tabular-nums">{windowText}</p>
      </div>
      {entries.length > 0 ? (
        <>
          <div aria-hidden="true" data-testid="share-bar" className="flex h-3 gap-0.5">
            {entries.map((e, i) => (
              <span
                key={e.name}
                className={`min-w-1 rounded-[3px] ${grey(i)}`}
                style={{ flex: `${e.count} 1 0` }}
              />
            ))}
          </div>
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
            {entries.map((e, i) => (
              <li key={e.name} className="flex min-h-8 items-center gap-2.5 text-callout">
                <span aria-hidden="true" className={`size-2.5 flex-none rounded-[3px] ${grey(i)}`} />
                <span className="min-w-0 flex-1 truncate font-medium">{e.name}</span>
                <span className="text-text-soft tabular-nums">
                  {e.count} {e.count === 1 ? "date" : "dates"} · {e.percent}%
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="m-0 text-callout text-text-muted">No babysitters in these eight weeks.</p>
      )}
    </section>
  );
}
