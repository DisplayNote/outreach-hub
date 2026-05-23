terraform {
  required_version = ">= 1.7"

  required_providers {
    supabase = {
      source  = "supabase/supabase"
      version = "~> 1.9"
    }
    vercel = {
      source  = "vercel/vercel"
      version = "~> 2.0"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
  }
}

provider "supabase" {
  access_token = var.supabase_access_token
}

provider "vercel" {
  api_token = var.vercel_token
  team      = var.vercel_org_id
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}
