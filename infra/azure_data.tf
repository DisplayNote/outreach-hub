resource "azurerm_postgresql_flexible_server" "this" {
  name                          = "psql-outreach-${var.env}"
  resource_group_name           = azurerm_resource_group.this.name
  location                      = azurerm_resource_group.this.location
  version                       = "16"
  administrator_login           = var.pg_admin_login
  administrator_password        = var.pg_admin_password
  sku_name                      = "B_Standard_B1ms"
  storage_mb                    = 32768
  public_network_access_enabled = true # tighten to VNet in a follow-up
  zone                          = "1"
}

resource "azurerm_postgresql_flexible_server_database" "app" {
  name      = "outreach"
  server_id = azurerm_postgresql_flexible_server.this.id
  charset   = "UTF8"
  collation = "en_US.utf8"
}

# Allow Azure services (ACA) to reach the server while public access is on.
resource "azurerm_postgresql_flexible_server_firewall_rule" "azure" {
  name             = "allow-azure"
  server_id        = azurerm_postgresql_flexible_server.this.id
  start_ip_address = "0.0.0.0"
  end_ip_address   = "0.0.0.0"
}

resource "azurerm_key_vault" "this" {
  name                       = "kv-outreach-${var.env}"
  resource_group_name        = azurerm_resource_group.this.name
  location                   = azurerm_resource_group.this.location
  tenant_id                  = var.azure_tenant_id
  sku_name                   = "standard"
  rbac_authorization_enabled = true
}

# app_user runtime DB password — generated here, stored in Key Vault, never in
# git or in a SQL migration. The deploy injects it as APP_USER_PASSWORD for the
# migration runner (which runs `alter role app_user with password ...`) and
# builds the app's DATABASE_URL from it. Rotate by tainting this resource.
resource "random_password" "app_user" {
  length  = 32
  special = false # avoid URL-encoding pain in DATABASE_URL
}

resource "azurerm_key_vault_secret" "app_user_password" {
  name         = "app-user-password"
  value        = random_password.app_user.result
  key_vault_id = azurerm_key_vault.this.id
}

# ─── App-generated secrets (never hand-set) ───────────────────────────────────
# AUTH_SECRET signs the Auth.js session JWT (the RLS-trusted identity), CRON_SECRET
# gates the scheduled email routes, and UNSUBSCRIBE_SECRET signs one-click
# unsubscribe links (HMAC). All three are generated here, stored in Key Vault, and
# referenced by the app + cron job secrets — they are never committed to git or a
# tfvars file. Rotate any of them by tainting its random_password resource.
resource "random_password" "auth_secret" {
  length  = 48
  special = false
}

resource "azurerm_key_vault_secret" "auth_secret" {
  name         = "auth-secret"
  value        = random_password.auth_secret.result
  key_vault_id = azurerm_key_vault.this.id
}

resource "random_password" "cron_secret" {
  length  = 48
  special = false
}

resource "azurerm_key_vault_secret" "cron_secret" {
  name         = "cron-secret"
  value        = random_password.cron_secret.result
  key_vault_id = azurerm_key_vault.this.id
}

resource "random_password" "unsubscribe_secret" {
  length  = 48
  special = false
}

resource "azurerm_key_vault_secret" "unsubscribe_secret" {
  name         = "unsubscribe-secret"
  value        = random_password.unsubscribe_secret.result
  key_vault_id = azurerm_key_vault.this.id
}
