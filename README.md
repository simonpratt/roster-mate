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

Open `http://<host>:8080`. `GET /api/health` returns `{"ok":true}`. The database is
`/data/roster-mate.db`; keep the volume to keep your shifts across restarts and upgrades.

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

Needs Go 1.26+, Node 22 and Docker.

```sh
make dev     # Go server on :8080 and Vite on :5173 (proxying /api); open http://localhost:5173
make test    # go vet + go test, then tsc + Vitest
make build   # the Docker image (IMAGE=roster-mate by default)
```

`make dev` reads `.env`, or `.env.example` if there is no `.env`, and keeps the database in
`DEV_DATA_DIR` (default `$TMPDIR/roster-mate-dev`) rather than `DATA_DIR`.
