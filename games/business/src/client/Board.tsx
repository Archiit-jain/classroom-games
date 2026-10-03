import type { BoardProps, BoardReaction, EffectsMode } from '@cg/game-sdk/client';
import type { SeatView } from '@cg/protocol';
import { CountdownRing, ReactionBubble, RollingNumber, durationFor, seatAccent } from '@cg/ui';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  BOARD,
  BOARD_COLS,
  BOARD_ROWS,
  MAX_LEVEL,
  OWNABLE_SPACES,
  cityFee,
  developCost,
  isCity,
  isIndustry,
  priceOf,
  tilePosition,
  type BusinessAction,
  type BusinessEvent,
  type BusinessView,
  type Choice,
  type LogEntry,
  type Space,
} from '../shared';
import { BuildingIcon, CoinIcon, CornerIcon, DeckIcon, IndustryIcon, TokenIcon } from './icons';
import { f, fk } from './messages';
import { HOP_MS } from './timing';
import './business.css';

type Props = BoardProps<BusinessView, BusinessAction, BusinessEvent>;

export const spaceName = (index: number): string => {
  const s = BOARD[index] as Space;
  switch (s.kind) {
    case 'city':
      return fk(`city.${s.id}`);
    case 'industry':
      return fk(`industry.${s.id}`);
    case 'card':
      return fk(`deck.${s.deck}`);
    case 'corner':
      return fk(`corner.${s.corner}`);
  }
};
const levelName = (level: number) => fk(`level.${Math.max(1, Math.min(MAX_LEVEL, level))}`);
const seatColor = (seat: number) => `var(--cb-${seatAccent(seat)})`;

/** Is the board wider than tall where it sits? (Landscape board: 10 × 6.) */
function useWide(ref: React.RefObject<HTMLElement | null>): boolean {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWide(el.clientWidth >= 640);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return wide;
}

/**
 * Token positions as shown: the rolling player's token hops along the server's path
 * (full), slides (lite) or jumps (reduced); everyone else stands where the view says.
 */
function useShownPositions(
  view: BusinessView,
  events: readonly BusinessEvent[],
  version: number,
  effects: EffectsMode,
) {
  const rolled = events.find(
    (e): e is Extract<BusinessEvent, { type: 'ROLLED' }> => e.type === 'ROLLED',
  );
  const [hop, setHop] = useState<{
    version: number;
    seat: number;
    path: number[];
    step: number;
  } | null>(null);
  if (rolled && effects !== 'reduced' && hop?.version !== version) {
    setHop({ version, seat: rolled.seat, path: [rolled.from, ...rolled.path], step: 0 });
  }
  useEffect(() => {
    if (!hop || hop.step >= hop.path.length - 1) return;
    const timer = setTimeout(
      () => setHop((h) => (h && h.version === hop.version ? { ...h, step: h.step + 1 } : h)),
      HOP_MS[effects === 'lite' ? 'lite' : 'full'],
    );
    return () => clearTimeout(timer);
  }, [hop, effects]);
  const shown = { ...view.positions };
  if (hop && hop.version === version && hop.step < hop.path.length - 1) {
    shown[hop.seat] = hop.path[hop.step] as number;
  }
  return { shown, moving: hop && hop.step < hop.path.length - 1 ? hop.seat : null };
}

/** Keeps a value on screen for `ms` after the update that brought it. */
function useFlash<T>(value: T | null, key: number, ms: number): T | null {
  const [state, setState] = useState<{ key: number; value: T | null }>({ key, value: null });
  if (value !== null && state.key !== key) setState({ key, value });
  useEffect(() => {
    if (state.value === null) return;
    const timer = setTimeout(
      () => setState((s) => (s.key === state.key ? { ...s, value: null } : s)),
      ms,
    );
    return () => clearTimeout(timer);
  }, [state.key, state.value, ms]);
  return state.value;
}

const logsIn = (events: readonly BusinessEvent[]) =>
  events.flatMap((e) => (e.type === 'LOG' ? [e.entry] : []));

export default function BusinessBoard(props: Props) {
  const { view, events, version, me, seats, send, effects, msUntil, reactions } = props;
  const wrap = useRef<HTMLDivElement>(null);
  const wide = useWide(wrap);
  const { shown, moving } = useShownPositions(view, events, version, effects);
  /**
   * A tapped tile's postcard stays up while others play (bots move fast) and goes back to
   * the current space when the player taps Back or their own next turn begins.
   */
  const [focus, setFocus] = useState<{ turn: number; space: number } | null>(null);
  const myTurnStarted = view.current === me && focus !== null && view.turn !== focus.turn;
  if (myTurnStarted) setFocus(null);
  const looking = focus !== null && !myTurnStarted;
  const [busy, setBusy] = useState(false);

  const nameOf = (seat: number) =>
    seat === me ? f('you') : (seats.find((s) => s.seat === seat)?.displayName ?? `#${seat + 1}`);
  const fresh = logsIn(events);
  const card = useFlash(
    (() => {
      const c = fresh.find((e) => e.type === 'CARD');
      return c && c.type === 'CARD' ? { deck: c.deck, card: c.card, seat: c.seat } : null;
    })(),
    version,
    effects === 'reduced' ? 3200 : 2600,
  );
  const wheel = useFlash(
    (() => {
      const w = fresh.find((e) => e.type === 'WHEEL');
      return w && w.type === 'WHEEL' ? w.slice : null;
    })(),
    version,
    2200,
  );
  const sold = useFlash(
    (() => {
      const b = fresh.find((e) => e.type === 'BOUGHT');
      return b && b.type === 'BOUGHT' ? b.space : null;
    })(),
    version,
    1400,
  );

  const mine = view.current === me && view.phase !== 'OVER';
  const decision = mine && view.phase === 'DECIDE' ? view.decision : null;
  const optionSpaces = new Set(decision?.options.map((o) => o.space) ?? []);
  const here = view.positions[view.current] ?? 0;
  const postcardSpace =
    looking && focus
      ? focus.space
      : decision && decision.kind !== 'EXPAND'
        ? (decision.options[0]?.space ?? here)
        : here;

  const act = async (action: Omit<BusinessAction, 'turn'> & { space?: number }) => {
    if (busy) return;
    setBusy(true);
    await send({ ...action, turn: view.turn } as BusinessAction);
    setBusy(false);
  };

  const latestReaction = (seat: number): BoardReaction | undefined =>
    [...reactions].reverse().find((r) => r.seat === seat);

  const cols = wide ? BOARD_ROWS : BOARD_COLS;
  const rows = wide ? BOARD_COLS : BOARD_ROWS;
  const place = (index: number) => {
    const p = tilePosition(index);
    // Turned a quarter clockwise, so play still runs clockwise round the ring.
    return wide ? { row: p.col, col: BOARD_ROWS - 1 - p.row } : p;
  };
  const timed = (view.phase === 'ROLL' || view.phase === 'DECIDE') && view.phaseMs > 0;

  return (
    <div className={`bz${wide ? ' bz--wide' : ''}`} ref={wrap}>
      <Players view={view} seats={seats} me={me} reaction={latestReaction} />

      <div
        className="bz-board"
        style={{ '--cols': cols, '--rows': rows } as CSSProperties}
        role="group"
        aria-label={f('board', { name: nameOf(view.current), place: spaceName(here) })}
      >
        {BOARD.map((space, i) => {
          const p = place(i);
          const owner = view.owner[i];
          const tokens = view.seats.filter((x) => shown[x] === i);
          return (
            <button
              key={i}
              type="button"
              className={[
                'bz-tile',
                `bz-tile--${space.kind}`,
                space.kind === 'city' && `bz-tile--${space.region}`,
                owner !== null && owner !== undefined && 'bz-tile--owned',
                optionSpaces.has(i) && 'bz-tile--option',
                i === postcardSpace && 'bz-tile--focus',
              ]
                .filter(Boolean)
                .join(' ')}
              style={
                {
                  gridRow: p.row + 1,
                  gridColumn: p.col + 1,
                  ...(owner !== null && owner !== undefined ? { '--owner': seatColor(owner) } : {}),
                } as CSSProperties
              }
              aria-label={tileLabel(view, i, nameOf)}
              data-space={i}
              onClick={() =>
                decision?.kind === 'EXPAND' && optionSpaces.has(i)
                  ? void act({ type: 'DEVELOP', space: i })
                  : setFocus({ turn: view.turn, space: i })
              }
            >
              <TileFace space={space} index={i} level={view.level[i] ?? 0} />
              {tokens.length > 0 && (
                <span className="bz-tokens">
                  {tokens.map((x) => (
                    <motion.span
                      key={`${x}-${shown[x]}`}
                      className={`bz-token${x === moving ? ' bz-token--moving' : ''}`}
                      style={{ '--seat': seatColor(x) } as CSSProperties}
                      initial={effects === 'full' && x === moving ? { y: -10, scale: 1.2 } : false}
                      animate={{ y: 0, scale: 1 }}
                      transition={{ type: 'spring', stiffness: 700, damping: 18 }}
                    >
                      <TokenIcon seat={x} size={12} />
                    </motion.span>
                  ))}
                </span>
              )}
              <AnimatePresence>
                {sold === i && effects !== 'reduced' && (
                  <motion.span
                    className="bz-sold"
                    initial={{ scale: effects === 'full' ? 2.2 : 1, opacity: 0, rotate: -20 }}
                    animate={{ scale: 1, opacity: 1, rotate: -12 }}
                    exit={{ opacity: 0 }}
                  >
                    {f('sold')}
                  </motion.span>
                )}
              </AnimatePresence>
            </button>
          );
        })}

        <div className="bz-stage">
          <div className="bz-stage__top">
            <span className="bz-chip">
              {f('round', { round: Math.min(view.round, view.rounds), rounds: view.rounds })}
            </span>
            {timed && (
              <CountdownRing
                key={`${view.turn}-${view.phase}`}
                deadline={view.phaseEndsAt}
                totalMs={view.phaseMs}
                msUntil={msUntil}
                size={38}
              />
            )}
          </div>
          <p className="bz-status" aria-live="polite">
            {view.phase === 'OVER'
              ? f('finalWealth')
              : mine
                ? f('yourTurn')
                : f('turnOf', { name: nameOf(view.current) })}
          </p>
          <Dice
            view={view}
            effects={effects}
            version={version}
            rolled={events.some((e) => e.type === 'ROLLED')}
          />
          <AnimatePresence mode="wait">
            {card ? (
              <motion.div
                key={`card-${version}`}
                className={`bz-card bz-card--${card.deck}`}
                role="status"
                initial={
                  effects === 'reduced'
                    ? false
                    : effects === 'full'
                      ? { rotateY: 90, scale: 0.8 }
                      : { opacity: 0 }
                }
                animate={{ rotateY: 0, scale: 1, opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: durationFor(effects, 350, 180) / 1000 }}
              >
                <span className="bz-card__deck">
                  <DeckIcon deck={card.deck} size={16} /> {fk(`deck.${card.deck}`)}
                </span>
                <span className="bz-card__text">{fk(`card.${card.card}`)}</span>
              </motion.div>
            ) : wheel !== null ? (
              <motion.div key={`wheel-${version}`} className="bz-card bz-card--wheel" role="status">
                <CornerIcon id="lucky" size={20} />
                <span className="bz-card__text">{fk(`wheel.${wheel}`)}</span>
              </motion.div>
            ) : (
              <Postcard
                key={`pc-${postcardSpace}`}
                view={view}
                index={postcardSpace}
                nameOf={nameOf}
              />
            )}
          </AnimatePresence>
          {looking && (
            <button type="button" className="bz-link" onClick={() => setFocus(null)}>
              {f('back')}
            </button>
          )}
          <Actions view={view} mine={mine} busy={busy} nameOf={nameOf} act={act} />
        </div>
      </div>

      <Log view={view} nameOf={nameOf} />
    </div>
  );
}

function tileLabel(view: BusinessView, i: number, nameOf: (seat: number) => string): string {
  const parts = [spaceName(i)];
  const owner = view.owner[i];
  if (owner !== null && owner !== undefined) {
    parts.push(f('owner', { name: nameOf(owner) }));
    if (isCity(BOARD[i])) parts.push(levelName(view.level[i] ?? 1));
  } else if (isCity(BOARD[i]) || isIndustry(BOARD[i])) {
    parts.push(f('price', { n: priceOf(i, view.economy) }));
  }
  const here = view.seats.filter((x) => view.positions[x] === i).map(nameOf);
  if (here.length > 0) parts.push(here.join(', '));
  return parts.join(' · ');
}

function TileFace({ space, index, level }: { space: Space; index: number; level: number }) {
  return (
    <>
      {space.kind === 'city' && <span className="bz-tile__band" aria-hidden="true" />}
      {space.kind === 'industry' && <IndustryIcon id={space.id} size={18} />}
      {space.kind === 'corner' && <CornerIcon id={space.corner} size={20} />}
      {space.kind === 'card' && <DeckIcon deck={space.deck} size={18} />}
      <span className={`bz-tile__name${spaceName(index).length > 8 ? ' bz-tile__name--long' : ''}`}>
        {spaceName(index)}
      </span>
      {space.kind === 'city' && level > 0 && (
        <span className="bz-tile__level" aria-hidden="true">
          <BuildingIcon level={level} size={13} />
        </span>
      )}
      {(space.kind === 'city' || space.kind === 'industry') && level === 0 && (
        <span className="bz-tile__price" aria-hidden="true">
          {priceOf(index)}
        </span>
      )}
    </>
  );
}

function Players({
  view,
  seats,
  me,
  reaction,
}: {
  view: BusinessView;
  seats: readonly SeatView[];
  me: number;
  reaction(seat: number): BoardReaction | undefined;
}) {
  return (
    <ol className="bz-players">
      {[...seats]
        .sort((a, b) => view.order.indexOf(a.seat) - view.order.indexOf(b.seat))
        .map((s) => {
          const broke =
            (view.coins[s.seat] ?? 0) === 0 &&
            OWNABLE_SPACES.every((i) => view.owner[i] !== s.seat);
          return (
            <li
              key={s.seat}
              className={[
                'bz-player',
                s.seat === view.current && view.phase !== 'OVER' && 'bz-player--current',
                s.seat === me && 'bz-player--me',
              ]
                .filter(Boolean)
                .join(' ')}
              style={{ '--seat': seatColor(s.seat) } as CSSProperties}
            >
              <ReactionBubble reaction={reaction(s.seat)} />
              <span className="bz-player__token" aria-hidden="true">
                <TokenIcon seat={s.seat} size={16} />
              </span>
              <span className="bz-player__name">
                {s.displayName}
                {s.controller === 'BOT' && <span className="bz-player__bot">{f('bot')}</span>}
              </span>
              <span
                className="bz-player__coins"
                aria-label={f('coins', { n: view.coins[s.seat] ?? 0 })}
              >
                <CoinIcon size={14} />
                <RollingNumber value={view.coins[s.seat] ?? 0} durationMs={600} />
              </span>
              {broke && <span className="bz-player__broke">{f('broke')}</span>}
            </li>
          );
        })}
    </ol>
  );
}

const PIPS: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [
    [28, 28],
    [72, 72],
  ],
  3: [
    [25, 25],
    [50, 50],
    [75, 75],
  ],
  4: [
    [28, 28],
    [72, 28],
    [28, 72],
    [72, 72],
  ],
  5: [
    [25, 25],
    [75, 25],
    [50, 50],
    [25, 75],
    [75, 75],
  ],
  6: [
    [28, 22],
    [72, 22],
    [28, 50],
    [72, 50],
    [28, 78],
    [72, 78],
  ],
};

function Dice({
  view,
  effects,
  version,
  rolled,
}: {
  view: BusinessView;
  effects: EffectsMode;
  version: number;
  rolled: boolean;
}) {
  const dice = view.lastRoll && view.lastRoll.seat === view.current ? view.lastRoll.dice : null;
  if (!dice) return <div className="bz-dice" aria-hidden="true" />;
  return (
    <div
      className="bz-dice"
      role="img"
      aria-label={f('rolled', { total: dice.reduce((a, b) => a + b, 0) })}
    >
      {dice.map((d, k) => (
        <motion.svg
          key={`${version}-${k}`}
          className="bz-die"
          viewBox="0 0 100 100"
          initial={rolled && effects === 'full' ? { rotate: -200, y: -18, scale: 0.6 } : false}
          animate={{ rotate: 0, y: 0, scale: 1 }}
          transition={{ type: 'spring', stiffness: 260, damping: 14, delay: k * 0.06 }}
        >
          <rect x={4} y={4} width={92} height={92} rx={18} />
          {(PIPS[d] ?? []).map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r={9} />
          ))}
        </motion.svg>
      ))}
      {dice.length === 1 && <span className="bz-dice__note">{f('oneDie')}</span>}
    </div>
  );
}

function Postcard({
  view,
  index,
  nameOf,
}: {
  view: BusinessView;
  index: number;
  nameOf(seat: number): string;
}) {
  const space = BOARD[index] as Space;
  const owner = view.owner[index];
  return (
    <div
      className={`bz-postcard bz-postcard--${space.kind}${space.kind === 'city' ? ` bz-tile--${space.region}` : ''}`}
    >
      <div className="bz-postcard__head">
        <span className="bz-postcard__name">{spaceName(index)}</span>
        {space.kind === 'city' && (
          <span className="bz-postcard__region">{fk(`region.${space.region}`)}</span>
        )}
      </div>
      {space.kind === 'city' && (
        <>
          <p className="bz-postcard__line">
            {owner !== null && owner !== undefined
              ? `${f('owner', { name: nameOf(owner) })} · ${levelName(view.level[index] ?? 1)}`
              : `${f('forSale')} · ${f('price', { n: priceOf(index, view.economy) })}`}
          </p>
          <ol className="bz-fees" aria-label={f('feeLine')}>
            {[1, 2, 3, 4].map((lv) => (
              <li key={lv} className={(view.level[index] ?? 0) === lv ? 'bz-fees__on' : undefined}>
                <BuildingIcon level={lv} size={13} />
                {cityFee(index, lv, false, view.economy)}
              </li>
            ))}
          </ol>
          <p className="bz-postcard__small">
            {f('developCost', { n: developCost(index, view.economy) })} · {f('regionBonus')}
          </p>
        </>
      )}
      {space.kind === 'industry' && (
        <>
          <p className="bz-postcard__line">
            {owner !== null && owner !== undefined
              ? f('owner', { name: nameOf(owner) })
              : `${f('forSale')} · ${f('price', { n: view.economy.industryPrice })}`}
          </p>
          <p className="bz-postcard__small">{f('dividendLine', { n: view.economy.dividend })}</p>
          <p className="bz-postcard__small">{f('factoryLine', { n: view.economy.factoryVisit })}</p>
        </>
      )}
      {space.kind === 'corner' && (
        <p className="bz-postcard__line">
          {fk(`about.${space.corner}`, { n: view.economy.salary })}
        </p>
      )}
      {space.kind === 'card' && <p className="bz-postcard__line">{fk(`about.${space.deck}`)}</p>}
    </div>
  );
}

function Actions({
  view,
  mine,
  busy,
  nameOf,
  act,
}: {
  view: BusinessView;
  mine: boolean;
  busy: boolean;
  nameOf(seat: number): string;
  act(a: { type: BusinessAction['type']; space?: number }): Promise<void>;
}) {
  if (view.phase === 'OVER') return null;
  if (!mine) return <p className="bz-wait">{f('waitFor', { name: nameOf(view.current) })}</p>;
  if (view.phase === 'ROLL') {
    return (
      <div className="bz-actions">
        <button
          type="button"
          className="btn btn--yellow bz-roll"
          disabled={busy}
          onClick={() => void act({ type: 'ROLL' })}
        >
          {f('roll')}
        </button>
      </div>
    );
  }
  const d = view.decision;
  if (view.phase !== 'DECIDE' || !d) return null;
  const coins = view.coins[view.current] ?? 0;
  if (d.kind === 'EXPAND') {
    return (
      <div className="bz-actions bz-actions--expand">
        <p className="bz-actions__q">{f('expandQ')}</p>
        <div className="bz-actions__list">
          {d.options.map((o: Choice) => (
            <button
              key={o.space}
              type="button"
              className="btn btn--small bz-option"
              disabled={busy || o.cost > coins}
              onClick={() => void act({ type: 'DEVELOP', space: o.space })}
            >
              {f('expandOption', {
                place: spaceName(o.space),
                level: levelName((view.level[o.space] ?? 1) + 1),
                cost: o.cost,
              })}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="btn btn--small bz-skip"
          disabled={busy}
          onClick={() => void act({ type: 'SKIP' })}
        >
          {f('skip')}
        </button>
      </div>
    );
  }
  const o = d.options[0] as Choice;
  const label =
    d.kind === 'BUY'
      ? f('buy', { cost: o.cost })
      : f('develop', { level: levelName((view.level[o.space] ?? 1) + 1), cost: o.cost });
  return (
    <div className="bz-actions">
      <p className="bz-actions__q">
        {d.kind === 'BUY'
          ? f('buyQ', { place: spaceName(o.space) })
          : f('developQ', { place: spaceName(o.space) })}
      </p>
      <div className="bz-actions__row">
        <button
          type="button"
          className="btn btn--yellow"
          disabled={busy || o.cost > coins}
          onClick={() => void act({ type: d.kind === 'BUY' ? 'BUY' : 'DEVELOP', space: o.space })}
        >
          {label}
        </button>
        <button
          type="button"
          className="btn bz-skip"
          disabled={busy}
          onClick={() => void act({ type: 'SKIP' })}
        >
          {f('skip')}
        </button>
      </div>
    </div>
  );
}

export function logLine(e: LogEntry, nameOf: (seat: number) => string): string {
  switch (e.type) {
    case 'ROLLED':
      return f('log.ROLLED', {
        name: nameOf(e.seat),
        dice: e.dice.join(' + '),
        place: spaceName(e.to),
      });
    case 'SALARY':
      return f('log.SALARY', { name: nameOf(e.seat), n: e.amount });
    case 'DIVIDEND':
      return f('log.DIVIDEND', { name: nameOf(e.seat), n: e.amount });
    case 'BOUGHT':
      return f('log.BOUGHT', { name: nameOf(e.seat), place: spaceName(e.space), n: e.price });
    case 'DEVELOPED':
      return f(e.cost > 0 ? 'log.DEVELOPED' : 'log.DEVELOPED_FREE', {
        name: nameOf(e.seat),
        level: levelName(e.level),
        place: spaceName(e.space),
      });
    case 'PAID': {
      const base =
        e.to === null
          ? f('log.PAID_BANK', { name: nameOf(e.from), n: e.amount })
          : f('log.PAID', { name: nameOf(e.from), n: e.amount, to: nameOf(e.to) });
      return e.writtenOff > 0 ? `${base} ${f('log.WRITTEN_OFF', { n: e.writtenOff })}` : base;
    }
    case 'GAINED':
      return f('log.GAINED', { name: nameOf(e.seat), n: e.amount });
    case 'CARD':
      return `${f('log.CARD', { name: nameOf(e.seat), deck: fk(`deck.${e.deck}`) })} — ${fk(`card.${e.card}`)}`;
    case 'WHEEL':
      return f('log.WHEEL', { name: nameOf(e.seat), slice: fk(`wheel.${e.slice}`) });
    case 'MOVED':
      return f('log.MOVED', { name: nameOf(e.seat), place: spaceName(e.to) });
    case 'JAM':
      return f('log.JAM', { name: nameOf(e.seat) });
    case 'CLEARANCE':
      return f('log.CLEARANCE', { name: nameOf(e.seat), n: e.raised });
    case 'SKIPPED':
      return f('log.SKIPPED', { name: nameOf(e.seat) });
  }
}

function Log({ view, nameOf }: { view: BusinessView; nameOf(seat: number): string }) {
  const recent = view.log.slice(-6).reverse();
  if (recent.length === 0) return null;
  return (
    <section className="bz-log" aria-label={f('log')}>
      <h3 className="bz-log__title">{f('log')}</h3>
      <ol className="bz-log__list" aria-live="polite">
        {recent.map((e, i) => (
          <li
            key={`${view.log.length - i}`}
            className={`bz-log__item bz-log__item--${e.type.toLowerCase()}`}
          >
            {logLine(e, nameOf)}
          </li>
        ))}
      </ol>
    </section>
  );
}
