# Terraform manages the production cloud environment only. Development runs
# entirely against a local Docker Postgres + `make db-migrate`, which is not
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

# ─── Azure ──────────────────────────────────────────────────────────────────────
variable "azure_subscription_id" {
  description = "Azure subscription id the stack is provisioned into."
  type        = string
}

variable "azure_location" {
  description = "Azure region for all resources."
  type        = string
  default     = "uksouth"
}

variable "azure_tenant_id" {
  description = "Entra tenant id (used for Key Vault RBAC)."
  type        = string
}

# ─── Postgres Flexible Server ─────────────────────────────────────────────────
variable "pg_admin_login" {
  description = "Administrator login for the Azure Postgres Flexible Server."
  type        = string
}

variable "pg_admin_password" {
  description = "Administrator password for the Azure Postgres Flexible Server."
  type        = string
  sensitive   = true
}

# ─── App hosting ──────────────────────────────────────────────────────────────
# DNS is managed manually (outside Terraform). After the app host is provisioned,
# create the CNAME for this subdomain and the mail records (SPF / DKIM / DMARC)
# by hand in the DNS provider.
variable "app_subdomain" {
  description = "Subdomain (without the zone) where the app is hosted. DNS record is created manually."
  type        = string
  default     = ""
}

# ─── Cron jobs (ACA Jobs) ─────────────────────────────────────────────────────
# The scheduled email send/scan jobs curl the app's CRON_SECRET-gated routes
# against its environment-internal ingress URL. Supplied as variables (rather
# than read from the Phase-6 azurerm_container_app) so this config validates and
# plans before the app resource exists; Phase 6 wires app_internal_url to the
# app's ingress FQDN.
variable "app_internal_url" {
  description = "App's Container Apps environment-internal base URL the cron jobs curl (e.g. https://app.internal.<env-domain>). Set in Phase 6 from the app's ingress FQDN."
  type        = string
  default     = "https://app.internal.localhost"
}

variable "cron_secret" {
  description = "Bearer secret the cron jobs send to the CRON_SECRET-gated routes; must match the app's CRON_SECRET."
  type        = string
  sensitive   = true
  default     = ""
}
