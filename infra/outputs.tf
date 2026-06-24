output "acr_login_server" {
  description = "Login server hostname of the Azure Container Registry."
  value       = azurerm_container_registry.this.login_server
}

output "pg_fqdn" {
  description = "Fully-qualified domain name of the Postgres Flexible Server."
  value       = azurerm_postgresql_flexible_server.this.fqdn
}

output "app_ingress_fqdn" {
  description = "The Container App's public ingress FQDN (assigned by ACA)."
  value       = azurerm_container_app.app.ingress[0].fqdn
}

output "app_principal_id" {
  description = "The app's system-assigned managed identity principal id (granted ACR pull + KV Secrets User)."
  value       = azurerm_container_app.app.identity[0].principal_id
}

output "app_url" {
  description = "Public app URL once the subdomain's CNAME is pointed at the ingress FQDN."
  value       = var.app_subdomain == "" ? "(set var.app_subdomain to render an app URL)" : "https://${var.app_subdomain}.displaynote.com"
}
