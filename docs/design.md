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
  internal/config       env loading + validation
  internal/auth         login, sessions, middleware
  internal/store        SQLite open, migrations, shift queries
  internal/api          HTTP handlers (sync, extract, session)
  internal/extract      Anthropic client + prompt + response parsing
  internal/web          serves the built frontend + SPA fallback
/apps/web               Vite + React + TypeScript + Tailwind app
  embed.go              package web: embeds dist/ (dist/.gitkeep committed)
  src/db                Dexie schema
  src/sync              sync engine
  src/shifts            shift codes, labels, colours (mirrors server)
  src/routes            Login, Calendar, Import
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

The server refuses to start, with a message naming the variable, if a required one is missing.

## Authentication

- `POST /api/login` `{username, password}` → `204` and a `rm_session` cookie, or `401`.
- `POST /api/logout` → `204`, clears the cookie.
- `GET /api/session` → `200 {username}` or `401`.
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
  rev        INTEGER NOT NULL
);
CREATE INDEX babysitters_rev ON babysitters(rev);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);  -- 'rev', 'db_id', 'session_secret', 'schema_version'
```

Migrations are ordered SQL files embedded in the binary and applied at startup. Migration 0003
added `events` and `babysitters` and dropped the shift `note` column; existing notes were not
carried over. Events and babysitters are records of their own, not fields on a shift; see
`docs/adr/0003-events-and-babysitters-sync-separately.md`.

### Client (Dexie / IndexedDB)

- `shifts`: `{date, code | null, editedAt, rev}` keyed by `date`.
- `outbox`: `{date, code | null, editedAt}` keyed by `date` (a newer edit to the same date
  replaces the queued one).
- `events`: `{id, date, text, createdAt, editedAt, rev}` keyed by `id`, indexed by `date`. Live
  events only: removing an event deletes its row and queues a tombstone in `eventOutbox`, and a
  pulled tombstone deletes the row.
- `eventOutbox`: `{id, date, text, deleted, createdAt, editedAt}` keyed by `id`.
- `babysitters`: `{date, name, editedAt, rev}` keyed by `date`; `name: ''` is no babysitter.
- `babysitterOutbox`: `{date, name, editedAt}` keyed by `date`.
- `meta`: `{key: 'lastRev', value}` and `{key: 'dbId', value}`.

Dexie version 2 added the four event and babysitter tables and stripped `note` from existing
`shifts` and `outbox` rows. The UI reaches them through `apps/web/src/dates/repo.ts`, whose
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
  "changes": [ { "date": "2026-11-03", "code": "L", "editedAt": 1760500000000 },
               { "date": "2026-11-04", "code": null, "editedAt": 1760500001000 } ],
  "events": [ { "id": "0b6f3e1c-2f4a-4c1d-9e8b-1a2b3c4d5e6f", "date": "2026-11-03",
                "text": "Dentist 3pm", "deleted": false,
                "createdAt": 1760400000000, "editedAt": 1760500002000 } ],
  "babysitters": [ { "date": "2026-11-03", "name": "Mum", "editedAt": 1760500003000 } ] }
```

`events` and `babysitters` are optional (absent means none). A `note` in a change, sent by an
older cached client, is ignored.

Response:

```json
{ "rev": 44, "dbId": "9f2c4e…",
  "shifts": [ { "date": "2026-11-03", "code": "L", "editedAt": 1760500000000, "rev": 42 }, ... ],
  "events": [ { "id": "0b6f3e1c-…", "date": "2026-11-03", "text": "Dentist 3pm", "deleted": false,
                "createdAt": 1760400000000, "editedAt": 1760500002000, "rev": 43 }, ... ],
  "babysitters": [ { "date": "2026-11-03", "name": "Mum", "editedAt": 1760500003000, "rev": 44 }, ... ] }
```

`shifts`, `events` and `babysitters` are always present, `[]` when empty.

Server rules, all in one transaction:

1. For each item, keyed by date (shifts, babysitters) or id (events): if no row exists or
   `item.editedAt >= row.edited_at`, write it with `rev = ++meta.rev`. Otherwise ignore it (an
   older edit lost to a newer one). The three kinds share the one `meta.rev` counter and are
   applied independently, so an event or babysitter edit never overwrites a shift edit.
2. Return every row of each kind with `rev > since`, the current `meta.rev`, and `meta.db_id` (a
   random ID generated when the database is created). If `since > meta.rev`, the database has
   been wiped or restored from a backup, so return every row.

An event is deleted by sending it with `deleted: true` (its `text` may be `""`). The server keeps
the row as a tombstone so the deletion reaches other devices; tombstones are never purged.

Validation happens before anything is written, and a request with any invalid item applies none
of them (`400 {"error": …}`): `since` ≥ 0; at most 1000 items across `changes`, `events` and
`babysitters`; every `date` is `YYYY-MM-DD`; `code` is `null` or matches `^[A-Z]{1,2}$`; an event
`id` is a canonical lowercase UUID; `text` is at most 200 characters and `name` at most 40
(Unicode code points; the client trims them, the server only checks length); `createdAt` and
`editedAt` > 0. Without a valid session the call returns `401`.

Client rules:

- After any local edit: write the table and its outbox (`shifts`/`outbox`, `events`/`eventOutbox`
  or `babysitters`/`babysitterOutbox`) in one Dexie transaction, then trigger sync.
- Sync triggers: app start, `online` event, page becoming visible, after each local edit, and
  every 60s while visible and online. Only one sync runs at a time; a trigger during a run
  schedules one follow-up run.
- On success: delete the outbox entries that were sent (only if not replaced since), upsert
  returned shifts, events and babysitters **unless** the matching outbox holds a newer local edit
  for that date or id, set `lastRev`.
- The outboxes are sent together in batches of at most 1000 items in total (the server's limit);
  a run keeps sending until every outbox is empty or a request fails.
- Network failure (the server can't be reached, including on mobile data away from the home
  network): keep everything, show `offline`, retry on the next trigger. `401`: show the sign-in
  banner. Any other non-2xx response: show `error`.
- **Server reset**: if the response's `dbId` differs from the stored one, or its `rev` is lower
  than the `since` sent, the server has lost data. The client copies every local shift with a code, every
  live event and every babysitter with a name into its outbox with its existing `editedAt`
  (leaving newer outbox entries alone, including pending tombstones), sets `lastRev` to 0
  and runs again, so the phone's copy restores the server. With two devices, each re-sends its
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

## UI

Screen layouts, states, visual tokens and copy are specified in `docs/ux-spec.md`.

Dark mode only (`<html class="dark">`, dark palette baked into Tailwind theme, `color-scheme: dark`,
`theme-color` matching). Designed for a 360–430 px wide portrait phone; usable but not tuned on
desktop.

- **Login**: username, password, submit, error message.
- **Calendar** (home, `/`):
  - Header: next upcoming shift ("Tomorrow · Late"), sync status dot (synced / pending N /
    offline / sign-in needed), Import button.
  - Month grid, Monday-first, with previous/next month controls and a "Today" jump. Each date
    shows its shift code in a coloured chip and one dot per event (at most 4); today is outlined;
    a date that needs a babysitter has a dashed `warn` border (`docs/ux-spec.md` §6.2).
  - Tapping a date opens the **date sheet**: five standard code buttons plus "Other"
    (a two-letter input), the babysitter picker and the date's events, Save/Cancel. There is no
    note field and no "Clear"; choosing Day off (`X`) is how a shift is removed.
- **Import**: as described above.

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
- Web: Vitest + Testing Library; `fake-indexeddb` for Dexie and sync-engine tests with a mocked
  `fetch`.
- `make test` runs both; `make build` builds the image; `docker run` with `.env.example` values
  serves the app.

## Delivery order

1. Scaffold and container
2. Authentication
3. Shift storage and sync API
4. Offline store, sync engine and PWA shell
5. Calendar view
6. Shift editing
7. Roster extraction API
8. Import and review UI
