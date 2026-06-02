// scripts/seed/dataset.mjs
//
// PURE dev-seed dataset: an in-memory object graph cross-referenced by string
// keys (NOT uuids) so it's readable and testable without a database. The seeder
// (scripts/seed-dev.mjs) resolves keys -> real uuids at insert time and converts
// the integer day OFFSETS here into concrete dates/timestamps against a single
// `now`. No Date/Math.random calls live here — keep it deterministic.
//
// Graph: templates -> sequences(+steps) -> campaigns -> contacts
//        -> touchpoints / emailEvents / suppressions ; plus userSettings and
//        mailpitReplies (live inbound for the Mailpit path).

export const ENUMS = {
  status: ['none', 'amber', 'red', 'green', 'meeting', 'notinterested', 'bounced'],
  channel: ['email', 'phone', 'linkedin', 'other'],
  eventType: ['sent', 'reply', 'bounce'],
  suppressionReason: ['replied', 'bounced', 'manual', 'unsubscribed'],
};

export const templates = [
  {
    key: 'intro',
    name: 'Intro — first touch',
    subject: 'Quick idea for {{company}}',
    body: 'Hi {{firstName}},\n\nI work with teams like {{company}} on classroom & meeting-room display tooling. Worth a quick chat?\n\nBest,\nPaul',
  },
  {
    key: 'follow1',
    name: 'Follow-up #1',
    subject: 'Re: Quick idea for {{company}}',
    body: 'Hi {{firstName}},\n\nCircling back — happy to send a 2-minute overview if useful.\n\nPaul',
  },
  {
    key: 'follow2',
    name: 'Follow-up #2',
    subject: 'One more thought for {{company}}',
    body: 'Hi {{firstName}},\n\nA few {{company}}-style orgs saw real savings. Open to a look?\n\nPaul',
  },
  {
    key: 'breakup',
    name: 'Break-up',
    subject: 'Closing the loop',
    body: 'Hi {{firstName}},\n\nI’ll stop here so I’m not a nuisance — just reply if the timing changes.\n\nPaul',
  },
  {
    key: 'reengage',
    name: 'Re-engagement',
    subject: 'Still on your radar, {{firstName}}?',
    body: 'Hi {{firstName}},\n\nWe spoke a while back about {{company}}. Lots has shipped since — reconnect?\n\nPaul',
  },
  {
    key: 'meeting',
    name: 'Meeting confirm',
    subject: 'Confirmed: our chat',
    body: 'Hi {{firstName}},\n\nLooking forward to it. Invite to follow.\n\nPaul',
  },
];

export const sequences = [
  {
    key: 'msp',
    name: 'MSP Cold Outreach',
    steps: [
      { order: 1, dayOffset: 0, channel: 'email', templateKey: 'intro' },
      { order: 2, dayOffset: 3, channel: 'email', templateKey: 'follow1' },
      { order: 3, dayOffset: 5, channel: 'linkedin', templateKey: null },
      { order: 4, dayOffset: 7, channel: 'email', templateKey: 'follow2' },
      { order: 5, dayOffset: 14, channel: 'email', templateKey: 'breakup' },
    ],
  },
  {
    key: 'reengage',
    name: 'Re-engagement',
    steps: [
      { order: 1, dayOffset: 0, channel: 'email', templateKey: 'reengage' },
      { order: 2, dayOffset: 4, channel: 'linkedin', templateKey: null },
      { order: 3, dayOffset: 9, channel: 'email', templateKey: 'breakup' },
    ],
  },
  {
    key: 'event',
    name: 'Event Follow-up',
    steps: [
      { order: 1, dayOffset: 0, channel: 'email', templateKey: 'intro' },
      { order: 2, dayOffset: 2, channel: 'email', templateKey: 'follow1' },
    ],
  },
];

export const campaigns = [
  { key: 'msp_q2', name: 'UK MSP Q2 2026', sequenceKey: 'msp' },
  { key: 'edu', name: 'Education EMEA', sequenceKey: 'msp' },
  { key: 'dormant', name: 'Re-engagement — Dormant 2025', sequenceKey: 'reengage' },
  // Deliberately unlinked: exercises the queue's "Not linked — set it" state.
  { key: 'bett', name: 'Event — BETT 2026 Leads', sequenceKey: null },
];

// Contacts. `followUpOffsetDays`: negative = overdue, 0 = due today, positive =
// future, null = not enrolled. `sequenceDay` mirrors a step's day_offset (or
// null). Phones populated on a subset (dialler-ready). Keys are referenced by
// touchpoints/emailEvents/suppressions/mailpitReplies below.
export const contacts = [
  // --- UK MSP Q2 2026: active mid-sequence + due/overdue --------------------
  { key: 'mike', campaignKey: 'msp_q2', firstName: 'Mike', lastName: 'Galkin', email: 'mike.galkin@example.com', company: 'FlutterUKI', phone: '+441234567890', mobile: '+447700900123', jobTitle: 'Director, IT', seniority: 'Director', country: 'United Kingdom', linkedin: 'https://www.linkedin.com/in/mike-galkin/', status: 'amber', sequenceDay: 3, followUpOffsetDays: 0, notes: 'Asked to follow up after budget review.' },
  { key: 'sara', campaignKey: 'msp_q2', firstName: 'Sara', lastName: 'Lopez', email: 'sara.lopez@example.com', company: 'NorthBridge MSP', phone: '+441611112222', mobile: '+447700900456', jobTitle: 'Head of Ops', seniority: 'Head', country: 'United Kingdom', linkedin: 'https://www.linkedin.com/in/sara-lopez/', status: 'red', sequenceDay: 7, followUpOffsetDays: -2, notes: 'Went quiet after step 3.' },
  { key: 'tomh', campaignKey: 'msp_q2', firstName: 'Tom', lastName: 'Harding', email: 'tom.harding@example.com', company: 'Cardinal Systems', phone: '+441189998888', mobile: null, jobTitle: 'IT Manager', seniority: 'Manager', country: 'United Kingdom', linkedin: null, status: 'amber', sequenceDay: 0, followUpOffsetDays: 0, notes: null },
  { key: 'greenwin', campaignKey: 'msp_q2', firstName: 'Priya', lastName: 'Nair', email: 'priya.nair@example.com', company: 'Helix Cloud', phone: '+441990001111', mobile: '+447700900789', jobTitle: 'CTO', seniority: 'C-level', country: 'United Kingdom', linkedin: 'https://www.linkedin.com/in/priya-nair/', status: 'green', sequenceDay: 7, followUpOffsetDays: 5, notes: 'Replied positively — sent calendar link.' },
  { key: 'meetingset', campaignKey: 'msp_q2', firstName: 'Dan', lastName: 'OBrien', email: 'dan.obrien@example.com', company: 'Brightwave', phone: '+441222333444', mobile: '+447700900222', jobTitle: 'Director', seniority: 'Director', country: 'Ireland', linkedin: null, status: 'meeting', sequenceDay: 3, followUpOffsetDays: 3, notes: 'Demo booked Thursday.' },
  { key: 'bounced1', campaignKey: 'msp_q2', firstName: 'Carl', lastName: 'Vesely', email: 'carl.vesely@bademail.example.com', company: 'Vesely IT', phone: null, mobile: null, jobTitle: 'Owner', seniority: 'Owner', country: 'United Kingdom', linkedin: null, status: 'bounced', sequenceDay: 0, followUpOffsetDays: null, notes: 'Hard bounce on first send.' },
  { key: 'notint1', campaignKey: 'msp_q2', firstName: 'Grace', lastName: 'Ffield', email: 'grace.field@example.com', company: 'Fieldworks', phone: '+441333444555', mobile: null, jobTitle: 'Ops Lead', seniority: 'Lead', country: 'United Kingdom', linkedin: null, status: 'notinterested', sequenceDay: 3, followUpOffsetDays: null, notes: 'Said not now, try Q4.' },

  // --- Education EMEA: mix incl. future + fresh ------------------------------
  { key: 'amaia', campaignKey: 'edu', firstName: 'Amaia', lastName: 'Etxe', email: 'amaia.etxe@example.com', company: 'Bilbao School Trust', phone: '+34600111222', mobile: '+34600333444', jobTitle: 'Head of Digital', seniority: 'Head', country: 'Spain', linkedin: 'https://www.linkedin.com/in/amaia-etxe/', status: 'amber', sequenceDay: 0, followUpOffsetDays: 1, notes: null },
  { key: 'lars', campaignKey: 'edu', firstName: 'Lars', lastName: 'Holm', email: 'lars.holm@example.com', company: 'Aarhus EdTech', phone: '+4520304050', mobile: null, jobTitle: 'IT Coordinator', seniority: 'Coordinator', country: 'Denmark', linkedin: null, status: 'none', sequenceDay: null, followUpOffsetDays: null, notes: 'Imported, not yet enrolled.' },
  { key: 'mei', campaignKey: 'edu', firstName: 'Mei', lastName: 'Tanaka', email: 'mei.tanaka@example.com', company: 'Kyoto Learning', phone: '+81312345678', mobile: '+819012345678', jobTitle: 'Procurement', seniority: 'Manager', country: 'Japan', linkedin: null, status: 'amber', sequenceDay: 3, followUpOffsetDays: -1, notes: null },
  { key: 'pablo', campaignKey: 'edu', firstName: 'Pablo', lastName: 'Ruiz', email: 'pablo.ruiz@example.com', company: 'Madrid Polytechnic', phone: '+34611222333', mobile: null, jobTitle: 'Dean', seniority: 'Dean', country: 'Spain', linkedin: 'https://www.linkedin.com/in/pablo-ruiz/', status: 'red', sequenceDay: 14, followUpOffsetDays: -5, notes: 'Last step, no response.' },
  { key: 'green2', campaignKey: 'edu', firstName: 'Nora', lastName: 'Berg', email: 'nora.berg@example.com', company: 'Oslo Schools', phone: '+4791020304', mobile: '+4791020305', jobTitle: 'CIO', seniority: 'C-level', country: 'Norway', linkedin: null, status: 'green', sequenceDay: 3, followUpOffsetDays: 7, notes: 'Warm — wants a pilot.' },

  // --- Re-engagement — Dormant 2025 -----------------------------------------
  { key: 'oldjon', campaignKey: 'dormant', firstName: 'Jon', lastName: 'Price', email: 'jon.price@example.com', company: 'Price & Co', phone: '+441444555666', mobile: null, jobTitle: 'MD', seniority: 'MD', country: 'United Kingdom', linkedin: null, status: 'amber', sequenceDay: 0, followUpOffsetDays: 0, notes: '2024 lead, reopening.' },
  { key: 'oldkate', campaignKey: 'dormant', firstName: 'Kate', lastName: 'Singh', email: 'kate.singh@example.com', company: 'Singh Digital', phone: '+441555666777', mobile: '+447700900999', jobTitle: 'Founder', seniority: 'Founder', country: 'United Kingdom', linkedin: 'https://www.linkedin.com/in/kate-singh/', status: 'red', sequenceDay: 4, followUpOffsetDays: -3, notes: null },
  { key: 'notint2', campaignKey: 'dormant', firstName: 'Ed', lastName: 'Mason', email: 'ed.mason@example.com', company: 'Mason Group', phone: null, mobile: null, jobTitle: 'COO', seniority: 'C-level', country: 'United Kingdom', linkedin: null, status: 'notinterested', sequenceDay: 9, followUpOffsetDays: null, notes: 'Unsubscribed politely.' },
  { key: 'bounced2', campaignKey: 'dormant', firstName: 'Wendy', lastName: 'Ash', email: 'wendy.ash@nodomain.example.com', company: 'Ash Ltd', phone: null, mobile: null, jobTitle: 'Owner', seniority: 'Owner', country: 'United Kingdom', linkedin: null, status: 'bounced', sequenceDay: 0, followUpOffsetDays: null, notes: null },

  // --- Event — BETT 2026 Leads (unlinked campaign; fresh imports) -----------
  { key: 'bett1', campaignKey: 'bett', firstName: 'Olu', lastName: 'Ade', email: 'olu.ade@example.com', company: 'Lagos Academies', phone: '+2348012345678', mobile: null, jobTitle: 'Director', seniority: 'Director', country: 'Nigeria', linkedin: null, status: 'none', sequenceDay: null, followUpOffsetDays: null, notes: 'Stand visitor.' },
  { key: 'bett2', campaignKey: 'bett', firstName: 'Hana', lastName: 'Kim', email: 'hana.kim@example.com', company: 'Seoul Ed', phone: '+821012345678', mobile: '+821087654321', jobTitle: 'Manager', seniority: 'Manager', country: 'South Korea', linkedin: 'https://www.linkedin.com/in/hana-kim/', status: 'none', sequenceDay: null, followUpOffsetDays: null, notes: 'Badge scan.' },
];

// Touchpoints: a few per active contact, spread over recent weeks. `daysAgo`
// (>=0) is converted to occurred_at by the seeder. `legacyId` (text) makes them
// idempotent under the seeder's wipe-then-insert.
export const touchpoints = [
  { key: 'tp-mike-1', contactKey: 'mike', channel: 'email', note: 'Sent intro.', daysAgo: 7 },
  { key: 'tp-mike-2', contactKey: 'mike', channel: 'email', note: 'Sent follow-up #1.', daysAgo: 4 },
  { key: 'tp-mike-3', contactKey: 'mike', channel: 'phone', note: 'Left voicemail.', daysAgo: 2 },
  { key: 'tp-sara-1', contactKey: 'sara', channel: 'email', note: 'Sent intro.', daysAgo: 12 },
  { key: 'tp-sara-2', contactKey: 'sara', channel: 'linkedin', note: 'Connection request.', daysAgo: 9 },
  { key: 'tp-priya-1', contactKey: 'greenwin', channel: 'email', note: 'Sent intro.', daysAgo: 9 },
  { key: 'tp-priya-2', contactKey: 'greenwin', channel: 'email', note: 'Positive reply — sent calendar link.', daysAgo: 2 },
  { key: 'tp-dan-1', contactKey: 'meetingset', channel: 'email', note: 'Sent intro.', daysAgo: 6 },
  { key: 'tp-dan-2', contactKey: 'meetingset', channel: 'phone', note: 'Booked demo.', daysAgo: 1 },
  { key: 'tp-pablo-1', contactKey: 'pablo', channel: 'email', note: 'Sequence completed, no reply.', daysAgo: 3 },
  { key: 'tp-nora-1', contactKey: 'green2', channel: 'email', note: 'Wants a pilot.', daysAgo: 2 },
];

// Email events. `daysAgo` -> occurred_at. `messageId` is deterministic so the
// seeder can keep (org,provider,message_id) unique and Mailpit replies can
// (optionally) thread to a sent id. Reply/bounce rows mirror what the scanner
// would have produced for green/meeting/bounced contacts.
export const emailEvents = [
  // sent history
  { contactKey: 'mike', campaignKey: 'msp_q2', type: 'sent', messageId: 'seed-sent-mike-1', subject: 'Quick idea for FlutterUKI', sequenceDay: 0, daysAgo: 7 },
  { contactKey: 'mike', campaignKey: 'msp_q2', type: 'sent', messageId: 'seed-sent-mike-2', subject: 'Re: Quick idea for FlutterUKI', sequenceDay: 3, daysAgo: 4 },
  { contactKey: 'sara', campaignKey: 'msp_q2', type: 'sent', messageId: 'seed-sent-sara-1', subject: 'Quick idea for NorthBridge MSP', sequenceDay: 0, daysAgo: 12 },
  { contactKey: 'greenwin', campaignKey: 'msp_q2', type: 'sent', messageId: 'seed-sent-priya-1', subject: 'Quick idea for Helix Cloud', sequenceDay: 0, daysAgo: 9 },
  { contactKey: 'meetingset', campaignKey: 'msp_q2', type: 'sent', messageId: 'seed-sent-dan-1', subject: 'Quick idea for Brightwave', sequenceDay: 0, daysAgo: 6 },
  { contactKey: 'bounced1', campaignKey: 'msp_q2', type: 'sent', messageId: 'seed-sent-carl-1', subject: 'Quick idea for Vesely IT', sequenceDay: 0, daysAgo: 8 },
  { contactKey: 'pablo', campaignKey: 'edu', type: 'sent', messageId: 'seed-sent-pablo-1', subject: 'Quick idea for Madrid Polytechnic', sequenceDay: 0, daysAgo: 18 },
  { contactKey: 'green2', campaignKey: 'edu', type: 'sent', messageId: 'seed-sent-nora-1', subject: 'Quick idea for Oslo Schools', sequenceDay: 0, daysAgo: 6 },
  { contactKey: 'bounced2', campaignKey: 'dormant', type: 'sent', messageId: 'seed-sent-wendy-1', subject: 'Still on your radar, Wendy?', sequenceDay: 0, daysAgo: 10 },
  // replies (green/meeting)
  { contactKey: 'greenwin', campaignKey: 'msp_q2', type: 'reply', messageId: 'seed-reply-priya-1', subject: 'Re: Quick idea for Helix Cloud', sequenceDay: null, daysAgo: 2 },
  { contactKey: 'meetingset', campaignKey: 'msp_q2', type: 'reply', messageId: 'seed-reply-dan-1', subject: 'Re: Quick idea for Brightwave', sequenceDay: null, daysAgo: 1 },
  { contactKey: 'green2', campaignKey: 'edu', type: 'reply', messageId: 'seed-reply-nora-1', subject: 'Re: Quick idea for Oslo Schools', sequenceDay: null, daysAgo: 2 },
  // bounces
  { contactKey: 'bounced1', campaignKey: 'msp_q2', type: 'bounce', messageId: 'seed-bounce-carl-1', subject: 'Undeliverable: Quick idea for Vesely IT', sequenceDay: null, daysAgo: 8 },
  { contactKey: 'bounced2', campaignKey: 'dormant', type: 'bounce', messageId: 'seed-bounce-wendy-1', subject: 'Undeliverable: Still on your radar, Wendy?', sequenceDay: null, daysAgo: 10 },
];

// Suppressions: one per reason. Email is normalised lower+trim by the seeder.
export const suppressions = [
  { contactKey: 'greenwin', email: 'priya.nair@example.com', reason: 'replied' },
  { contactKey: 'meetingset', email: 'dan.obrien@example.com', reason: 'replied' },
  { contactKey: 'bounced1', email: 'carl.vesely@bademail.example.com', reason: 'bounced' },
  { contactKey: 'bounced2', email: 'wendy.ash@nodomain.example.com', reason: 'bounced' },
  { contactKey: 'notint2', email: 'ed.mason@example.com', reason: 'unsubscribed' },
  { contactKey: 'notint1', email: 'grace.field@example.com', reason: 'manual' },
];

export const userSettings = {
  dailyGoal: 20,
  weeklyCallsGoal: 60,
  weeklyEmailsGoal: 150,
  rhythmGreen: 7,
  rhythmAmber: 14,
  rhythmRed: 30,
  rhythmNone: 60,
  signature: 'Paul Murphy\nDisplayNote — Outreach',
  noteSnippets: ['Left voicemail', 'Sent pricing', 'Asked to follow up next quarter'],
  txSipUser: 'paul.dev',
  txCallerId: '+441234000000',
  diallerInterCallDelaySec: 8,
  diallerAutoDial: false,
  diallerSynthTones: true,
};

// Live inbound for the Mailpit path (scripts/seed-inbox.mjs). Each becomes an
// SMTP message From the contact's address; the scanner classifies it a reply
// (non-system sender, non-NDR subject) and correlates by sender to the contact's
// sent event. Targets are amber/red contacts WITH a sent event and no existing
// reply/suppression, so a live Scan visibly flips them.
export const mailpitReplies = [
  { contactKey: 'mike', subject: 'Re: Quick idea for FlutterUKI', body: 'Thanks — yes, let’s find time next week.' },
  { contactKey: 'sara', subject: 'Re: Quick idea for NorthBridge MSP', body: 'Sorry for the delay! Still interested.' },
];

// --- Validation --------------------------------------------------------------

/**
 * Throw if the dataset graph is internally inconsistent. Pure: no DB, no IO.
 * Returns a per-collection count summary on success (handy for logs/tests).
 */
export function validateDataset() {
  const errors = [];
  const templateKeys = new Set(templates.map((t) => t.key));
  const sequenceKeys = new Set(sequences.map((s) => s.key));
  const campaignKeys = new Set(campaigns.map((c) => c.key));
  const contactKeys = new Set(contacts.map((c) => c.key));

  const dupe = (label, keys) => {
    const seen = new Set();
    for (const k of keys) {
      if (seen.has(k)) errors.push(`duplicate ${label} key: ${k}`);
      seen.add(k);
    }
  };
  dupe('template', templates.map((t) => t.key));
  dupe('sequence', sequences.map((s) => s.key));
  dupe('campaign', campaigns.map((c) => c.key));
  dupe('contact', contacts.map((c) => c.key));

  for (const seq of sequences) {
    for (const step of seq.steps) {
      if (!ENUMS.channel.includes(step.channel)) errors.push(`bad channel ${step.channel} in ${seq.key}`);
      if (step.channel === 'email' && (step.templateKey === null || !templateKeys.has(step.templateKey))) {
        errors.push(`email step ${seq.key}#${step.order} needs a valid template`);
      }
      if (step.templateKey !== null && !templateKeys.has(step.templateKey)) {
        errors.push(`step ${seq.key}#${step.order} references missing template ${step.templateKey}`);
      }
    }
  }

  for (const c of campaigns) {
    if (c.sequenceKey !== null && !sequenceKeys.has(c.sequenceKey)) {
      errors.push(`campaign ${c.key} references missing sequence ${c.sequenceKey}`);
    }
  }

  for (const c of contacts) {
    if (!campaignKeys.has(c.campaignKey)) errors.push(`contact ${c.key} references missing campaign ${c.campaignKey}`);
    if (!ENUMS.status.includes(c.status)) errors.push(`contact ${c.key} has bad status ${c.status}`);
  }

  const sentByContact = new Set(emailEvents.filter((e) => e.type === 'sent').map((e) => e.contactKey));
  for (const ev of emailEvents) {
    if (!ENUMS.eventType.includes(ev.type)) errors.push(`event for ${ev.contactKey} has bad type ${ev.type}`);
    if (!contactKeys.has(ev.contactKey)) errors.push(`event references missing contact ${ev.contactKey}`);
    if (!campaignKeys.has(ev.campaignKey)) errors.push(`event references missing campaign ${ev.campaignKey}`);
    if (ev.type !== 'sent' && !sentByContact.has(ev.contactKey)) {
      errors.push(`${ev.type} for ${ev.contactKey} has no prior sent event`);
    }
  }

  for (const tp of touchpoints) {
    if (!contactKeys.has(tp.contactKey)) errors.push(`touchpoint references missing contact ${tp.contactKey}`);
    if (!ENUMS.channel.includes(tp.channel)) errors.push(`touchpoint ${tp.key} bad channel ${tp.channel}`);
  }

  for (const s of suppressions) {
    if (!contactKeys.has(s.contactKey)) errors.push(`suppression references missing contact ${s.contactKey}`);
    if (!ENUMS.suppressionReason.includes(s.reason)) errors.push(`suppression bad reason ${s.reason}`);
  }

  for (const r of mailpitReplies) {
    if (!contactKeys.has(r.contactKey)) errors.push(`mailpit reply references missing contact ${r.contactKey}`);
    if (!sentByContact.has(r.contactKey)) errors.push(`mailpit reply ${r.contactKey} has no sent event to correlate`);
  }

  if (errors.length > 0) {
    throw new Error(`dataset validation failed:\n - ${errors.join('\n - ')}`);
  }

  return {
    templates: templates.length,
    sequences: sequences.length,
    sequenceSteps: sequences.reduce((n, s) => n + s.steps.length, 0),
    campaigns: campaigns.length,
    contacts: contacts.length,
    touchpoints: touchpoints.length,
    emailEvents: emailEvents.length,
    suppressions: suppressions.length,
    mailpitReplies: mailpitReplies.length,
  };
}
