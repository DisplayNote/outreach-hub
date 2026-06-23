output "acr_login_server" {
  description = "Login server hostname of the Azure Container Registry."
  value       = azurerm_container_registry.this.login_server
}

output "pg_fqdn" {
  description = "Fully-qualified domain name of the Postgres Flexible Server."
  value       = azurerm_postgresql_flexible_server.this.fqdn
}

output "app_url" {
  description = "App URL once the subdomain is configured."
  value       = var.app_subdomain == "" ? "(set var.app_subdomain to render an app URL)" : "https://${var.app_subdomain}.displaynote.com"
}
