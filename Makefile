IMAGE ?= roster-mate
# Development database directory. Keep it off the repo's host mount, where SQLite can fail.
DEV_DATA_DIR ?= $(or $(TMPDIR),/tmp)/roster-mate-dev

.PHONY: dev test build e2e e2e-smoke

# pnpm comes from corepack (`corepack enable`), at the version pinned in the root package.json.
node_modules: package.json pnpm-lock.yaml pnpm-workspace.yaml apps/web/package.json test/e2e/package.json
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

# Go vet and tests, then the web type-check and Vitest, then the e2e specs' type-check.
test: node_modules
	go vet ./... && go test ./...
	pnpm --filter ./apps/web typecheck && pnpm --filter ./apps/web test
	pnpm --filter ./test/e2e typecheck

# The Playwright suite on a phone viewport. It builds the web app and bin/roster-mate first, then
# starts them in test mode on :18080 with the fake Claude on :18081 (test/e2e/playwright.config.ts).
# First run: pnpm --filter ./test/e2e exec playwright install chromium
e2e: node_modules
	pnpm --filter ./test/e2e exec playwright test

# The @smoke tests against a running app or container, http://localhost:8080 unless APP_TEST_URL
# says otherwise. Sign-in uses APP_TEST_USERNAME/APP_TEST_PASSWORD (default e2e/e2e-password).
e2e-smoke: node_modules
	APP_TEST_URL=$${APP_TEST_URL:-http://localhost:8080} pnpm --filter ./test/e2e exec playwright test --grep @smoke

build:
	docker build -t $(IMAGE) .
