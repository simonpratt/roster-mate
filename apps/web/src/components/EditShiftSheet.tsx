import { useId, useState } from "react";
import { formatHeadingDate, type DateString } from "../lib/dates";
import { codeInfo, isValidCode, type ShiftCode } from "../shifts/codes";
import { setShift, useShift, type Shift } from "../shifts/repo";
import { BottomSheet } from "./BottomSheet";
import { Button } from "./Button";
import { CodePicker, pickedCode, pickerValueFor, type PickerValue } from "./CodePicker";

// The edit sheet, docs/ux-spec.md §6.3 and docs/designs/EditSheet.dc.html (markup in
// Main.dc.html): the date, what it holds now, the code picker, Cancel and Save. Save
// writes locally through setShift (a pending edit) and closes; the grid updates from IndexedDB.
type EditShiftSheetProps = {
  date: DateString;
  today: DateString;
  onClose: () => void;
};

export function EditShiftSheet({ date, today, onClose }: EditShiftSheetProps) {
  const shift = useShift(date);
  // Opens once the stored shift has loaded, which IndexedDB answers at once.
  if (shift === undefined) return null;
  return <EditShiftForm key={date} date={date} today={today} shift={shift} onClose={onClose} />;
}

type EditShiftFormProps = EditShiftSheetProps & {
  /** The stored shift, kept live: a sync may change it while the sheet is open. */
  shift: Shift | null;
};

function EditShiftForm({ date, today, shift, onClose }: EditShiftFormProps) {
  const titleId = useId();
  // The fields start from the shift as it was on opening and then hold the user's values, even if
  // a sync changes the stored shift meanwhile (§7.1): their Save wins under last-write-wins.
  const [picker, setPicker] = useState<PickerValue>(() => pickerValueFor(shift?.code ?? null));
  const [saving, setSaving] = useState(false);

  const code = pickedCode(picker);
  // An unrostered date needs a code; an Other code needs its letters.
  const valid = code !== null && isValidCode(code);
  const changed = !shift || code !== shift.code;
  const canSave = valid && changed && !saving;

  async function save(close: () => void) {
    if (!canSave || code === null) return;
    setSaving(true);
    await setShift(date, code);
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
              {shift ? currentlyText(shift.code) : "Not rostered yet"}
            </p>
          </div>

          <CodePicker
            value={picker}
            onChange={setPicker}
            hint={<p className="m-0 text-footnote text-text-muted">To remove a shift, set it to Day off.</p>}
          />

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
