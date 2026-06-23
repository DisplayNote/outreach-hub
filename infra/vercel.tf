resource "vercel_project" "this" {
  name      = "outreach-hub"
  framework = "nextjs"

  git_repository = {
    type              = "github"
    repo              = var.vercel_git_repo
    production_branch = "main"
  }

  build_command    = "pnpm build"
  install_command  = "corepack enable pnpm && pnpm install --frozen-lockfile"
  output_directory = ".next"
  # The Vercel provider only accepts up to "22.x" here. The actual build/runtime
  # is pinned to Node 24 by package.json#engines (>=24.13), which overrides this
  # project setting on Vercel — keep engines and the Dockerfile aligned on 24.
  node_version = "22.x"

  lifecycle {
    ignore_changes = [
      # Avoid stomping on tweaks made directly in the Vercel UI for one-off experiments.
      build_command,
      install_command,
    ]
  }
}

# Only production deploys exist (no PR previews); development runs locally against
# the Supabase CLI stack. All env vars therefore target "production" only.
locals {
  runtime_env = {
    NEXT_PUBLIC_SUPABASE_URL      = "https://${var.supabase_project_ref}.supabase.co"
    NEXT_PUBLIC_SUPABASE_ANON_KEY = "" # Read from Supabase via dashboard or `supabase status`.
    EMAIL_DRIVER                  = "graph-prod"
  }
}

resource "vercel_project_environment_variable" "runtime" {
  for_each   = local.runtime_env
  project_id = vercel_project.this.id
  key        = each.key
  value      = each.value
  target     = ["production"]
}

resource "vercel_project_environment_variable" "service_role" {
  project_id = vercel_project.this.id
  key        = "SUPABASE_SERVICE_ROLE_KEY"
  value      = "" # Populated manually post-bootstrap; rotate on every Phase 7 secret rotation.
  target     = ["production"]
  sensitive  = true
}

resource "vercel_project_environment_variable" "ms_client_id" {
  project_id = vercel_project.this.id
  key        = "MS_CLIENT_ID"
  value      = var.ms_client_id
  target     = ["production"]
}

resource "vercel_project_environment_variable" "ms_client_secret" {
  project_id = vercel_project.this.id
  key        = "MS_CLIENT_SECRET"
  value      = var.ms_client_secret
  target     = ["production"]
  sensitive  = true
}
