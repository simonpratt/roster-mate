# Roster Mate — UX Design Specification

How Roster Mate looks, reads and behaves on a phone. `docs/design.md` covers architecture and
behaviour; this document covers the screens, states, visual system and copy that the UI tickets
(SIM-10, SIM-12, SIM-13, SIM-14, SIM-16) build. The design canvas (snapshot in `docs/designs/`)
is the source of truth for layout, colour, type and copy; this document covers behaviour,
states and accessibility. Where a ticket's spec is more specific, the ticket wins; where this
document fills a gap the tickets leave, build to this document.

Source: Linear SIM-17, written from SIM-8 to SIM-16 and `docs/design.md`. Terms follow
`CONTEXT.md`: in particular, the home screen is the **Calendar**, a **Roster** is the employer's
published schedule, and the image uploaded is a **Roster photo**.

## 1. Principles

1. **Glanceable first.** The main question is "when am I working next?" The answer is the first
   thing on screen, readable in under a second, without tapping.
2. **The phone is the source of truth for the user.** Every edit appears instantly. Sync is a
   quiet background fact, shown by a small indicator, never a blocking spinner.
3. **Nothing changes without review.** Imports always show a review list; edits always need Save.
4. **Colour helps, letters decide.** Every shift shows its letter code. Colour is a second cue,
   never the only one.
5. **One hand, portrait, dark.** Primary actions sit in thumb reach; there is no light mode.

## 2. Users and context

- One user: a shift worker checking and correcting their own roster.
- Typical moments: a glance the night before a shift; a correction right after agreeing a swap
  (often at work, away from the home network, possibly offline); an import when a new roster
  is published (at home, online, photographing a printed sheet or a screen).
- Installed to the home screen as a standalone PWA; also usable in the browser.

## 3. Information architecture

```
/login ──(signed in)──► /  Calendar (home)
                         ├── tap date ─► Date sheet (overlay on /)
                         ├── Import ───► /import ──(save)──► / (month of first saved date)
                         └── ⋯ menu ──┬► Babysitters ──► /babysitters ── tap date ─► Date sheet
                                      └► Sign out ──► /login
```

| Route | Screen | Reached from | Works offline |
|---|---|---|---|
| `/login` | Sign in | App start (online, `401`), "Sign in to sync", Sign out | Shows offline notice (§7.1) |
| `/` | Calendar | Default route | Yes |
| (overlay) | Date sheet | Tapping a date on `/` | Yes |
| `/import` | Import | Header Import button | No — shows "Import needs a connection" |
| `/babysitters` | Babysitters | ⋯ menu | Yes |

There is no tab bar. The Calendar is the hub; Import, Babysitters and Login are leaf screens with a
back control. Browser/OS back closes the date sheet first, then leaves Import or Babysitters.

## 4. Visual system

### 4.1 Theme

Dark only: `<html class="dark">`, `color-scheme: dark`, manifest and `<meta name="theme-color">`
set to the page background. Define these as custom Tailwind theme tokens (values from
`docs/designs/Tokens.dc.html`) so components use names, not raw palette classes.

| Token | Value | Use |
|---|---|---|
| `bg` | #0E1014 | Page background, `theme_color`, `background_color` |
| `cell` | #121418 | Calendar cells |
| `surface` | #161920 | Pills, inputs, bottom sheet |
| `surface-raised` | #1E222A | Pressed states, menus |
| `border` | #2A2F38 | Dividers, input borders |
| `text` | #ECEEF2 | Primary text |
| `text-muted` | #9AA1AD | Secondary text, labels |
| `text-faint` | #8C93A0 | Captions, Day off, disabled text |
| `primary` | #ECEEF2 bg / #0E1014 text | Primary buttons (Save, Sign in) |
| `danger` | #FB7185 | Errors, sign-in-needed dot and banner |
| `failed` | #EF4444 | Sync-failed dot |
| `ok` | #34D399 | Synced dot |
| `warn` | #F5A524 | Pending dot, "Needs a babysitter" label in the date sheet |
| `sitter-need` | #C98A2A | The needs-a-babysitter dot on a shift chip, "No babysitter" on the Babysitters screen |
| `focus` | #7DD3FC | Focus rings (2 px, offset 2 px) |

The primary button is near-white rather than a hue so it never competes with or mimics a shift
colour.

### 4.2 Shift codes

Codes, labels and colour families come from `apps/web/src/shifts/codes.ts` (SIM-12). Chips use a
dark fill with a light text colour of the same family, which keeps contrast high on the dark
surface and lets six colours sit side by side without glare.

| Code | Label | Chip background | Chip text | Notes |
|---|---|---|---|---|
| D | Day | #3B2A0A | #FCC35A (amber) | |
| E | Early | #0A2C3D | #7DD3FC (sky) | |
| L | Late | #2A1C47 | #C9B6FD (violet) | |
| N | Night | #1B2050 | #A5B1FF (indigo) | |
| X | Day off | none, 1 px #3A404B outline | #8C93A0 | Outlined, not filled, so days off recede |
| Other (`SE`, `XD`, …) | the code itself | #232E0C | #C8EC72 (lime) | One shared colour for every Other code; the chip shows both letters |

- Chip: rounded, code in JetBrains Mono bold, centred. In the grid the chip shows the code only;
  in the header, date sheet and review list a standard code shows its label too ("Late").
  An Other code has no label, so it shows just its letters ("SE") everywhere.
- Selected state (date sheet): border in the chip's text colour plus a check icon, so selection
  does not rely on colour.
- All chip text colours meet WCAG AA (≥ 4.5:1) against `surface` and `bg`; verify with a contrast
  checker when the palette is implemented.

### 4.3 Typography

Schibsted Grotesk (400–700) for UI and copy; JetBrains Mono (500/700) for shift codes and
dates. Bundle both as `woff2` in the app (e.g. `@fontsource`) so the service worker precaches
them and the shell renders offline; never load them from Google Fonts at runtime. Fall back to
`ui-sans-serif, system-ui` / `ui-monospace`.

| Role | Size / weight | Use |
|---|---|---|
| Display | 28 px / 600 | Next-shift line |
| Title | 18 px / 600 | Screen titles, month name, sheet heading |
| Body | 16 px / 400 | Body text, inputs (16 px prevents iOS zoom on focus) |
| Label | 14 px / 500 | Buttons, badges, list secondary text |
| Caption | 12 px / 500 | Weekday header, sync indicator, day numbers |

Use tabular numerals (`tabular-nums`) for dates and counts.

### 4.4 Spacing, size and layout

- Design width 360–430 px portrait. 16 px side gutters. Base spacing unit 4 px.
- Tap targets ≥ 44 px (SIM-13). At 360 px the seven grid columns leave room for gaps of 3 px or
  less.
- On wider screens, centre the content in a column of max 480 px; no desktop layout.
- Respect safe areas in standalone mode: header gets `padding-top: env(safe-area-inset-top)`,
  bottom sheet and fixed bottom bars get `env(safe-area-inset-bottom)`.
- No horizontal page scroll at 360 px on any screen.

### 4.5 Iconography

Simple 20–24 px stroke icons (e.g. Lucide or inline SVG): chevron-left/right (month), camera
(Import), more-vertical (menu), x (close), check (selected), alert-triangle (warnings),
cloud-off (offline). Icon-only buttons always carry an `aria-label`.

### 4.6 Motion

- Bottom sheet slides up 200 ms ease-out, backdrop fades to `black/60`. Closes in 150 ms.
- Month change: content slides 150 ms in the swipe direction; no animation on "Today" jump.
- Honour `prefers-reduced-motion`: replace slides with an instant change or a fade.

## 5. Components

### 5.1 App header (Calendar)

```
┌──────────────────────────────────────────┐
│ [logo]          (● Synced) [📷 Import] [⋮] │  ← header: sync pill, Import, menu
│ NEXT SHIFT                               │
│ [L] Tomorrow · Late                      │  ← next-shift block (Display)
└──────────────────────────────────────────┘
```

- **Next shift block** (rules from SIM-13), below the header: a "Next shift" caption, the code
  chip and the text. First working shift (any code except `X`, including Other codes) dated
  today or later. An Other code shows its letters: "Tomorrow · SE". Formats: "Today · Day",
  "Tomorrow · Late", "Fri 6 Nov · Night", or "No upcoming shifts". Tapping it jumps the grid to
  that date's month and opens nothing else.
- **Import** button: camera icon with visible label "Import". When offline it stays visible;
  the Import screen explains why it cannot proceed.
- **Menu (⋮)**: a small popover with "Babysitters" (users icon, goes to `/babysitters`, §6.5)
  above "Sign out" (`docs/designs/CalendarMenu.dc.html`). With an
  empty outbox, Sign out goes straight to `/login`. Otherwise it opens a centred dialog
  (`docs/designs/CalendarSignOut.dc.html`): "Sign out?" / "You have N pending edits. Signing out
  keeps them on this phone, but they won't sync until you sign in again." [Cancel] [Sign out].

### 5.2 Sync indicator

A pill with a dot and short text, `role="status"` so changes are announced politely.

| Status (SIM-12) | Dot | Text | Tap action |
|---|---|---|---|
| `synced` | `ok` | "Synced" | Trigger a sync |
| `pending(n)` | `warn` | "N pending" (e.g. "1 pending") | Trigger a sync |
| `offline` | `text-faint`, hollow | "Offline": the phone has no connection or can't reach the server (e.g. on mobile data away from home) | None |
| `unauthorized` | `danger` | "Sign in needed", plus the sign-in banner (§5.7) | Go to `/login` |
| `error` | `failed` | "Sync failed" with a "↻ Retry" affordance; the whole pill is a `<button>` on a red-tinted background (`docs/designs/CalendarFailed.dc.html`) | Trigger a sync |

One status shows at a time, in this order of precedence: `unauthorized`, `error`, `offline`,
`pending(n)`, `synced`. The pending count is available on its own as well (the sign-out dialog
needs it while offline).

While a background run is in flight, keep the current text (no spinner, no text change), so the
pill doesn't flicker every 60 s. After the user taps Retry, show "Syncing…" (hollow `focus`
dot) until that run finishes.

### 5.3 Month grid

```
   ‹   November 2026   ›          [Today]
  Mon Tue Wed Thu Fri Sat Sun
 ┌───┬───┬───┬───┬───┬───┬───┐
 │26 │27 │28 │29 │30 │31 │ 1 │  ← 26–31 Oct dimmed
 │ D │ D │ X │   │ L │ L │ X │
 ├───┼───┼───┼───┼───┼───┼───┤
 │ 2 │ 3 │ 4 │ ...                ← ° avatar on the chip's corner: initials, or an
 │ N°│ L°│ E•│                      amber dot (•) when the date needs a babysitter
 │ ••│   │   │                    ← • one dot per event
```

- Monday-first, always 6 rows (SIM-13). Weekday header uses single letters (M T W T F S S).
  Month title is a live region so screen readers hear the new month after prev/next.
- **Cell**: day number at the top (Caption, mono), shift chip centred with the babysitter avatar
  (§5.10) on its top-right corner, event dots at the bottom: one 5 px `text` dot per event, at most
  4, 3 px apart (`text-dim` outside the month). The cell's border and fill never change with the
  babysitter (`docs/designs/Main.dc.html`).
- **Needs a babysitter** (a working shift dated today or later with no babysitter): the avatar's
  amber dot. Days off, unrostered dates and past dates never get it.
- **Today**: `text` outline around the cell, day number bold.
- **Adjacent-month days**: day number and chip dimmed; still tappable (opens that date).
- **Unrostered date**: day number only.
- **Day off**: the outlined `X` chip (§4.2).
- **Past days**: day number dimmed; chips unchanged (history is useful for swaps).
- **Navigation**: ‹ › buttons, horizontal swipe (≥ 50 px, mostly horizontal), "Today" button
  (always shown).
- **Accessible name** per cell: shift, then ", babysitter {name}, tentative" or ", babysitter
  {name}, confirmed" (or ", no babysitter" when it needs one), then the event count, then
  ", today": "Saturday 24 October, Night, no babysitter, 1 event" / "Friday 6 November, Late,
  babysitter Mum, confirmed" / "Wednesday 4 November, no shift". Cells are buttons.

### 5.4 Code picker

A row of five standard chip buttons (D E L N X) with labels underneath, then an "Other" button.
Choosing Other reveals a short text input (`maxlength=2`, `autocapitalize="characters"`, letters
only, shown uppercase) with placeholder "SE"; the selection is valid once it holds one or two
letters. Typing a standard code there (e.g. "D") selects that standard chip instead. Opening the
picker on a shift with an Other code selects Other with its letters filled in. There is no
"Clear": choosing Day off (`X`) is how a shift is removed, and the sheet no longer prints a hint
saying so. Used in the date sheet; the review
list uses a native `<select>` with the same options instead (§6.4). One selected, or none only on an unrostered date that hasn't been picked yet;
`role="radiogroup"` with each chip `role="radio"`.

### 5.5 Bottom sheet

Fixed to the bottom, `surface` background, top corners rounded 16 px, drag handle, max height
90 vh with internal scroll. Closes on backdrop tap, `Escape`, Cancel, or downward drag past
30 %. Focus is trapped inside and returns to the tapped cell on close (SIM-14).

### 5.6 Buttons

| Variant | Style | Use |
|---|---|---|
| Primary | `primary`, full width in sheets/footers, 48 px tall | Save, Sign in, Save N shifts |
| Secondary | `surface-raised` bg, `text` | Cancel, Choose photo, Retry |
| Ghost | no bg, `text-muted` | Today, back links |

Disabled: `text-faint`, no bg change on press, `aria-disabled`. Pressed: 95 % scale or
`surface-raised` darken for 100 ms.

### 5.7 Banners and inline messages

A rounded box with a tinted background and border in the status colour, icon + one sentence +
optional action. Used for: the sign-in-needed banner on the Calendar ("Sign in to sync. Your
edits are kept on this phone until then." [Sign in]), warnings from extraction, errors on
Login/Import. The sign-in banner is the only banner on the Calendar; the sync pill carries
routine status.

### 5.8 Babysitter picker

A wrapping row of 44 px pill chips, `role="radiogroup"` labelled "Babysitter": "None", every name
used on any date (one chip per name, ignoring case; sorted A–Z), then a dashed "+ Someone else".
The selected chip gets a `text` border, `surface-raised` fill and a check icon. Choosing Someone
else reveals a "Name" input (`maxlength=40`, `autocapitalize="words"`, placeholder "e.g. Aunty Bec",
focused); typing a known name (trimmed, ignoring case) selects that name's chip instead and saves
that name's spelling, and the input stays open. Save stays disabled while the Name input is open
and blank. There is no list to
manage: a name leaves the chips once no date uses it. While the date needs a babysitter and None
is selected, "Needs a babysitter" shows beside the label in `warn`
(`docs/designs/DateSheetNewSitter.dc.html`).

**Confirmed switch**: below the chips, while a name is picked (a name chip, or Someone else with a
name typed), a 44 px row with the label "Confirmed" and a switch (`role="switch"`,
`aria-checked`): on is a `text-muted` track with a `bg` knob on the right holding a `text` check,
off a `border-strong` track with a `text-soft` knob on the left (`docs/designs/DateSheetConfirmed.dc.html`). It opens with the date's stored status. Picking a different name (another chip, or a typed
name that differs from the stored one ignoring case) turns it off: a new babysitter starts
tentative. Picking None hides it, and None saves as tentative. Toggling it alone enables Save.

### 5.10 Babysitter avatar

A small circle on the top-right corner of a shift chip, offset 7 px past the corner and ringed
2 px in the background colour behind it so it reads as sitting on the chip. It shows a date's
babysitter state with neutral colours, so the shift's colour stays the loudest thing in the
cell. Status is shown by shape as well as colour:

| State | Look |
|---|---|
| Needs a babysitter | An 8 px `sitter-need` dot, offset 3 px past the corner, no letters |
| Tentative | 16 px, `cell` fill, 1 px dashed `text-disabled` border, `text-muted` initials |
| Confirmed | 16 px, `border-strong` fill, no border, `text` initials |

Initials are 8 px JetBrains Mono bold. A date with a babysitter and no shift shows the avatar
where the chip would be, centred. Outside the month it is at 45 % opacity, like the chip; on past
dates it shows as normal. The Babysitters screen (§6.5) uses the same avatar on its row chips,
and a 28 px circle (`border-strong` fill, `text` initials, 12 px) by each babysitter's name.

**Initials**: the first letter of the name, uppercased (`Mum` → `M`, `aunty bec` → `A`). When
another known name (§5.8) starts with the same letter ignoring case, both use their first two
letters, the first uppercased and the second lowercased (`Mum` → `Mu`, `Mel` → `Me`); if those
still clash, the name, the date sheet and the accessible name tell them apart. The avatar is
`aria-hidden`: the cell's accessible name carries the babysitter and status.

## 6. Screens

### 6.1 Login (`/login`)

```
         Roster Mate
  ┌───────────────────────────┐
  │ Username                  │
  └───────────────────────────┘
  ┌───────────────────────────┐
  │ Password                  │
  └───────────────────────────┘
  [          Sign in          ]
```

- Top-aligned column: logo, "Roster Mate", tagline "Your shifts, on your phone.", then the form
  (`docs/designs/Login.dc.html`). No sign-up, no "forgot password", no show/hide toggle.
- Inputs: `autocomplete="username"` / `"current-password"`, `autocapitalize="none"`,
  `autocorrect="off"`. Enter submits.
- **Submitting**: button text "Signing in…", disabled. The server waits 1 s on failure, so keep
  the button busy for the whole request.
- **401**: alert box above the fields, "That username and password don’t match."; field borders
  turn `danger`; password cleared and focused; username kept.
- **Network error**: "Can't reach Roster Mate. Check you're on your home network." — the
  server is LAN-only, so this is the likely cause.
- **Offline** (`navigator.onLine === false`): banner at the top "You're offline. Sign in when
  you're back on your home network." with a "Back to calendar" button if any shifts are stored
  locally; the Sign in button is disabled (`docs/designs/LoginOffline.dc.html`).
- States are drawn in `docs/designs/LoginBusy.dc.html`, `LoginError.dc.html`,
  `LoginNetwork.dc.html` and `LoginOffline.dc.html`.
- **Success**: navigate to `/`, replacing history so back doesn't return to Login.

### 6.2 Calendar (`/`)

Layout top to bottom: header and next-shift block (§5.1), month controls, weekday row, grid
(§5.3). No legend: the date sheet labels every code.

States:

| State | What the user sees |
|---|---|
| First run, no shifts | Grid of unrostered dates; next-shift line "No upcoming shifts"; below the grid an empty-state card: "Import a photo of your roster to get started." [Import roster] (`docs/designs/CalendarEmpty.dc.html`) |
| Normal | As above |
| Offline | Indicator "Offline"; everything else unchanged and editable |
| Pending edits | Indicator "N pending" |
| Signed out but data cached | Pill "Sign in needed" and the sign-in banner; data visible and editable |
| Returning from Import | Grid on the month of the first saved date; indicator shows pending until sync completes |

Tapping a date opens the date sheet (§6.3). Long-press does nothing (avoid conflicting gestures).

### 6.3 Date sheet (overlay on `/`)

```
  ───                                     ← drag handle
  Thursday 22 October                     ← Title
  Currently Day
  [ D✓] [ E ] [ L ] [ N ] [ X ] [Other]   ← code picker (§5.4)
   Day  Early Late  Night Day off
  [ SE ] Code                             ← only when Other is selected
  Babysitter            Needs a babysitter ← only while one is needed
  (None) (Dad) (Jo) (✓ Mum) (+ Someone else)
  Confirmed                         [ ●] ← switch, only while a name is picked (§5.8)
  Events
  [ Dentist 3pm              ] [×]
  [ Pick up dry cleaning     ] [×]
  [ Add an event             ]
  [ Cancel ]            [    Save    ]
```

Drawn in `docs/designs/EditSheet.dc.html`, `DateSheetNewSitter.dc.html` and
`DateSheetUnrostered.dc.html` (prototype behaviour in `Main.dc.html`).

- Heading: full weekday and date; add the year only when it isn't the current year. Under it,
  "Currently {Label}" or "Not rostered yet".
- Opens with the stored code, babysitter and events. Tapping the selected code again does
  nothing; to remove a shift, choose Day off (`X`).
- **Unrostered date**: opens with no code selected. Events and a babysitter save without a code,
  and the date stays unrostered. With Other selected, Save needs one or two letters in its input.
- **Save** writes the shift, babysitter (with its status) and events together, and is disabled
  until one of them differs from the stored value and the input is valid (a picked Other code needs its letters;
  Someone else needs a name). On Save: write locally, close, and the cell updates immediately. No
  toast — the grid change and the indicator going to "1 pending" are the feedback.
- **Cancel / backdrop / Escape / back**: close without writing. If there are unsaved changes,
  close anyway — edits are small and quick to redo; a confirm dialog would slow the common case.
- When the keyboard is open, the sheet stays above it (use `visualViewport` height) so Save
  remains reachable.

### 6.4 Import (`/import`)

Header: back arrow (to `/`) and title "Import roster". Four steps share one screen.

**Offline** — cloud-off icon, heading "Import needs a connection", text "Reconnect to your home
network to import a roster. You can still view and edit shifts while you’re away." and
"Back to calendar". No file input (SIM-16). Shown when the phone is offline or when
`GET /api/health` fails on opening the screen (5 s timeout), so being on mobile data away from
home counts as offline here too.

**Step 1 — Choose a photo** (`docs/designs/Import.dc.html`)

```
  Photograph your roster
  Claude reads the photo and finds your row. You’ll check
  every shift before anything is saved.
  1  Fit the whole roster in frame, with your name visible.
  2  Printed sheets and screenshots both work.
  [   📷  Take photo   ]                    ← primary, capture="environment"
  [   Choose from library   ]               ← secondary
  The photo is read once and not stored.
```

**Step 2 — Extracting** (`docs/designs/ImportExtracting.dc.html`)

- Photo thumbnail with a scanning animation, heading "Extracting…", text "Finding the shifts in
  your row. This can take up to a minute." [Cancel] aborts the request and returns to Step 1.
- Keep the screen awake is not required; if the user leaves the app, the request may fail and
  the error state handles it.

**Step 3 — Review**

```
  14 shifts found
  Mon 26 Oct – Sun 8 Nov · 10 new · 1 changed · 2 same · 1 needs a code
  ⚠ Week of 2 Nov is partly obscured.       ← warnings banner
  ┌──────────────────────────────────────┐
  │ ☐ Mon 26 Oct  Already Night  Same  [N Night ▾] │
  │ ☑ Wed 28 Oct  Was Day off  Changed [E Early ▾] │
  │ ☑ Sat 31 Oct  Not rostered  Unsure [L Late  ▾] │
  │ ☑ Thu 5 Nov   Not rostered  New    [Other ▾][SE]│
  │ ☐ Fri 6 Nov   Read as “TRN” Needs code [Pick… ▾]│ ← disabled until a code is picked
  └──────────────────────────────────────┘
  Unticked rows are left as they are.
  [          Save 11 shifts          ]      ← sticky footer
```

- Rows sorted by date (`docs/designs/ImportReview.dc.html`).
- Each row: checkbox, date ("Tue 3 Nov") with a status line under it ("Already Night", "Was Day
  off", "Not rostered", or "Read as “TRN”" for an Unmapped code), one badge, and a native
  `<select>` code picker (Pick…, the five standard codes, Other) tinted in the code's colours.
  Choosing Other shows a two-letter input beside it.
- **Badges** (text plus colour, never colour alone). One per row; Unsure takes precedence while
  the proposed code is unchanged, and the status line still shows what it replaces:

  | Badge | Meaning | Default checkbox |
  |---|---|---|
  | New | No local shift | Checked |
  | Changed | Local code differs | Checked |
  | Same | Matches local | Unchecked |
  | Unsure | Uncertain: the roster cell was hard to read | Checked if new or changed |
  | Needs code | Unmapped code | Unchecked, disabled |

- Other codes from the roster (e.g. `SE`) are ordinary proposed shifts: they get New / Changed /
  Same like any other code.
- Picking a code on a Needs code row enables and checks it, and replaces the badge with New or
  Changed. Changing the proposed code on any row re-evaluates its badge against the local value.
- Footer button: "Save N shifts", disabled at 0 with text "Nothing selected". On Save: write all
  checked rows locally, then go to `/` on the month of the first saved date.
- **Not found** (`personFound: false`): "Couldn't find you on this roster." with a hint "Check
  the photo shows your name as it's printed on the roster." [Try another photo]. No list, no
  Save (SIM-16).
- **Nothing found** (`personFound: true`, zero shifts): "Found you, but no shifts could be
  read." [Try another photo].
- Leaving Review with selected rows (back arrow or OS back) asks with a native `confirm()`:
  "Discard this import?". The extraction is not stored, so leaving loses it.

Not found and Nothing found reuse the Step 2 layout (dimmed photo, message, [Try another photo]):
`docs/designs/ImportNotFound.dc.html`, `docs/designs/ImportNoShifts.dc.html`.

**Errors** (replace Step 2 with a message and [Try again] / [Choose another photo]; drawn in
`docs/designs/ImportTooLarge.dc.html`, `ImportReadFailed.dc.html`, `ImportConnLost.dc.html`):

| Cause | Message |
|---|---|
| `413` / `415` | "That image is too large or not a supported format." |
| Any `5xx` (incl. a proxy's `504`) / timeout | "Couldn't read the roster. Try again, or use a clearer photo." |
| Network failure | "Lost connection while reading. Try again when you're online." |
| `401` | Go to `/login` (SIM-16) |

### 6.5 Babysitters (`/babysitters`)

Who is minding the children, and what is left to confirm with them. Reached from the ⋯ menu.
Header: back arrow (to `/`) and title "Babysitters". It reads only IndexedDB, so it works offline.
Tapping any date row opens the date sheet (§6.3) for that date over this screen, and focus
returns to the row on close. The lists update live, so a row moves or leaves as soon as a save
lands.

```
  ←  Babysitters
  ┌ Share ──────────────────────────────┐
  │ Share                1 Sep – 26 Oct  │  ← the share window
  │ [■■■■■■■■■■■■■■■■■■■■|▒▒▒▒▒▒▒▒▒▒▒▒▒] │  ← split bar, one grey per name
  │ ■ Mum               9 dates · 56%    │
  │ ▒ Dad               7 dates · 44%    │
  └──────────────────────────────────────┘
  (•) Needs a babysitter                  ← only while some upcoming date does
      2 dates
  Fri 23 Oct            [L•]  No babysitter
  Sat 24 Oct            [N•]  No babysitter
  (M) Mum                     [✓ Confirm all]
      2 to confirm
  Thu 22 Oct            [Dᴹ]  ✓ Confirmed
  Fri 30 Oct            [Lᴹ]    Tentative
  (D) Dad
      All confirmed
  Mon 26 Oct            [Eᴰ]  ✓ Confirmed
```

**Share card** (`surface`, rounded, §4.4 gutters): the caption "Share" and the share window's dates
("24 Aug – 18 Oct", with the year on either end that isn't the current year); a 12 px split bar
with one segment per babysitter, widths proportional to their counts, filled `text`, `text-muted`
and `text-dim` in turn (then repeating), with a 2 px gap between segments; then one row per
babysitter with any date in the window, most dates first then A–Z: a 10 px square swatch in its
segment's grey, name, "{n} dates · {p}%" (`1 date`; percentages rounded to whole numbers). A date counts once for its babysitter whatever its
status and whether or not it has a shift; names group ignoring case, as in the picker. With no
babysitter in the window the card shows "No babysitters in these eight weeks." in place of the bar
and rows.

**Needs a babysitter**: shown only while at least one date needs a babysitter. The same header as a
babysitter's section, with a 28 px dashed `text-dim` circle holding a 10 px `sitter-need` dot,
the title "Needs a babysitter" and "{n} dates" ("1 date") in `text-muted`. Then one row per such
date, earliest first: date ("Fri 23 Oct"), the shift chip with the amber dot (§5.10), and "No
babysitter" in `sitter-need`. Rows look like every other row: no dashed or amber border.

**One section per babysitter** with a date today or later, A–Z: the 28 px avatar, name, and a
summary in `text-muted` ("{n} to confirm" or "All confirmed"); a compact secondary "Confirm all"
button (with a check icon) while any of its upcoming dates is tentative. Rows: every date from
today on with that babysitter, earliest first: date, shift chip with the avatar (§5.10; on an
unrostered date the avatar alone), and a status label "Tentative" (in `text-muted`) or
"Confirmed" (in `text`), with a check icon before "Confirmed" so the status doesn't rest on
colour. Past dates are not listed here; they count only towards the share.

**Confirm all** marks every upcoming tentative date of that babysitter confirmed in one save (one
edit time, one transaction, one sync), with no dialog: a slip is undone in the date sheet.
Afterwards the summary reads "All confirmed" and the button goes.

**Empty**: with no babysitter on any date, the share card shows its empty line and, below it, "No
upcoming babysitters. Choose one for a date in the calendar." in `text-muted`; the Needs a
babysitter list still shows when it has dates.

Rows are 52 px buttons on `cell` with a `cell-line` border (`docs/designs/Babysitters.dc.html`,
`BabysittersEmpty.dc.html`). Each row is a button whose accessible name reads like a calendar cell's: "Friday 30
October, Late, babysitter Mum, tentative". Section headings are `h2`.

## 7. Cross-cutting behaviour

### 7.1 Offline and sync

- The UI never waits for the network outside Login and Import. Edits render from IndexedDB.
- Offline is shown in one place only: the sync pill (and the Import/Login screens that need
  a connection). No global offline banner on the Calendar.
- A sync that pulls in changes updates the grid in place without animation or scroll jumps. If
  the date sheet is open for a date that sync changes, the sheet keeps the user's in-progress
  values (the outbox rule means their Save will win).
- After an app update installs (`registerType: 'autoUpdate'`), the new version loads on next
  open; no update prompt.

### 7.2 Dates and locale

- Display dates in `en-AU` style: "Fri 6 Nov", "Wednesday 4 November", "November 2026". Week
  starts Monday.
- "Today" follows the phone's local date and updates if the app stays open past midnight
  (re-evaluate on `visibilitychange` and on the 60 s tick).

### 7.3 Accessibility

- WCAG 2.2 AA contrast for all text and meaningful icons.
- Every interactive element reachable and operable by keyboard (useful on desktop testing) and
  labelled for screen readers; focus rings visible (`focus` token).
- Shift meaning never conveyed by colour alone (letters, labels, badges).
- Respect `prefers-reduced-motion`; text scales with the OS setting up to 200 % without loss of
  function (grid cells may grow taller; the 7-column grid stays).
- Live regions: sync indicator (polite), month title (polite), import step changes (polite),
  errors (assertive).

### 7.4 PWA presentation

- Manifest `name`/`short_name` "Roster Mate", `display: standalone`, `orientation: portrait`,
  colours = `bg` token. Icon: a simple calendar glyph on `bg`, with a maskable variant whose
  glyph sits inside the 80 % safe zone.
- iOS: `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style="black-translucent"`,
  `apple-touch-icon` 180 px. Content clears the status bar via safe-area insets.
- Disable pull-to-refresh bounce on the grid (`overscroll-behavior-y: contain`) so swipes and
  scrolls don't reload the app.

## 8. Copy deck

| Key | Text |
|---|---|
| App name | Roster Mate |
| Next shift | "Today · {Label}", "Tomorrow · {Label}", "{Ddd d Mmm} · {Label}"; {Label} is the code itself for an Other code |
| No next shift | No upcoming shifts |
| Sync | Synced · {n} pending · Offline · Sign in needed · Sync failed + Retry · Syncing… |
| Sign-in banner | Sign in to sync. Your edits are kept on this phone until then. |
| Empty roster | Import a photo of your roster to get started. |
| Login error | That username and password don’t match. |
| Login unreachable | Can't reach Roster Mate. Check you're on your home network. |
| Import offline | Import needs a connection / Reconnect to your home network to import a roster. You can still view and edit shifts while you’re away. |
| Import guidance | Photograph your roster / Claude reads the photo and finds your row. You’ll check every shift before anything is saved. |
| Extracting | Extracting… / Finding the shifts in your row. This can take up to a minute. |
| Not found | Couldn't find you on this roster. |
| Save import | Save {n} shifts / Save 1 shift / Nothing selected |
| Discard import | Discard this import? |
| Babysitter | Babysitter · None · + Someone else · Name · Needs a babysitter · Confirmed |
| Babysitters screen | Babysitters · Share · {n} dates / 1 date · {p}% · No babysitters in these eight weeks. · Needs a babysitter · {n} to confirm · All confirmed · Confirm all · Tentative · Confirmed · No upcoming babysitters. Choose one for a date in the calendar. |
| Events | Events · Add an event · Remove event: {text} |
| Sign out with pending | You have {n} pending edits. Signing out keeps them on this phone, but they won't sync until you sign in again. |

Tone: short, plain, second person, no exclamation marks, no technical terms ("sync" is the one
exception, already used in the indicator).

## 9. Ticket mapping

| Ticket | Sections to apply |
|---|---|
| SIM-10 Login | §6.1, §4, §8 |
| SIM-12 Offline store / PWA | §4.1 tokens, §4.2 code colours in `codes.ts`, §5.2 statuses, §7.1, §7.4 |
| SIM-13 Calendar view | §5.1–5.3, §6.2, §7.2 |
| SIM-14 Edit sheet (now the date sheet) | §5.4, §5.5, §6.3 |
| SIM-16 Import | §6.4, §5.4, §5.7 |
| SIM-24 / SIM-35 Events and babysitters | §5.3, §5.8, §5.9, §6.3, §8 |
| SIM-41 Confirmed babysitters | §5.8 Confirmed switch, §6.3, §8 |
| SIM-42 Babysitter visibility | §3, §4.1, §5.1 menu, §5.3, §5.10, §6.5 (without the share card), §8 |
| SIM-43 Babysitter share | §6.5 share card, §8 |

## 10. Additions beyond the tickets

These come from this spec, not from the ticket specs. Each is small; drop any that the reviewer
doesn't want, and the ticket specs still stand on their own.

- First-run empty-state card (§6.2).
- Tapping the next-shift line jumps to its month; tapping the sync indicator triggers a sync.
- Sign-out confirmation when edits are pending (§5.1).
- "Nothing found" import state and "Discard this import?" confirmation (§6.4).
- Sheet stays above the keyboard (§6.3).
- `en-AU` date formatting and midnight rollover of "today" (§7.2).
- Sync failure pill "Sync failed" + Retry for the `error` state SIM-12 exposes.

## 11. Open questions

1. Should past months be reachable without limit? Default: yes, prev/next has no bound.
2. Should the review list hide "Same" rows behind a "Show unchanged" toggle when there are many?
   Default: show them, unchecked, as SIM-16 specifies.
