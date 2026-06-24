# ─── App hosting platform (shared by the app + the cron jobs) ─────────────────
#
# The Container Apps Environment and its Log Analytics workspace are created
# here because BOTH the cron jobs (below) and the app itself (azurerm_container_app,
# landing in Phase 6) live inside the same environment. Defining the environment
# here lets the cron jobs reference it without a forward dependency on the app.

resource "azurerm_log_analytics_workspace" "this" {
  name                = "log-outreach-${var.env}"
  resource_group_name = azurerm_resource_group.this.name
  location            = azurerm_resource_group.this.location
  sku                 = "PerGB2018"
  retention_in_days   = 30
}

resource "azurerm_container_app_environment" "this" {
  name                       = "cae-outreach-${var.env}"
  resource_group_name        = azurerm_resource_group.this.name
  location                   = azurerm_resource_group.this.location
  log_analytics_workspace_id = azurerm_log_analytics_workspace.this.id
}

# ─── Scheduled email cron (ACA Jobs) ──────────────────────────────────────────
#
# CRON STRATEGY — why two Jobs that curl the app, not a bespoke node entrypoint:
#
# The Next.js app already exposes CRON_SECRET-gated routes that do the work:
#   POST /api/email/run   → runSenderAllOrgs()
#   POST /api/email/scan  → scanInboxAllOrgs()
# (nodejs runtime; they call the same lib/email/cron.ts the manual triggers use.)
#
# So the simplest robust trigger is a tiny scheduled container that curls those
# routes against the app's INTERNAL ingress URL with the bearer secret. This
# keeps ONE source of truth for the cron behaviour (the routes), needs no second
# build artifact or node entrypoint, and the routes also stay usable for manual
# triggering / debugging. The job image is a stock curl image, not the app image
# — the app does the work; the job only kicks it.
#
# app_internal_url is now WIRED to the app's ingress FQDN (azurerm_container_app.app,
# defined in azure_app.tf) — no longer a localhost-placeholder variable. The
# Phase-4 deferral (a stand-in default before the app existed) is closed: the URL
# is derived, and the precondition on the email_send job below refuses any apply
# where it would resolve to a loopback host, so a prod apply can't curl localhost.

locals {
  # The app's public ingress FQDN. Cron jobs in the same environment reach the
  # app through it; ACA routes the request back into the app. https:// because
  # ACA ingress terminates TLS at the env edge.
  app_internal_url = "https://${azurerm_container_app.app.ingress[0].fqdn}"

  # Fail fast inside the container if the curl gets a non-2xx (e.g. 401/500),
  # so a misconfigured secret or a failing send surfaces as a failed job run
  # instead of a green no-op.
  cron_send_command = [
    "sh", "-c",
    "set -e; curl -fsS -X POST -H \"Authorization: Bearer $CRON_SECRET\" \"$APP_INTERNAL_URL/api/email/run\""
  ]
  cron_scan_command = [
    "sh", "-c",
    "set -e; curl -fsS -X POST -H \"Authorization: Bearer $CRON_SECRET\" \"$APP_INTERNAL_URL/api/email/scan\""
  ]
}

resource "azurerm_container_app_job" "email_send" {
  name                         = "caj-outreach-email-send-${var.env}"
  resource_group_name          = azurerm_resource_group.this.name
  location                     = azurerm_resource_group.this.location
  container_app_environment_id = azurerm_container_app_environment.this.id

  replica_timeout_in_seconds = 600
  replica_retry_limit        = 1

  schedule_trigger_config {
    # Weekdays 09:15 UTC — matches the retired vercel.json send schedule.
    cron_expression          = "15 9 * * 1-5"
    parallelism              = 1
    replica_completion_count = 1
  }

  template {
    container {
      name    = "email-send"
      image   = "mcr.microsoft.com/azure-cli:latest"
      cpu     = 0.25
      memory  = "0.5Gi"
      command = local.cron_send_command

      env {
        name  = "APP_INTERNAL_URL"
        value = local.app_internal_url
      }
      env {
        name        = "CRON_SECRET"
        secret_name = "cron-secret"
      }
    }
  }

  secret {
    name  = "cron-secret"
    value = random_password.cron_secret.result
  }

  # Closes the Phase-4 deferral: refuse to apply if the cron target ever resolves
  # to a loopback host. A prod apply curling localhost would silently no-op the
  # scheduled send/scan; fail the apply instead.
  lifecycle {
    precondition {
      condition     = !can(regex("(?i)//(localhost|127\\.0\\.0\\.1|\\[::1\\]|::1)([:/]|$)", local.app_internal_url))
      error_message = "app_internal_url must be the app's real ingress FQDN, not a loopback host (got: ${local.app_internal_url})."
    }
  }
}

resource "azurerm_container_app_job" "email_scan" {
  name                         = "caj-outreach-email-scan-${var.env}"
  resource_group_name          = azurerm_resource_group.this.name
  location                     = azurerm_resource_group.this.location
  container_app_environment_id = azurerm_container_app_environment.this.id

  replica_timeout_in_seconds = 600
  replica_retry_limit        = 1

  schedule_trigger_config {
    # Every 30 min, 07:00–18:00 UTC weekdays — matches the retired vercel.json scan schedule.
    cron_expression          = "*/30 7-18 * * 1-5"
    parallelism              = 1
    replica_completion_count = 1
  }

  template {
    container {
      name    = "email-scan"
      image   = "mcr.microsoft.com/azure-cli:latest"
      cpu     = 0.25
      memory  = "0.5Gi"
      command = local.cron_scan_command

      env {
        name  = "APP_INTERNAL_URL"
        value = local.app_internal_url
      }
      env {
        name        = "CRON_SECRET"
        secret_name = "cron-secret"
      }
    }
  }

  secret {
    name  = "cron-secret"
    value = random_password.cron_secret.result
  }
}
