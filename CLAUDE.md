# Roster Mate

A single-user, mobile-first, dark-only PWA holding one shift worker's shifts: Claude reads them from a roster photo, the user reviews and saves them, and the phone keeps working offline. A Go server with SQLite serves an embedded React/Tailwind client that stores shifts in Dexie, all in one Docker image on a LAN-only homelab.

**Read `CONTEXT.md` before any work.** It is the domain glossary. Use its terms in code, API, UI copy, tests and tickets, and never the words listed under _Avoid_ (in particular, "Day" is a shift code, so a calendar date is a **Date**). Implementation-only terms (Outbox, `rev`) are in `docs/design.md` § Glossary. If a term is missing or no longer fits, raise it with the user rather than inventing one; the `/domain-modeling` skill edits `CONTEXT.md` and the ADRs.

## Sources, and which one wins

- **Linear**, project `roster-mate` (team SIM). SIM-8 parents the initial build and lists its sub-issues in landing order with their blockers. A ticket's `## Spec` is what to build, and its **Designs** section names the artboards.
- `docs/design.md`: architecture, configuration, auth, schema, sync protocol, extraction, PWA and testing.
- `docs/ux-spec.md`: screens, states, tokens and copy. §9 maps its sections to tickets.
- `docs/designs/`: the snapshot of the design canvas (see UX design below).
- `docs/adr/`: decisions that are hard to reverse. Read them before touching offline sync and conflicts (0001) or the shape of a shift (0002), and record any new decision of that kind there.

When they disagree, `CONTEXT.md` wins on terms, the ticket's Spec and acceptance criteria win on behaviour, `docs/designs/` wins on layout, colour, type and copy, and `docs/ux-spec.md` fills the gaps the tickets and designs leave. Mention each disagreement you resolve in the ticket comment. `docs/ux-spec.md` §10 lists small additions beyond the tickets (empty state, sign-out confirmation, …); build each with the ticket for its screen unless that ticket puts it out of scope.

## Working on tickets

`/linear-refine` and `/linear-implement` carry the Linear status flow and the commit format. For any other change, commit to `master` (the default branch; there is no `main`) with the subject `SIM-<n>: <summary>` when it belongs to a ticket. The repo has no remote: the user reviews and pushes.

- Done means every acceptance criterion is met. Automated criteria get their test in the same commit. Manual ones (on a phone, in devtools, Lighthouse) are checked, or reported as unchecked with the steps to check them.
- Keep `docs/design.md` true to the code: change it in the same commit as any change to the configuration table, schema, endpoints or sync protocol.

## Commands

`make dev` (Go on :8080, Vite on :5173 proxying `/api`), `make test` (go vet, go test, tsc, Vitest) and `make build` (the Docker image); every environment variable is in `.env.example`. As each ticket lands, record here the commands and gotchas that a look at the `Makefile` or `package.json` wouldn't reveal.

- **Embedded web app**: Go can't embed files outside its module, so the image build copies `web/dist` into `server/internal/web/dist/` before `go build`. A plain `go build` or `make dev` embeds only `.gitkeep`, and the Go server answers `/` with 503 "web app not built"; use the Vite port in development.
- **`make dev`** reads `.env` (else `.env.example`) line by line, not through the shell, so values may contain spaces unquoted, as Docker's `--env-file` expects. It overrides `DATA_DIR` with `DEV_DATA_DIR` (default `$TMPDIR/roster-mate-dev`).
- **Migrations** are `server/internal/store/migrations/NNNN_name.sql`, applied in order at startup, each in a transaction with the `meta.schema_version` bump. Add a new file; never edit an applied one.
- **Tailwind** clears its default palette (`--color-*: initial` in `web/src/index.css`), so only the theme tokens exist as colour classes.

- **Viewing the app** in this sandbox: start the dev servers as background tasks listening on `0.0.0.0`, and wait until `/api/health` returns 200 and the client page loads. Then ask the user to run `sbx ports <sandbox-name> --publish <port>:<port>` on their host for the client's port, with the name from `$SANDBOX_NAME`, and to log in with the dev `APP_USERNAME`/`APP_PASSWORD`. Stop the tasks when asked.
- **SQLite** files belong in a temp dir (tests) or a `DATA_DIR` outside the repo. The repo sits on a host mount, where SQLite can report disk I/O or locking errors.
- **Web tests and IndexedDB**: `src/test-setup.ts` loads `fake-indexeddb`, and after each test waits for the sync engine to go idle and empties the Dexie tables. The app root starts a sync on mount, so a test's `fetch` stub must answer `/api/sync` (an unmatched path gets 404 from `stubFetch`) rather than hang, or the next test's cleanup times out.
- **`useLiveQuery`** keeps returning its previous answer while a query with new deps runs. Where a stale answer would be wrong (the import review's saved shifts), return the deps with the answer and ignore a mismatch, as `useShiftsOn` in `web/src/shifts/repo.ts` does.
- **Import tests** mock `../lib/image` (jsdom has no canvas) and set `URL.createObjectURL`; choose a photo with `fireEvent.change` on the `input[type="file"]`.
- **PWA**: the service worker exists only in a production build (`npm run build`); `make dev` has none. The app icons in `web/public/icons/` are generated by `node scripts/icons.mjs` (run from `web/`).
- **Anthropic API**: tests never call it. The extraction client sits behind an interface, and handler tests use a fake; `extract` tests point the real client at an `httptest` server with `option.WithBaseURL`. Load the `/claude-api` skill before changing `server/internal/extract`. Current models reject a forced `tool_choice`, so extraction uses structured outputs. The first `go test` or `go vet` after a fresh module download compiles the SDK and takes several minutes; run it in the background rather than under a short timeout.

## Invariants

- **Offline-first** (ADR 0001): the UI reads and writes only IndexedDB, and only the sync engine talks to `/api/sync`. The service worker precaches the shell and never caches `/api/`. Clashing edits resolve by last-write-wins on the phone's `editedAt`.
- **A shift is one code on one date** (ADR 0002): codes match `^[A-Z]{1,2}$`, `D E L N X` are the standard codes, and any other match is an Other code. Codes are defined on both sides, in `server/internal/store/codes.go` and `web/src/shifts/codes.ts`; change them together.
- **Day off is how a shift is removed.** The UI always writes a code. `code: null` is a reserved tombstone that the protocol accepts and clients show as an unrostered date.
- **Dates are local calendar dates**: `YYYY-MM-DD` strings with no time or zone, and a Night shift belongs to the date it starts on. Do date arithmetic on the calendar date itself. `toISOString()` and `new Date('YYYY-MM-DD')` go through UTC and shift dates by a day in `en-AU`.
- **Import saves only through review**: extraction returns proposed shifts and stores nothing, including the photo. Saved rows become ordinary local edits through the outbox.
- **One user on a LAN**: build for exactly one account and one usually-online phone, as `docs/design.md` § Non-goals sets out.

## UI

- Colours, sizes and spacing come from the Tailwind theme tokens (`docs/ux-spec.md` §4.1, `docs/designs/Tokens.dc.html`), referenced by name rather than raw palette classes. Every shift shows its letter code; colour is a second cue.
- Each pattern in `docs/ux-spec.md` §5 (app header, sync indicator, month grid, code picker, bottom sheet, buttons, banners) is one component in `web/src/components/`, and screens in `web/src/routes/` only arrange them. Search there first and extend a component with a prop before adding a new one.
- UI text comes from the designs, collected in the copy deck, `docs/ux-spec.md` §8.

## UX design

The design canvas is the source of truth for UX: https://claude.ai/artifact/f7df7c66-c03e-4e71-bb0b-018b8b594d58

Add every new screen, state or UX change to the canvas first. Once the canvas changes are finished, pull the canvas's `project/` files down into `docs/designs/` and commit them before implementing. `docs/designs/` is a snapshot of the canvas, so leave it unedited by hand.

- **Reading:** the `.dc.html` files are design-tool templates, so read them as source. The markup and inline styles give layout and styling, and the `<script type="text/x-dc">` at the bottom holds the sample data and prototype behaviour (the calendar and edit sheet live in `Main.dc.html`; the other artboards show its states). `Tokens.dc.html` holds colours, type and markers; `canvas.json` indexes the boards by row.
- The prototype behaviour is a sketch: where it differs from a ticket (such as when Save is enabled in the edit sheet), the ticket wins.
