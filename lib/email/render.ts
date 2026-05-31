/**
 * Renders a template's subject/body for a contact by substituting single-brace
 * merge tokens (legacy `composeForContact`, PHASE_5_SPEC §3). Pure.
 *
 * Known tokens map to contact fields / org settings; a missing known field
 * renders as an empty string. An UNKNOWN token (e.g. a typo `{frstName}`) is
 * left verbatim — so the mistake is visible in the sent mail rather than being
 * silently dropped (DECISION 3.1).
 */
import type { Contact, OrgSettings } from '@/lib/types/domain';

type TemplateLike = { subject: string | null; body: string | null };

/** Build the known-token → value map for one contact. Missing → empty string. */
function tokenValues(contact: Contact, settings: OrgSettings): Record<string, string> {
  return {
    firstName: contact.firstName ?? '',
    lastName: contact.lastName ?? '',
    company: contact.company ?? '',
    jobTitle: contact.jobTitle ?? '',
    signature: settings.signature ?? '',
  };
}

/** Replace only the known `{token}`s; unknown tokens are left as-is. */
function substitute(text: string, values: Record<string, string>): string {
  return text.replace(/\{([a-zA-Z]+)\}/g, (match, token: string) =>
    Object.prototype.hasOwnProperty.call(values, token) ? values[token]! : match,
  );
}

export interface RenderedTemplate {
  subject: string;
  body: string;
}

export function renderTemplate(
  template: TemplateLike,
  contact: Contact,
  settings: OrgSettings,
): RenderedTemplate {
  const values = tokenValues(contact, settings);
  return {
    subject: substitute(template.subject ?? '', values),
    body: substitute(template.body ?? '', values),
  };
}
