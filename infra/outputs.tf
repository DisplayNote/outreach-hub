output "acr_login_server" {
  description = "Login server hostname of the Azure Container Registry."
  value       = azurerm_container_registry.this.login_server
}

output "app_url" {
  description = "App URL once the subdomain is configured."
  value       = var.app_subdomain == "" ? "(set var.app_subdomain to render an app URL)" : "https://${var.app_subdomain}.displaynote.com"
}
