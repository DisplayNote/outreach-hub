variable "env" {
  description = "Environment name (dev or prod)."
  type        = string
  validation {
    condition     = contains(["dev", "prod"], var.env)
    error_message = "env must be \"dev\" or \"prod\"."
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

# ─── Cloudflare DNS ─────────────────────────────────────────────────────────────
variable "cloudflare_api_token" {
  description = "Cloudflare API token scoped to Zone.DNS:Edit on displaynote.com."
  type        = string
  sensitive   = true
}

variable "cloudflare_zone_id" {
  description = "Cloudflare zone id for displaynote.com."
  type        = string
}

variable "app_subdomain" {
  description = "Subdomain (without the zone) where the app is hosted. Filled in Phase 2+."
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
