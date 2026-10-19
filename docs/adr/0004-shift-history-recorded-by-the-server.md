# The server records shift history as it applies sync writes

The user wants to look back over what changed in their shifts, to catch a change made by mistake
(SIM-45). The server records a shift change in the sync transaction each time it applies a shift
edit that changes the date's code: the date, the code before (null when the date had no row) and
after, the edit's `editedAt` and source, keyed by the `rev` the write took. Changes reach every
phone through `/api/sync` like any other row (`rev > since`), and each phone keeps them in IndexedDB
so the History screen reads only local data (ADR 0001).

Because the server writes the record, "before" is what the server held, so history is the same on
every device and includes edits from all of them. An edit that loses last-write-wins never happened
as far as the shifts are concerned, so it leaves no record; neither does a write that keeps the
code. An edit's source (`sheet` or `import`) travels with it from the outbox; `restore` marks the
re-send after a server reset, which the server applies without recording, since those shifts are
being put back, not changed.

## Considered Options

- **Phone-only log**: each phone writes a record when it saves a local edit. It knows the source and
  needs no server change, but it misses edits from other devices, is lost with the phone's storage,
  and records edits that later lose last-write-wins.
- **Phone-written records synced as their own kind** (like events, ADR 0003): complete across
  devices, but "before" is whatever that phone held, which can be stale, and it adds a fourth outbox.

## Consequences

- The sync response carries a fourth array, `shiftChanges`, and the request's shift changes carry an
  optional `source`.
- Shift changes are never purged, like event tombstones. With one user they stay small.
- History starts when this ships: shifts saved before it have no changes, and nothing is backfilled.
- After a server reset the server's history is gone, and each phone drops its copy and pulls the new
  server's from the start.
- Pending edits aren't changes yet; the History screen shows them apart, as not synced.
