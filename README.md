# Roster Mate

A single-user, mobile-first PWA for one shift worker's roster. Claude reads shifts from a roster
photo, you review and save them, and the phone keeps working offline. One Docker image runs a Go
server (SQLite, the JSON API) with the React app embedded.

Design: `docs/design.md`. Domain terms: `CONTEXT.md`. UX: `docs/ux-spec.md`.

## Run it

```sh
cp .env.example .env      # then set APP_PASSWORD, ANTHROPIC_API_KEY and ROSTER_NAME
make build                # builds the image "roster-mate"
docker run -d --name roster-mate --restart unless-stopped \
  --env-file .env -p 8080:8080 -v "$PWD/data:/data" roster-mate
```

Every push to `master` also builds the image for amd64 and arm64 and pushes it to
`ghcr.io/simonpratt/roster-mate:sha-<short commit SHA>` (`.github/workflows/ci.yml`); use that
tag in place of `roster-mate` to skip the local build.

Open `http://<host>:8080`. `GET /api/health` returns `{"ok":true}`. The database is
`/data/roster-mate.db`; keep the volume to keep your shifts across restarts and upgrades.

### It runs as non-root

The container runs as the unprivileged UID/GID 65532, never root, so `/data` must be writable by
the user it runs as. With `docker run`, either `mkdir -p data && sudo chown 65532:65532 data`
before the first run, or add `--user "$(id -u):$(id -g)"` to run as yourself.

Under Kubernetes, set your own UID in the pod's `securityContext`, and an `fsGroup` to make the
`/data` volume writable by it. The server needs no privileges and writes nothing outside `/data`
(not even temp files), so it runs with a read-only root filesystem and every capability dropped:

```yaml
spec:
  securityContext:            # pod level
    runAsNonRoot: true
    runAsUser: 1234           # your UID and GID
    runAsGroup: 1234
    fsGroup: 1234             # makes the /data volume writable by that group
  containers:
    - name: roster-mate
      securityContext:
        readOnlyRootFilesystem: true
        allowPrivilegeEscalation: false
        capabilities: { drop: [ALL] }
      volumeMounts:
        - { name: data, mountPath: /data }
```

If `/data` isn't writable, the server stops at startup with
`open /data/roster-mate.db: unable to open database file (14)`: fix the volume's ownership or the
`fsGroup`. A database carried over from an image that ran as root has root-owned files, so
`chown` `roster-mate.db*` to the new UID before the first start.

The server stops at startup, naming the variable, if `APP_USERNAME`, `APP_PASSWORD`,
`ANTHROPIC_API_KEY` or `ROSTER_NAME` is missing. Every setting is listed in `.env.example` and in
`docs/design.md` § Configuration.

### HTTPS is needed for install and offline use

Browsers only run service workers in a secure context, so installing the app to the home screen
and using it offline need HTTPS. Put the container behind a reverse proxy with a certificate your
phone trusts. Over plain HTTP the app still works while online.

Roster extraction can take up to 90 seconds, so give the proxy a read timeout above that (nginx
defaults to 60s). Otherwise the proxy cuts the request off with a 504 and Import says it couldn't
read the roster.

## Develop

Needs Go 1.26+, Node 22 (with `corepack enable`, for pnpm) and Docker. One Go module sits at the
root, with the server in `apps/server/` and the React client in `apps/web/`, which embeds its
build through `apps/web/embed.go`; a pnpm workspace at the root holds the client.

```sh
make dev     # Go server on :8080 and Vite on :5173 (proxying /api); open http://localhost:5173
make test    # go vet + go test, then tsc + Vitest, and the e2e specs' type-check
make build   # the Docker image (IMAGE=roster-mate by default)
make e2e     # Playwright suite on a phone viewport; builds the web app and binary first
make e2e-smoke  # the @smoke tests against a running app at APP_TEST_URL (default :8080)
```

Before the first `make e2e`, install Chromium once:
`pnpm --filter ./test/e2e exec playwright install chromium`.

`make dev` reads `.env`, or `.env.example` if there is no `.env`, and keeps the database in
`DEV_DATA_DIR` (default `$TMPDIR/roster-mate-dev`) rather than `DATA_DIR`.
