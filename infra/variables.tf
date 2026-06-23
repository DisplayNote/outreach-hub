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

# ─── App hosting ──────────────────────────────────────────────────────────────
# DNS is managed manually (outside Terraform). After the app host is provisioned,
# create the CNAME for this subdomain and the mail records (SPF / DKIM / DMARC)
# by hand in the DNS provider.
variable "app_subdomain" {
  description = "Subdomain (without the zone) where the app is hosted. DNS record is created manually."
  type        = string
  default     = ""
}
