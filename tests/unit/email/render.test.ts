import { describe, it, expect } from 'vitest';
import { renderTemplate } from '@/lib/email/render';
import type { Contact, OrgSettings } from '@/lib/types/domain';

function contact(over: Partial<Contact> = {}): Contact {
  return {
    id: 'c1',
    orgId: 'o1',
    campaignId: 'camp1',
    firstName: 'Mike',
    lastName: 'Galkin',
    email: 'mike@example.com',
    company: 'FlutterUKI',
    phone: null,
    mobile: null,
    jobTitle: 'Director, IT',
    seniority: null,
    country: null,
    linkedin: null,
    status: 'none',
    sequenceDay: null,
    followUp: null,
    notes: null,
    legacyId: null,
    metadata: {},
    createdAt: '2026-05-31T00:00:00.000Z',
    updatedAt: '2026-05-31T00:00:00.000Z',
    ...over,
  };
}

const settings: OrgSettings = { signature: 'Paul (paul@displaynote.com)' };

describe('renderTemplate', () => {
  it('substitutes known tokens in subject and body', () => {
    const out = renderTemplate(
      { subject: 'Hi {firstName} at {company}', body: '{firstName} {lastName} — {jobTitle}\n{signature}' },
      contact(),
      settings,
    );
    expect(out.subject).toBe('Hi Mike at FlutterUKI');
    expect(out.body).toBe('Mike Galkin — Director, IT\nPaul (paul@displaynote.com)');
  });

  it('renders a missing known field as empty string', () => {
    const out = renderTemplate(
      { subject: 'Hi {firstName}', body: '{company}|{jobTitle}' },
      contact({ firstName: null, company: null, jobTitle: null }),
      settings,
    );
    expect(out.subject).toBe('Hi ');
    // No {signature} token → signature appended to the non-empty body.
    expect(out.body).toBe('|\n\nPaul (paul@displaynote.com)');
  });

  it('leaves an unknown token verbatim (typo is visible, not silently dropped)', () => {
    const out = renderTemplate({ subject: 'Hi {frstName}', body: '{unknown} {company}' }, contact(), settings);
    expect(out.subject).toBe('Hi {frstName}');
    expect(out.body).toBe('{unknown} FlutterUKI\n\nPaul (paul@displaynote.com)');
  });

  it('appends the org signature when the body omits the {signature} token', () => {
    const out = renderTemplate({ subject: 'Hi', body: 'Hello {firstName}' }, contact(), settings);
    expect(out.body).toBe('Hello Mike\n\nPaul (paul@displaynote.com)');
  });

  it('does NOT append when the body already has a {signature} token', () => {
    const out = renderTemplate({ subject: 'Hi', body: 'Hello\n--\n{signature}' }, contact(), settings);
    expect(out.body).toBe('Hello\n--\nPaul (paul@displaynote.com)'); // exactly one signature
  });

  it('does not append a signature when none is configured', () => {
    const out = renderTemplate({ subject: 'Hi', body: 'Hello {firstName}' }, contact(), { signature: '' });
    expect(out.body).toBe('Hello Mike');
  });

  it('treats null subject/body as empty (nothing to sign)', () => {
    const out = renderTemplate({ subject: null, body: null }, contact(), settings);
    expect(out.subject).toBe('');
    expect(out.body).toBe('');
  });
});
