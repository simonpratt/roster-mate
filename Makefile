IMAGE ?= roster-mate
# Development database directory. Keep it off the repo's host mount, where SQLite can fail.
DEV_DATA_DIR ?= $(or $(TMPDIR),/tmp)/roster-mate-dev

.PHONY: dev test build

# pnpm comes from corepack (`corepack enable`), at the version pinned in web/package.json.
web/node_modules: web/package.json web/pnpm-lock.yaml
	cd web && pnpm install --frozen-lockfile
	@touch $@

# Go server on $PORT (8080) and Vite on 5173, both on 0.0.0.0; Vite proxies /api to Go.
# Settings come from .env, or .env.example when there is no .env. Open http://localhost:5173.
dev: web/node_modules
	@env_file=.env; [ -f "$$env_file" ] || env_file=.env.example; \
	echo "make dev: settings from $$env_file, data in $(DEV_DATA_DIR)"; \
	while IFS= read -r line; do case "$$line" in ''|\#*) ;; *) export "$$line";; esac; done < "$$env_file"; \
	export DATA_DIR="$(DEV_DATA_DIR)"; \
	trap 'kill 0' INT TERM EXIT; \
	(cd server && go run ./cmd/roster-mate) & \
	(cd web && API_PORT="$${PORT:-8080}" pnpm dev) & \
	wait

# Go vet and tests, then the web type-check and Vitest.
test: web/node_modules
	cd server && go vet ./... && go test ./...
	cd web && pnpm typecheck && pnpm test

build:
	docker build -t $(IMAGE) .
