# Events and babysitters sync as records of their own

A date can carry events and a babysitter as well as a shift, and each can be edited without the
others: a swap changes the shift, a phone call changes the babysitter, an appointment adds an
event. So events and babysitters are separate records, each with its own last-write-wins on the
phone's `editedAt` (ADR 0001). An event is keyed by a client-generated UUID, a babysitter by its
date, and both share the server's one `rev` counter with shifts. Editing an event or a babysitter
never overwrites a shift edit, or the other way round. A deleted event stays on the server as a
tombstone (`deleted = 1`) so the deletion reaches every device; a babysitter is cleared by an
empty name.

Events replace the optional note a shift used to carry (ADR 0002), and the `note` column is
dropped without carrying existing notes over.

## Considered Options

- **Fields on the shift row** (a list of events and a babysitter name next to the code): one
  record per date and no new tables, but a date with events and no shift would need a shift row,
  and last-write-wins on the whole row would let an edit to one part silently undo a concurrent
  edit to another, such as a roster import overwriting a babysitter set on a second device.
- **One JSON blob per date** holding shift, events and babysitter: the same lost-update problem
  as fields on the shift row, and the server could no longer validate each part.

## Consequences

- The sync request and response carry three arrays, and the client keeps one outbox per kind.
- Event tombstones accumulate. With one user they stay small; purging them would need every
  device to have synced past them, and is left for later.
- The phone keeps only live events, so re-sending after a server reset sends live events and
  pending tombstones only. A deletion that had already synced can come back if the server is
  restored from a backup taken before it.
