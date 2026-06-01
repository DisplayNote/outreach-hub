import { notFound } from 'next/navigation';
import { getAdminEmails } from '@/lib/env';
import { getCurrentUser, type CurrentUser } from '@/lib/supabase/org';

/**
 * Admin gating for the /admin panel.
 *
 * "Admin" is an env-var email allowlist (`ADMIN_EMAIL_ALLOWLIST`), NOT a DB role
 * — deliberately, so the set of admins is a deploy-time decision that a DB write
 * (or a compromised authenticated session) can never escalate into. Account-tier
 * settings and deployment config are only writable by an allowlisted email.
 */

/** True when `email` is in the env allowlist (case-insensitive). */
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return getAdminEmails().includes(email.toLowerCase());
}

/**
 * Resolve the signed-in user and assert they are an admin. Returns the user on
 * success; otherwise `notFound()` (a 404 — we don't reveal that /admin exists to
 * non-admins). Call this FIRST in any admin route or admin server action, before
 * loading or mutating any data — nav hiding is cosmetic, this is the real guard.
 */
export async function requireAdmin(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!isAdminEmail(user.email)) {
    notFound();
  }
  return user;
}
