import { useId, useMemo, useRef, useState } from "react";
import { ApiError, type Recipient } from "../api";
import { useKnownBabysitters } from "../dates/repo";
import {
  EMAIL_MAX,
  emailProblem,
  serverProblem,
  withoutRecipient,
  withRecipient,
} from "../recipients/recipients";
import { BabysitterPicker, babysitterValueFor, pickedBabysitter, type BabysitterValue } from "./BabysitterPicker";
import { BottomSheet } from "./BottomSheet";
import { Button } from "./Button";
import { TextField } from "./TextField";

// The recipient sheet, docs/ux-spec.md §6.7 and docs/designs/RosterEmailsSheet.dc.html (markup in
// RosterEmails.dc.html): the email address, the babysitter picker without its Confirmed switch,
// Cancel and Save, and Remove recipient when editing. Save checks the address first; Save and
// Remove hand the whole new list to onSave and close once it resolves.
type RecipientSheetProps = {
  /** The list as the server last answered it. */
  list: readonly Recipient[];
  /** The recipient being edited, or null to add one. */
  index: number | null;
  /** Writes the whole list (PUT /api/recipients). Rejects as putRecipients does. */
  onSave: (list: Recipient[]) => Promise<void>;
  /** Called once the sheet has closed; removed is true after Remove recipient. */
  onClose: (removed: boolean) => void;
  returnFocus?: () => HTMLElement | null;
};

export const SAVE_FAILED = "Couldn’t save. Check your connection and try again.";

const HINT = "Who this address belongs to. Their babysitting dates aren’t emailed.";

export function RecipientSheet(props: RecipientSheetProps) {
  const known = useKnownBabysitters();
  // Opens once the names have loaded, which IndexedDB answers at once.
  if (known === undefined) return null;
  return <RecipientForm {...props} known={known} />;
}

function RecipientForm({
  list,
  index,
  onSave,
  onClose,
  returnFocus,
  known: usedNames,
}: RecipientSheetProps & { known: string[] }) {
  const titleId = useId();
  const emailId = useId();
  const errorId = useId();
  const [initial] = useState<Recipient>(() => (index === null ? { email: "", babysitter: "" } : list[index]!));
  const [email, setEmail] = useState(initial.email);
  const [sitter, setSitter] = useState<BabysitterValue>(() => babysitterValueFor(initial.babysitter));
  const [emailError, setEmailError] = useState<string | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  // A ref, as close() may call onClose before a re-render.
  const removed = useRef(false);

  // The names used on any date, plus this recipient's own babysitter if no date uses it now.
  const known = useMemo(() => {
    const own = initial.babysitter;
    if (own === "" || usedNames.some((n) => n.toLocaleLowerCase() === own.toLocaleLowerCase())) return usedNames;
    return [...usedNames, own].sort((a, b) => a.localeCompare(b));
  }, [usedNames, initial.babysitter]);

  const babysitter = pickedBabysitter(sitter, known);

  async function submit(next: Recipient[], close: () => void, removing: boolean) {
    setBusy(true);
    setSaveFailed(false);
    try {
      await onSave(next);
      removed.current = removing;
      close();
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiError && err.status === 400 && err.serverError && !removing) {
        setEmailError(serverProblem(err.serverError));
      } else {
        setSaveFailed(true);
      }
    }
  }

  function save(close: () => void) {
    if (busy || babysitter === null) return;
    const problem = emailProblem(email, list, index);
    setEmailError(problem);
    if (problem) return;
    void submit(withRecipient(list, index, { email, babysitter }), close, false);
  }

  return (
    <BottomSheet labelledBy={titleId} onClose={() => onClose(removed.current)} returnFocus={returnFocus}>
      {(close) => (
        <form
          className="contents"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            save(close);
          }}
        >
          <h2 id={titleId} className="m-0 text-sheet-title">
            {index === null ? "Add recipient" : "Edit recipient"}
          </h2>

          <div className="flex flex-col gap-1.5">
            <TextField
              id={emailId}
              label="Email address"
              tone="sunken"
              type="email"
              inputMode="email"
              autoCapitalize="none"
              autoComplete="email"
              spellCheck={false}
              maxLength={EMAIL_MAX}
              placeholder="nan@example.com"
              value={email}
              invalid={emailError !== null}
              aria-describedby={emailError ? errorId : undefined}
              onChange={(e) => {
                setEmail(e.target.value);
                setEmailError(null);
              }}
            />
            {emailError && (
              <span id={errorId} className="text-footnote text-danger">
                {emailError}
              </span>
            )}
          </div>

          <BabysitterPicker value={sitter} onChange={setSitter} known={known} hint={HINT} />

          {saveFailed && (
            <p role="alert" className="m-0 text-label font-normal text-danger">
              {SAVE_FAILED}
            </p>
          )}

          <div className="grid grid-cols-2 gap-2.5">
            <Button variant="outline-wide" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" busy={busy} disabled={babysitter === null}>
              Save
            </Button>
          </div>

          {index !== null && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void submit(withoutRecipient(list, index), close, true)}
              className="h-11 rounded-control text-callout font-semibold text-danger focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              Remove recipient
            </button>
          )}
        </form>
      )}
    </BottomSheet>
  );
}
