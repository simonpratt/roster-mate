import { useEffect, useRef, type KeyboardEvent } from "react";
import { EVENT_TEXT_MAX, type DateEdit, type Event } from "../dates/repo";
import { newId } from "../lib/uuid";
import { XIcon } from "./icons";

// The event list, docs/ux-spec.md §5.9 and the date sheet in docs/designs/Main.dc.html: one
// input and remove button per event, then an empty "Add an event" input. Typing in that input
// makes it a row (the same element, so focus and the caret stay put) and a new empty input
// appears below. Enter moves to the next input rather than submitting the sheet.

/** One line of the list: a saved event (id) or a new one (no id). */
export type EventDraft = {
  /** The React key, stable while the sheet is open. */
  key: string;
  /** The saved event's id; null for a new one. */
  id: string | null;
  text: string;
};

const blank = (): EventDraft => ({ key: newId(), id: null, text: "" });

/** The list's lines for the saved events: one per event, then the empty "Add an event" line. */
export function eventDraftsFor(events: readonly Event[]): EventDraft[] {
  return [...events.map((e) => ({ key: e.id, id: e.id, text: e.text })), blank()];
}

/**
 * The changes from the saved events to the drafts, trimmed: a blank saved line is removed and a
 * blank new one dropped. Undefined when nothing changed.
 */
export function eventChanges(saved: readonly Event[], drafts: readonly EventDraft[]): DateEdit["events"] {
  const kept = new Map(drafts.filter((d) => d.id !== null).map((d) => [d.id!, d.text.trim()]));
  const added = drafts.filter((d) => d.id === null && d.text.trim() !== "").map((d) => d.text.trim());
  const changed: { id: string; text: string }[] = [];
  const removed: string[] = [];
  for (const e of saved) {
    const text = kept.get(e.id);
    if (text === undefined || text === "") removed.push(e.id);
    else if (text !== e.text) changed.push({ id: e.id, text });
  }
  return added.length + changed.length + removed.length > 0 ? { added, changed, removed } : undefined;
}

type EventListProps = {
  /** The lines; the last is always the empty "Add an event" one. */
  value: EventDraft[];
  onChange: (value: EventDraft[]) => void;
};

const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";
const field = `h-12 min-w-0 flex-1 rounded-field border border-border-input bg-bg px-3.5 text-body text-text placeholder:text-text-muted ${focus}`;

export function EventList({ value, onChange }: EventListProps) {
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const focusKey = useRef<string | null>(null);

  // After a removal, focus moves to the line that took its place.
  useEffect(() => {
    if (focusKey.current === null) return;
    inputs.current.get(focusKey.current)?.focus();
    focusKey.current = null;
  });

  function setText(i: number, text: string) {
    const next = value.map((d, j) => (j === i ? { ...d, text } : d));
    // Typing in the last line makes it an event and opens a new last line.
    if (i === value.length - 1 && text !== "") next.push(blank());
    onChange(next);
  }

  function remove(i: number) {
    focusKey.current = value[i + 1]!.key;
    onChange(value.filter((_, j) => j !== i));
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>, i: number) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const next = value[i + 1];
    if (next) inputs.current.get(next.key)?.focus();
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-label text-text-soft">Events</span>
      {value.map((d, i) => {
        const last = i === value.length - 1;
        return (
          <div key={d.key} className="flex items-center gap-1.5">
            <input
              ref={(el) => {
                if (el) inputs.current.set(d.key, el);
                else inputs.current.delete(d.key);
              }}
              type="text"
              maxLength={EVENT_TEXT_MAX}
              autoComplete="off"
              aria-label={last ? "Add an event" : "Event"}
              placeholder={last ? "Add an event" : undefined}
              value={d.text}
              onChange={(e) => setText(i, e.target.value)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={field}
            />
            {last ? (
              <span aria-hidden="true" className="w-11 flex-none" />
            ) : (
              <button
                type="button"
                aria-label={`Remove event: ${d.text.trim()}`}
                onClick={() => remove(i)}
                className={`flex size-11 flex-none items-center justify-center rounded-field text-text-muted ${focus}`}
              >
                <XIcon className="size-4.5" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
