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
const SYSTEM_SENDER = /(^|[<\s])(postmaster|mailer-daemon|mail-delivery-system)@/i;
const NDR_SUBJECT =
  /undeliverable|delivery status notification|mail delivery (failed|subsystem)|returned mail|failure notice/i;

export function classifyInbound(message: InboundMessage): 'reply' | 'bounce' {
  if (SYSTEM_SENDER.test(message.from) || NDR_SUBJECT.test(message.subject)) {
    return 'bounce';
  }
  return 'reply';
}
