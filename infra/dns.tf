# DNS records for the app subdomain. The actual subdomain choice (e.g. `outreach`, `app`) is
# locked in Phase 2; here we just template the resource so it's ready when the value is supplied.
resource "cloudflare_record" "vercel_app" {
  count   = var.app_subdomain == "" ? 0 : 1
  zone_id = var.cloudflare_zone_id
  name    = var.app_subdomain
  type    = "CNAME"
  content = "cname.vercel-dns.com"
  ttl     = 1 # auto
  proxied = false

  comment = "Outreach Hub app — Vercel"
}

# Mail-related DNS (SPF / DKIM / DMARC) lands in Phase 5 when Microsoft Graph outbound goes live.
# Placeholder block kept here to anchor that work; do not uncomment until Mail.Send is in use.
#
# resource "cloudflare_record" "spf" { ... }
# resource "cloudflare_record" "dkim_selector1" { ... }
# resource "cloudflare_record" "dmarc" { ... }
