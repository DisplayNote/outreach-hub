#!/usr/bin/env node
// scripts/seed-inbox.mjs
//
// Best-effort LOCAL injector of live inbound REPLIES into Mailpit (SMTP :1025),
// so that under EMAIL_DRIVER=mailpit, "Scan inbox now" finds them. The scanner
// classifies each as a reply (non-system sender, non-NDR subject) and correlates
// it to the contact's seeded `sent` event by sender address.
//
// Bounces are NOT injected here: the Mailpit driver can't recover an NDR's failed
// recipient, so the scanner ignores Mailpit bounces. Test bounces via the in-app
// "Sim bounce" button (mock driver), which sets failedRecipient correctly.
//
// If Mailpit isn't reachable, this warns and exits 0 (so `make seed` is fine on
// the default mock stack).

import nodemailer from 'nodemailer';
import { contacts, mailpitReplies } from './seed/dataset.mjs';

const HOST = process.env.MAILPIT_HOST ?? '127.0.0.1';
const PORT = Number(process.env.MAILPIT_PORT ?? 1025); // matches lib/email/mailpit.ts
const SENDER = process.env.SEED_SENDER ?? 'paul@displaynote.dev'; // the "you" mailbox

async function main() {
  const transport = nodemailer.createTransport({ host: HOST, port: PORT, secure: false, ignoreTLS: true });
  try {
    await transport.verify();
  } catch (e) {
    console.warn(`seed-inbox: Mailpit not reachable at ${HOST}:${PORT} — skipping (${e instanceof Error ? e.message : e}).`);
    console.warn('seed-inbox: start the dev stack (make dev) and set EMAIL_DRIVER=mailpit to use this path.');
    process.exit(0);
  }

  let sent = 0;
  for (const r of mailpitReplies) {
    const contact = contacts.find((c) => c.key === r.contactKey);
    if (!contact) {
      console.warn(`seed-inbox: no contact for key ${r.contactKey}, skipping`);
      continue;
    }
    await transport.sendMail({
      from: `${contact.firstName} ${contact.lastName} <${contact.email}>`,
      to: SENDER,
      subject: r.subject,
      text: r.body,
    });
    sent += 1;
    console.log(`seed-inbox: queued reply from ${contact.email} ("${r.subject}")`);
  }
  // Close the SMTP transport so the Node process exits promptly instead of
  // lingering on an open socket (which makes `make seed` look like it hangs).
  transport.close();
  console.log(`seed-inbox: injected ${sent} reply message(s) into Mailpit.`);
  console.log('Next: set EMAIL_DRIVER=mailpit, open the Email Queue, click "Scan inbox now".');
}

main().catch((e) => {
  console.error(`seed-inbox: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
