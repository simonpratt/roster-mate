import { useCallback, useState } from "react";
import { useNavigate } from "react-router";
import { BabysitterDateRow, BabysitterSection } from "../components/BabysitterSection";
import { DateSheet } from "../components/DateSheet";
import { ScreenHeader } from "../components/ScreenHeader";
import { ShareCard } from "../components/ShareCard";
import { babysitterInitials, babysitterSections, dateLabel, datesText } from "../dates/babysitters";
import {
  confirmBabysitter,
  useDatesNeedingBabysitter,
  useKnownBabysitters,
  useUpcomingBabysitters,
} from "../dates/repo";
import { useBabysitterShare } from "../dates/share";
import { formatDateRange, formatShortDate, type DateString } from "../lib/dates";
import { useToday } from "../lib/useToday";

// The Babysitters screen (/babysitters), docs/ux-spec.md §6.5 and docs/designs/Babysitters.dc.html,
// BabysittersEmpty.dc.html: the share card over the share window, the dates from today on that need
// a babysitter, then one section per babysitter with its upcoming dates and Confirm all. It reads
// only IndexedDB, so it works offline. Tapping a row opens the date sheet over the screen.
export function Babysitters() {
  const navigate = useNavigate();
  const today = useToday();
  const upcoming = useUpcomingBabysitters(today);
  const needing = useDatesNeedingBabysitter(today);
  const known = useKnownBabysitters();
  const share = useBabysitterShare(today);
  const [editing, setEditing] = useState<DateString | null>(null);
  const onCloseSheet = useCallback(() => setEditing(null), []);

  const loaded = upcoming !== undefined && needing !== undefined && known !== undefined;
  const sections = loaded ? babysitterSections(upcoming) : [];

  return (
    <main className="mx-auto flex min-h-dvh max-w-app flex-col pt-[env(safe-area-inset-top)] pb-[max(32px,env(safe-area-inset-bottom))]">
      <ScreenHeader title="Babysitters" onBack={() => navigate("/")} />

      {share && <ShareCard windowText={formatDateRange(share.start, share.end, today)} entries={share.entries} />}

      {loaded && needing.length > 0 && (
        <BabysitterSection status="needs" title="Needs a babysitter" summary={datesText(needing.length)}>
          {needing.map((s) => (
            <BabysitterDateRow
              key={s.date}
              date={s.date}
              dateText={formatShortDate(s.date)}
              label={dateLabel({
                date: s.date,
                code: s.code,
                babysitter: { name: "", confirmed: false },
                needsBabysitter: true,
                events: 0,
                today: "",
              })}
              code={s.code}
              status="needs"
              onSelect={setEditing}
            />
          ))}
        </BabysitterSection>
      )}

      {sections.map((section) => {
        const initials = babysitterInitials(section.name, known!);
        const tentative = section.dates.filter((d) => !d.confirmed).map((d) => d.date);
        return (
          <BabysitterSection
            key={section.name.toLocaleLowerCase()}
            status="confirmed"
            initials={initials}
            title={section.name}
            summary={section.tentative > 0 ? `${section.tentative} to confirm` : "All confirmed"}
            onConfirmAll={section.tentative > 0 ? () => void confirmBabysitter(section.name, tentative) : undefined}
          >
            {section.dates.map((d) => (
              <BabysitterDateRow
                key={d.date}
                date={d.date}
                dateText={formatShortDate(d.date)}
                label={dateLabel({ date: d.date, code: d.code, babysitter: d, needsBabysitter: false, events: 0, today: "" })}
                code={d.code}
                status={d.confirmed ? "confirmed" : "tentative"}
                initials={initials}
                onSelect={setEditing}
              />
            ))}
          </BabysitterSection>
        );
      })}

      {loaded && sections.length === 0 && (
        <p className="mx-4 mt-7 mb-0 text-callout text-text-muted">
          No upcoming babysitters. Choose one for a date in the calendar.
        </p>
      )}

      {editing && <DateSheet date={editing} today={today} onClose={onCloseSheet} />}
    </main>
  );
}
