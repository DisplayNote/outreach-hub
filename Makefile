.PHONY: help bootstrap bootstrap-prod dev dev-docker dev-stop test test-e2e lint typecheck build \
        db-reset db-migration db-diff fns-serve tunnel clean

help:  ## Show this help
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN{FS=":.*?## "}{printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

bootstrap:  ## Bootstrap LOCAL dev (.env.local) from .env.bootstrap — needs only the Microsoft values
	@bash scripts/dev-bootstrap.sh

bootstrap-prod:  ## Generate infra/envs/prod.tfvars from .env.bootstrap — needs the cloud creds (Supabase/Vercel)
	@bash scripts/bootstrap-prod.sh

dev:  ## Start the full local stack
	@bash scripts/dev.sh

dev-docker:  ## Start Supabase plus production app container and Mailpit
	@bash scripts/dev-docker.sh

dev-stop:  ## Stop the full local stack
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

db-reset:  ## Reset the local DB (destroys data)
	@pnpm exec supabase db reset

db-migration:  ## Create a new migration (usage: make db-migration name=add_contacts)
	@pnpm exec supabase migration new $(name)

db-diff:  ## Diff between local DB and migrations
	@pnpm exec supabase db diff

fns-serve:  ## Serve edge functions locally
	@pnpm exec supabase functions serve --env-file .env.local

tunnel:  ## Open ngrok tunnel for webhooks (set OUTREACH_DEV_TUNNEL_URL first)
	@ngrok http --domain=$(OUTREACH_DEV_TUNNEL_URL) 54321

clean:  ## Clean node_modules and caches
	@rm -rf node_modules .next .turbo coverage playwright-report
