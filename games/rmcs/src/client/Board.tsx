import { formatMessage, type BoardProps, type EffectsMode } from '@cg/game-sdk/client';
import type { SeatView } from '@cg/protocol';
import {
  Avatar,
  CountdownRing,
  PaperChit,
  RollingNumber,
  Stamp,
  durationFor,
  seatAccent,
} from '@cg/ui';
import { AnimatePresence, motion } from 'motion/react';
import { useState, type CSSProperties, type ReactNode } from 'react';
import type { RmcsAction, RmcsEvent, RmcsView, Role, RoundRecord } from '../shared/types';
import { CrownIcon, PointerIcon, ROLE_ACCENT, RoleIcon, ScrollIcon } from './icons';
import { rmcsMessages as m, type RmcsMessageKey } from './messages';
import './rmcs.css';

const f = (key: RmcsMessageKey, params?: Record<string, string | number>) =>
  formatMessage(m[key], params);
const roleKey = <P extends 'role' | 'sub' | 'points' | 'hint'>(prefix: P, role: Role) =>
  `${prefix}${role}` as RmcsMessageKey;

/** Seat positions relative to the viewer: you are always at the bottom, play goes clockwise. */
const POSITIONS = ['bottom', 'left', 'top', 'right'] as const;
type Position = (typeof POSITIONS)[number];
const TILT = [-5, 4, -3, 6];
/** Where a chit flies in from when dealt (towards the centre of the desk). */
const DEAL_FROM: Record<Position, { x: number; y: number }> = {
  bottom: { x: 0, y: -110 },
  top: { x: 0, y: 110 },
  left: { x: 110, y: 0 },
  right: { x: -110, y: 0 },
};

export default function RmcsBoard({
  view,
  events,
  version,
  me,
  seats,
  send,
  effects,
  msUntil,
}: BoardProps<RmcsView, RmcsAction, RmcsEvent>) {
  const [pick, setPick] = useState<{ round: number; seat: number } | null>(null);
  const [sending, setSending] = useState(false);

  const seatInfo = (seat: number): SeatView | undefined => seats.find((s) => s.seat === seat);
  const nameOf = (seat: number | null) =>
    seat === null ? '' : (seatInfo(seat)?.displayName ?? `#${seat + 1}`);

  const iAmMantri = view.phase === 'GUESSING' && view.mantri === me;
  const selection =
    iAmMantri && pick?.round === view.round && view.candidates.includes(pick.seat)
      ? pick.seat
      : null;
  const lastRound: RoundRecord | undefined =
    view.phase === 'ROUND_RESULT' || view.phase === 'OVER' ? view.history.at(-1) : undefined;
  const resolvedNow = events.some((e) => e.type === 'ROUND_RESOLVED');
  const revealedNow = new Set(
    events.flatMap((e) =>
      e.type === 'RAJA_REVEALED' || e.type === 'MANTRI_REVEALED' ? [e.seat] : [],
    ),
  );
  const order = POSITIONS.map((_, i) => (me + i) % 4);

  const accuse = async () => {
    if (selection === null || sending) return;
    setSending(true);
    await send({ type: 'GUESS', target: selection });
    setSending(false);
  };

  return (
    <div className="rmcs">
      <div className="rmcs-top">
        <span className="rmcs-round">
          {f('round', { round: view.round, total: view.totalRounds })}
        </span>
      </div>

      <div className="rmcs-table">
        {order.map((seat, i) => {
          const position = POSITIONS[i] as Position;
          const info = seatInfo(seat);
          const suspect = view.phase === 'GUESSING' && view.candidates.includes(seat);
          return (
            <SeatSpot
              key={seat}
              seat={seat}
              position={position}
              name={nameOf(seat)}
              isMe={seat === me}
              isBot={info?.controller === 'BOT'}
              role={view.known[seat]}
              round={view.round}
              score={view.scores[seat] ?? 0}
              delta={resolvedNow && lastRound ? (lastRound.deltas[seat] ?? 0) : null}
              version={version}
              thinking={view.phase === 'GUESSING' && seat === view.mantri}
              deadline={view.phaseEndsAt}
              phaseMs={view.phaseMs}
              msUntil={msUntil}
              suspect={suspect}
              selectable={iAmMantri && suspect}
              selected={selection === seat}
              accused={lastRound?.target === seat}
              justRevealed={revealedNow.has(seat)}
              effects={effects}
              onSelect={() => setPick({ round: view.round, seat })}
            />
          );
        })}

        <div className="rmcs-desk">
          <Desk
            view={view}
            me={me}
            nameOf={nameOf}
            msUntil={msUntil}
            lastRound={lastRound}
            iAmMantri={iAmMantri}
            effects={effects}
          />
        </div>
      </div>

      {iAmMantri && (
        <div className="rmcs-accuse" role="group" aria-label={f('youHunt')}>
          {selection === null ? (
            <p className="rmcs-accuse__hint">{f('youHunt')}</p>
          ) : (
            <>
              <button
                type="button"
                className="btn btn--pink btn--big"
                disabled={sending}
                onClick={() => void accuse()}
              >
                {f('accuse', { name: nameOf(selection) })}
              </button>
              <button type="button" className="btn btn--ghost" onClick={() => setPick(null)}>
                {f('cancel')}
              </button>
            </>
          )}
        </div>
      )}

      <MyCard role={view.myRole} round={view.round} effects={effects} />
    </div>
  );
}

interface SeatSpotProps {
  seat: number;
  position: Position;
  name: string;
  isMe: boolean;
  isBot: boolean;
  role: Role | undefined;
  round: number;
  score: number;
  delta: number | null;
  version: number;
  thinking: boolean;
  deadline: number;
  phaseMs: number;
  msUntil(ts: number): number;
  suspect: boolean;
  selectable: boolean;
  selected: boolean;
  accused: boolean;
  justRevealed: boolean;
  effects: EffectsMode;
  onSelect(): void;
}

function SeatSpot(p: SeatSpotProps) {
  const avatar = <Avatar name={p.name} accent={seatAccent(p.seat)} size={46} />;
  const dealMs = durationFor(p.effects, 520, 240);
  const from = DEAL_FROM[p.position];
  const classes = [
    'rmcs-seat',
    `rmcs-seat--${p.position}`,
    p.suspect && 'is-suspect',
    p.selected && 'is-selected',
    p.accused && 'is-accused',
    p.isMe && 'is-me',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={classes}>
      <div className="rmcs-seat__who">
        {p.thinking ? (
          <CountdownRing
            deadline={p.deadline}
            totalMs={p.phaseMs}
            msUntil={p.msUntil}
            size={60}
            stroke={5}
          >
            {avatar}
          </CountdownRing>
        ) : (
          avatar
        )}
        <div className="rmcs-seat__name">
          <span className="rmcs-seat__label">{p.name}</span>
          {p.isMe && <span className="badge badge--you">{m.you}</span>}
          {p.isBot && <span className="badge badge--bot">{m.bot}</span>}
        </div>
        <div className="rmcs-seat__score">
          <RollingNumber value={p.score} />
        </div>
        {p.delta !== null && (
          <motion.span
            key={p.version}
            className={p.delta > 0 ? 'rmcs-delta' : 'rmcs-delta rmcs-delta--zero'}
            initial={p.effects === 'reduced' ? false : { y: 8, opacity: 0, scale: 0.6 }}
            animate={{ y: -26, opacity: 1, scale: 1 }}
            transition={{ duration: durationFor(p.effects, 700, 300) / 1000, delay: 0.5 }}
          >
            +{p.delta}
          </motion.span>
        )}
      </div>

      <motion.div
        key={p.round}
        className="rmcs-seat__chit"
        initial={p.effects === 'reduced' ? false : { x: from.x, y: from.y, scale: 0.4, opacity: 0 }}
        animate={{
          x: 0,
          y: 0,
          scale: p.justRevealed && p.effects === 'full' ? [1, 1.18, 1] : 1,
          opacity: 1,
        }}
        transition={{
          duration: dealMs / 1000,
          ease: [0.22, 1, 0.36, 1],
          delay: (p.seat % 4) * 0.08,
        }}
      >
        <PaperChit
          faceUp={p.role !== undefined}
          width={54}
          height={68}
          tilt={TILT[p.seat % 4]}
          label={p.role ? f(roleKey('role', p.role)) : f('hiddenChit')}
        >
          {p.role && <ChitFace role={p.role} />}
        </PaperChit>
        <AnimatePresence>
          {p.accused && (
            <motion.span
              className="rmcs-pointer"
              initial={p.effects === 'reduced' ? false : { y: -30, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 18 }}
            >
              <PointerIcon size={30} />
            </motion.span>
          )}
        </AnimatePresence>
      </motion.div>

      {p.selectable && (
        <button
          type="button"
          className={p.selected ? 'btn btn--small btn--pink' : 'btn btn--small btn--cyan'}
          aria-pressed={p.selected}
          aria-label={f('choose', { name: p.name })}
          onClick={p.onSelect}
        >
          {f('suspect')}
        </button>
      )}
    </div>
  );
}

function ChitFace({ role }: { role: Role }) {
  return (
    <span className="rmcs-chitface" style={{ '--role': ROLE_ACCENT[role] } as CSSProperties}>
      <RoleIcon role={role} size={26} />
      <span className="rmcs-chitface__name">{f(roleKey('role', role))}</span>
    </span>
  );
}

function Desk({
  view,
  me,
  nameOf,
  msUntil,
  lastRound,
  iAmMantri,
  effects,
}: {
  view: RmcsView;
  me: number;
  nameOf(seat: number | null): string;
  msUntil(ts: number): number;
  lastRound: RoundRecord | undefined;
  iAmMantri: boolean;
  effects: EffectsMode;
}) {
  let body: ReactNode;
  switch (view.phase) {
    case 'DEALING':
      body = (
        <>
          <DealingStack effects={effects} />
          <p className="rmcs-desk__text">{f('dealing')}</p>
        </>
      );
      break;
    case 'REVEAL_RAJA':
      body = (
        <>
          <CrownIcon size={64} />
          <p className="rmcs-desk__text">
            {view.raja === me ? f('rajaIsYou') : f('rajaIs', { name: nameOf(view.raja) })}
          </p>
        </>
      );
      break;
    case 'REVEAL_MANTRI':
      body = (
        <>
          <ScrollIcon size={60} />
          <p className="rmcs-desk__text">
            {view.mantri === me ? f('mantriIsYou') : f('mantriIs', { name: nameOf(view.mantri) })}
          </p>
        </>
      );
      break;
    case 'GUESSING':
      body = (
        <>
          <CountdownRing
            deadline={view.phaseEndsAt}
            totalMs={view.phaseMs}
            msUntil={msUntil}
            size={64}
            stroke={6}
          />
          <p className="rmcs-desk__text">
            {iAmMantri ? f('whoIsChor') : f('mantriHunting', { name: nameOf(view.mantri) })}
          </p>
        </>
      );
      break;
    case 'ROUND_RESULT':
      body = lastRound && (
        <>
          <Stamp tone={lastRound.correct ? 'success' : 'danger'} delayMs={300}>
            {lastRound.correct ? f('caught') : f('escaped')}
          </Stamp>
          <p className="rmcs-desk__sub">
            {f(lastRound.auto ? 'autoAccused' : 'accused', {
              mantri: nameOf(lastRound.mantri),
              target: nameOf(lastRound.target),
            })}
          </p>
        </>
      );
      break;
    case 'OVER':
      body = <p className="rmcs-desk__text">{f('finalScores')}</p>;
      break;
  }
  const ms = durationFor(effects, 280, 160);
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={`${view.phase}-${view.round}`}
        className="rmcs-desk__inner"
        aria-live="polite"
        initial={effects === 'reduced' ? false : { opacity: 0, scale: 0.85 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.92 }}
        transition={{ duration: ms / 1000 }}
      >
        {body}
      </motion.div>
    </AnimatePresence>
  );
}

function DealingStack({ effects }: { effects: EffectsMode }) {
  return (
    <div className="rmcs-deal" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <motion.span
          key={i}
          className="rmcs-deal__chit"
          style={{ rotate: `${(i - 1.5) * 9}deg` }}
          animate={
            effects === 'full'
              ? {
                  x: [0, (i - 1.5) * 14, 0],
                  rotate: [(i - 1.5) * 9, (1.5 - i) * 12, (i - 1.5) * 9],
                }
              : {}
          }
          transition={{ duration: 0.9, repeat: Infinity, ease: 'easeInOut', delay: i * 0.06 }}
        />
      ))}
    </div>
  );
}

function MyCard({ role, round, effects }: { role: Role; round: number; effects: EffectsMode }) {
  const ms = durationFor(effects, 620, 260);
  return (
    <motion.section
      key={round}
      className="rmcs-mycard paper"
      style={{ '--role': ROLE_ACCENT[role] } as CSSProperties}
      initial={effects === 'reduced' ? false : { rotateY: 88, opacity: 0.4 }}
      animate={{ rotateY: 0, opacity: 1 }}
      transition={{ duration: ms / 1000, delay: effects === 'full' ? 0.3 : 0 }}
      aria-label={`${f('yourChit')}: ${f(roleKey('role', role))}`}
    >
      <div className="rmcs-mycard__icon">
        <RoleIcon role={role} size={58} />
      </div>
      <div className="rmcs-mycard__body">
        <span className="rmcs-mycard__label">{f('yourChit')}</span>
        <div>
          <strong className="rmcs-mycard__role">{f(roleKey('role', role))}</strong>{' '}
          <span className="rmcs-mycard__sub">{f(roleKey('sub', role))}</span>
        </div>
        <span className="rmcs-mycard__points">{f(roleKey('points', role))}</span>
        <p className="rmcs-mycard__hint">{f(roleKey('hint', role))}</p>
      </div>
    </motion.section>
  );
}
