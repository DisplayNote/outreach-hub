.PHONY: help bootstrap bootstrap-prod dev dev-stop test test-e2e lint typecheck build \
        db-reset db-migrate db-migration clean seed seed-inbox

help:  ## Show this help
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN{FS=":.*?## "}{printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

bootstrap:  ## Bootstrap LOCAL dev (.env.local) from .env.bootstrap — needs only the Microsoft values
	@bash scripts/dev-bootstrap.sh

bootstrap-prod:  ## Generate infra/envs/prod.tfvars from .env.bootstrap — needs the Azure cloud creds
	@bash scripts/bootstrap-prod.sh

dev:  ## Start the local stack (Docker Postgres + Mailpit), migrate, then `next dev`
	@bash scripts/dev.sh

dev-stop:  ## Stop the local stack
	@bash scripts/teardown.sh

test:  ## Run unit tests
	@pnpm test

test-e2e:  ## Run end-to-end tests
	@pnpm test:e2e

lint:  ## Lint
	@pnpm lint

typecheck:  ## Typecheck
	@pnpm typecheck

build:  ## Production build
	@pnpm build

db-reset:  ## Reset the local DB: recreate the Postgres volume, then re-apply migrations
	@docker compose -f docker-compose.dev.yml down -v 2>/dev/null || true
	@docker compose -f docker-compose.dev.yml up -d postgres
	@bash -c 'for _ in $$(seq 1 30); do docker compose -f docker-compose.dev.yml exec -T postgres pg_isready -U postgres -d outreach >/dev/null 2>&1 && break; sleep 1; done; docker compose -f docker-compose.dev.yml exec -T postgres pg_isready -U postgres -d outreach >/dev/null 2>&1 || { echo "ERROR: Postgres did not become ready." >&2; exit 1; }'
	@bash -c '. scripts/lib/load-dotenv.sh && load_dotenv .env.local && node scripts/migrate.mjs'

db-migrate:  ## Apply SQL migrations to the target DB (DATABASE_URL_ADMIN)
	@bash -c '. scripts/lib/load-dotenv.sh && load_dotenv .env.local && node scripts/migrate.mjs'

db-migration:  ## Scaffold a new migration file (usage: make db-migration name=add_contacts)
	@test -n "$(name)" || (echo "usage: make db-migration name=<slug>" >&2; exit 1)
	@f="supabase/migrations/$$(date -u +%Y%m%d%H%M%S)_$(name).sql"; \
		printf -- "-- %s\n\n" "$(name)" > "$$f"; \
		echo "created $$f"

seed:  ## Seed LOCAL dev DB with a full-coverage dataset (+ best-effort Mailpit replies)
	@bash -c '. scripts/lib/load-dotenv.sh && load_dotenv .env.local && node scripts/seed-dev.mjs && node scripts/seed-inbox.mjs'

seed-inbox:  ## Inject live reply messages into Mailpit (EMAIL_DRIVER=mailpit path)
	@bash -c '. scripts/lib/load-dotenv.sh && load_dotenv .env.local && node scripts/seed-inbox.mjs'

clean:  ## Clean node_modules and caches
	@rm -rf node_modules .next .turbo coverage playwright-report
