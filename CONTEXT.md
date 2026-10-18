# Roster Mate

One shift worker's own shifts, read from photos of the rosters their employer publishes and kept on
their phone so they can check and correct them anywhere.

## Language

### Shifts

**Date**:
A local calendar date, with no time of day or timezone.
_Avoid_: day (when meaning a date; "Day" is a shift code)

**Shift**:
What the user is rostered for on one date: one shift code. A date has at most
one shift, and a shift belongs to the date it starts on, even when it runs past midnight.
_Avoid_: assignment, entry, booking

**Shift code**:
One or two letters naming what a shift is: either a standard code or an Other code.
_Avoid_: shift type, roster code

**Standard code**:
One of the five shift codes the app knows the meaning of: `D` Day, `E` Early, `L` Late, `N` Night
and `X` Day off.
_Avoid_: built-in code, fixed code

**Other code**:
Any shift code of one or two letters that is not a standard code, such as `SE` or `XD`, for shift
types too rare to warrant a standard code. It means nothing to the app beyond its letters.
_Avoid_: custom code, extra code, misc

**Working shift**:
A shift whose code is anything except `X`: `D`, `E`, `L`, `N` or an Other code.

**Day off**:
A shift with code `X`. It is how the user records that they are not working on a date.
_Avoid_: cleared, empty, free day, RDO

**Unrostered date**:
A date with no shift yet. Once a date has a shift it never goes back to unrostered; the user sets it
to Day off instead.
_Avoid_: blank, cleared, empty day

**Next shift**:
The first working shift dated today or later.
_Avoid_: upcoming shift

**Calendar**:
The user's shifts laid out by month; the app's home screen.
_Avoid_: roster (for this), schedule

### Events and babysitters

**Event**:
Short free text on a date, such as "Dentist 3pm", with no time. A date can have any number of
events, and an event doesn't need a shift. Events replace the notes shifts used to carry.
_Avoid_: note, appointment, reminder

**Babysitter**:
The person minding the children on a date, named by free text such as "Mum". A date has at most one
babysitter, and a babysitter doesn't need a shift.
_Avoid_: sitter, carer, childcare

**Needs a babysitter**:
Said of a date with a working shift, dated today or later, that has no babysitter.
_Avoid_: unarranged, uncovered

### Rosters and import

**Roster**:
The schedule an employer publishes, usually a grid of staff by dates, printed or on a screen.
_Avoid_: rota, schedule, timetable

**Roster photo**:
An image of a roster that the user uploads to import from. It is not kept.
_Avoid_: roster (for the image), upload, scan

**Roster name**:
The user's name exactly as it is printed on rosters; it identifies which row is theirs.
_Avoid_: username, display name

**Import**:
Turning one roster photo into saved shifts: extraction followed by review.
_Avoid_: upload, sync

**Extraction**:
Reading one roster photo into proposed shifts. It saves nothing.
_Avoid_: parsing, OCR, scan

**Proposed shift**:
A date and shift code read by extraction that has not been saved.
_Avoid_: suggestion, result, extracted shift

**Uncertain**:
Said of a proposed shift whose roster cell was hard to read, so the user should check it.
_Avoid_: low confidence, check

**Unmapped code**:
Text in a roster cell that cannot be a shift code because it is longer than two letters or not
letters at all, such as "A/L" or "08-16". The user picks a shift code for it before it can be
saved.
_Avoid_: unknown code, raw code, invalid code

**Review**:
The step where the user compares proposed shifts with their saved shifts and chooses which to save.
_Avoid_: confirm, approve

### Sync

**Pending edit**:
A change to a shift, event or babysitter that is saved on the phone but not yet on the server.
_Avoid_: outbox entry, unsynced change, queued change

**Synced**:
The phone has no pending edits and has the server's latest shifts, events and babysitters.
_Avoid_: up to date, saved
