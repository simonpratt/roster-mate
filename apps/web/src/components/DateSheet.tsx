import { useId, useState } from "react";
import { needsBabysitter, saveDate, useDate, useKnownBabysitters, type DateContents, type DateEdit } from "../dates/repo";
import { formatHeadingDate, type DateString } from "../lib/dates";
import { codeInfo, isValidCode, type ShiftCode } from "../shifts/codes";
import { BabysitterPicker, babysitterValueFor, pickedBabysitter, type BabysitterValue } from "./BabysitterPicker";
import { BottomSheet } from "./BottomSheet";
import { Button } from "./Button";
import { CodePicker, pickedCode, pickerValueFor, type PickerValue } from "./CodePicker";
import { EventList, eventChanges, eventDraftsFor, type EventDraft } from "./EventList";

// The date sheet, docs/ux-spec.md §6.3 and docs/designs/EditSheet.dc.html,
// DateSheetNewSitter.dc.html and DateSheetUnrostered.dc.html (markup in Main.dc.html): the date,
// its shift now, the code picker, the babysitter, the events, Cancel and Save. Save writes what
// changed locally through saveDate (pending edits) and closes; the grid updates from IndexedDB.
type DateSheetProps = {
  date: DateString;
  today: DateString;
  onClose: () => void;
};

export function DateSheet({ date, today, onClose }: DateSheetProps) {
  const contents = useDate(date);
  const known = useKnownBabysitters();
  // Opens once the stored date has loaded, which IndexedDB answers at once.
  if (contents === undefined || known === undefined) return null;
  return <DateForm key={date} date={date} today={today} contents={contents} known={known} onClose={onClose} />;
}

type DateFormProps = DateSheetProps & {
  /** What the date holds, kept live: a sync may change it while the sheet is open. */
  contents: DateContents;
  known: string[];
};

function DateForm({ date, today, contents, known, onClose }: DateFormProps) {
  const titleId = useId();
  // The fields start from the date as it was on opening and then hold the user's values, even if
  // a sync changes the stored ones meanwhile (§7.1). Save sends only what differs from opening,
  // so a part the user left alone keeps whatever a sync brought in.
  const [initial] = useState(contents);
  const [picker, setPicker] = useState<PickerValue>(() => pickerValueFor(initial.shift?.code ?? null));
  const [sitter, setSitter] = useState<BabysitterValue>(() => babysitterValueFor(initial.babysitter));
  const [events, setEvents] = useState<EventDraft[]>(() => eventDraftsFor(initial.events));
  const [saving, setSaving] = useState(false);

  const code = pickedCode(picker);
  const name = pickedBabysitter(sitter, known);
  const eventEdit = eventChanges(initial.events, events);

  // No code is only possible on an unrostered date, where the rest saves on its own; an Other
  // code needs its letters, and Someone else needs a name.
  const valid = (code === null || isValidCode(code)) && name !== null;
  const codeChanged = code !== null && code !== initial.shift?.code;
  const sitterChanged = name !== null && name !== initial.babysitter;
  const canSave = valid && (codeChanged || sitterChanged || eventEdit !== undefined) && !saving;

  // While Someone else is open the user is naming one, so the warning stays away.
  const shownCode = code !== null && code !== "" ? { code } : contents.shift;
  const needed = sitter.other === null && needsBabysitter(shownCode, sitter.name, date, today);

  async function save(close: () => void) {
    if (!canSave) return;
    const edit: DateEdit = {};
    if (codeChanged) edit.code = code!;
    if (sitterChanged) edit.babysitter = name!;
    if (eventEdit) edit.events = eventEdit;
    setSaving(true);
    await saveDate(date, edit);
    close();
  }

  return (
    <BottomSheet
      labelledBy={titleId}
      onClose={onClose}
      // Focus goes back to the date's cell in the month grid.
      returnFocus={() => document.querySelector<HTMLElement>(`[data-date="${date}"]`)}
    >
      {(close) => (
        <form
          className="contents"
          onSubmit={(e) => {
            e.preventDefault();
            void save(close);
          }}
        >
          <div className="flex flex-col gap-1">
            <h2 id={titleId} className="m-0 text-sheet-title">
              {formatHeadingDate(date, today)}
            </h2>
            <p className="m-0 text-label font-normal text-text-muted">
              {contents.shift ? currentlyText(contents.shift.code) : "Not rostered yet"}
            </p>
          </div>

          <CodePicker value={picker} onChange={setPicker} />

          <BabysitterPicker value={sitter} onChange={setSitter} known={known} needed={needed} />

          <EventList value={events} onChange={setEvents} />

          <div className="grid grid-cols-2 gap-2.5">
            <Button variant="outline-wide" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSave}>
              Save
            </Button>
          </div>
        </form>
      )}
    </BottomSheet>
  );
}

/** "Currently Late", or "Currently Other · SE" for an Other code, as in the design. */
function currentlyText(code: ShiftCode): string {
  const info = codeInfo(code);
  return `Currently ${info.standard ? info.label : `Other · ${code}`}`;
}
