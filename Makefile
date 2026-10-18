IMAGE ?= roster-mate
# Development database directory. Keep it off the repo's host mount, where SQLite can fail.
DEV_DATA_DIR ?= $(or $(TMPDIR),/tmp)/roster-mate-dev

.PHONY: dev test build

# pnpm comes from corepack (`corepack enable`), at the version pinned in the root package.json.
node_modules: package.json pnpm-lock.yaml pnpm-workspace.yaml apps/web/package.json
	pnpm install --frozen-lockfile
	@touch $@

# Go server on $PORT (8080) and Vite on 5173, both on 0.0.0.0; Vite proxies /api to Go.
# Settings come from .env, or .env.example when there is no .env. Open http://localhost:5173.
dev: node_modules
	@env_file=.env; [ -f "$$env_file" ] || env_file=.env.example; \
	echo "make dev: settings from $$env_file, data in $(DEV_DATA_DIR)"; \
	while IFS= read -r line; do case "$$line" in ''|\#*) ;; *) export "$$line";; esac; done < "$$env_file"; \
	export DATA_DIR="$(DEV_DATA_DIR)"; \
	trap 'kill 0' INT TERM EXIT; \
	go run ./apps/server/cmd/roster-mate & \
	API_PORT="$${PORT:-8080}" pnpm --filter ./apps/web dev & \
	wait

# Go vet and tests, then the web type-check and Vitest.
test: node_modules
	go vet ./... && go test ./...
	pnpm --filter ./apps/web typecheck && pnpm --filter ./apps/web test

build:
	docker build -t $(IMAGE) .
