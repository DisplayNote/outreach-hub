// Shared avatar-initials helpers (presentation only). Centralized here so the
// Today/Contacts/detail lists, the dialler, and the email queue all derive
// initials the same way instead of each re-implementing it.

/**
 * Up-to-two-letter uppercase initials from a display name, falling back to the
 * email, then `'?'`. A multi-word name uses the first + last word's initials;
 * a single word uses its first two letters.
 */
export function initials(name?: string | null, email?: string | null): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]![0] ?? ''}${parts[parts.length - 1]![0] ?? ''}`.toUpperCase();
  }
  const single = parts[0] ?? '';
  if (single) return single.slice(0, 2).toUpperCase();
  const trimmedEmail = (email ?? '').trim();
  if (trimmedEmail) return trimmedEmail.slice(0, 2).toUpperCase();
  return '?';
}

/**
 * Initials for a contact-like record: the first-name and last-name initials,
 * falling back to the email, then `'?'`.
 */
export function contactInitials(contact: {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
}): string {
  const first = contact.firstName?.trim()?.[0] ?? '';
  const last = contact.lastName?.trim()?.[0] ?? '';
  const fromName = `${first}${last}`.trim();
  if (fromName) return fromName.toUpperCase();
  const email = contact.email?.trim();
  if (email) return email.slice(0, 2).toUpperCase();
  return '?';
}
