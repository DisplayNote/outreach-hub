/**
 * Classifies an inbound message as a bounce (NDR) vs an ordinary reply
 * (PHASE_5_SPEC §7, DECISION 7.1). Pure.
 *
 * A message is a `bounce` when the sender is a system/NDR address
 * (postmaster / mailer-daemon / mail-delivery-system) OR the subject matches a
 * delivery-failure pattern; otherwise it's a `reply`. Whether a reply/bounce is
 * actually relevant (correlates to a contact we emailed) is the scanner's job —
 * this function only decides the kind.
 */
import type { InboundMessage } from '@/lib/email/types';

// NDR senders only — deliberately NOT `no-reply` (a legitimate no-reply mailbox
// can send a correlated auto-response that must not be treated as a hard bounce).
// Exported (with isSystemSender) so the Graph driver and the correlation store
// share one definition. Matches a bare address (`postmaster@…`) or a display
// form (`… <mailer-daemon@…>`); the keyword must be the whole local-part.
export const SYSTEM_SENDER = /(^|[<\s])(postmaster|mailer-daemon|mail-delivery-system)@/i;

/** True if `address` is an NDR/system-mailer sender (not a real correspondent). */
export function isSystemSender(address: string): boolean {
  return SYSTEM_SENDER.test(address);
}
const NDR_SUBJECT =
  /undeliverable|delivery status notification|mail delivery (failed|subsystem)|returned mail|failure notice/i;

/** True if `subject` matches a delivery-failure (NDR) subject pattern. */
export function isNdrSubject(subject: string): boolean {
  return NDR_SUBJECT.test(subject);
}

export function classifyInbound(message: InboundMessage): 'reply' | 'bounce' {
  if (isSystemSender(message.from) || isNdrSubject(message.subject)) {
    return 'bounce';
  }
  return 'reply';
}
