import { describe, it, expect } from 'vitest';
import { campaignSequenceStatuses } from '@/lib/campaigns/sequence-status';

const sequences = [
  { id: 'seq-1', name: 'Cold outreach' },
  { id: 'seq-2', name: 'Re-engagement' },
];

describe('campaignSequenceStatuses', () => {
  it('reports the linked sequence name when sequence_id is set', () => {
    const result = campaignSequenceStatuses(
      [{ id: 'c1', name: 'Q3 push', sequenceId: 'seq-1' }],
      sequences,
    );
    expect(result).toEqual([{ id: 'c1', name: 'Q3 push', sequenceName: 'Cold outreach' }]);
  });

  it('reports null (not linked) when sequence_id is null, even if stale free-text exists', () => {
    // The denormalised free-text column is irrelevant to the helper — only
    // sequence_id is passed in — so a legacy "test"-style name can never make a
    // campaign read as linked. This is the exact case the queue badge/count
    // must not get wrong.
    const result = campaignSequenceStatuses(
      [{ id: 'c1', name: 'Legacy campaign', sequenceId: null }],
      sequences,
    );
    expect(result[0]?.sequenceName).toBeNull();
  });

  it('reports null when sequence_id points at a sequence that no longer exists', () => {
    const result = campaignSequenceStatuses(
      [{ id: 'c1', name: 'Dangling', sequenceId: 'seq-deleted' }],
      sequences,
    );
    expect(result[0]?.sequenceName).toBeNull();
  });

  it('resolves the current name, so a renamed sequence is reflected', () => {
    const result = campaignSequenceStatuses(
      [{ id: 'c1', name: 'C', sequenceId: 'seq-2' }],
      [{ id: 'seq-2', name: 'Renamed flow' }],
    );
    expect(result[0]?.sequenceName).toBe('Renamed flow');
  });

  it('maps multiple campaigns, mixing linked and unlinked', () => {
    const result = campaignSequenceStatuses(
      [
        { id: 'c1', name: 'A', sequenceId: 'seq-1' },
        { id: 'c2', name: 'B', sequenceId: null },
      ],
      sequences,
    );
    expect(result.map((r) => r.sequenceName)).toEqual(['Cold outreach', null]);
  });
});
