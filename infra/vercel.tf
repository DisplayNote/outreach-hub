resource "vercel_project" "this" {
  name      = "outreach-hub${var.env == "prod" ? "" : "-${var.env}"}"
  framework = "nextjs"

  git_repository = {
    type              = "github"
    repo              = var.vercel_git_repo
    production_branch = var.env == "prod" ? "main" : null
  }

  build_command    = "pnpm build"
  install_command  = "corepack enable pnpm && pnpm install --frozen-lockfile"
  output_directory = ".next"
  node_version     = "20.x"

  lifecycle {
    ignore_changes = [
      # Avoid stomping on tweaks made directly in the Vercel UI for one-off experiments.
      build_command,
      install_command,
    ]
  }
}

locals {
  runtime_env = {
    NEXT_PUBLIC_SUPABASE_URL      = "https://${var.supabase_project_ref}.supabase.co"
    NEXT_PUBLIC_SUPABASE_ANON_KEY = "" # Read from Supabase via dashboard or `supabase status`.
    EMAIL_DRIVER                  = var.env == "prod" ? "graph-prod" : "graph-dev"
  }
}

resource "vercel_project_environment_variable" "runtime" {
  for_each   = local.runtime_env
  project_id = vercel_project.this.id
  key        = each.key
  value      = each.value
  target     = ["production", "preview", "development"]
}

resource "vercel_project_environment_variable" "service_role" {
  project_id = vercel_project.this.id
  key        = "SUPABASE_SERVICE_ROLE_KEY"
  value      = "" # Populated manually post-bootstrap; rotate on every Phase 7 secret rotation.
  target     = ["production", "preview"]
  sensitive  = true
}

resource "vercel_project_environment_variable" "ms_client_id" {
  project_id = vercel_project.this.id
  key        = "MS_CLIENT_ID"
  value      = var.ms_client_id
  target     = ["production", "preview", "development"]
}

resource "vercel_project_environment_variable" "ms_client_secret" {
  project_id = vercel_project.this.id
  key        = "MS_CLIENT_SECRET"
  value      = var.ms_client_secret
  target     = ["production", "preview", "development"]
  sensitive  = true
}
