import { notFound, redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import ContactForm from '@/components/contact-form';
import { updateContact } from '@/lib/actions/contacts';
import type { UpdateContactInput } from '@/lib/actions/contacts';
import { getContact, listCampaigns } from '@/lib/db/queries';
import type { ContactStatus } from '@/lib/types/domain';
import { CONTACT_STATUSES } from '@/lib/types/domain';
import { Card } from '@/components/ui';

// Auth state + contact/campaign data change per request; never prerender.
export const dynamic = 'force-dynamic';

// --- FormData parsing ---------------------------------------------------------

/** Trim a form field; collapse empty/missing to null so the column stays clean. */
function text(formData: FormData, key: string): string | null {
  const raw = formData.get(key);
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

/** Parse a `<select>` status field; fall back to 'none' for unknown/missing. */
function status(formData: FormData): ContactStatus {
  const raw = formData.get('status');
  if (typeof raw === 'string' && (CONTACT_STATUSES as readonly string[]).includes(raw)) {
    return raw as ContactStatus;
  }
  return 'none';
}

/** Parse the numeric sequence-day field; null when blank or not a number. */
function sequenceDay(formData: FormData): number | null {
  const raw = text(formData, 'sequenceDay');
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

export default async function EditContactPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const session = await getSession();
  if (!session) {
    redirect('/login');
  }

  const [contact, campaigns] = await Promise.all([getContact(id), listCampaigns()]);

  if (!contact) {
    notFound();
  }

  // Server Action bound to the form. Parses the submitted FormData into the
  // typed UpdateContactInput, updates by id (RLS scopes to the org), then
  // redirects back to the contact detail page.
  async function action(formData: FormData): Promise<void> {
    'use server';

    const input: UpdateContactInput = {
      campaignId: String(formData.get('campaignId') ?? ''),
      firstName: text(formData, 'firstName'),
      lastName: text(formData, 'lastName'),
      email: text(formData, 'email'),
      company: text(formData, 'company'),
      phone: text(formData, 'phone'),
      mobile: text(formData, 'mobile'),
      jobTitle: text(formData, 'jobTitle'),
      seniority: text(formData, 'seniority'),
      country: text(formData, 'country'),
      linkedin: text(formData, 'linkedin'),
      status: status(formData),
      sequenceDay: sequenceDay(formData),
      followUp: text(formData, 'followUp'),
      notes: text(formData, 'notes'),
    };

    await updateContact(id, input);
    redirect(`/contacts/${id}`);
  }

  return (
    <div className="content__inner">
      <div className="page-head">
        <div>
          <div className="page-head__title">Edit contact</div>
          <div className="page-head__sub">Update this contact&rsquo;s details.</div>
        </div>
      </div>
      <Card>
        <ContactForm
          action={action}
          campaigns={campaigns}
          contact={contact}
          submitLabel="Save changes"
          cancelHref={`/contacts/${id}`}
        />
      </Card>
    </div>
  );
}
