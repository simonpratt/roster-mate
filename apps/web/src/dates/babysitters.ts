// Babysitter logic the Calendar and the Babysitters screen share: avatar initials (docs/ux-spec.md
// §5.10), a date's accessible name (§5.3) and the screen's sections (§6.5).
import { formatLongDate, type DateString } from "../lib/dates";
import { codeInfo, type ShiftCode } from "../shifts/codes";

/** A babysitter on a date, with the date's shift code (null on an unrostered date). */
export interface DatedBabysitter {
  date: DateString;
  name: string;
  confirmed: boolean;
  code: ShiftCode | null;
}

/** One babysitter's upcoming dates on the Babysitters screen. */
export interface BabysitterSection {
  /** The name as stored on the section's earliest date. */
  name: string;
  /** Earliest first. */
  dates: DatedBabysitter[];
  /** How many of them are tentative. */
  tentative: number;
}

const firstLetters = (name: string) => [...name.trim()];

/**
 * The avatar's initials: the first letter uppercased ("Mum" → "M"), or, when another known name
 * starts with the same letter ignoring case, the first two letters as "Xx" ("Mum" → "Mu" beside
 * "Mel").
 */
export function babysitterInitials(name: string, known: readonly string[]): string {
  const [first = "", second = ""] = firstLetters(name);
  const key = name.trim().toLocaleLowerCase();
  const initial = first.toLocaleLowerCase();
  const clash = known.some((other) => {
    const otherKey = other.trim().toLocaleLowerCase();
    return otherKey !== key && (firstLetters(otherKey)[0] ?? "") === initial;
  });
  return clash ? first.toLocaleUpperCase() + second.toLocaleLowerCase() : first.toLocaleUpperCase();
}

export interface DateLabelParts {
  date: DateString;
  code: ShiftCode | null;
  /** The babysitter's name and status, or name "" for none. */
  babysitter: { name: string; confirmed: boolean };
  needsBabysitter: boolean;
  events: number;
  today: DateString;
}

/**
 * A date's accessible name, as on a calendar cell: "Friday 6 November, Late, babysitter Mum,
 * confirmed, 1 event, today".
 */
export function dateLabel({ date, code, babysitter, needsBabysitter, events, today }: DateLabelParts): string {
  const sitter = babysitter.name
    ? `, babysitter ${babysitter.name}, ${babysitter.confirmed ? "confirmed" : "tentative"}`
    : needsBabysitter
      ? ", no babysitter"
      : "";
  return (
    formatLongDate(date) +
    ", " +
    (code ? codeInfo(code).label : "no shift") +
    sitter +
    (events === 0 ? "" : events === 1 ? ", 1 event" : `, ${events} events`) +
    (date === today ? ", today" : "")
  );
}

/**
 * Groups babysitter dates into one section per babysitter, names grouped ignoring case, A–Z, each
 * with its dates earliest first. Dates with no name are left out.
 */
export function babysitterSections(dates: readonly DatedBabysitter[]): BabysitterSection[] {
  const byKey = new Map<string, DatedBabysitter[]>();
  for (const d of [...dates].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))) {
    if (d.name === "") continue;
    const key = d.name.toLocaleLowerCase();
    const list = byKey.get(key);
    if (list) list.push(d);
    else byKey.set(key, [d]);
  }
  return [...byKey.values()]
    .map((list) => ({ name: list[0]!.name, dates: list, tentative: list.filter((d) => !d.confirmed).length }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** "2 dates", "1 date". */
export function datesText(n: number): string {
  return n === 1 ? "1 date" : `${n} dates`;
}
