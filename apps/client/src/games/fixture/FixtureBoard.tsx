import type { BoardProps } from '@cg/game-sdk/client';
import type { FixtureAction, FixtureEvent, FixtureView } from '@cg/game-sdk/fixture';
import { useState } from 'react';
import { format } from '../../i18n';
import { useTick } from '../../platform/context';
import { fixtureMessages as m } from './messages';

/** Minimal board for the platform fixture game (development only). */
export default function FixtureBoard({
  view,
  me,
  seats,
  send,
  msUntil,
}: BoardProps<FixtureView, FixtureAction, FixtureEvent>) {
  useTick(250);
  const [busy, setBusy] = useState(false);
  const nameOf = (seat: number) => seats.find((s) => s.seat === seat)?.displayName ?? `#${seat}`;
  const myTurn = view.phase === 'PLAYING' && view.turn === me;
  const seconds = Math.max(0, Math.ceil(msUntil(view.turnDeadline) / 1000));

  const add = async (amount: 1 | 2 | 3) => {
    setBusy(true);
    await send({ type: 'ADD', amount });
    setBusy(false);
  };

  return (
    <div className="fixture">
      <div className="fixture__counter" aria-live="polite">
        <span className="fixture__label">{m.counter}</span>
        <strong className="fixture__value">{view.counter}</strong>
        <span className="fixture__label">{format(m.target, { target: view.target })}</span>
      </div>

      <p className="fixture__secret">
        {m.yourSecret}: <strong>{view.yourLucky}</strong>
      </p>

      {view.phase === 'PLAYING' ? (
        <>
          <p
            className={myTurn ? 'fixture__turn fixture__turn--mine' : 'fixture__turn'}
            aria-live="polite"
          >
            {myTurn ? m.yourTurn : format(m.waitingFor, { name: nameOf(view.turn) })}{' '}
            <span className="fixture__timer">{format(m.secondsLeft, { seconds })}</span>
          </p>
          <div className="fixture__actions">
            {([1, 2, 3] as const).map((amount) => (
              <button
                key={amount}
                type="button"
                className="btn btn--primary btn--big"
                disabled={!myTurn || busy}
                onClick={() => void add(amount)}
              >
                {format(m.add, { amount })}
              </button>
            ))}
          </div>
        </>
      ) : (
        <p className="fixture__turn fixture__turn--mine">
          {format(m.winner, { name: nameOf(view.winner ?? 0) })}
        </p>
      )}

      {view.lastMove && (
        <p className="fixture__last">
          {format(view.lastMove.auto ? m.lastMoveAuto : m.lastMove, {
            name: nameOf(view.lastMove.seat),
            amount: view.lastMove.amount,
          })}
        </p>
      )}

      {view.revealedLucky && (
        <div className="fixture__reveal">
          <h3>{m.secrets}</h3>
          <ul>
            {Object.entries(view.revealedLucky).map(([seat, lucky]) => (
              <li key={seat}>
                {nameOf(Number(seat))}: <strong>{lucky}</strong>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
