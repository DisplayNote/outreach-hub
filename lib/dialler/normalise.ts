import type { Contact } from '@/lib/types/domain';

/**
 * Best-effort phone normalisation toward E.164, dependency-free.
 *
 * Rules (in order):
 * - Strip everything except digits and a single leading `+`.
 * - A `+`-prefixed input is assumed already-international; keep its digits.
 * - `00`-prefixed input is the international access code → replace with `+`.
 * - A leading national-trunk `0` (common in the UK and much of Europe) is
 *   dropped and `defaultCountryCode` prepended.
 * - Anything else gets `defaultCountryCode` prepended as-is.
 *
 * Returns `null` for input with no usable digits. This is intentionally light —
 * it is not a full libphonenumber, just enough to make `tel:` links and the
 * dialler stable for UK-centric data. `defaultCountryCode` is the calling code
 * including the leading `+` (e.g. `+44`).
 */
export function normalisePhone(raw: string, defaultCountryCode = '+44'): string | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;

  const hadPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/[^\d]/g, '');
  if (digits === '') return null;

  const cc = defaultCountryCode.startsWith('+') ? defaultCountryCode : `+${defaultCountryCode}`;
  const ccDigits = cc.replace(/[^\d]/g, '');

  if (hadPlus) {
    return `+${digits}`;
  }
  if (digits.startsWith('00')) {
    const rest = digits.slice(2);
    return rest === '' ? null : `+${rest}`;
  }
  if (digits.startsWith('0')) {
    return `${cc}${digits.slice(1)}`;
  }
  // Already starts with the default calling code (rare, but avoid doubling it).
  if (digits.startsWith(ccDigits)) {
    return `+${digits}`;
  }
  return `${cc}${digits}`;
}

/**
 * Validate and normalise a user-entered default calling code to canonical
 * `+<digits>` form. Accepts an optional leading `+` followed by 1–4 digits
 * (e.g. `"44"` or `"+44"`). Returns `null` for anything non-numeric — notably
 * ISO country codes like `"GB"`, which {@link normalisePhone} cannot use as a
 * calling code — so callers can reject bad input rather than persist it.
 */
export function normaliseCallingCode(raw: string): string | null {
  const trimmed = raw.trim();
  if (!/^\+?\d{1,4}$/.test(trimmed)) return null;
  return trimmed.startsWith('+') ? trimmed : `+${trimmed}`;
}

/**
 * Pick the number to dial for a contact: mobile is preferred over the landline
 * `phone`. Returns the normalised E.164 string, or `null` when the contact has
 * no usable number. `defaultCountryCode` is forwarded to {@link normalisePhone}.
 */
export function pickDialNumber(
  contact: Pick<Contact, 'phone' | 'mobile'>,
  defaultCountryCode = '+44',
): string | null {
  const candidates = [contact.mobile, contact.phone];
  for (const candidate of candidates) {
    if (candidate == null) continue;
    const normalised = normalisePhone(candidate, defaultCountryCode);
    if (normalised !== null) return normalised;
  }
  return null;
}
