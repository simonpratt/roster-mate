# Roster Mate

A self-hosted, single-user, mobile-first PWA holding one shift worker's shifts: Claude reads them from a roster photo, the user reviews and saves them, and the phone keeps working offline. A Go server with SQLite serves an embedded React/Tailwind client that stores shifts in Dexie, all in one Docker image on the LAN-only homelab. `docs/design.md` is the spec.

**Read `CONTEXT.md` before any work.** It is the domain glossary. Use its terms in code, API, UI copy, tests and tickets, and never the words listed under _Avoid_ ("Day" is a shift code, so a calendar date is a **Date**). Implementation-only terms (Outbox, `rev`) are in `docs/design.md` § Glossary. If a term is missing or no longer fits, raise it with the user rather than inventing one.

Before building significant new behaviour or a new feature, run the `/domain-modeling` skill: it sharpens the terms the work introduces in `CONTEXT.md` and records any hard-to-reverse decision as an ADR.

## Sources, and which one wins

- `docs/design.md`: architecture, configuration, auth, schema, sync protocol, extraction, PWA and testing.
- `docs/ux-spec.md`: screens, states, tokens and copy. §9 maps its sections to tickets; §10 lists small additions beyond the tickets (empty state, sign-out confirmation, …), each built with the ticket for its screen unless that ticket puts it out of scope.
- Linear tickets: what to build. A ticket's `## Spec` and acceptance criteria are its definition of done, and its **Designs** section names the artboards.
- `docs/designs/`: the design snapshot (see Design below).
- `docs/adr/`: decisions that are hard to reverse. Read them before changing offline sync and conflicts (0001) or the shape of a shift (0002).

When they disagree, `CONTEXT.md` wins on terms, the ticket wins on behaviour, `docs/designs/` wins on layout, colour, type and copy, and `docs/ux-spec.md` fills the gaps. Mention each disagreement you resolve in the ticket or the commit message.

## Tickets

Tickets are in Linear, project `roster-mate` (team SIM). `/linear-refine` and `/linear-implement` carry the status flow and commit format. For any other change, commit to `master` with the subject `SIM-<n>: <summary>` when it belongs to a ticket.

Done means every acceptance criterion is met. Automated criteria get their test in the same commit. Manual ones (on a phone, in devtools, Lighthouse) are checked, or reported as unchecked with the steps to check them.

`docs/design.md` holds the configuration table, schema, endpoints and sync protocol. Read it before changing any of them, and update it in the same commit.

## Commands

`make dev` (Go on :8080, Vite on :5173 proxying `/api`), `make test` (go vet, go test, tsc, Vitest) and `make build` (the Docker image); every environment variable is in `.env.example`. As each ticket lands, record here the commands and gotchas a look at the `Makefile` or `package.json` wouldn't reveal.

- **Layout**: one Go module at the root (`github.com/simonpratt/roster-mate`), the Go server in `apps/server/`, the React client in `apps/web/`, and a pnpm workspace at the root. Run `go` and `pnpm` from the root; `pnpm --filter ./apps/web <script>` runs a client script (the root `package.json` has shortcuts).
- **pnpm** runs through corepack at the version pinned by `packageManager` in the root `package.json` (`corepack enable` once). pnpm 12 needs corepack 0.36 or later; an older one (this sandbox has 0.24) fails with `Cannot find module …/bin/pnpm.cjs`. Where the home directory is on another filesystem from the repo (this sandbox), pnpm puts its store inside the repo (`node_modules/.pnpm-store/` or `.pnpm-store/`), which git and Docker ignore.
- **Embedded web app**: `apps/web/embed.go` embeds `apps/web/dist/`, and the server imports it. `dist/.gitkeep` is committed so a fresh clone compiles, and the Vite build writes it back after emptying `dist/`. Until `pnpm build` has run, `go build` and `make dev` embed only `.gitkeep`, and the Go server answers `/` with 503 "web app not built"; use the Vite port in development.
- **`make dev`** reads `.env` (else `.env.example`) line by line, not through the shell, so values may contain spaces unquoted, as Docker's `--env-file` expects. It overrides `DATA_DIR` with `DEV_DATA_DIR` (default `$TMPDIR/roster-mate-dev`).
- **Migrations** are `apps/server/internal/store/migrations/NNNN_name.sql`, applied in order at startup, each in a transaction with the `meta.schema_version` bump. Each change is a new file, leaving applied ones as they are.
- **SQLite** files belong in a temp dir (tests) or a `DATA_DIR` outside the repo. The repo sits on a host mount, where SQLite can report disk I/O or locking errors.
- **Web tests and IndexedDB**: `src/test-setup.ts` loads `fake-indexeddb`, and after each test waits for the sync engine to go idle and empties the Dexie tables. The app root starts a sync on mount, so a test's `fetch` stub must answer `/api/sync` (an unmatched path gets 404 from `stubFetch`) rather than hang, or the next test's cleanup times out.
- **`useLiveQuery`** keeps returning its previous answer while a query with new deps runs. Where a stale answer would be wrong (the import review's saved shifts), return the deps with the answer and ignore a mismatch, as `useShiftsOn` in `apps/web/src/shifts/repo.ts` does.
- **Import tests** mock `../lib/image` (jsdom has no canvas) and set `URL.createObjectURL`; choose a photo with `fireEvent.change` on the `input[type="file"]`.
- **Test mode**: `APP_TEST_MODE=1` mounts `POST /api/test/reset` (no session; empties shifts, shift changes, events, babysitters, recipients and roster email sends, keeps `meta`). Without it the path is a 404 when signed in, and 401 when not, because the session middleware runs first.
- **Roster email template**: `apps/email` (React Email) is rendered once into `apps/server/internal/mail/templates/roster.html.tmpl`, which is committed. After changing `apps/email`, run `pnpm --filter ./apps/email render` and commit the template; its Vitest fails while the template is stale. Template actions are literal text and hold no string literals (React escapes quotes), so Go precomputes every value. The Docker image installs only `apps/web` (`--filter ./apps/web...`). React Email's components now ship in the `react-email` package (`@react-email/components` is deprecated).
- **PWA**: the service worker exists only in a production build (`pnpm build`); `make dev` has none. The app icons in `apps/web/public/icons/` are generated by `node scripts/icons.mjs` (run from `apps/web/`).
- **Anthropic API**: tests use fakes. The extraction client sits behind an interface, and handler tests use a fake. Every test of the real client goes through the one shared fake Messages API, `internal/extract/fakeanthropic`: `extract` tests point the client at it with `option.WithBaseURL`, and app tests in `cmd/roster-mate` boot `run()` with `ANTHROPIC_BASE_URL` set to it. `go run ./apps/server/cmd/fake-anthropic` serves it on `127.0.0.1:18081` (key `sk-ant-e2e`) for the browser suite. Load the `/claude-api` skill before changing `apps/server/internal/extract`. Current models reject a forced `tool_choice`, so extraction uses structured outputs. The first `go test` or `go vet` after a fresh module download compiles the SDK and takes several minutes; run it in the background rather than under a short timeout.
- **Resend**: tests never reach Resend. `internal/mail/fakeresend` is the one fake (`Fail` makes an address answer 500); mail tests point `NewResend` at it, and app tests boot `run()` with `RESEND_BASE_URL` at it and shorten the 30 s send delay through the unexported `mailDelay`, not an env var. The e2e suite runs with email off.
- **E2E** (`test/e2e`, Playwright): install Chromium once with `pnpm --filter ./test/e2e exec playwright install chromium` (and, in a bare sandbox missing its shared libraries, `playwright install-deps chromium`). `make e2e` builds the web app and `bin/roster-mate` itself, then starts the fake Claude on :18081 and the binary in test mode on :18080; both ports must be free (`reuseExistingServer` is off). About 16 s with a warm Go cache; the first run after a fresh module download compiles the Anthropic SDK and takes minutes. One test: `pnpm --filter ./test/e2e exec playwright test -g "<name>"`. Each test gets a fresh browser context (empty IndexedDB) and a server reset, and the browser clock starts at 2026-12-07 09:00 in `Australia/Sydney` (also the server's `TZ`, since a POSIX `TZ` such as this sandbox's makes the server refuse to start). `TODAY` in `fixtures/env.ts` is parsed in the runner's own zone, so under this sandbox's UTC the page's clock reads 20:00 Sydney time: don't assert an exact time of day. The service worker doesn't claim open pages, so a page is controlled only from the next load.
- **Smoke against the image**: `make build`, then `docker run -d -p 8080:8080 -v roster-mate-smoke:/data -e APP_USERNAME=e2e -e APP_PASSWORD=e2e-password -e ANTHROPIC_API_KEY=sk-ant-smoke -e ROSTER_NAME=Smoke roster-mate`, then `make e2e-smoke` (`APP_TEST_URL` overrides the URL). With `APP_TEST_URL` set there is no reset, so `@smoke` tests must pass on a server holding their own earlier runs: keep each to its own date, never call extraction, and make each save a real change (re-run shift edits lose last-write-wins to the same pinned clock).
- **Viewing the app** in this sandbox: start `make dev` as a background task, and wait until `localhost:8080/api/health` returns 200 and `localhost:5173/` loads. Then ask the user to run `sbx ports <sandbox-name> --publish 5173:5173` on their host, with the name from `$SANDBOX_NAME`, and to log in with `APP_USERNAME`/`APP_PASSWORD` from `.env` (else `.env.example`). Client changes reload live; restart `make dev` after a Go change. Stop the task when asked.

## Invariants

- **Offline-first** (ADR 0001): the UI reads and writes only IndexedDB, and only the sync engine talks to `/api/sync`. The service worker precaches the shell and leaves `/api/` uncached. Clashing edits resolve by last-write-wins on the phone's `editedAt`.
- **A shift is one code on one date** (ADR 0002): codes match `^[A-Z]{1,2}$`, `D E L N X` are the standard codes, and any other match is an Other code. Codes are defined on both sides, in `apps/server/internal/store/codes.go` and `apps/web/src/shifts/codes.ts`; change them together.
- **Day off is how a shift is removed.** The UI always writes a code. `code: null` is a reserved tombstone that the protocol accepts and clients show as an unrostered date.
- **Dates are local calendar dates**: `YYYY-MM-DD` strings with no time or zone, and a Night shift belongs to the date it starts on. Do date arithmetic on the calendar date itself. `toISOString()` and `new Date('YYYY-MM-DD')` go through UTC and shift dates by a day in `en-AU`.
- **Import saves only through review**: extraction returns proposed shifts and stores nothing, including the photo. Saved rows become ordinary local edits through the outbox.
- **One user on a LAN**: build for exactly one account and one usually-online phone, as `docs/design.md` § Non-goals sets out.

## UI

Follow the `homelab-frontend` skill. In this repo: components are in `apps/web/src/components/`, one per pattern in `docs/ux-spec.md` §5, screens in `apps/web/src/routes/` arrange them, and the tokens are in `apps/web/src/index.css` (from `docs/ux-spec.md` §4.1 and `docs/designs/Tokens.dc.html`). There is no catalogue page yet. Every shift shows its letter code; colour is a second cue. UI text comes from the copy deck, `docs/ux-spec.md` §8.

## Design

`docs/designs/` is a snapshot of the design canvas at https://claude.ai/artifact/f7df7c66-c03e-4e71-bb0b-018b8b594d58, the source of truth for UX. Each ticket's **Designs** section names its artboards.

- **Reading:** the `.dc.html` files are design-tool templates, so read them as source. The markup and inline styles give layout and styling, and the `<script type="text/x-dc">` at the bottom holds the sample data and prototype behaviour (the calendar and date sheet live in `Main.dc.html`; the other artboards show its states). `Tokens.dc.html` holds colours, type and markers; `canvas.json` indexes the boards by row. The prototype behaviour is a sketch: where it differs from a ticket, the ticket wins.
- **Changes:** make every new screen, state or UX change on the canvas first, then pull the canvas's `project/` files down into `docs/designs/` and commit them before implementing. Ask before refreshing the snapshot from the live canvas.

## Done means

All of these pass:

```bash
gofmt -l .       # prints nothing
make test        # go vet, go test, tsc, Vitest
make build       # the Docker image
```

Then prove the behaviour in the running app, not just in tests: open the changed screen at phone width (380 px) and at desktop width, and report what you checked. For container changes, run the image with only environment variables set.
