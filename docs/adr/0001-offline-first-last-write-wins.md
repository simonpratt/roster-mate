# Offline-first with last-write-wins

The app must work away from the home network, where the server can't be reached, so the phone keeps
its own full copy of the shifts and the UI reads and writes only that copy. Edits are queued as
pending edits and synced when the server is reachable. When two edits to the same date clash, the one
made most recently by the phone's clock wins, silently.

## Considered Options

- **Server-first, read-only offline cache**: simpler, but the main reason to edit (a swap agreed at
  work) usually happens offline.
- **Conflict prompts or merging**: correct with several devices, but with one user and usually one
  phone a clash is almost always the same person changing their mind, so the newest edit is the
  right answer.

## Consequences

- A phone with a badly wrong clock can lose or override edits. Accepted: phone clocks are network
  set.
- The same user on a second device works: each device pulls the other's edits, and a clash on a
  date goes to the later edit. Multiple users would need real conflict handling and a revisit of
  this decision.
- Because every phone holds a full copy, a wiped or restored server is refilled from the phones:
  when a phone sees the server's database ID change or its revision go backwards, it re-sends all
  its shifts.
