terraform {
  # Phase 0: local state. `terraform.tfstate` is gitignored.
  # TODO (Phase 7): migrate to a remote backend (Terraform Cloud, S3 + DynamoDB lock, or
  # Supabase Storage). The current single-developer setup tolerates local state; once
  # multiple operators touch infra, a locking backend is mandatory.
  backend "local" {
    path = "terraform.tfstate"
  }
}
