# Brain web app. `make ci` runs exactly what CI runs (Brain ADR-0006).
.DEFAULT_GOAL := help
.PHONY: help install dev dev-http build preview typecheck test e2e api ci clean

help: ## Show this help
	@grep -hE '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) | \
	  awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

install: ## Install exact, locked dependencies
	npm ci

dev: ## Run against the in-browser mock server (no network, no sign-in)
	npx vite --host 127.0.0.1

dev-http: ## Run against the real server on 127.0.0.1:8080 (needs .env.local)
	VITE_API_MODE=http npx vite --host 127.0.0.1

build: ## Typecheck and build to dist/
	npm run build

preview: build ## Serve the production build
	npx vite preview --host 127.0.0.1

typecheck: ## TypeScript, strict
	npx tsc --noEmit

test: ## Unit tests
	npx vitest run

e2e: ## Browser smoke tests (uses local Chrome if present)
	npx playwright test

api: ## Regenerate src/api/schema.gen.ts from ../Server/Sources/API/openapi.yaml
	npm run -s api:gen

ci: typecheck test build ## Exactly what CI runs. If this passes, CI passes.

clean:
	rm -rf dist test-results playwright-report
