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

# The fully-qualified image (registry/repo:tag or @digest) the Container App and
# the cron jobs run. CI overrides this with the freshly-built ACR digest on every
# deploy; the default lets a first apply stand the app up on a placeholder until
# the first image is pushed.
variable "container_image" {
  description = "Container image (with tag or digest) for the app + cron jobs, e.g. acroutreachprod.azurecr.io/outreach-hub:latest."
  type        = string
  default     = "acroutreachprod.azurecr.io/outreach-hub:latest"
}

# APP_BASE_URL — the app's PUBLIC origin, used to build absolute one-click
# unsubscribe links at send time. Distinct from the internal ingress FQDN the
# cron jobs curl (that is derived from the app resource, not set here). Defaults
# to the configured subdomain under displaynote.com.
variable "app_base_url" {
  description = "Public origin of the app (https://...), used to build absolute unsubscribe links. Defaults to https://<app_subdomain>.displaynote.com."
  type        = string
  default     = ""
}

# ─── Entra (Auth.js OAuth provider + cron app-only Graph) ─────────────────────
variable "azure_ad_client_id" {
  description = "Entra app-registration client id (Auth.js sign-in + cron app-only Graph)."
  type        = string
}

variable "azure_ad_client_secret" {
  description = "Entra app-registration client secret."
  type        = string
  sensitive   = true
}

variable "azure_ad_tenant_id" {
  description = "Entra tenant id the app authenticates against (issuer is tenant-pinned)."
  type        = string
}

# ─── Email / cron behaviour ───────────────────────────────────────────────────
variable "admin_email_allowlist" {
  description = "Comma-separated email allowlist gating the /admin panel. Empty => nobody is an admin."
  type        = string
  default     = ""
}

variable "cron_org_id" {
  description = "The single org id the scheduled sender/scanner serves (one global Graph mailbox)."
  type        = string
}

variable "cron_sender_email" {
  description = "Mailbox the scheduled sender sends FROM when an org has not set settings.senderEmail."
  type        = string
}

# ─── Telnyx (AMD dialler, Mode B) ─────────────────────────────────────────────
variable "telnyx_api_key" {
  description = "Telnyx API key (AMD dialler). Empty disables the live telephony path."
  type        = string
  sensitive   = true
  default     = ""
}

variable "telnyx_connection_id" {
  description = "Telnyx connection id used to originate calls."
  type        = string
  default     = ""
}

variable "telnyx_public_key" {
  description = "Telnyx public key used to verify inbound webhook signatures."
  type        = string
  default     = ""
}

variable "bridge_sip_username" {
  description = "SIP username the AMD bridge dials the agent leg at."
  type        = string
  default     = ""
}
