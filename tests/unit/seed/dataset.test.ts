import { describe, it, expect } from 'vitest';
// dataset.mjs is plain ESM data — import works directly under Vitest.
import {
  ENUMS,
  templates,
  sequences,
  campaigns,
  contacts,
  touchpoints,
  emailEvents,
  suppressions,
  userSettings,
  mailpitReplies,
  validateDataset,
} from '../../../scripts/seed/dataset.mjs';

describe('seed dataset', () => {
  it('passes validateDataset() with no errors', () => {
    expect(() => validateDataset()).not.toThrow();
  });

  it('covers every contact_status at least once', () => {
    const present = new Set(contacts.map((c) => c.status));
    for (const status of ENUMS.status) {
      expect(present.has(status), `missing status: ${status}`).toBe(true);
    }
  });

  it('has at least one contact due today and one overdue', () => {
    expect(contacts.some((c) => c.followUpOffsetDays === 0)).toBe(true);
    expect(contacts.some((c) => typeof c.followUpOffsetDays === 'number' && c.followUpOffsetDays < 0)).toBe(true);
  });

  it('has exactly one deliberately unlinked campaign', () => {
    expect(campaigns.filter((c) => c.sequenceKey === null)).toHaveLength(1);
  });

  it('every email sequence step references an existing template', () => {
    const templateKeys = new Set(templates.map((t) => t.key));
    for (const seq of sequences) {
      for (const step of seq.steps) {
        if (step.channel === 'email') {
          expect(step.templateKey, `email step in ${seq.key} needs a template`).not.toBeNull();
          expect(templateKeys.has(step.templateKey)).toBe(true);
        }
      }
    }
  });

  it('every reply/bounce event has a matching sent event for the same contact', () => {
    const sentByContact = new Set(
      emailEvents.filter((e) => e.type === 'sent').map((e) => e.contactKey),
    );
    for (const ev of emailEvents.filter((e) => e.type !== 'sent')) {
      expect(sentByContact.has(ev.contactKey), `${ev.type} for ${ev.contactKey} has no prior sent`).toBe(true);
    }
  });

  it('every mailpit reply targets a contact that has a sent event (so it correlates)', () => {
    const sentByContact = new Set(
      emailEvents.filter((e) => e.type === 'sent').map((e) => e.contactKey),
    );
    expect(mailpitReplies.length).toBeGreaterThan(0);
    for (const r of mailpitReplies) {
      expect(sentByContact.has(r.contactKey), `mailpit reply for ${r.contactKey} needs a sent event`).toBe(true);
    }
  });

  it('exposes user settings with goals', () => {
    expect(userSettings.dailyGoal).toBeGreaterThan(0);
    expect(Array.isArray(userSettings.noteSnippets)).toBe(true);
    expect(suppressions.length).toBeGreaterThan(0);
    expect(touchpoints.length).toBeGreaterThan(0);
  });
});
