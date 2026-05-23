output "supabase_project_url" {
  description = "Supabase REST URL for this environment."
  value       = "https://${var.supabase_project_ref}.supabase.co"
}

output "vercel_project_id" {
  description = "Vercel project id (echoed for cross-tool reference)."
  value       = vercel_project.this.id
}

output "app_url" {
  description = "App URL once the subdomain is configured."
  value       = var.app_subdomain == "" ? "(set var.app_subdomain to render an app URL)" : "https://${var.app_subdomain}.displaynote.com"
}
