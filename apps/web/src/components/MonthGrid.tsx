import { useMemo, useRef, type TouchEvent } from "react";
import {
  addMonths,
  dayOfMonth,
  formatLongDate,
  formatMonth,
  monthGridDates,
  monthOf,
  type DateString,
  type MonthString,
} from "../lib/dates";
import { codeInfo } from "../shifts/codes";
import type { Shift } from "../shifts/repo";
import { CodeChip } from "./CodeChip";
import { ChevronLeftIcon, ChevronRightIcon } from "./icons";

// The month grid, docs/ux-spec.md §5.3 and docs/designs/Main.dc.html: month controls, a
// Monday-first weekday row and six rows of date cells. Each cell is a button showing the date
// number, the shift's code chip and a marker row.
type MonthGridProps = {
  month: MonthString;
  today: DateString;
  /** The shifts in or around the month; undefined while loading. */
  shifts: Shift[] | undefined;
  onMonthChange: (month: MonthString) => void;
  onSelectDay: (date: DateString) => void;
};

const WEEKDAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"];

/** A horizontal swipe of at least this many px changes month. */
const SWIPE_PX = 50;

const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

export function MonthGrid({ month, today, shifts, onMonthChange, onSelectDay }: MonthGridProps) {
  const dates = useMemo(() => monthGridDates(month), [month]);
  const byDate = useMemo(() => new Map((shifts ?? []).map((s) => [s.date, s])), [shifts]);
  const touch = useRef<{ x: number; y: number } | null>(null);

  function onTouchStart(e: TouchEvent) {
    const t = e.touches[0];
    touch.current = t ? { x: t.clientX, y: t.clientY } : null;
  }

  function onTouchEnd(e: TouchEvent) {
    const start = touch.current;
    touch.current = null;
    const t = e.changedTouches[0];
    if (!start || !t) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    // Mostly horizontal: well clear of a vertical scroll.
    if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    onMonthChange(addMonths(month, dx < 0 ? 1 : -1));
  }

  const navButton = `flex size-11 items-center justify-center rounded-field text-text-soft ${focus}`;

  return (
    <div>
      <div className="flex h-13 items-center justify-between pr-2 pl-4">
        <h2 aria-live="polite" className="m-0 text-title">
          {formatMonth(month)}
        </h2>
        <div className="flex items-center gap-0.5">
          <button type="button" aria-label="Previous month" onClick={() => onMonthChange(addMonths(month, -1))} className={navButton}>
            <ChevronLeftIcon className="size-5" />
          </button>
          <button
            type="button"
            onClick={() => onMonthChange(monthOf(today))}
            // 36 px visible pill inside a 44 px tap target.
            className={`flex h-11 items-center rounded-full ${focus}`}
          >
            <span className="flex h-9 items-center rounded-full border border-border bg-surface px-3.5 text-label text-text">
              Today
            </span>
          </button>
          <button type="button" aria-label="Next month" onClick={() => onMonthChange(addMonths(month, 1))} className={navButton}>
            <ChevronRightIcon className="size-5" />
          </button>
        </div>
      </div>

      <div aria-hidden="true" className="grid grid-cols-7 gap-0.75 px-3 pb-1.5 text-center text-caption text-text-faint">
        {WEEKDAY_LETTERS.map((l, i) => (
          <span key={i}>{l}</span>
        ))}
      </div>

      <div
        data-testid="month-grid"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        className="grid touch-pan-y grid-cols-7 gap-0.75 overscroll-y-contain px-3"
      >
        {dates.map((date) => (
          <DayCell
            key={date}
            date={date}
            shift={byDate.get(date)}
            inMonth={monthOf(date) === month}
            today={today}
            onSelect={onSelectDay}
          />
        ))}
      </div>
    </div>
  );
}

type DayCellProps = {
  date: DateString;
  shift: Shift | undefined;
  inMonth: boolean;
  today: DateString;
  onSelect: (date: DateString) => void;
};

function DayCell({ date, shift, inMonth, today, onSelect }: DayCellProps) {
  const isToday = date === today;
  const name =
    formatLongDate(date) +
    ", " +
    (shift ? codeInfo(shift.code).label : "no shift") +
    (isToday ? ", today" : "");

  const cell = isToday
    ? "bg-surface border-text ring-1 ring-inset ring-text"
    : inMonth
      ? "bg-cell border-cell-line"
      : "border-cell-line-dim";
  const number = !inMonth
    ? "text-text-dim"
    : isToday
      ? "font-bold text-text"
      : date < today
        ? "text-text-disabled"
        : "text-text-soft";

  return (
    <button
      type="button"
      aria-label={name}
      data-date={date}
      aria-current={isToday ? "date" : undefined}
      onClick={() => onSelect(date)}
      className={`flex h-17.5 min-w-0 flex-col items-center justify-between rounded-field border pt-1.5 pb-1.75 ${cell} ${focus}`}
    >
      <span className={`font-mono text-caption tabular-nums ${number}`}>{dayOfMonth(date)}</span>
      {shift ? (
        <CodeChip code={shift.code} size="grid" className={inMonth ? "" : "opacity-45"} />
      ) : (
        <span className="h-8" />
      )}
      {/* The marker row, kept for the date's event and babysitter markers (SIM-38). */}
      <span className="size-1.25" />
    </button>
  );
}
