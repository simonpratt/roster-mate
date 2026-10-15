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
| **Outbox** | Client-side store of pending edits, one per date, removed once the server has acknowledged them. |
| **Revision (`rev`)** | Server-wide, monotonically increasing integer stamped on every shift write. Clients pull "everything since rev N". |

## Architecture

```
 phone (PWA)                                   homelab: one Docker container
 ┌───────────────────────────┐                 ┌─────────────────────────────────┐
 │ React + Tailwind UI       │                 │ Go binary                        │
 │   ↕                       │   HTTPS (via    │  ├─ /            embedded web    │
 │ Dexie (IndexedDB)         │   user's TLS    │  ├─ /api/login, /api/session ... │
 │   shifts + outbox + meta  │   reverse proxy)│  ├─ /api/sync     shifts         │
 │   ↕ sync engine  ─────────┼────────────────►│  └─ /api/extract  → Anthropic API│
 │ Service worker (shell)    │                 │ SQLite file in /data             │
 └───────────────────────────┘                 └─────────────────────────────────┘
```

- **The UI reads and writes only IndexedDB.** The sync engine moves data between IndexedDB and
  the server. The service worker only precaches the app shell; it never caches API responses.
- **One container**: a multi-stage Dockerfile builds the web app, embeds `web/dist` into the
  Go binary with `embed.FS`, and ships a static binary. SQLite via `modernc.org/sqlite`
  (pure Go, no CGO).

### Repository layout

```
/server            Go module (cmd/roster-mate/main.go, internal/...)
  internal/config  env loading + validation
  internal/auth    login, sessions, middleware
  internal/store   SQLite open, migrations, shift queries
  internal/api     HTTP handlers (sync, extract, session)
  internal/extract Anthropic client + prompt + response parsing
  internal/web     embed of the built frontend + SPA fallback
/web               Vite + React + TypeScript + Tailwind app
  src/db           Dexie schema
  src/sync         sync engine
  src/shifts       shift codes, labels, colours (mirrors server)
  src/routes       Login, Calendar, Import
/docs              design docs
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
  90-day lifetime refreshed on any authenticated request. `Secure` is set when the request
  arrived over TLS or with `X-Forwarded-Proto: https`.
- Every `/api/*` route except login and `/api/health` requires a valid cookie; otherwise `401`.
- Failed logins sleep 1s before responding (crude brute-force damping; LAN only).
- Static assets are served without auth so the shell loads offline; the client checks
  `/api/session` when online and shows the login screen on `401`.
- Offline, the client trusts its cached data and does not require a session. A `401` during
  sync shows a "Sign in to sync" banner; local data and the outbox are kept.

## Data model

### Server (SQLite)

```sql
CREATE TABLE shifts (
  date       TEXT PRIMARY KEY,        -- 'YYYY-MM-DD', a local calendar date
  code       TEXT,                    -- 1-2 uppercase letters; NULL is reserved (see Sync protocol)
  note       TEXT NOT NULL DEFAULT '',
  edited_at  INTEGER NOT NULL,        -- client edit time, unix ms (last-write-wins key)
  rev        INTEGER NOT NULL         -- server revision of the last applied write
);
CREATE INDEX shifts_rev ON shifts(rev);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);  -- 'rev', 'session_secret', 'schema_version'
```

Migrations are ordered SQL files embedded in the binary and applied at startup.

### Client (Dexie / IndexedDB)

- `shifts`: `{date, code | null, note, editedAt, rev}` keyed by `date`.
- `outbox`: `{date, code | null, note, editedAt}` keyed by `date` (a newer edit to the same date
  replaces the queued one).
- `meta`: `{key: 'lastRev', value}`.

### Shift codes

Defined once per side (`server/internal/store/codes.go`, `web/src/shifts/codes.ts`):

| Code | Label | Colour token |
|---|---|---|
| D | Day | amber |
| E | Early | sky |
| L | Late | violet |
| N | Night | indigo |
| X | Day off | neutral / muted |
| any other 1–2 letters | Other (the code itself is shown, e.g. `SE`) | teal |

A shift code must match `^[A-Z]{1,2}$`; the five above are the standard codes and anything else
that matches is an Other code (see `CONTEXT.md`). The client uppercases what the user types; the
server rejects any code that doesn't match (lowercase, digits, three or more letters) with `400`. Shifts have no times; see `docs/adr/0002-shifts-are-codes-not-times.md`.

## Sync protocol

Single endpoint, one round trip:

`POST /api/sync`

```json
{ "since": 41,
  "changes": [ { "date": "2026-11-03", "code": "L", "note": "swapped with Sam", "editedAt": 1760500000000 },
               { "date": "2026-11-04", "code": null, "note": "", "editedAt": 1760500001000 } ] }
```

Response:

```json
{ "rev": 44,
  "shifts": [ { "date": "2026-11-03", "code": "L", "note": "swapped with Sam", "editedAt": 1760500000000, "rev": 43 }, ... ] }
```

Server rules, all in one transaction:

1. For each change, if no row exists or `change.editedAt >= row.edited_at`, write it with
   `rev = ++meta.rev`. Otherwise ignore it (an older edit lost to a newer one).
2. Return every row with `rev > since` and the current `meta.rev`.

Client rules:

- After any local edit: write `shifts` and `outbox` in one Dexie transaction, then trigger sync.
- Sync triggers: app start, `online` event, page becoming visible, after each local edit, and
  every 60s while visible and online. Only one sync runs at a time; a trigger during a run
  schedules one follow-up run.
- On success: delete the outbox entries that were sent (only if not replaced since), upsert
  returned shifts **unless** the outbox holds a newer local edit for that date, set `lastRev`.
- Network failure: keep everything, retry on the next trigger. `401`: show the sign-in banner.
- The UI never writes `code: null`: a shift is removed by setting it to Day off (`X`), so a date
  never returns to unrostered. The protocol still accepts and returns `null` (a reserved
  tombstone for a future "remove shift" or data fix); clients render such a row as an
  unrostered date and drop its note.

Conflict policy is last-write-wins on `editedAt` (the phone's clock). With one user and usually
one device, this is enough. See `docs/adr/0001-offline-first-last-write-wins.md`.

## Roster extraction

`POST /api/extract` — `multipart/form-data` with field `image` (JPEG/PNG/WebP, ≤ 5 MB).

- The client downsizes before upload: long edge ≤ 2000 px, JPEG quality 0.9.
- The server sends the image to the Anthropic Messages API with the official Go SDK
  (`github.com/anthropics/anthropic-sdk-go`), forcing a single tool call whose input schema is:

```json
{ "personFound": true,
  "shifts": [ { "date": "2026-11-03", "code": "L", "rawCode": "L", "uncertain": false } ],
  "warnings": [ "Week of 10 Nov is partly obscured" ] }
```

- The prompt includes: `ROSTER_NAME`, today's date (for inferring missing years), the five
  standard codes with meanings, that a shift belongs to the date it starts on (a Night shift running
  past midnight is dated by its start, as rosters print it), and instructions to map synonyms
  (e.g. "OFF", "RDO" → `X`), to set
  return any other cell text of one or two letters as an Other code (uppercased, e.g. "se" →
  `SE`), to set `code: null` with the original text in `rawCode` only when a cell can't be a code
  (longer than two letters or not letters, e.g. "A/L"), and to mark
  low-confidence reads `uncertain`.
- The server validates dates and codes (`^[A-Z]{1,2}$` or null), drops malformed entries into `warnings`, and returns
  `200` with the validated payload. Anthropic errors → `502` with a short message; timeout 90s.
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
5. Import requires being online; the screen shows an "Import needs a connection" state offline.

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
    shows its shift code in a coloured chip; today is outlined; shifts with notes show a dot.
  - Tapping a date opens the **edit sheet**: five standard code buttons plus "Other"
    (a two-letter input), a note field, Save/Cancel. There
    is no "Clear"; choosing Day off (`X`) is how a shift is removed.
- **Import**: as described above.

## PWA

- `vite-plugin-pwa` with a generated service worker that precaches the built shell and
  serves `index.html` for navigations offline.
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
