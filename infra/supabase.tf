# NOTE: project itself is created out-of-band (via Supabase dashboard) — see §4.1 of the
# execution plan. Terraform imports it and manages settings only.
#
# To attach an existing project to this state on first apply:
#   terraform -chdir=infra import supabase_project.this "<project-ref>"
resource "supabase_project" "this" {
  organization_id   = "" # filled in on import; Supabase Terraform provider derives this.
  name              = "outreach-${var.env}"
  database_password = var.supabase_db_password
  region            = var.supabase_region

  lifecycle {
    ignore_changes = [
      organization_id,
      database_password,
      region,
      name,
    ]
  }
}

resource "supabase_settings" "this" {
  project_ref = var.supabase_project_ref

  auth = jsonencode({
    SITE_URL                   = "https://${var.app_subdomain}.displaynote.com"
    URI_ALLOW_LIST             = "https://${var.app_subdomain}.displaynote.com/auth/callback"
    JWT_EXP                    = 3600
    EXTERNAL_AZURE_ENABLED     = true
    EXTERNAL_AZURE_CLIENT_ID   = var.ms_client_id
    EXTERNAL_AZURE_SECRET      = var.ms_client_secret
    EXTERNAL_AZURE_URL         = "https://login.microsoftonline.com/common/v2.0"
    EXTERNAL_AZURE_REDIRECT_URI = "https://${var.supabase_project_ref}.supabase.co/auth/v1/callback"
  })
}
