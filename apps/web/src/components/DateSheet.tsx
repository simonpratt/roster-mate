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
// DateSheetNewSitter.dc.html, DateSheetConfirmed.dc.html and DateSheetUnrostered.dc.html (markup in
// Main.dc.html): the date, its shift now, the code picker, the babysitter with its Confirmed
// switch, the events, Cancel and Save. Save writes what changed locally through saveDate (pending
// edits) and closes; the grid updates from IndexedDB.
type DateSheetProps = {
  date: DateString;
  today: DateString;
  onClose: () => void;
  /**
   * Where focus goes on close; by default the first element with the date's data-date (its cell
   * in the month grid). A screen that can list one date more than once passes the row tapped.
   */
  returnFocus?: () => HTMLElement | null;
};

export function DateSheet({ date, today, onClose, returnFocus }: DateSheetProps) {
  const contents = useDate(date);
  const known = useKnownBabysitters();
  // Opens once the stored date has loaded, which IndexedDB answers at once.
  if (contents === undefined || known === undefined) return null;
  return (
    <DateForm
      key={date}
      date={date}
      today={today}
      contents={contents}
      known={known}
      onClose={onClose}
      returnFocus={returnFocus}
    />
  );
}

type DateFormProps = DateSheetProps & {
  /** What the date holds, kept live: a sync may change it while the sheet is open. */
  contents: DateContents;
  known: string[];
};

function DateForm({ date, today, contents, known, onClose, returnFocus }: DateFormProps) {
  const titleId = useId();
  // The fields start from the date as it was on opening and then hold the user's values, even if
  // a sync changes the stored ones meanwhile (§7.1). Save sends only what differs from opening,
  // so a part the user left alone keeps whatever a sync brought in.
  const [initial] = useState(contents);
  const [picker, setPicker] = useState<PickerValue>(() => pickerValueFor(initial.shift?.code ?? null));
  const [sitter, setSitter] = useState<BabysitterValue>(() => babysitterValueFor(initial.babysitter.name));
  // The Confirmed switch as last toggled, and for which name (lower case). Another name picked
  // since makes it moot: the switch then shows that name's stored status, off for a new name.
  const [toggled, setToggled] = useState<{ key: string; on: boolean } | null>(null);
  const [events, setEvents] = useState<EventDraft[]>(() => eventDraftsFor(initial.events));
  const [saving, setSaving] = useState(false);

  const code = pickedCode(picker);
  const name = pickedBabysitter(sitter, known);
  const eventEdit = eventChanges(initial.events, events);

  // No code is only possible on an unrostered date, where the rest saves on its own; an Other
  // code needs its letters, and Someone else needs a name.
  const valid = (code === null || isValidCode(code)) && name !== null;
  const codeChanged = code !== null && code !== initial.shift?.code;
  const nameKey = name?.toLocaleLowerCase() ?? "";
  const confirmed =
    name === null || name === ""
      ? false
      : toggled?.key === nameKey
        ? toggled.on
        : nameKey === initial.babysitter.name.toLocaleLowerCase() && initial.babysitter.confirmed;
  const sitterChanged =
    name !== null && (name !== initial.babysitter.name || confirmed !== initial.babysitter.confirmed);
  const canSave = valid && (codeChanged || sitterChanged || eventEdit !== undefined) && !saving;

  // While Someone else is open the user is naming one, so the warning stays away.
  const shownCode = code !== null && code !== "" ? { code } : contents.shift;
  const needed = sitter.other === null && needsBabysitter(shownCode, sitter.name, date, today);

  async function save(close: () => void) {
    if (!canSave) return;
    const edit: DateEdit = {};
    if (codeChanged) edit.code = code!;
    if (sitterChanged) edit.babysitter = { name: name!, confirmed };
    if (eventEdit) edit.events = eventEdit;
    setSaving(true);
    await saveDate(date, edit);
    close();
  }

  return (
    <BottomSheet
      labelledBy={titleId}
      onClose={onClose}
      // Focus goes back to the date's cell in the month grid, or the row the screen names.
      returnFocus={returnFocus ?? (() => document.querySelector<HTMLElement>(`[data-date="${date}"]`))}
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

          <BabysitterPicker
            value={sitter}
            onChange={setSitter}
            known={known}
            needed={needed}
            confirmed={name === null || name === "" ? null : confirmed}
            onConfirmedChange={(on) => setToggled({ key: nameKey, on })}
          />

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
