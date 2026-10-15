# A shift is a code, not a time range

A shift is one of five fixed shift codes (`D`, `E`, `L`, `N`, `X`) on one date, with an optional
note; it has no start or end time, a date has at most one shift, and a Night shift belongs to the
date it starts on. This matches how rosters print shifts and keeps extraction and review simple:
each roster cell maps to exactly one code, and anything else is an unmapped code the user resolves.

## Considered Options

- **Start and end times**: would allow hours and pay calculations, but rosters rarely print times,
  and extraction would have to guess them.
- **User-defined codes** (leave, training, on-call): more flexible, but every new code needs a
  label, a colour and extraction rules. Leave and similar are recorded as Day off with a note.

## Consequences

- Double shifts, split shifts and partial days can't be represented.
- Adding times or custom codes later changes the stored data, the sync payload, extraction and
  every screen that shows a shift.
