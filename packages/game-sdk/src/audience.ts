import type { Audience, Scoped, SeatIndex } from './contract';

export const toAll = <E>(event: E): Scoped<E> => ({ to: 'ALL', event });

export const toSeats = <E>(seats: SeatIndex[], event: E): Scoped<E> => ({
  to: 'SEATS',
  seats,
  event,
});

export const toAllExcept = <E>(seats: SeatIndex[], event: E): Scoped<E> => ({
  to: 'ALL_EXCEPT',
  seats,
  event,
});

export function isInAudience(audience: Audience, seat: SeatIndex): boolean {
  switch (audience.to) {
    case 'ALL':
      return true;
    case 'SEATS':
      return audience.seats.includes(seat);
    case 'ALL_EXCEPT':
      return !audience.seats.includes(seat);
  }
}

/** The events from a transition that one seat is allowed to see. */
export function eventsForSeat<E>(events: readonly Scoped<E>[], seat: SeatIndex): E[] {
  return events.filter((e) => isInAudience(e, seat)).map((e) => e.event);
}
