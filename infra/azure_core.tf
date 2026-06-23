resource "azurerm_resource_group" "this" {
  name     = "rg-outreach-${var.env}"
  location = var.azure_location
}

resource "azurerm_container_registry" "this" {
  name                = "acroutreach${var.env}" # globally unique, alnum only
  resource_group_name = azurerm_resource_group.this.name
  location            = azurerm_resource_group.this.location
  sku                 = "Basic"
  admin_enabled       = false
}
