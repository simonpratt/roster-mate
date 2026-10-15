# A shift is a code, not a time range

A shift is one shift code on one date, with an optional note; it has no start or end time, a date
has at most one shift, and a Night shift belongs to the date it starts on. A shift code is one or
two letters: one of five standard codes (`D`, `E`, `L`, `N`, `X`) that the app understands, or an
Other code (such as `SE` or `XD`) that it stores and shows but gives no meaning. This matches how
rosters print shifts and keeps extraction and review simple: each roster cell maps to exactly one
code, and anything that can't be a code is an unmapped code the user resolves.

## Considered Options

- **Start and end times**: would allow hours and pay calculations, but rosters rarely print times,
  and extraction would have to guess them.
- **Only the five standard codes**: the simplest model, but rarer shift types (`SE`, `XD`, …)
  would have to be forced into a standard code plus a note.
- **User-defined codes with labels and colours**: more expressive, but every code needs managing.
  Other codes give the flexibility without the management: they have no label, one shared
  colour, and no extraction rules of their own.

## Consequences

- Double shifts, split shifts and partial days can't be represented.
- Other codes count as working shifts, because the app can't tell what they mean.
- Codes are limited to two letters; longer roster text has to be mapped during review.
- Adding times or custom codes later changes the stored data, the sync payload, extraction and
  every screen that shows a shift.
