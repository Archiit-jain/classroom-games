import { describe, expect, it } from 'vitest';
import { eventsForSeat, isInAudience, toAll, toAllExcept, toSeats } from '../src/audience';

describe('audiences', () => {
  it('routes events to the right seats', () => {
    expect(isInAudience({ to: 'ALL' }, 3)).toBe(true);
    expect(isInAudience({ to: 'SEATS', seats: [1, 2] }, 2)).toBe(true);
    expect(isInAudience({ to: 'SEATS', seats: [1, 2] }, 0)).toBe(false);
    expect(isInAudience({ to: 'ALL_EXCEPT', seats: [1] }, 1)).toBe(false);
    expect(isInAudience({ to: 'ALL_EXCEPT', seats: [1] }, 0)).toBe(true);
  });

  it('eventsForSeat keeps order and drops invisible events', () => {
    const events = [
      toAll('a'),
      toSeats([0], 'secret-for-0'),
      toAllExcept([0], 'not-for-0'),
      toAll('b'),
    ];
    expect(eventsForSeat(events, 0)).toEqual(['a', 'secret-for-0', 'b']);
    expect(eventsForSeat(events, 1)).toEqual(['a', 'not-for-0', 'b']);
  });
});
