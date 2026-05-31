import type { DiallerDriver } from '@/lib/dialler/driver';
import { NotImplementedError, type CallControl, type CallHandlers } from '@/lib/dialler/types';

/**
 * Stub. The real Telnyx driver lands in Phase 4 — it will use Telnyx WebRTC /
 * Call Control to place outbound calls and stream lifecycle events back through
 * the {@link CallHandlers}. The class exists today so the factory typechecks.
 */
export class TelnyxDiallerDriver implements DiallerDriver {
  readonly name = 'telnyx';

  placeCall(_number: string, _handlers?: CallHandlers): CallControl {
    throw new NotImplementedError('Telnyx dialler lands in Phase 4');
  }
}
