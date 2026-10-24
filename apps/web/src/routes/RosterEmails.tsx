import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import {
  ApiError,
  getRecipients,
  HEALTH_TIMEOUT_MS,
  putRecipients,
  UnauthorizedError,
  type Recipient,
  type Recipients,
} from "../api";
import { Button } from "../components/Button";
import { PlusIcon } from "../components/icons";
import { NeedsConnection } from "../components/NeedsConnection";
import { RecipientRow } from "../components/RecipientRow";
import { RecipientSheet } from "../components/RecipientSheet";
import { ScreenHeader } from "../components/ScreenHeader";
import { StatusLine } from "../components/StatusLine";
import { useToday } from "../lib/useToday";
import { setEmailEnabled } from "../recipients/flag";
import { lastSendText, MAX_RECIPIENTS, recipientLabel, recipientSummary } from "../recipients/recipients";

// The Roster emails screen (/emails), docs/ux-spec.md §6.7 and docs/designs/RosterEmails*.dc.html:
// who gets a roster email after each import, and when the last one went. The recipients live only
// on the server (ADR 0005), so the screen loads them on opening and keeps no copy; offline, or
// when the call fails, it shows the needs-a-connection state as Import does. Tapping a row or Add
// recipient opens the recipient sheet, which writes the whole list back.

type State = { name: "loading" } | { name: "offline" } | { name: "loaded"; data: Recipients };

/** Who has the sheet open: a recipient's index, "new", or nobody. */
type Editing = number | "new" | null;

export function RosterEmails() {
  const navigate = useNavigate();
  const today = useToday();
  const [state, setState] = useState<State>(() => (navigator.onLine ? { name: "loading" } : { name: "offline" }));
  const [editing, setEditing] = useState<Editing>(null);
  const tapped = useRef<HTMLElement | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);

  // A 401 goes to sign in; a 404 means email has been switched off since the session check.
  const handleRefusal = useCallback(
    async (err: unknown): Promise<boolean> => {
      if (err instanceof UnauthorizedError) {
        navigate("/login", { replace: true });
        return true;
      }
      if (err instanceof ApiError && err.status === 404) {
        await setEmailEnabled(false);
        navigate("/", { replace: true });
        return true;
      }
      return false;
    },
    [navigate],
  );

  useEffect(() => {
    if (!navigator.onLine) return;
    const controller = new AbortController();
    // Away from home on mobile data the request may hang rather than fail.
    const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    let cancelled = false;
    getRecipients(controller.signal)
      .then((data) => {
        if (!cancelled) setState({ name: "loaded", data });
      })
      .catch(async (err: unknown) => {
        if (cancelled) return;
        if (!(await handleRefusal(err))) setState({ name: "offline" });
      })
      .finally(() => clearTimeout(timer));
    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [handleRefusal]);

  const save = useCallback(
    async (list: Recipient[]) => {
      try {
        const data = await putRecipients(list);
        setState({ name: "loaded", data });
      } catch (err) {
        await handleRefusal(err);
        throw err;
      }
    },
    [handleRefusal],
  );

  const removedRef = useRef(false);
  const onCloseSheet = useCallback((removed: boolean) => {
    removedRef.current = removed;
    setEditing(null);
  }, []);
  // Back to the row tapped, or to Add recipient after a removal or an add.
  const returnFocus = useCallback(() => {
    const row = tapped.current;
    if (!removedRef.current && row?.isConnected) return row;
    return addButton.current;
  }, []);

  function open(which: Editing, from: HTMLElement | null) {
    tapped.current = from;
    removedRef.current = false;
    setEditing(which);
  }

  const data = state.name === "loaded" ? state.data : null;
  const last = data ? lastSendText(data.lastSend, today) : null;

  return (
    <main className="mx-auto flex min-h-dvh max-w-app flex-col pt-[env(safe-area-inset-top)] pb-[max(32px,env(safe-area-inset-bottom))]">
      <ScreenHeader title="Roster emails" onBack={() => navigate("/")} />

      {state.name === "offline" && (
        <NeedsConnection
          title="Roster emails need a connection"
          body="Reconnect to your home network to change who gets your roster."
        />
      )}

      {data && (
        <div className="flex flex-col">
          <p className="mx-4 mt-1 mb-0 text-callout text-text-muted">
            When you import a roster, its shifts are emailed to everyone here. Babysitters and notes are left out.
          </p>

          {last && <StatusLine tone={last.failed ? "danger" : "ok"} text={last.text} className="mx-4 mt-3" />}

          {data.recipients.length > 0 ? (
            <section aria-label="Recipients" className="mx-4 mt-5 flex flex-col gap-2">
              {data.recipients.map((r, i) => (
                <RecipientRow
                  // By position, so an edited row keeps its element and focus can return to it.
                  key={i}
                  email={r.email}
                  summary={recipientSummary(r)}
                  label={recipientLabel(r)}
                  onSelect={(row) => open(i, row)}
                />
              ))}
            </section>
          ) : (
            <p className="mx-4 mt-7 mb-0 text-callout text-text-muted">
              No one gets your roster yet. Add an email address to send each new roster to.
            </p>
          )}

          {data.recipients.length < MAX_RECIPIENTS && (
            <div className="mx-4 mt-4">
              <Button ref={addButton} variant="outline-wide" onClick={() => open("new", null)}>
                <PlusIcon className="size-4.5" />
                Add recipient
              </Button>
            </div>
          )}
        </div>
      )}

      {data && editing !== null && (
        <RecipientSheet
          list={data.recipients}
          index={editing === "new" ? null : editing}
          onSave={save}
          onClose={onCloseSheet}
          returnFocus={returnFocus}
        />
      )}
    </main>
  );
}
