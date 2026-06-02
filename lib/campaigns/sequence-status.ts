/**
 * Derive each campaign's *operational* sequence link for the Email Queue's
 * Enrolment panel.
 *
 * The name is resolved from `sequenceId` (the load-bearing FK the email runner
 * actually follows), resolved against the live sequences list — NOT the
 * denormalised free-text `campaigns.sequence` column. A campaign carrying stale
 * free-text (e.g. a legacy "test") but no `sequence_id` must read as "not
 * linked", and a renamed sequence must show its current name.
 */

export interface CampaignSequenceStatus {
  id: string;
  name: string;
  /** The linked sequence's current name, or null when no sequence is linked. */
  sequenceName: string | null;
}

export function campaignSequenceStatuses(
  campaigns: ReadonlyArray<{ id: string; name: string; sequenceId: string | null }>,
  sequences: ReadonlyArray<{ id: string; name: string }>,
): CampaignSequenceStatus[] {
  const nameById = new Map(sequences.map((s) => [s.id, s.name]));
  return campaigns.map((c) => ({
    id: c.id,
    name: c.name,
    sequenceName: c.sequenceId ? (nameById.get(c.sequenceId) ?? null) : null,
  }));
}
