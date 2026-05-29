# Terraform manages the production cloud environment only. Development runs
# entirely against the local Supabase CLI stack (`supabase start`), which is not
# managed here — so there is no cloud "dev" project to provision or pay for.
variable "env" {
  description = "Environment name. Only \"prod\" is managed by Terraform; dev is local-only."
  type        = string
  default     = "prod"
  validation {
    condition     = var.env == "prod"
    error_message = "env must be \"prod\"; development is local-only and not managed by Terraform."
  }
}

# ─── Supabase ───────────────────────────────────────────────────────────────────
variable "supabase_access_token" {
  description = "Supabase Personal Access Token (account-level). Treat as sensitive."
  type        = string
  sensitive   = true
}

variable "supabase_project_ref" {
  description = "Existing Supabase project reference (e.g. abcdefghijklmnopqrst)."
  type        = string
}

variable "supabase_db_password" {
  description = "Database password for the Supabase project."
  type        = string
  sensitive   = true
}

variable "supabase_region" {
  description = "Supabase region (e.g. eu-west-2)."
  type        = string
  default     = "eu-west-2"
}

# ─── Vercel ─────────────────────────────────────────────────────────────────────
variable "vercel_token" {
  description = "Vercel API token."
  type        = string
  sensitive   = true
}

variable "vercel_org_id" {
  description = "Vercel team/org id."
  type        = string
}

variable "vercel_project_id" {
  description = "Vercel project id."
  type        = string
}

variable "vercel_git_repo" {
  description = "GitHub repo slug (org/name) for the Vercel project."
  type        = string
  default     = "DisplayNote/outreach-hub"
}

# ─── App hosting ──────────────────────────────────────────────────────────────
# DNS is managed manually (outside Terraform). After Vercel is provisioned,
# create a CNAME for this subdomain pointing at `cname.vercel-dns.com`, and the
# Phase 5 mail records (SPF / DKIM / DMARC), by hand in the DNS provider.
variable "app_subdomain" {
  description = "Subdomain (without the zone) where the app is hosted. Filled in Phase 2+. DNS record is created manually."
  type        = string
  default     = ""
}

# ─── Microsoft OAuth (consumed by Supabase auth configuration) ──────────────────
variable "ms_client_id" {
  description = "Microsoft Entra application (client) id."
  type        = string
}

variable "ms_client_secret" {
  description = "Microsoft Entra application client secret."
  type        = string
  sensitive   = true
}
