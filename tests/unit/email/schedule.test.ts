import { describe, it, expect } from 'vitest';
import { businessDayAdd, currentStep, nextStep } from '@/lib/email/schedule';
import type { SequenceStep } from '@/lib/types/domain';

function step(stepOrder: number, dayOffset: number): SequenceStep {
  return {
    id: `s${stepOrder}`,
    orgId: 'o1',
    sequenceId: 'seq1',
    stepOrder,
    dayOffset,
    channel: 'email',
    templateId: `t${stepOrder}`,
    createdAt: '2026-05-31T00:00:00.000Z',
  };
}

describe('businessDayAdd', () => {
  // 2026-05-29 is a Friday.
  it('rolls a weekend landing to Monday when skipWeekends', () => {
    expect(businessDayAdd('2026-05-29', 1, true)).toBe('2026-06-01'); // Sat → Mon
  });

  it('does not roll when skipWeekends is false', () => {
    expect(businessDayAdd('2026-05-29', 1, false)).toBe('2026-05-30'); // Sat
  });

  it('lands on a weekday without rolling', () => {
    expect(businessDayAdd('2026-05-29', 4, true)).toBe('2026-06-02'); // +4 = Tue
  });

  it('rolls a Sunday landing to Monday', () => {
    // 2026-05-28 is Thursday; +3 = Sunday 2026-05-31 → Monday 2026-06-01.
    expect(businessDayAdd('2026-05-28', 3, true)).toBe('2026-06-01');
  });
});

describe('currentStep / nextStep', () => {
  const steps = [step(1, 0), step(2, 3), step(3, 7)];

  it('currentStep finds the step at a day_offset', () => {
    expect(currentStep(steps, 3)?.stepOrder).toBe(2);
    expect(currentStep(steps, 99)).toBeNull();
  });

  it('nextStep returns the smallest day_offset greater than the current', () => {
    expect(nextStep(steps, 0)?.dayOffset).toBe(3);
    expect(nextStep(steps, 3)?.dayOffset).toBe(7);
    expect(nextStep(steps, 7)).toBeNull(); // last step → no next
  });
});
