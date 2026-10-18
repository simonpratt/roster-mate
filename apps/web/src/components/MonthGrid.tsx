import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { addDays, addMonths, dayOfMonth, formatMonth, monthDates, monthOf, weekdayIndex, type DateString, type MonthString } from "../lib/dates";
import { babysitterInitials, dateLabel } from "../dates/babysitters";
import { NO_BABYSITTER, needsBabysitter, type BabysitterStatus } from "../dates/repo";
import type { Shift } from "../shifts/repo";
import { ChipWithAvatar, type AvatarStatus } from "./BabysitterAvatar";

// The month grid, docs/ux-spec.md §5.3 and docs/designs/Main.dc.html: a bar naming the month at
// the top of the scroll with the Today button, a Monday-first weekday row, then the months stacked
// in one vertical scroll, each with its own title and only its own dates. Each cell is a button
// showing the date number, the shift's code chip with the babysitter avatar on its corner (§5.10),
// and a row of event dots. The cell's border and fill never depend on the babysitter.
type MonthGridProps = {
  /** The months to show, earliest first; the Calendar adds to either end as asked. */
  months: MonthString[];
  /** The month to open on. */
  initialMonth: MonthString;
  today: DateString;
  /** The shifts in the months; undefined while loading. */
  shifts: Shift[] | undefined;
  /** The number of events on each date that has any; undefined while loading. */
  eventCounts: Map<string, number> | undefined;
  /** The babysitter on each date that has one; undefined while loading. */
  babysitters: Map<string, BabysitterStatus> | undefined;
  /** Every known babysitter name, for telling initials apart. */
  knownBabysitters: readonly string[];
  /** Called when the scroll comes within a screen of the first or last month. */
  onNearEnd: (end: "start" | "end") => void;
  onSelectDay: (date: DateString) => void;
};

const WEEKDAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"];

/** A cell shows at most this many event dots. */
const MAX_DOTS = 4;

const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

export function MonthGrid({
  months,
  initialMonth,
  today,
  shifts,
  eventCounts,
  babysitters,
  knownBabysitters,
  onNearEnd,
  onSelectDay,
}: MonthGridProps) {
  const byDate = useMemo(() => new Map((shifts ?? []).map((s) => [s.date, s])), [shifts]);
  const scroller = useRef<HTMLDivElement>(null);
  const [topMonth, setTopMonth] = useState(initialMonth);
  // Where to scroll once that month is rendered: on mount, and after Today.
  const pendingScroll = useRef<{ month: MonthString; smooth: boolean } | null>({ month: initialMonth, smooth: false });
  // The first month and scroll height before months were added above, to keep the view still.
  const before = useRef<{ first: MonthString; height: number } | null>(null);

  /**
   * The scroll offset that puts a month's dates at the top, its title just above the view; null
   * until the month is rendered. Offsets are within the scroller, which is positioned.
   */
  function gridTop(month: MonthString): number | null {
    const grid = scroller.current?.querySelector<HTMLElement>(`[data-month="${month}"] [data-grid]`);
    return grid ? grid.offsetTop : null;
  }

  function scrollToMonth(month: MonthString, smooth: boolean): boolean {
    const top = gridTop(month);
    if (top === null) return false;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (smooth && !reduced) scroller.current!.scrollTo({ top, behavior: "smooth" });
    else scroller.current!.scrollTop = top;
    return true;
  }

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (before.current && before.current.first !== months[0]) {
      el.scrollTop += el.scrollHeight - before.current.height;
    }
    before.current = null;
    const target = pendingScroll.current;
    if (target && scrollToMonth(target.month, target.smooth)) {
      pendingScroll.current = null;
      if (!target.smooth) setTopMonth(target.month);
    }
  }, [months]);

  function onScroll() {
    const el = scroller.current;
    if (!el) return;
    // The bar names the last month whose title has scrolled at least half out of view.
    let top = months[0]!;
    for (const section of el.querySelectorAll<HTMLElement>("[data-month]")) {
      const grid = section.querySelector<HTMLElement>("[data-grid]")!;
      if ((section.offsetTop + grid.offsetTop) / 2 <= el.scrollTop + 1) top = section.dataset.month!;
    }
    setTopMonth(top);
    if (el.scrollTop < el.clientHeight) {
      // Asked once until the months above arrive.
      if (before.current) return;
      before.current = { first: months[0]!, height: el.scrollHeight };
      onNearEnd("start");
    } else if (el.scrollHeight - el.scrollTop - el.clientHeight < el.clientHeight) {
      onNearEnd("end");
    }
  }

  // Today's month may not be rendered yet after a midnight rollover; the Calendar then adds it
  // and the layout effect scrolls.
  function goToday() {
    if (!scrollToMonth(monthOf(today), true)) pendingScroll.current = { month: monthOf(today), smooth: true };
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-13 flex-none items-center justify-between pr-2 pl-4">
        <h1 aria-live="polite" className="m-0 text-title">
          {formatMonth(topMonth)}
        </h1>
        <button
          type="button"
          onClick={goToday}
          // 36 px visible pill inside a 44 px tap target.
          className={`flex h-11 items-center rounded-full ${focus}`}
        >
          <span className="flex h-9 items-center rounded-full border border-border bg-surface px-3.5 text-label text-text">
            Today
          </span>
        </button>
      </div>

      <div
        aria-hidden="true"
        className="grid flex-none grid-cols-7 gap-0.75 border-b border-cell-line px-3 pb-1.5 text-center text-caption text-text-faint"
      >
        {WEEKDAY_LETTERS.map((l, i) => (
          <span key={i}>{l}</span>
        ))}
      </div>

      <div
        ref={scroller}
        data-testid="month-scroll"
        onScroll={onScroll}
        className="relative min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-3 pb-[max(24px,env(safe-area-inset-bottom))]"
      >
        {months.map((month) => (
          <MonthSection
            key={month}
            month={month}
            today={today}
            byDate={byDate}
            eventCounts={eventCounts}
            babysitters={babysitters}
            knownBabysitters={knownBabysitters}
            onSelectDay={onSelectDay}
          />
        ))}
      </div>
    </div>
  );
}

type MonthSectionProps = {
  month: MonthString;
  today: DateString;
  byDate: Map<string, Shift>;
  eventCounts: Map<string, number> | undefined;
  babysitters: Map<string, BabysitterStatus> | undefined;
  knownBabysitters: readonly string[];
  onSelectDay: (date: DateString) => void;
};

/** One month: its title, blanks up to the 1st's weekday, then its dates. */
function MonthSection({ month, today, byDate, eventCounts, babysitters, knownBabysitters, onSelectDay }: MonthSectionProps) {
  const dates = useMemo(() => monthDates(month), [month]);
  const title = formatMonth(month);
  return (
    <section aria-label={title} data-month={month} className="pb-3">
      <h2 className="m-0 h-11 px-1 pt-4 text-callout font-semibold text-text-soft">{title}</h2>
      <div data-grid className="grid grid-cols-7 gap-0.75">
        {Array.from({ length: weekdayIndex(dates[0]!) }, (_, i) => (
          <span key={i} aria-hidden="true" className="h-21" />
        ))}
        {dates.map((date) => (
          <DayCell
            key={date}
            date={date}
            shift={byDate.get(date)}
            events={eventCounts?.get(date) ?? 0}
            babysitter={babysitters?.get(date) ?? NO_BABYSITTER}
            known={knownBabysitters}
            // Unmarked until the babysitters have loaded, so a cell doesn't flash the amber dot.
            needsBabysitter={babysitters !== undefined && needsBabysitter(byDate.get(date), babysitters.get(date)?.name ?? "", date, today)}
            today={today}
            onSelect={onSelectDay}
          />
        ))}
      </div>
    </section>
  );
}

/** The first and last dates of the months, for querying them. */
export function monthsRange(months: MonthString[]): [DateString, DateString] {
  return [`${months[0]}-01`, addDays(`${addMonths(months[months.length - 1]!, 1)}-01`, -1)];
}

type DayCellProps = {
  date: DateString;
  shift: Shift | undefined;
  events: number;
  /** The babysitter, or NO_BABYSITTER for none. */
  babysitter: BabysitterStatus;
  known: readonly string[];
  needsBabysitter: boolean;
  today: DateString;
  onSelect: (date: DateString) => void;
};

function DayCell({ date, shift, events, babysitter, known, needsBabysitter, today, onSelect }: DayCellProps) {
  const isToday = date === today;
  const code = shift?.code ?? null;
  const name = dateLabel({ date, code, babysitter, needsBabysitter, events, today });

  const cell = isToday ? "border border-text bg-surface ring-1 ring-inset ring-text" : "border border-cell-line bg-cell";
  const number = isToday ? "font-bold text-text" : date < today ? "text-text-disabled" : "text-text-soft";
  const status: AvatarStatus | null = babysitter.name
    ? babysitter.confirmed
      ? "confirmed"
      : "tentative"
    : needsBabysitter
      ? "needs"
      : null;

  return (
    <button
      type="button"
      aria-label={name}
      data-date={date}
      aria-current={isToday ? "date" : undefined}
      onClick={() => onSelect(date)}
      className={`flex h-21 min-w-0 flex-col items-center justify-between rounded-field pt-1.75 pb-2 ${cell} ${focus}`}
    >
      <span className={`font-mono text-caption tabular-nums ${number}`}>{dayOfMonth(date)}</span>
      {code || status ? (
        <ChipWithAvatar
          code={code}
          size="grid"
          avatar={status && { status, initials: babysitterInitials(babysitter.name, known) }}
          ring={isToday ? "surface" : "cell"}
        />
      ) : (
        <span className="h-8" />
      )}
      <span data-testid="event-dots" className="flex h-1.25 gap-0.75">
        {Array.from({ length: Math.min(events, MAX_DOTS) }, (_, i) => (
          <span key={i} className="size-1.25 rounded-full bg-text" />
        ))}
      </span>
    </button>
  );
}
