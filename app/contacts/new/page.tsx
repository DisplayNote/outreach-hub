import { redirect } from 'next/navigation';
import ContactForm from '@/components/contact-form';
import { createContact } from '@/lib/actions/contacts';
import type { CreateContactInput } from '@/lib/actions/contacts';
import { createClient } from '@/lib/supabase/server';
import { listCampaigns } from '@/lib/supabase/queries';
import type { ContactStatus } from '@/lib/types/domain';
import { CONTACT_STATUSES } from '@/lib/types/domain';

// Auth state + campaign list change per request; never prerender.
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

const mainStyle: React.CSSProperties = {
  padding: '2rem',
  fontFamily: 'system-ui, sans-serif',
  maxWidth: 720,
  margin: '0 auto',
};

export default async function NewContactPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const campaigns = await listCampaigns();

  // A contact cannot exist without a campaign — guide the user to make one
  // first rather than rendering a form that can never submit.
  if (campaigns.length === 0) {
    return (
      <main style={mainStyle}>
        <h1 style={{ marginBottom: '0.25rem' }}>New contact</h1>
        <div
          style={{
            marginTop: '1.5rem',
            padding: '2rem',
            textAlign: 'center',
            color: '#666',
            background: '#fafafa',
            border: '1px solid #eee',
            borderRadius: 6,
          }}
        >
          <p style={{ margin: 0, fontSize: '1.05rem' }}>No campaigns yet.</p>
          <p style={{ margin: '0.5rem 0 1.25rem', fontSize: '0.9rem' }}>
            Every contact belongs to a campaign. Create a campaign first, then
            add contacts to it.
          </p>
          <a
            href="/campaigns/new"
            style={{
              padding: '0.55rem 1.25rem',
              background: '#111',
              color: '#fff',
              border: '1px solid #111',
              borderRadius: 4,
              fontSize: '0.9375rem',
              fontWeight: 600,
              textDecoration: 'none',
              display: 'inline-block',
            }}
          >
            Create a campaign
          </a>
        </div>
      </main>
    );
  }

  // Server Action bound to the form. Parses the submitted FormData into the
  // typed CreateContactInput, inserts (org_id is set inside createContact), then
  // redirects to the new contact's detail page.
  async function action(formData: FormData): Promise<void> {
    'use server';

    const input: CreateContactInput = {
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

    const contact = await createContact(input);
    redirect(`/contacts/${contact.id}`);
  }

  return (
    <main style={mainStyle}>
      <h1 style={{ marginBottom: '0.25rem' }}>New contact</h1>
      <p style={{ marginTop: 0, marginBottom: '1.5rem', color: '#666' }}>
        Add a contact to one of your campaigns.
      </p>
      <ContactForm
        action={action}
        campaigns={campaigns}
        submitLabel="Create contact"
        cancelHref="/contacts"
      />
    </main>
  );
}
