# Roster Mate — Design

Roster Mate is a single-user, mobile-first progressive web app (PWA) for keeping track of
work shifts. The user photographs a printed or on-screen roster, an LLM extracts their shifts,
and the app shows them in a simple calendar that keeps working offline.

Domain terms (Shift, Day off, Roster, Roster photo, Proposed shift, Pending edit, …) are defined
in `CONTEXT.md`. Decisions are recorded in `docs/adr/`.

Source: Linear SIM-8 ("Initial scope").

## Goals

- Upload a roster photo; Claude extracts the user's shifts; the user reviews and saves them.
- View shifts on a phone in a simple, dark-mode-only UI.
- Edit a single shift (e.g. after a swap). Setting a date to Day off is how a shift is removed.
- View and edit while away from the home network; edits sync when the phone reconnects.

## Non-goals

- Multiple users, sharing, or roles.
- Importing or extracting rosters while offline.
- Light mode, desktop-optimised layouts, native apps.
- Push notifications, calendar (ICS) export, pay calculation.
- Exposing the app to the internet. Network isolation is a deployment concern.

## Glossary

Domain terms live in `CONTEXT.md`. These are implementation terms only.

| Term | Meaning |
|---|---|
| **Outbox** | Client-side store of pending edits, one per kind: `outbox` (shifts, one per date), `eventOutbox` (one per event id) and `babysitterOutbox` (one per date). An entry is removed once the server has acknowledged it. |
| **Revision (`rev`)** | Server-wide, monotonically increasing integer stamped on every shift, event and babysitter write (one counter for all three). Clients pull "everything since rev N". |

## Architecture

```
 phone (PWA)                                   homelab: one Docker container
 ┌───────────────────────────┐                 ┌─────────────────────────────────┐
 │ React + Tailwind UI       │                 │ Go binary                        │
 │   ↕                       │   HTTPS (via    │  ├─ /            embedded web    │
 │ Dexie (IndexedDB)         │   user's TLS    │  ├─ /api/login, /api/session ... │
 │   shifts, events, babys.  │   reverse proxy)│  ├─ /api/sync     shifts, events,│
 │   + outboxes + meta       │                 │  │                babysitters    │
 │   ↕ sync engine  ─────────┼────────────────►│  └─ /api/extract  → Anthropic API│
 │ Service worker (shell)    │                 │ SQLite file in /data             │
 └───────────────────────────┘                 └─────────────────────────────────┘
```

- **The UI reads and writes only IndexedDB.** The sync engine moves data between IndexedDB and
  the server. The service worker only precaches the app shell; it never caches API responses.
- **One container**: a multi-stage Dockerfile builds the web app, embeds `apps/web/dist` into the
  Go binary with `embed.FS`, and ships a static binary. SQLite via `modernc.org/sqlite`
  (pure Go, no CGO).

### Repository layout

```
go.mod, go.sum          one Go module (github.com/simonpratt/roster-mate)
package.json, pnpm-workspace.yaml, pnpm-lock.yaml   the pnpm workspace
/apps/server            Go server (cmd/roster-mate/main.go, internal/...)
  cmd/fake-anthropic    standalone fake Messages API for the browser suite
  internal/config       env loading + validation
  internal/auth         login, sessions, middleware
  internal/store        SQLite open, migrations, shift queries
  internal/api          HTTP handlers (sync, extract, session)
  internal/extract      Anthropic client + prompt + response parsing
  internal/extract/fakeanthropic   the one shared fake Messages API (fixture: roster.json)
  internal/mail         the roster email: view model, embedded templates (templates/)
  internal/web          serves the built frontend + SPA fallback
/apps/web               Vite + React + TypeScript + Tailwind app
  embed.go              package web: embeds dist/ (dist/.gitkeep committed)
  src/db                Dexie schema
  src/sync              sync engine
  src/shifts            shift codes, labels, colours (mirrors server)
  src/routes            Login, Calendar, Import, Babysitters
/apps/email             React Email source of the roster email (own workspace package,
                        roster-mate-email; dev only, never in the image)
  src/RosterEmail.tsx   the email, with Go template actions as text
  src/write.ts          `render` script: writes internal/mail/templates/roster.html.tmpl
/test/e2e               Playwright suite (own workspace package, roster-mate-e2e)
  playwright.config.ts  phone project, webServer for the binary and the fake Claude
  fixtures/             test (reset + clock), env, files/roster.jpg
  ui/                   one spec per user path
/docs                   design docs
Dockerfile, Makefile, .env.example, README.md
```

## Configuration (environment)

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `APP_USERNAME` | yes | — | Login username |
| `APP_PASSWORD` | yes | — | Login password (compared in constant time) |
| `ANTHROPIC_API_KEY` | yes | — | Extraction |
| `ANTHROPIC_MODEL` | no | `claude-sonnet-5-5` | Extraction model |
| `ROSTER_NAME` | yes | — | The user's name as printed on rosters; tells Claude which row is theirs |
| `SESSION_SECRET` | no | random, generated once and stored in the DB | HMAC key for session cookies |
| `PORT` | no | `8080` | Listen port |
| `DATA_DIR` | no | `/data` | Holds `roster-mate.db` |
| `TZ` | no | container default | Used only for "today" in the extraction prompt |
| `ANTHROPIC_BASE_URL` | no | the SDK's default | Messages API address; an absolute `http`/`https` URL. Tests point it at the fake |
| `RESEND_API_KEY` | no | unset (email off) | Resend API key. Set, it turns roster emails on (ADR 0005): `/api/recipients` is mounted and `/api/session` reports `email: true`. Unset, email is off and the recipients API is the usual `/api/` 404. Never logged |
| `EMAIL_FROM` | when `RESEND_API_KEY` is set | — | The roster email's From address, display name allowed (`Simon's roster <roster@mail.example.com>`); must parse as an address. Ignored when email is off |
| `RESEND_BASE_URL` | no | `https://api.resend.com` | Resend API address; an absolute `http`/`https` URL. Tests point it at a fake |
| `APP_TEST_MODE` | no | off | Test only; never set in production. `1` (and only `1`) mounts `POST /api/test/reset`, which needs no session and deletes every shift, shift change, event, babysitter, recipient and roster email send (204), keeping `meta` so sessions and the rev counter survive. Off, the path is the usual `/api/` 404. The server logs a warning at startup when it is on |

The server refuses to start, with a message naming the variable, if a required one is missing.
The startup log line reports `email=on` or `email=off`.

## Authentication

- `POST /api/login` `{username, password}` → `204` and a `rm_session` cookie, or `401`.
- `POST /api/logout` → `204`, clears the cookie.
- `GET /api/session` → `200 {username, email}` or `401`. `email` is `true` when roster emails are
  on (`RESEND_API_KEY` set), so the client knows whether to offer the Roster emails screen.
- Cookie: HMAC-SHA256-signed `{username, expiresAt}`, `HttpOnly`, `SameSite=Strict`, `Path=/`,
  90-day lifetime refreshed on authenticated requests: a valid cookie with less than 89 days
  left is reissued, so the session runs 90 days from its last use (to within a day) without a
  `Set-Cookie` on every response. `Secure` is set when the request arrived over TLS or with
  `X-Forwarded-Proto: https`. The key is `SESSION_SECRET`, else 32 random bytes generated on
  first start and kept in `meta.session_secret`, so sessions survive restarts.
- Every `/api/*` route except login and `/api/health` requires a valid cookie; otherwise `401`.
- Failed logins sleep 1s before responding (crude brute-force damping; LAN only).
- Static assets are served without auth so the shell loads offline; the client checks
  `/api/session` when online and shows the login screen on `401`.
- Offline, the client trusts its cached data and does not require a session. A `401` during
  sync shows "Sign in needed" and a "Sign in to sync" banner; local data and the outbox are kept.

## Data model

### Server (SQLite)

```sql
CREATE TABLE shifts (
  date       TEXT PRIMARY KEY,        -- 'YYYY-MM-DD', a local calendar date
  code       TEXT,                    -- 1-2 uppercase letters; NULL is reserved (see Sync protocol)
  edited_at  INTEGER NOT NULL,        -- client edit time, unix ms (last-write-wins key)
  rev        INTEGER NOT NULL         -- server revision of the last applied write
);
CREATE INDEX shifts_rev ON shifts(rev);
CREATE TABLE events (
  id         TEXT PRIMARY KEY,        -- client-generated UUID
  date       TEXT NOT NULL,           -- 'YYYY-MM-DD'
  text       TEXT NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0, -- 1 = tombstone, kept so the deletion syncs
  created_at INTEGER NOT NULL,        -- unix ms; orders events within a date
  edited_at  INTEGER NOT NULL,        -- last-write-wins key
  rev        INTEGER NOT NULL
);
CREATE INDEX events_rev ON events(rev);
CREATE TABLE babysitters (
  date       TEXT PRIMARY KEY,        -- 'YYYY-MM-DD'; at most one babysitter per date
  name       TEXT NOT NULL,           -- '' = no babysitter
  edited_at  INTEGER NOT NULL,
  rev        INTEGER NOT NULL,
  confirmed  INTEGER NOT NULL DEFAULT 0 -- 1 = confirmed, 0 = tentative (migration 0004)
);
CREATE INDEX babysitters_rev ON babysitters(rev);
CREATE TABLE shift_changes (            -- migration 0005, ADR 0004
  rev        INTEGER PRIMARY KEY,     -- the rev the shift write took; one change per write
  date       TEXT NOT NULL,
  from_code  TEXT,                    -- NULL: the date had no row, or the reserved null code
  to_code    TEXT,                    -- NULL only for the reserved tombstone
  source     TEXT,                    -- 'sheet' | 'import' | NULL (unknown: an older client)
  edited_at  INTEGER NOT NULL
);
CREATE TABLE recipients (               -- migration 0006, ADR 0005; server-only, never synced
  position   INTEGER PRIMARY KEY,     -- list order, 0-based
  email      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  babysitter TEXT NOT NULL DEFAULT '' -- '' = no babysitter
);
CREATE TABLE roster_email_sends (       -- migration 0006; one row per roster email
  id         INTEGER PRIMARY KEY,
  sent_at    INTEGER NOT NULL,        -- unix ms
  first_date TEXT NOT NULL,           -- 'YYYY-MM-DD', the email's Monday
  last_date  TEXT NOT NULL,           -- its Sunday
  recipients INTEGER NOT NULL,        -- how many were sent to successfully
  ok         INTEGER NOT NULL         -- 1 = every recipient succeeded
);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);  -- 'rev', 'db_id', 'session_secret', 'schema_version'
```

Migrations are ordered SQL files embedded in the binary and applied at startup. Migration 0003
added `events` and `babysitters` and dropped the shift `note` column; existing notes were not
carried over. Events and babysitters are records of their own, not fields on a shift; see
`docs/adr/0003-events-and-babysitters-sync-separately.md`. Migration 0004 added the babysitter's
`confirmed` column; existing babysitters became tentative and kept their `rev`. Migration 0005
added `shift_changes`, the shift history (`docs/adr/0004-shift-history-recorded-by-the-server.md`);
nothing is backfilled, so history starts with that release, and shift changes are never purged.
Migration 0006 added `recipients` and `roster_email_sends` for roster emails
(`docs/adr/0005-roster-emails-sent-by-the-server.md`); both live only on the server.

### Client (Dexie / IndexedDB)

- `shifts`: `{date, code | null, editedAt, rev}` keyed by `date`.
- `outbox`: `{date, code | null, editedAt, source?}` keyed by `date` (a newer edit to the same
  date replaces the queued one). `source` is `'sheet'` (the date sheet), `'import'` (an import's
  Save) or `'restore'` (the re-send after a server reset); rows queued before SIM-45 have none.
- `events`: `{id, date, text, createdAt, editedAt, rev}` keyed by `id`, indexed by `date`. Live
  events only: removing an event deletes its row and queues a tombstone in `eventOutbox`, and a
  pulled tombstone deletes the row.
- `eventOutbox`: `{id, date, text, deleted, createdAt, editedAt}` keyed by `id`.
- `babysitters`: `{date, name, confirmed, editedAt, rev}` keyed by `date`; `name: ''` is no
  babysitter, and `confirmed: false` is tentative.
- `babysitterOutbox`: `{date, name, confirmed, editedAt}` keyed by `date`.
- `shiftChanges`: `{rev, date, from: code | null, to: code | null, source: 'sheet' | 'import' |
  null, editedAt}` keyed by `rev`, indexed by `editedAt`: the server's shift changes, pulled
  like any other row and written only by the sync engine.
- `meta`: `{key: 'lastRev', value}` and `{key: 'dbId', value}`.

Dexie version 2 added the four event and babysitter tables and stripped `note` from existing
`shifts` and `outbox` rows. Dexie version 3 has no index changes; its upgrade sets
`confirmed: false` on every `babysitters` and `babysitterOutbox` row. Dexie version 4 adds
`shiftChanges` and needs no upgrade. The UI reaches them through `apps/web/src/dates/repo.ts`, whose
`saveDate` writes a date's code, babysitter and events with one `editedAt` in one transaction.
Event ids come from `crypto.randomUUID()`, or `crypto.getRandomValues` over plain HTTP where
`randomUUID` is missing.

### Shift codes

Defined once per side (`apps/server/internal/store/codes.go`, `apps/web/src/shifts/codes.ts`):

| Code | Label | Colour token |
|---|---|---|
| D | Day | amber |
| E | Early | sky |
| L | Late | violet |
| N | Night | indigo |
| X | Day off | neutral / muted |
| any other 1–2 letters | Other (the code itself is shown, e.g. `SE`) | lime |

A shift code must match `^[A-Z]{1,2}$`; the five above are the standard codes and anything else
that matches is an Other code (see `CONTEXT.md`). The client uppercases what the user types; the
server rejects any code that doesn't match (lowercase, digits, three or more letters) with `400`. Shifts have no times; see `docs/adr/0002-shifts-are-codes-not-times.md`.

## Sync protocol

Single endpoint, one round trip:

`POST /api/sync`

```json
{ "since": 41,
  "changes": [ { "date": "2026-11-03", "code": "L", "editedAt": 1760500000000, "source": "sheet" },
               { "date": "2026-11-04", "code": null, "editedAt": 1760500001000 } ],
  "events": [ { "id": "0b6f3e1c-2f4a-4c1d-9e8b-1a2b3c4d5e6f", "date": "2026-11-03",
                "text": "Dentist 3pm", "deleted": false,
                "createdAt": 1760400000000, "editedAt": 1760500002000 } ],
  "babysitters": [ { "date": "2026-11-03", "name": "Mum", "confirmed": true,
                     "editedAt": 1760500003000 } ] }
```

`events` and `babysitters` are optional (absent means none). A change's `source` is optional:
`"sheet"`, `"import"` or `"restore"`, stored as unknown (NULL) when absent. A babysitter's `confirmed` is an
optional boolean, `false` (tentative) when absent. A `note` in a change, sent by an older cached
client, is ignored. Clients always send `confirmed: false` with `name: ""`; the server stores
whatever it is sent.

Response:

```json
{ "rev": 44, "dbId": "9f2c4e…",
  "shifts": [ { "date": "2026-11-03", "code": "L", "editedAt": 1760500000000, "rev": 42 }, ... ],
  "events": [ { "id": "0b6f3e1c-…", "date": "2026-11-03", "text": "Dentist 3pm", "deleted": false,
                "createdAt": 1760400000000, "editedAt": 1760500002000, "rev": 43 }, ... ],
  "babysitters": [ { "date": "2026-11-03", "name": "Mum", "confirmed": true,
                     "editedAt": 1760500003000, "rev": 44 }, ... ],
  "shiftChanges": [ { "rev": 42, "date": "2026-11-03", "from": "E", "to": "L", "source": "sheet",
                      "editedAt": 1760500000000 }, ... ] }
```

`shifts`, `events`, `babysitters` and `shiftChanges` are always present, `[]` when empty, and
every babysitter carries `confirmed`. A shift change's `from` and `to` are a code or `null`, and
its `source` is `"sheet"`, `"import"` or `null` (unknown).

Server rules, all in one transaction:

1. For each item, keyed by date (shifts, babysitters) or id (events): if no row exists or
   `item.editedAt >= row.edited_at`, write it with `rev = ++meta.rev`. Otherwise ignore it (an
   older edit lost to a newer one). The three kinds share the one `meta.rev` counter and are
   applied independently, so an event or babysitter edit never overwrites a shift edit.
2. A shift write that changes the date's code (the date had no row, or the stored code differs,
   `null` included) also inserts a `shift_changes` row under the write's `rev`, with the stored
   code as `from_code`, unless its `source` is `"restore"`. A shift edit that loses
   last-write-wins, or keeps the code, records nothing (ADR 0004).
3. Return every row of each kind with `rev > since`, every shift change with `rev > since`, the
   current `meta.rev`, and `meta.db_id` (a random ID generated when the database is created). If
   `since > meta.rev`, the database has been wiped or restored from a backup, so return every row.

An event is deleted by sending it with `deleted: true` (its `text` may be `""`). The server keeps
the row as a tombstone so the deletion reaches other devices; tombstones are never purged.

Validation happens before anything is written, and a request with any invalid item applies none
of them (`400 {"error": …}`): `since` ≥ 0; at most 1000 items across `changes`, `events` and
`babysitters`; every `date` is `YYYY-MM-DD`; `code` is `null` or matches `^[A-Z]{1,2}$`; an event
`id` is a canonical lowercase UUID; a babysitter's `confirmed`, if present, is a boolean; `text`
is at most 200 characters and `name` at most 40
(Unicode code points; the client trims them, the server only checks length); `createdAt` and
`editedAt` > 0; a change's `source`, if present, is `sheet`, `import` or `restore`
(`changes[i]: source must be sheet, import or restore`). Without a valid session the call
returns `401`.

Client rules:

- After any local edit: write the table and its outbox (`shifts`/`outbox`, `events`/`eventOutbox`
  or `babysitters`/`babysitterOutbox`) in one Dexie transaction, then trigger sync. A shift
  edit's outbox row carries its source: `saveDate` writes `"sheet"`, and the import's
  `setShifts` writes `"import"`. The engine sends `source` when the row has one.
- Sync triggers: app start, `online` event, page becoming visible, after each local edit, and
  every 60s while visible and online. Only one sync runs at a time; a trigger during a run
  schedules one follow-up run.
- On success: delete the outbox entries that were sent (only if not replaced since), upsert
  returned shifts, events and babysitters **unless** the matching outbox holds a newer local edit
  for that date or id, put every returned shift change into `shiftChanges` (keyed by `rev`), set
  `lastRev`.
- The outboxes are sent together in batches of at most 1000 items in total (the server's limit);
  a run keeps sending until every outbox is empty or a request fails.
- Network failure (the server can't be reached, including on mobile data away from the home
  network): keep everything, show `offline`, retry on the next trigger. `401`: show the sign-in
  banner. Any other non-2xx response: show `error`.
- **Server reset**: if the response's `dbId` differs from the stored one, or its `rev` is lower
  than the `since` sent, the server has lost data. The client copies every local shift with a code, every
  live event and every babysitter with a name into its outbox with its existing `editedAt`
  (leaving newer outbox entries alone, including pending tombstones; re-queued shifts carry
  `source: "restore"`, so the new server records no shift change for them), empties
  `shiftChanges` (the old server's revs are void), sets `lastRev` to 0 and runs again, so the phone's copy restores the server. With two devices, each re-sends its
  copy and last-write-wins settles each date. On the first sync (no stored `dbId`) the client
  just stores it.
- The UI never writes `code: null`: a shift is removed by setting it to Day off (`X`), so a date
  never returns to unrostered. The protocol still accepts and returns `null` (a reserved
  tombstone for a future "remove shift" or data fix); clients render such a row as an
  unrostered date. The date's events and babysitter are separate records and stay.

Conflict policy is last-write-wins on `editedAt` (the phone's clock). With one user this is enough
for one device or a few: each device pulls the others' edits by `rev`, and a clash on a date goes
to the later edit. See `docs/adr/0001-offline-first-last-write-wins.md`.

## Roster extraction

`POST /api/extract` (session required) — `multipart/form-data` with field `image` (JPEG/PNG/WebP,
≤ 5 MB). The type is sniffed from the bytes: a larger image is `413`, any other type `415`, a
missing field `400`.

- The client downsizes before upload: long edge ≤ 2000 px, JPEG quality 0.9.
- The server sends the image (base64) to the Anthropic Messages API in one call with the official
  Go SDK (`github.com/anthropics/anthropic-sdk-go`), with one retry on an overloaded or transient
  error. The answer is constrained by structured outputs (`output_config.format`, a JSON schema)
  to this shape, which is also the response body:

```json
{ "personFound": true,
  "shifts": [ { "date": "2026-11-03", "code": "L", "rawCode": "L", "uncertain": false } ],
  "warnings": [ "Week of 10 Nov is partly obscured" ] }
```

  Structured outputs replaces a forced tool call: `claude-sonnet-5-5` and other current models
  reject `tool_choice` of type `tool` with a 400.
- The system prompt (`extract.BuildPrompt`) includes: `ROSTER_NAME`, today's date in `TZ` (for
  inferring missing years), the five standard codes with meanings, to read only that person's row
  and set `personFound: false` when the name is absent, that a shift belongs to the date it starts
  on (a Night shift running past midnight is dated by its start, as rosters print it), and the cell
  rules in order: map synonyms first ("OFF", "RDO", "/", blank-but-marked-off → `X`; "AM" → `E`;
  "PM" → `L`); then return any other cell of one or two letters as an Other code (uppercased, e.g.
  "se" → `SE`); and set `code: null` with the original text in `rawCode` only when a cell can't be
  a code (longer than two letters or not letters, e.g. "A/L"). Low-confidence reads are marked
  `uncertain`.
- The server validates the answer (`extract.Validate`): an entry with an invalid date, a code not
  matching `^[A-Z]{1,2}$` (after uppercasing), or a null code with no `rawCode` is dropped with a
  warning, as is every reading of a date after the first. It returns `200` with the validated
  payload.
- A failed call, a refusal, a cut-off or unparseable answer, or the 90s timeout → `502
  {"error":"extraction failed: <short reason>"}`; the reason never includes the API key or the
  upstream body. Each call logs the model, input and output tokens and duration. A reverse proxy
  in front of the app needs a read timeout above 90s (nginx defaults to 60s).
- Nothing is stored. The image is not kept.

### Review and apply (client)

1. Import screen: pick or take a photo → "Extracting…" → review list.
2. The review list shows each proposed date with: the existing shift (from IndexedDB), the
   proposed code, and a marker for new / changed / same / uncertain / unmapped.
3. Each row has a checkbox (default checked for new and changed; unmapped rows default
   unchecked and need a code picked to be included) and a code picker (the five standard codes
   plus Other).
4. "Save N shifts" writes the selected rows as ordinary local edits (`editedAt = now`), which
   go through the outbox and sync like any other edit.
5. Import requires reaching the server: on opening, the screen calls `GET /api/health` (5s
   timeout) and shows an "Import needs a connection" state if that fails or the phone is offline.

## Roster email recipients

Mounted only when email is on (`RESEND_API_KEY` set); otherwise both routes are the usual
`/api/` 404. Both need a session. The client calls them directly, online only (ADR 0005).

- `GET /api/recipients` → `200 {"recipients": [{"email", "babysitter"}], "lastSend": {"at", "ok",
  "recipients"} | null}`. `recipients` is in list order; `lastSend` is the newest
  `roster_email_sends` row (`at` in unix ms, `recipients` the number reached), `null` before the
  first send.
- `PUT /api/recipients` with `{"recipients": [{"email", "babysitter"}]}` replaces the whole list
  in one transaction and answers like `GET`. Body limit 64 KiB. Each email is trimmed and
  lowercased, each babysitter trimmed (`""` = none). The first problem is a `400 {"error"}` and
  changes nothing:
  - more than 10 → `at most 10 recipients`;
  - an email over 254 characters, or one that `net/mail.ParseAddress` does not return unchanged
    with no display name → `recipients[i]: email must be an address like nan@example.com`;
  - an email already earlier in the list → `recipients[i]: email is already on the list`;
  - a babysitter over 40 characters → `recipients[i]: babysitter must be at most 40 characters`.

## Roster email

The email a recipient gets after an import (`docs/ux-spec.md` §6.8; ADR 0005 for why it is
rendered at build time). Sending comes with SIM-56.

**Template pipeline.** `apps/email/src/RosterEmail.tsx` builds the HTML from React Email
components (tables, inline styles, light colours, `color-scheme: light` metas, a 560 px card,
system fonts). Its dynamic parts are Go `html/template` actions written as literal text
(`{{.Subject}}`, `{{range .Weeks}}`, …). `pnpm --filter ./apps/email render` renders it with
`@react-email/render` (`pretty: false`) to `apps/server/internal/mail/templates/roster.html.tmpl`,
which is committed and embedded with `//go:embed`; the package's Vitest fails while the committed
file differs from a fresh render. React escapes quotes, so the actions hold no string literals:
Go precomputes every value, colours included, and each style hole is a whole CSS property value
so `html/template` accepts it. The plain-text part is the hand-written `text/template`
`templates/roster.txt.tmpl`: subject, range and summary, then one line per date
(`Mon 26 Oct  N  Night`, `Fri 20 Nov  –  Not rostered`) under each week's title. The Docker web
stage installs only `apps/web`, so React Email never reaches the image.

**View model** (`internal/mail`):

- `BuildRosterEmail(first, last string, shifts map[string]string, today time.Time) RosterEmail`
  takes a Monday and a Sunday (`YYYY-MM-DD`) and the codes by date (missing or `""` =
  unrostered), and returns `{Subject, Preheader, Range, Summary, Weeks}`.
  - `Subject` "New roster: 26 Oct – 22 Nov", the year after the last date only when it isn't
    `today`'s year; `Preheader` "{n} working shifts, 26 Oct – 22 Nov" (same year rule).
  - `Range` "Mon 26 Oct – Sun 22 Nov 2026" (always the last date's year, and the first date's
    too when they differ).
  - `Summary` "{n} working shifts over {w} weeks.": "1 working shift", "one week" … "ten weeks",
    then digits.
  - `Weeks[]` `{Title: "Week of Mon 26 Oct", Rows[]}`, each row `{Date, Code, Label, ChipBg,
    ChipFg, ChipLine, LabelFg, LabelWeight, DateFg, RowBg, RowLine}`. Chip colours come from the
    table in `internal/mail/build.go` keyed by `store.StandardCodes`; any other code uses the
    Other colours and its letters as the label; an unrostered date is "–" / "Not rostered".
- `Render(e RosterEmail) (html, text string, err error)` fills both templates.

## UI

Screen layouts, states, visual tokens and copy are specified in `docs/ux-spec.md`.

Dark mode only (`<html class="dark">`, dark palette baked into Tailwind theme, `color-scheme: dark`,
`theme-color` matching). Designed for a 360–430 px wide portrait phone; usable but not tuned on
desktop.

- **Login**: username, password, submit, error message.
- **Calendar** (home, `/`):
  - Header: sync status dot (synced / pending N / offline / sign-in needed), Import button.
  - Month grid: the months stacked in one vertical scroll, from the month before the one it
    opens on and with no end ahead, each Monday-first with its own
    title and only its own dates, under a bar naming the month at the top and a "Today" jump. Each date
    shows its shift code in a coloured chip and a caption with its first event's text and "+n" for
    the rest; today is outlined; a babysitter avatar on the chip's top-right corner shows a
    needs-a-babysitter dot, or the babysitter's initials, dashed while tentative and filled once
    confirmed; a swap badge on its bottom-left marks a swapped shift, one whose code differs from
    the latest import's, worked out on the phone from the synced shift changes and the pending
    import edits (`docs/ux-spec.md` §5.3, §5.10, §5.11).
  - Tapping a date opens the **date sheet**: five standard code buttons plus "Other"
    (a two-letter input), the babysitter picker with its Confirmed switch and the date's events,
    Save/Cancel. There is no
    note field and no "Clear"; choosing Day off (`X`) is how a shift is removed.
- **Import**: as described above.
- **Babysitters** (`/babysitters`, from the header's ⋯ menu): the Share card over the share
  window, the dates that need a babysitter, then one section per babysitter with its upcoming
  dates and Confirm all; tapping a date opens the date sheet (`docs/ux-spec.md` §6.5).
- **History** (`/history`, from the ⋯ menu): the pending shift edits under "Not synced yet",
  then every shift change, one group per save (equal `editedAt` and source), newest first, each
  row the date with the code it had and the code it got; tapping a row opens the date sheet
  (`docs/ux-spec.md` §6.6). Only shift codes have history.

## PWA

- `vite-plugin-pwa` with a generated service worker that precaches the built shell (including
  the bundled `woff2` fonts) and serves `index.html` for navigations offline. It never handles
  `/api/`. Only `vite build` generates it; `make dev` runs without one.
- The Go server sends `Cache-Control: no-cache` for every unhashed file (`index.html`, `sw.js`,
  `registerSW.js`, `manifest.webmanifest`, icons) so a new build is picked up, and a year,
  `immutable`, for the content-hashed files under `assets/`.
- Manifest: name "Roster Mate", `display: standalone`, `orientation: portrait`, dark
  `background_color`/`theme_color`, 192/512 px and maskable icons.
- Service workers need a secure context. The app must be reached over HTTPS (e.g. the user's
  existing reverse proxy with a certificate the phone trusts) for install and offline to work.
  Over plain HTTP the app still works online.

## Testing

- Go: `go test ./...`; store and handler tests against a temp-dir SQLite file and `httptest`.
  The extraction client is behind an interface so handler tests use a fake.
- Fake Claude: `internal/extract/fakeanthropic` is the one fake of the Messages API. It accepts
  one API key (401 otherwise, in the API's error shape), records each request's method, path,
  image count and body, and answers with `roster.json`: 5 shifts on 8–12 Dec 2026 coded D, E,
  N, X and SE. `Down` (529), `Slow`, `StopReason`/`Text` and `Set` change its answer mid-test.
  The extraction client tests and the app tests in `cmd/roster-mate` (booted through `run()`
  with `ANTHROPIC_BASE_URL`) use it, and `go run ./apps/server/cmd/fake-anthropic` serves it for
  the browser suite on `FAKE_ANTHROPIC_ADDR` (default `127.0.0.1:18081`) with key
  `FAKE_ANTHROPIC_KEY` (default `sk-ant-e2e`), plus `GET /health`.
- Web: Vitest + Testing Library; `fake-indexeddb` for Dexie and sync-engine tests with a mocked
  `fetch`.
- Browser (e2e): Playwright in `test/e2e`, one `ui` project on a Pixel 7 viewport in Chromium,
  run one test at a time (`workers: 1`) because they share one server. `make e2e` builds the web
  app and `bin/roster-mate`, then the config's `webServer` starts the fake Claude on
  `127.0.0.1:18081` and the binary on `127.0.0.1:18080` with `APP_TEST_MODE=1`, credentials
  `e2e`/`e2e-password`, `ROSTER_NAME=E2E`, `ANTHROPIC_BASE_URL` at the fake, `TZ` and the
  browsers' time zone `Australia/Sydney`, and a fresh `DATA_DIR` under the OS temp dir. An auto
  fixture calls `POST /api/test/reset` before each test and starts the browser clock at
  2026-12-07 09:00 (not frozen), and each test has a fresh context, so empty IndexedDB. The specs
  cover the main user paths no lower layer sees: signing in (wrong password, then right) and
  signing out through the pending-edits confirmation; saving a date's shift, babysitter and
  event and seeing them on a second phone (a second context, so whatever it shows came through
  the server); an offline edit kept while offline after a reload from the service worker's
  precache and sent once back online; and importing the fake's roster, unticking one row and
  saving the rest. Left to lower layers on purpose: last-write-wins conflicts, the server-reset
  re-send, extraction errors and the import error screens, session expiry, a desktop viewport,
  other browsers, and Lighthouse and PWA install checks.
- Smoke: the sign-in, date and offline tests are tagged `@smoke`. With `APP_TEST_URL` set, the
  suite starts nothing, skips the reset and tests that URL; `make e2e-smoke` aims them at
  `http://localhost:8080` (credentials from `APP_TEST_USERNAME`/`APP_TEST_PASSWORD`). They use
  dates no other test touches (14, 15 and 16 Dec 2026), never call extraction, and pass on a
  server that already holds their own data from an earlier run: since every run's clock starts
  at the same instant, a re-run's shift edit loses last-write-wins, so each also adds an event
  and checks the second phone against the first phone's cell rather than a fixed count.
- `make test` runs the Go and web tests and type-checks the e2e specs; `make build` builds the
  image; `docker run` with `.env.example` values serves the app.
- CI (`.github/workflows/ci.yml`): `checks` (gofmt, `make test`), `e2e` (`make e2e`, Chromium
  cached on the Playwright version) and `smoke` run in parallel. `smoke` builds the amd64 image,
  runs it on a named volume with the e2e credentials, runs `make e2e-smoke` against it and fails
  if `docker logs` contains the password or API key. `publish` needs all three.

## Delivery order

1. Scaffold and container
2. Authentication
3. Shift storage and sync API
4. Offline store, sync engine and PWA shell
5. Calendar view
6. Shift editing
7. Roster extraction API
8. Import and review UI
