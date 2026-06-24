# ─── The Next.js server (Azure Container App) ─────────────────────────────────
#
# The app runs the standalone Next.js server (Dockerfile) on Container Apps with
# external ingress on :3000. It authenticates to ACR and Key Vault with a
# system-assigned managed identity:
#   - "AcrPull" on the registry lets ACA pull the image without admin creds.
#   - "Key Vault Secrets User" lets the app's secret blocks resolve their
#     key_vault_secret_id references at runtime.
# Because those role assignments reference the app's own identity, they are
# created AFTER the app (see the ordering note below) — no depends_on cycle.

locals {
  # Runtime DATABASE_URL for the app (role app_user). The password is the
  # Key-Vault-stored generated secret; sslmode=require because Azure Postgres
  # Flexible Server enforces TLS. Built here rather than hand-set so it always
  # tracks the generated password + provisioned FQDN.
  app_database_url = "postgres://app_user:${random_password.app_user.result}@${azurerm_postgresql_flexible_server.this.fqdn}:5432/outreach?sslmode=require"

  # Public origin used for absolute unsubscribe links. Falls back to the
  # configured subdomain under displaynote.com when app_base_url is unset.
  app_base_url = var.app_base_url != "" ? var.app_base_url : (
    var.app_subdomain != "" ? "https://${var.app_subdomain}.displaynote.com" : ""
  )
}

resource "azurerm_container_app" "app" {
  name                         = "ca-outreach-app-${var.env}"
  resource_group_name          = azurerm_resource_group.this.name
  container_app_environment_id = azurerm_container_app_environment.this.id
  revision_mode                = "Single"

  identity {
    type = "SystemAssigned"
  }

  registry {
    server   = azurerm_container_registry.this.login_server
    identity = "SystemAssigned"
  }

  # ─── Secrets (Key Vault references + the composed DATABASE_URL) ─────────────
  secret {
    name  = "database-url"
    value = local.app_database_url
  }
  secret {
    name                = "auth-secret"
    identity            = "System"
    key_vault_secret_id = azurerm_key_vault_secret.auth_secret.id
  }
  secret {
    name  = "azure-ad-client-secret"
    value = var.azure_ad_client_secret
  }
  secret {
    name                = "cron-secret"
    identity            = "System"
    key_vault_secret_id = azurerm_key_vault_secret.cron_secret.id
  }
  secret {
    name                = "unsubscribe-secret"
    identity            = "System"
    key_vault_secret_id = azurerm_key_vault_secret.unsubscribe_secret.id
  }
  secret {
    name  = "telnyx-api-key"
    value = var.telnyx_api_key
  }

  ingress {
    external_enabled = true
    target_port      = 3000
    transport        = "auto"
    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }

  template {
    min_replicas = 1
    max_replicas = 2

    container {
      name   = "app"
      image  = var.container_image
      cpu    = 0.5
      memory = "1Gi"

      env {
        name        = "DATABASE_URL"
        secret_name = "database-url"
      }
      env {
        name        = "AUTH_SECRET"
        secret_name = "auth-secret"
      }
      env {
        name  = "AZURE_AD_CLIENT_ID"
        value = var.azure_ad_client_id
      }
      env {
        name        = "AZURE_AD_CLIENT_SECRET"
        secret_name = "azure-ad-client-secret"
      }
      env {
        name  = "AZURE_AD_TENANT_ID"
        value = var.azure_ad_tenant_id
      }
      env {
        name        = "CRON_SECRET"
        secret_name = "cron-secret"
      }
      env {
        name  = "CRON_ORG_ID"
        value = var.cron_org_id
      }
      env {
        name  = "CRON_SENDER_EMAIL"
        value = var.cron_sender_email
      }
      env {
        name  = "EMAIL_DRIVER"
        value = "graph-prod"
      }
      env {
        name  = "ADMIN_EMAIL_ALLOWLIST"
        value = var.admin_email_allowlist
      }
      env {
        name  = "APP_BASE_URL"
        value = local.app_base_url
      }
      env {
        name        = "UNSUBSCRIBE_SECRET"
        secret_name = "unsubscribe-secret"
      }
      env {
        name        = "TELNYX_API_KEY"
        secret_name = "telnyx-api-key"
      }
      env {
        name  = "TELNYX_CONNECTION_ID"
        value = var.telnyx_connection_id
      }
      env {
        name  = "TELNYX_PUBLIC_KEY"
        value = var.telnyx_public_key
      }
      env {
        name  = "BRIDGE_SIP_USERNAME"
        value = var.bridge_sip_username
      }
    }
  }
}

# NOTE on ordering: the role assignments below reference the app's
# system-assigned identity, so the app must be created FIRST — we therefore do
# NOT add a depends_on from the app to them (that would be a dependency cycle).
# The app's Key-Vault-referenced secrets (auth/cron/unsubscribe) resolve once the
# identity has "Key Vault Secrets User"; ACA reconciles the revision after the
# grant lands, so a first apply may need the revision to re-provision once the
# role propagates. This is the documented trade-off of a system-assigned identity
# (vs. a pre-granted user-assigned one).

# Let the app's managed identity read Key Vault secrets (auth/cron/unsubscribe).
resource "azurerm_role_assignment" "app_kv_secrets_user" {
  scope                = azurerm_key_vault.this.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_container_app.app.identity[0].principal_id
}

# Let the app's managed identity pull the image from ACR.
resource "azurerm_role_assignment" "app_acr_pull" {
  scope                = azurerm_container_registry.this.id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_container_app.app.identity[0].principal_id
}
