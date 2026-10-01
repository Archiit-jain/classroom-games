import type { BoardProps, BoardReaction, EffectsMode } from '@cg/game-sdk/client';
import type { SeatView } from '@cg/protocol';
import { CountdownRing, durationFor } from '@cg/ui';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CATEGORY_LABELS } from '../../content/en';
import {
  countItems,
  nextActive,
  type Chit,
  type Finish,
  type ParchiAction,
  type ParchiEvent,
  type ParchiView,
  type PassMove,
} from '../shared/types';
import { Medal } from './icons/game';
import { ItemIcon } from './icons/items';
import { Slip } from './Slip';
import {
  DirectionRing,
  FinishedSet,
  PassFlights,
  POSITIONS,
  SeatSpot,
  f,
  itemLabel,
  placeLabel,
  useElementSize,
} from './table';
import './sixteen-parchi.css';

/** Groups a hand by item, biggest group first, so nobody has to count. */
function groupHand(
  hand: readonly Chit[],
  items: readonly string[],
): { item: string; chits: Chit[] }[] {
  const counts = countItems(hand);
  const order = [...counts.keys()].sort(
    (a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || items.indexOf(a) - items.indexOf(b),
  );
  return order.map((item) => ({
    item,
    chits: hand.filter((c) => c.item === item).sort((a, b) => a.handle.localeCompare(b.handle)),
  }));
}

export default function ParchiBoard({
  view,
  events,
  version,
  me,
  seats,
  send,
  effects,
  msUntil,
  reactions,
}: BoardProps<ParchiView, ParchiAction, ParchiEvent>) {
  const tableRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(tableRef);
  const [pending, setPending] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);

  const seatInfo = (seat: number): SeatView | undefined => seats.find((s) => s.seat === seat);
  const nameOf = (seat: number) => seatInfo(seat)?.displayName ?? `#${seat + 1}`;
  const iAmActive = view.active.includes(me);
  const myFinish = view.finishes.find((x) => x.seat === me);
  const passTo = iAmActive && view.active.length > 1 ? nextActive(view.active, me) : null;

  // What happened in the update being presented (drives the animations).
  const dealt = events.some((e) => e.type === 'DEALT');
  const pass = events.find(
    (e): e is Extract<ParchiEvent, { type: 'PASS_RESOLVED' }> => e.type === 'PASS_RESOLVED',
  );
  const received = events.find(
    (e): e is Extract<ParchiEvent, { type: 'CHIT_RECEIVED' }> => e.type === 'CHIT_RECEIVED',
  );
  const autoPick = events.find(
    (e): e is Extract<ParchiEvent, { type: 'MY_SELECTION' }> => e.type === 'MY_SELECTION' && e.auto,
  );
  const fresh = new Set(events.flatMap((e) => (e.type === 'CLAIM_ACCEPTED' ? [e.seat] : [])));
  const youCanClaimNow = events.some((e) => e.type === 'YOU_CAN_CLAIM');

  // A short buzz when your full set appears (never in reduced motion).
  useEffect(() => {
    if (youCanClaimNow && effects !== 'reduced' && typeof navigator !== 'undefined') {
      navigator.vibrate?.(effects === 'full' ? [60, 40, 60] : 60);
    }
  }, [youCanClaimNow, version, effects]);

  const latestReaction = (seat: number): BoardReaction | undefined =>
    [...reactions].reverse().find((r) => r.seat === seat);

  const select = async (handle: string) => {
    if (view.phase !== 'SELECTING' || !iAmActive || handle === view.mySelection) return;
    setPending(handle);
    await send({ type: 'SELECT', handle });
    setPending(null);
  };

  const claim = async () => {
    if (claiming) return;
    setClaiming(true);
    await send({ type: 'CLAIM' });
    setClaiming(false);
  };

  const selectedChit = view.hand.find((c) => c.handle === view.mySelection) ?? null;
  const inHand = view.hand.filter((c) => c.handle !== view.mySelection);
  const biggest = Math.max(0, ...countItems(view.hand).values());
  const receivedGlow =
    received && biggest >= 2 && (countItems(view.hand).get(received.item) ?? 0) === biggest
      ? received.handle
      : null;

  return (
    <LayoutGroup>
      <div className="sp">
        <div className="sp-top">
          <span className="sp-category">
            <span className="sp-category__icons" aria-hidden="true">
              {view.items.map((item) => (
                <ItemIcon key={item} item={item} size={20} />
              ))}
            </span>
            {CATEGORY_LABELS[view.categoryId] ?? view.categoryId}
          </span>
          <span className="sp-pass">
            {f('pass', { n: Math.max(1, view.cycle + (view.phase === 'SELECTING' ? 1 : 0)) })}
          </span>
        </div>

        <div className="sp-table" ref={tableRef}>
          <DirectionRing active={view.active} me={me} />
          {POSITIONS.map((position, i) => {
            const seat = (me + i) % 4;
            const info = seatInfo(seat);
            return (
              <SeatSpot
                key={seat}
                seat={seat}
                position={position}
                name={nameOf(seat)}
                isMe={seat === me}
                isBot={info?.controller === 'BOT'}
                selected={view.phase === 'SELECTING' && view.selected.includes(seat)}
                finish={view.finishes.find((x) => x.seat === seat)}
                justFinished={fresh.has(seat)}
                reaction={latestReaction(seat)}
                dealKey={dealt ? version : null}
                effects={effects}
              />
            );
          })}

          <div className="sp-desk">
            <Desk
              view={view}
              me={me}
              nameOf={nameOf}
              passTo={passTo}
              selectedChit={selectedChit}
              msUntil={msUntil}
              effects={effects}
              autoPicked={autoPick ? autoPick.item : null}
              finishes={view.finishes}
              freshFinish={view.finishes.filter((x) => fresh.has(x.seat)).at(-1)}
            />
          </div>

          {pass && (
            <PassFlights
              moves={pass.moves as PassMove[]}
              me={me}
              size={size}
              effects={effects}
              flightKey={version}
            />
          )}
        </div>

        <AnimatePresence>
          {view.canClaim && (
            <motion.div
              className="sp-claim"
              initial={effects === 'reduced' ? false : { scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
              transition={
                effects === 'full'
                  ? { type: 'spring', stiffness: 500, damping: 14 }
                  : { duration: durationFor(effects, 200, 140) / 1000 }
              }
            >
              <button
                type="button"
                className={`btn btn--pink btn--big sp-claim__btn${effects === 'full' ? ' is-pulsing' : ''}`}
                aria-label={f('claimLabel')}
                disabled={claiming}
                onClick={() => void claim()}
              >
                {f('claim')}
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {myFinish ? (
          <MyFinish finish={myFinish} fresh={fresh.has(me)} effects={effects} />
        ) : (
          <Hand
            groups={groupHand(inHand, view.items)}
            canSelect={view.phase === 'SELECTING' && iAmActive}
            pending={pending}
            claimable={view.canClaim}
            receivedHandle={received?.handle ?? null}
            receivedGlow={receivedGlow}
            dealt={dealt}
            passing={!!pass}
            effects={effects}
            onSelect={(h) => void select(h)}
          />
        )}
      </div>
    </LayoutGroup>
  );
}

// ───────────────────────────── desk ─────────────────────────────

function Desk({
  view,
  me,
  nameOf,
  passTo,
  selectedChit,
  msUntil,
  effects,
  autoPicked,
  finishes,
  freshFinish,
}: {
  view: ParchiView;
  me: number;
  nameOf(seat: number): string;
  passTo: number | null;
  selectedChit: Chit | null;
  msUntil(ts: number): number;
  effects: EffectsMode;
  autoPicked: string | null;
  finishes: readonly Finish[];
  freshFinish: Finish | undefined;
}) {
  const iAmActive = view.active.includes(me);
  let body: ReactNode;
  switch (view.phase) {
    case 'DEALING':
      body = <p className="sp-desk__text">{f('dealing')}</p>;
      break;
    case 'SELECTING':
      body = (
        <>
          <CountdownRing
            deadline={view.phaseEndsAt}
            totalMs={view.phaseMs}
            msUntil={msUntil}
            size={104}
            stroke={6}
            urgentMs={3000}
            showSeconds={false}
          >
            <span className={selectedChit ? 'sp-spot is-filled' : 'sp-spot'}>
              {selectedChit ? (
                <motion.span layoutId={`slip-${selectedChit.handle}`} className="sp-spot__slip">
                  <Slip item={selectedChit.item} folded size="hand" />
                </motion.span>
              ) : (
                iAmActive && <span className="sp-spot__arrow" aria-hidden="true" />
              )}
            </span>
          </CountdownRing>
          <p className="sp-desk__text">
            {!iAmActive
              ? f('othersPassing')
              : selectedChit && passTo !== null
                ? f('passingTo', { name: nameOf(passTo) })
                : passTo !== null
                  ? f('pickToPass', { name: nameOf(passTo) })
                  : ''}
          </p>
          {iAmActive && selectedChit && <p className="sp-desk__sub">{f('swapHint')}</p>}
        </>
      );
      break;
    case 'PASSING':
      body = (
        <>
          <p className="sp-desk__big">{f('passing')}</p>
          {autoPicked && (
            <p className="sp-desk__sub">{f('autoPicked', { item: itemLabel(autoPicked) })}</p>
          )}
        </>
      );
      break;
    case 'CLAIM_WINDOW':
      body = (
        <>
          <CountdownRing
            deadline={view.phaseEndsAt}
            totalMs={view.phaseMs}
            msUntil={msUntil}
            size={64}
            stroke={6}
            urgentMs={2000}
          />
          <p className={view.canClaim ? 'sp-desk__big is-hot' : 'sp-desk__big'}>
            {view.canClaim ? f('claimMine') : f('claimOthers')}
          </p>
        </>
      );
      break;
    case 'CLAIM_HOLD': {
      const last = freshFinish ?? finishes.at(-1);
      body = last && (
        <>
          <Medal place={last.place} size={48} />
          <p className="sp-desk__text">
            {last.seat === me
              ? f('youFinished', { place: placeLabel(last.place) })
              : f('finished', { name: nameOf(last.seat), place: placeLabel(last.place) })}
          </p>
        </>
      );
      break;
    }
    case 'OVER':
      body = <p className="sp-desk__big">{view.endedByCap ? f('cappedOver') : f('matchOver')}</p>;
      break;
  }
  const ms = durationFor(effects, 260, 150);
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.div
        key={view.phase}
        className="sp-desk__inner"
        aria-live="polite"
        initial={effects === 'reduced' ? false : { opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.94 }}
        transition={{ duration: ms / 1000 }}
      >
        {body}
      </motion.div>
    </AnimatePresence>
  );
}

// ───────────────────────────── hand ─────────────────────────────

function Hand({
  groups,
  canSelect,
  pending,
  claimable,
  receivedHandle,
  receivedGlow,
  dealt,
  passing,
  effects,
  onSelect,
}: {
  groups: { item: string; chits: Chit[] }[];
  canSelect: boolean;
  pending: string | null;
  claimable: boolean;
  receivedHandle: string | null;
  receivedGlow: string | null;
  dealt: boolean;
  passing: boolean;
  effects: EffectsMode;
  onSelect(handle: string): void;
}) {
  const wave = durationFor(effects, 300, 120) / 1000;
  const flight = durationFor(effects, 800, 480) / 1000;
  let index = 0;
  return (
    <section className={claimable ? 'sp-hand is-claimable' : 'sp-hand'} aria-label={f('yourSlips')}>
      {groups.map((group) => (
        <div key={group.item} className="sp-group">
          {group.chits.map((chit) => {
            const i = index++;
            const arriving = passing && chit.handle === receivedHandle;
            const initial =
              effects === 'reduced'
                ? false
                : dealt
                  ? { y: -160, opacity: 0, scale: 0.5 }
                  : arriving
                    ? { y: 40, opacity: 0 }
                    : false;
            const landMs = flight * 850;
            return (
              <motion.button
                key={chit.handle}
                layoutId={`slip-${chit.handle}`}
                type="button"
                className={pending === chit.handle ? 'sp-hand__slip is-pending' : 'sp-hand__slip'}
                disabled={!canSelect}
                aria-label={f('slipPass', { item: itemLabel(chit.item) })}
                initial={initial}
                animate={{ y: pending === chit.handle ? -10 : 0, opacity: 1, scale: 1 }}
                transition={{
                  duration: durationFor(effects, 380, 200) / 1000,
                  delay: dealt ? i * wave : arriving ? landMs / 1000 : 0,
                  ease: [0.22, 1, 0.36, 1],
                }}
                onClick={() => onSelect(chit.handle)}
              >
                <Slip
                  item={chit.item}
                  folded={false}
                  size="hand"
                  glow={claimable || receivedGlow === chit.handle}
                  {...(arriving ? { unfoldAfterMs: landMs + 150 } : {})}
                />
              </motion.button>
            );
          })}
          {group.chits.length > 1 && (
            <span className="sp-group__count" aria-hidden="true">
              {f('groupCount', { n: group.chits.length })}
            </span>
          )}
        </div>
      ))}
    </section>
  );
}

function MyFinish({
  finish,
  fresh,
  effects,
}: {
  finish: Finish;
  fresh: boolean;
  effects: EffectsMode;
}) {
  return (
    <motion.section
      className="sp-mine-done"
      initial={fresh && effects !== 'reduced' ? { scale: 1.25, y: -30, opacity: 0 } : false}
      animate={{ scale: 1, y: 0, opacity: 1 }}
      transition={
        effects === 'full'
          ? { type: 'spring', stiffness: 380, damping: 12 }
          : { duration: durationFor(effects, 300, 160) / 1000 }
      }
    >
      <FinishedSet finish={finish} fresh={fresh} effects={effects} />
      <p className="sp-mine-done__text">{f('youFinished', { place: placeLabel(finish.place) })}</p>
      <p className="sp-mine-done__sub">{f('watching')}</p>
    </motion.section>
  );
}
