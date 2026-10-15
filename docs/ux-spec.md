# Roster Mate — UX Design Specification

How Roster Mate looks, reads and behaves on a phone. `docs/design.md` covers architecture and
behaviour; this document covers the screens, states, visual system and copy that the UI tickets
(SIM-10, SIM-12, SIM-13, SIM-14, SIM-16) build. Where a ticket's spec is more specific, the
ticket wins; where this document fills a gap the tickets leave, build to this document.

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
                         ├── tap date ─► Edit sheet (overlay on /)
                         ├── Import ───► /import ──(save)──► / (month of first saved date)
                         └── ⋯ menu ──► Sign out ──► /login
```

| Route | Screen | Reached from | Works offline |
|---|---|---|---|
| `/login` | Sign in | App start (online, `401`), "Sign in to sync", Sign out | Shows offline notice (§7.1) |
| `/` | Calendar | Default route | Yes |
| (overlay) | Edit sheet | Tapping a date on `/` | Yes |
| `/import` | Import | Header Import button | No — shows "Import needs a connection" |

There is no tab bar. The Calendar is the hub; Import and Login are leaf screens with a back
control. Browser/OS back closes the edit sheet first, then leaves Import.

## 4. Visual system

### 4.1 Theme

Dark only: `<html class="dark">`, `color-scheme: dark`, manifest and `<meta name="theme-color">`
set to the page background. Define these as Tailwind theme tokens so components use names, not
raw palette classes.

| Token | Tailwind value | Use |
|---|---|---|
| `bg` | `neutral-950` (#0a0a0a) | Page background, `theme_color`, `background_color` |
| `surface` | `neutral-900` | Header, cards, review rows, bottom sheet |
| `surface-raised` | `neutral-800` | Inputs, pressed states, menus |
| `border` | `neutral-800` | Dividers, input borders |
| `text` | `neutral-100` | Primary text |
| `text-muted` | `neutral-400` | Secondary text, labels, adjacent-month dates |
| `text-faint` | `neutral-600` | Disabled text |
| `primary` | `neutral-100` bg / `neutral-950` text | Primary buttons (Save, Sign in) |
| `danger` | `rose-400` | Error text, destructive confirmations |
| `ok` | `emerald-400` | Synced dot |
| `warn` | `amber-400` | Pending / attention dot |
| `focus` | `sky-400` | Focus rings (2 px, offset 2 px) |

The primary button is near-white rather than a hue so it never competes with or mimics a shift
colour.

### 4.2 Shift codes

Codes, labels and colour families come from `web/src/shifts/codes.ts` (SIM-12). Chips use a
tinted background with a light text colour of the same family, which keeps contrast high on the
dark surface and lets six colours sit side by side without glare.

| Code | Label | Chip background | Chip text | Notes |
|---|---|---|---|---|
| D | Day | `amber-400/15` | `amber-300` | |
| E | Early | `sky-400/15` | `sky-300` | |
| L | Late | `violet-400/15` | `violet-300` | |
| N | Night | `indigo-400/20` | `indigo-300` | Slightly stronger fill to separate it from Late |
| X | Day off | none | `neutral-500` | Rendered as a quiet letter, not a chip — days off should recede |
| Other (`SE`, `XD`, …) | the code itself | `teal-400/15` | `teal-300` | One shared colour for every Other code; the chip shows both letters |

- Chip: rounded-md, code in semibold, centred. In the grid the chip shows the code only; in the
  header, edit sheet and review list a standard code shows its label too ("L · Late" or "Late").
  An Other code has no label, so it shows just its letters ("SE") everywhere. Two-letter codes
  use 1 px tighter letter-spacing so they fit a 46 px cell.
- Selected state (edit sheet, review picker): solid ring `ring-2` in the chip's text colour plus a
  check icon, so selection does not rely on colour.
- All chip text colours meet WCAG AA (≥ 4.5:1) against `surface` and `bg`; verify with a contrast
  checker when the palette is implemented.

### 4.3 Typography

System font stack (`ui-sans-serif, system-ui, …`); no web fonts, so the shell renders offline
instantly.

| Role | Size / weight | Use |
|---|---|---|
| Display | 20 px / 600 | Next-shift line |
| Title | 18 px / 600 | Screen titles, month name, sheet heading |
| Body | 16 px / 400 | Body text, inputs (16 px prevents iOS zoom on focus) |
| Label | 14 px / 500 | Buttons, badges, list secondary text |
| Caption | 12 px / 500 | Weekday header, sync indicator, day numbers |

Use tabular numerals (`tabular-nums`) for dates and counts.

### 4.4 Spacing, size and layout

- Design width 360–430 px portrait. 16 px side gutters. Base spacing unit 4 px.
- Tap targets ≥ 44 px (SIM-13's floor is 40 px; aim for 44 where space allows).
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
│ Tomorrow · Late                [📷] [⋮] │  ← next shift (Display), Import, menu
│ ● Synced                                 │  ← sync indicator (Caption)
└──────────────────────────────────────────┘
```

- **Next shift line** (rules from SIM-13): first working shift (any code except `X`,
  including Other codes) dated today or later. An Other code shows its letters: "Tomorrow · SE". Formats: "Today · Day", "Tomorrow · Late", "Fri 6 Nov · Night", or "No upcoming shifts"
  in `text-muted`. Tapping it jumps the grid to that date's month and opens nothing else.
- **Import** button: camera icon with visible label "Import" if width allows, otherwise
  icon-only with `aria-label="Import roster"`. When offline it stays visible; the Import screen
  explains why it cannot proceed.
- **Menu (⋮)**: a small popover with "Sign out". Sign out asks for confirmation if the outbox is
  non-empty: "You have N pending edits. Signing out keeps them on this phone, but they won't
  sync until you sign in again." [Cancel] [Sign out].

### 5.2 Sync indicator

A dot plus short text, `role="status"` so changes are announced politely.

| Status (SIM-12) | Dot | Text | Tap action |
|---|---|---|---|
| `synced` | `ok` | "Synced" | Trigger a sync |
| `pending(n)` | `warn` | "N pending" (e.g. "1 pending") | Trigger a sync |
| `offline` | `text-muted`, hollow | "Offline" | None |
| `unauthorized` | `warn` | "Sign in to sync" (link to `/login`) | Go to `/login` |
| `error` | `danger` | "Sync failed · retry" | Trigger a sync |

While a run is in flight, keep the current text and pulse the dot (no spinner, no text change),
so the indicator doesn't flicker every 60 s.

### 5.3 Month grid

```
   ‹   November 2026   ›          [Today]
  Mon Tue Wed Thu Fri Sat Sun
 ┌───┬───┬───┬───┬───┬───┬───┐
 │26 │27 │28 │29 │30 │31 │ 1 │  ← 26–31 Oct dimmed
 │ D │ D │ X │   │ L │ L │ X │
 ├───┼───┼───┼───┼───┼───┼───┤
 │ 2 │ 3•│ 4 │ ...                ← • note dot
 │ N │ L │   │
```

- Monday-first, always 6 rows (SIM-13). Month title is a live region so screen readers hear the
  new month after prev/next.
- **Cell** (~46 × 56 px at 360 px): day number top-left (Caption), shift chip centred below,
  note dot top-right (4 px, `text-muted`).
- **Today**: 2 px `text` outline around the cell, day number bold.
- **Adjacent-month days**: day number and chip at 40 % opacity; still tappable (opens that date).
- **Unrostered date**: day number only.
- **Day off**: the muted `X` letter (§4.2); a note dot if it has a note.
- **Past days**: no special styling (keeps the grid calm; history is useful for swaps).
- **Navigation**: ‹ › buttons, horizontal swipe (≥ 50 px, mostly horizontal), "Today" button.
  "Today" is hidden when the current month is shown.
- **Accessible name** per cell: "Tuesday 3 November, Late, has note" / "Wednesday 4 November, no
  shift". Cells are buttons.

### 5.4 Code picker

A row of five standard chip buttons (D E L N X) with labels underneath, then an "Other" button.
Choosing Other reveals a short text input (`maxlength=2`, `autocapitalize="characters"`, letters
only, shown uppercase) with placeholder "SE"; the selection is valid once it holds one or two
letters. Typing a standard code there (e.g. "D") selects that standard chip instead. Opening the
picker on a shift with an Other code selects Other with its letters filled in. There is no
"Clear": choosing Day off (`X`) is how a shift is removed. Used in the edit sheet and (compact, letters only) in
the review list. One selected, or none only on an unrostered date that hasn't been picked yet;
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

Full-width strip under the header, `surface` bg with a 3 px left border in the status colour,
icon + one sentence + optional action. Used for: offline on Import, warnings from extraction,
errors on Login/Import. Never stack more than one banner on the Calendar; the sync
indicator carries routine status.

## 6. Screens

### 6.1 Login (`/login`)

```
         Roster Mate
  ┌───────────────────────────┐
  │ Username                  │
  └───────────────────────────┘
  ┌───────────────────────────┐
  │ Password               👁 │
  └───────────────────────────┘
  Wrong username or password.        ← danger, only after 401
  [          Sign in          ]
```

- Vertically centred column. App name in Title. No sign-up, no "forgot password".
- Inputs: `autocomplete="username"` / `"current-password"`, `autocapitalize="none"`,
  `autocorrect="off"`. Password has a show/hide toggle. Enter submits.
- **Submitting**: button text "Signing in…", disabled. The server waits 1 s on failure, so keep
  the button busy for the whole request.
- **401**: "Wrong username or password." under the fields; password cleared and focused; username
  kept.
- **Network error**: "Can't reach Roster Mate. Check you're on your home network." — the
  server is LAN-only, so this is the likely cause.
- **Offline** (`navigator.onLine === false`): banner "You're offline. Sign in when you're back on
  your home network." with a "Back to calendar" link if any shifts are stored locally.
- **Success**: navigate to `/`, replacing history so back doesn't return to Login.

### 6.2 Calendar (`/`)

Layout top to bottom: header (§5.1), month controls, weekday row, grid (§5.3). Below the grid,
a short legend line in Caption: "D Day · E Early · L Late · N Night · X Off · other codes as shown" — useful on first
use, cheap to keep.

States:

| State | What the user sees |
|---|---|
| First run, no shifts | Grid of unrostered dates; next-shift line "No upcoming shifts"; below the grid an empty-state card: "Import a photo of your roster to get started." [Import roster] |
| Normal | As above |
| Offline | Indicator "Offline"; everything else unchanged and editable |
| Pending edits | Indicator "N pending" |
| Signed out but data cached | Indicator "Sign in to sync"; data visible and editable |
| Returning from Import | Grid on the month of the first saved date; indicator shows pending until sync completes |

Tapping a date opens the edit sheet (§6.3). Long-press does nothing (avoid conflicting gestures).

### 6.3 Edit sheet (overlay on `/`)

```
  ───                                     ← drag handle
  Wednesday 4 November                    ← Title
  [ D ] [ E ] [ L✓] [ N ] [ X ] [Other]   ← code picker
   Day  Early Late  Night Off
                              [ SE ]      ← only when Other is selected
  Note
  ┌──────────────────────────────────┐
  │ swapped with Sam                 │
  └──────────────────────────────────┘
                              16 / 500    ← shown from 400 chars
  [ Cancel ]            [    Save    ]
```

- Heading: full weekday and date; add the year only when it isn't the current year.
- Opens with the current code selected and note filled. Tapping the selected code again does
  nothing; to remove a shift, choose Day off (`X`).
- **Unrostered date**: opens with no code selected. A note can't be saved on its own, because a
  note needs a shift: Save stays disabled until a code is picked. With Other selected, Save also
  needs one or two letters in its input.
- **Save** disabled until the code or note differs from the stored value (SIM-14). On Save: write
  locally, close, and the cell updates immediately. No toast — the grid change and the
  indicator going to "1 pending" are the feedback.
- **Note**: textarea, 3 rows growing to 6, `maxlength=500`, plain text. Counter appears at 400
  characters.
- **Cancel / backdrop / Escape / back**: close without writing. If there are unsaved changes,
  close anyway — edits are small and quick to redo; a confirm dialog would slow the common case.
- When the keyboard is open, the sheet stays above it (use `visualViewport` height) so Save
  remains reachable.

### 6.4 Import (`/import`)

Header: back arrow (to `/`) and title "Import roster". Four steps share one screen.

**Offline** — banner "Import needs a connection. You can still view and edit shifts offline."
plus "Back to calendar". No file input (SIM-16).

**Step 1 — Choose a photo**

```
  Import roster
  Take a clear photo of the whole roster,
  with your name and the dates visible.
  [   📷  Take photo   ]                    ← primary, capture="environment"
  [   Choose from library   ]               ← secondary
```

- Short guidance text above the buttons. After selection, show a thumbnail briefly while the
  image is downscaled.

**Step 2 — Reading**

- Thumbnail, spinner and "Reading roster…". After 10 s add "This can take up to a minute."
  [Cancel] aborts the request and returns to Step 1.
- Keep the screen awake is not required; if the user leaves the app, the request may fail and
  the error state handles it.

**Step 3 — Review**

```
  ⚠ Week of 10 Nov is partly obscured      ← warnings banner (collapsible if > 2)
  12 shifts found · 8 selected
  [Select all new/changed]
  ┌──────────────────────────────────────┐
  │ ☑ Mon 2 Nov   —  →  [N]   New        │
  │ ☑ Tue 3 Nov   E  →  [L]   Changed    │
  │ ☐ Wed 4 Nov   X  →  [X]   Same       │
  │ ☐ Thu 5 Nov   —  →  [ ? ] Unmapped "A/L"│ ← disabled until a code is picked
  │ ☑ Sat 7 Nov   —  →  [SE]  New        │  ← Other code
  │ ☑ Fri 6 Nov   —  →  [D]   Uncertain  │
  └──────────────────────────────────────┘
  [          Save 8 shifts          ]       ← sticky footer
```

- Rows sorted by date, grouped by month with a sticky month subheading when the result spans
  months.
- Each row: checkbox, date ("Tue 3 Nov"), current local value (chip or "—"), arrow, proposed
  code (tap to open a compact code picker popover), badge.
- **Badges** (text plus colour, never colour alone):

  | Badge | Meaning | Style | Default checkbox |
  |---|---|---|---|
  | New | No local shift | `ok` text | Checked |
  | Changed | Local code differs | `warn` text | Checked |
  | Same | Matches local | `text-muted` | Unchecked |
  | Uncertain | The roster cell was hard to read | `warn` outline | Checked if New/Changed |
  | Unmapped "A/L" | Unmapped code; the cell text is shown | `danger` text | Unchecked, disabled |

  A row can be both Changed and Uncertain; show both badges.
- Other codes from the roster (e.g. `SE`) are ordinary proposed shifts: they get New / Changed /
  Same like any other code. The row picker includes Other (§5.4).
- Picking a code on an Unmapped row enables and checks it, and replaces the badge with New or
  Changed. Changing the proposed code on any row re-evaluates its badge against the local value.
- Changed rows show the local note, if any, under the date in Caption so the user knows it will
  be kept.
- Footer button: "Save N shifts", disabled at 0 with text "Nothing selected". On Save: write all
  checked rows locally, then go to `/` on the month of the first saved date.
- **Not found** (`personFound: false`): "Couldn't find you on this roster." with a hint "Check
  the photo shows your name as it's printed on the roster." [Try another photo]. No list, no
  Save (SIM-16).
- **Nothing found** (`personFound: true`, zero shifts): "Found you, but no shifts could be
  read." [Try another photo].
- Leaving Review with selected rows (back arrow or OS back) asks: "Discard this import?"
  [Keep reviewing] [Discard]. The extraction is not stored, so leaving loses it.

**Errors** (replace Step 2 with a message and [Try again] / [Choose another photo]):

| Cause | Message |
|---|---|
| `413` / `415` | "That image is too large or not a supported format." |
| `502` / timeout | "Couldn't read the roster. Try again, or use a clearer photo." |
| Network failure | "Lost connection while reading. Try again when you're online." |
| `401` | Go to `/login` (SIM-16) |

## 7. Cross-cutting behaviour

### 7.1 Offline and sync

- The UI never waits for the network outside Login and Import. Edits render from IndexedDB.
- Offline is shown in one place only: the sync indicator (and the Import/Login screens that need
  a connection). No global offline banner on the Calendar.
- A sync that pulls in changes updates the grid in place without animation or scroll jumps. If
  the edit sheet is open for a date that sync changes, the sheet keeps the user's in-progress
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
| Sync | Synced · {n} pending · Offline · Sign in to sync · Sync failed · retry |
| Empty roster | Import a photo of your roster to get started. |
| Login error | Wrong username or password. |
| Login unreachable | Can't reach Roster Mate. Check you're on your home network. |
| Import offline | Import needs a connection. You can still view and edit shifts offline. |
| Import guidance | Take a clear photo of the whole roster, with your name and the dates visible. |
| Reading | Reading roster… / This can take up to a minute. |
| Not found | Couldn't find you on this roster. |
| Save import | Save {n} shifts / Save 1 shift / Nothing selected |
| Discard import | Discard this import? |
| Sign out with pending | You have {n} pending edits. Signing out keeps them on this phone, but they won't sync until you sign in again. |

Tone: short, plain, second person, no exclamation marks, no technical terms ("sync" is the one
exception, already used in the indicator).

## 9. Ticket mapping

| Ticket | Sections to apply |
|---|---|
| SIM-10 Login | §6.1, §4, §8 |
| SIM-12 Offline store / PWA | §4.1 tokens, §4.2 code colours in `codes.ts`, §5.2 statuses, §7.1, §7.4 |
| SIM-13 Calendar view | §5.1–5.3, §6.2, §7.2 |
| SIM-14 Edit sheet | §5.4, §5.5, §6.3 |
| SIM-16 Import | §6.4, §5.4, §5.7 |

## 10. Additions beyond the tickets

These come from this spec, not from the ticket specs. Each is small; drop any that the reviewer
doesn't want, and the ticket specs still stand on their own.

- Legend line under the grid and first-run empty-state card (§6.2).
- Tapping the next-shift line jumps to its month; tapping the sync indicator triggers a sync.
- Sign-out confirmation when edits are pending (§5.1).
- "Nothing found" import state and "Discard this import?" confirmation (§6.4).
- Note counter from 400 characters; sheet stays above the keyboard (§6.3).
- `en-AU` date formatting and midnight rollover of "today" (§7.2).
- Sync failure status text "Sync failed · retry" for the `error` state SIM-12 exposes.
- "Today" button hidden while the current month is already shown (SIM-13 only says it returns
  to the current month).
- "Select all new/changed" shortcut on the review list (§6.4).

## 11. Open questions

1. Should past months be reachable without limit? Default: yes, prev/next has no bound.
2. Should the review list hide "Same" rows behind a "Show unchanged" toggle when there are many?
   Default: show them, unchecked, as SIM-16 specifies.
