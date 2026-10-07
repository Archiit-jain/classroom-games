import type { BoardProps, BoardReaction, EffectsMode } from '@cg/game-sdk/client';
import type { SeatView } from '@cg/protocol';
import { CountdownRing, ReactionBubble, RollingNumber, seatAccent } from '@cg/ui';
import { AnimatePresence, motion } from 'motion/react';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import {
  ASSET_SPACES,
  BOARD,
  HOTEL,
  TRANSPORT_SPACES,
  baseRent,
  buildCost,
  buildingsValue,
  cellOf,
  cityRent,
  edgeOf,
  eventOutcome,
  groupSpaces,
  isCity,
  isTransport,
  priceOf,
  transportRent,
  type BusinessAction,
  type BusinessEvent,
  type BusinessView,
  type Deck,
  type Economy,
  type Group,
  type LogEntry,
  type Space,
} from '../shared';
import {
  BusinessIcon,
  CityIcon,
  CornerIcon,
  DeckIcon,
  Hotel,
  House,
  RupeeChip,
  Token,
  TransportIcon,
} from './icons';
import { f, fk, rupees } from './messages';
import { DICE_MS, HOP_MS, LAND_MS, walkMs } from './timing';
import './business.css';

type Props = BoardProps<BusinessView, BusinessAction, BusinessEvent>;
type Send = (a: Omit<BusinessAction, 'turn'> & Record<string, unknown>) => Promise<void>;

/** Grid tracks: corners are 1.55 × a side tile; the same on both axes. */
const CORNER_TRACK = 1.55;
const TRACK_TOTAL = 8 + 2 * CORNER_TRACK;
const trackCenter = (k: number) =>
  ((k === 0
    ? CORNER_TRACK / 2
    : k === 9
      ? TRACK_TOTAL - CORNER_TRACK / 2
      : CORNER_TRACK + k - 0.5) /
    TRACK_TOTAL) *
  100;
/** Centre of a space in % of the board. */
const spot = (i: number) => {
  const c = cellOf(i);
  return { x: trackCenter(c.col), y: trackCenter(c.row) };
};
/** Where tokens stand: nudged towards the outer edge so the tile's name stays readable. */
const OUTWARD = 2.2;
const stand = (i: number) => {
  const p = spot(i);
  switch (edgeOf(i)) {
    case 'right':
      return { x: p.x + OUTWARD, y: p.y };
    case 'top':
      return { x: p.x, y: p.y - OUTWARD };
    case 'left':
      return { x: p.x - OUTWARD, y: p.y };
    case 'bottom':
      return { x: p.x, y: p.y + OUTWARD };
    default:
      return p;
  }
};

/** Event text with the economy's (scaled) amounts filled in. */
export function eventText(deck: Deck, sum: number, e: Economy): string {
  const fx = eventOutcome(deck, sum, e).effect;
  const params: Record<string, string> = { salary: rupees(e.salary) };
  if ('amount' in fx) params.amount = rupees(fx.amount);
  if (fx.kind === 'freeBuilding') params.fallback = rupees(fx.fallback);
  if (fx.kind === 'repairs') {
    params.perHouse = rupees(fx.perHouse);
    params.perHotel = rupees(fx.perHotel);
    params.max = rupees(fx.max);
  }
  return fk(`event.${deck}.${sum}`, params);
}

const REGION_ORDER: readonly Group[] = ['A', 'B', 'C', 'D'];
const levelName = (lv: number) => fk(`level.${lv}`);

export const seatColor = (seat: number) => `var(--cb-${seatAccent(seat)})`;
export const spaceName = (i: number, short = false): string => {
  const s = BOARD[i] as Space;
  switch (s.kind) {
    case 'city':
      return short && fk(`short.${s.id}`) !== `short.${s.id}`
        ? fk(`short.${s.id}`)
        : fk(`city.${s.id}`);
    case 'transport':
      return fk(`transport.${s.id}`);
    case 'event':
      return fk(`deck.${s.deck}`);
    case 'corner':
      return fk(`corner.${s.corner}`);
  }
};

const logsIn = (events: readonly BusinessEvent[]) =>
  events.flatMap((e) => (e.type === 'LOG' ? [e.entry] : []));

/** Keeps a value for `ms` after the update that brought it. */
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

/**
 * Phones (narrow, or short in landscape) zoom in and follow the play; bigger screens show
 * the whole board and tilt it.
 */
function useCompact(ref: React.RefObject<HTMLElement | null>): {
  compact: boolean;
  landscape: boolean;
} {
  const [state, setState] = useState({ compact: false, landscape: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => {
      const compact = el.clientWidth < 640 || window.innerHeight < 500;
      // A phone on its side: too short for the stacked layout, wide enough for two columns.
      const landscape = window.innerHeight < 500 && el.clientWidth >= 640;
      setState((s) =>
        s.compact === compact && s.landscape === landscape ? s : { compact, landscape },
      );
    };
    const ro = new ResizeObserver(check);
    ro.observe(el);
    window.addEventListener('resize', check);
    check();
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', check);
    };
  }, [ref]);
  return state;
}

interface Walk {
  version: number;
  seat: number;
  /** The authoritative path from the server, starting where the pawn stood. */
  path: number[];
  step: number;
  stage: 'dice' | 'walk' | 'landed' | 'done';
  /** How many times the pawn has stepped onto START so far (keys the pass-START flash). */
  passed: number;
}

/**
 * The pawn walks the server's path space by space in every effects mode: the dice
 * tumble, then one hop per space (passing START flashes the salary), then a landing.
 * Decisions, rent and ownership wait until it has landed.
 */
function useWalk(
  view: BusinessView,
  events: readonly BusinessEvent[],
  version: number,
  effects: EffectsMode,
) {
  const rolled = events.find(
    (e): e is Extract<BusinessEvent, { type: 'ROLLED' }> =>
      e.type === 'ROLLED' && e.path.length > 0,
  );
  const [walk, setWalk] = useState<Walk | null>(null);
  if (rolled && walk?.version !== version) {
    setWalk({
      version,
      seat: rolled.seat,
      path: [rolled.from, ...rolled.path],
      step: 0,
      stage: rolled.dice.length > 0 ? 'dice' : 'walk',
      passed: 0,
    });
  }
  useEffect(() => {
    if (!walk || walk.stage === 'done') return;
    const ms =
      walk.stage === 'dice'
        ? DICE_MS[effects]
        : walk.stage === 'walk'
          ? HOP_MS[effects]
          : LAND_MS[effects];
    const v = walk.version;
    const t = setTimeout(
      () =>
        setWalk((w) => {
          if (!w || w.version !== v) return w;
          if (w.stage === 'dice') return { ...w, stage: 'walk' };
          if (w.stage === 'walk') {
            if (w.step >= w.path.length - 1) return { ...w, stage: 'landed' };
            const step = w.step + 1;
            return { ...w, step, passed: w.path[step] === 0 ? w.passed + 1 : w.passed };
          }
          return { ...w, stage: 'done' };
        }),
      ms,
    );
    return () => clearTimeout(t);
  }, [walk, effects]);
  const active = walk !== null && walk.stage !== 'done';
  const shown: Record<number, number> = {};
  for (const x of view.seats) shown[x] = view.players[x]?.position ?? 0;
  if (active && walk) shown[walk.seat] = walk.path[walk.step] as number;
  return {
    shown,
    /** The seat whose pawn is still rolling or walking. */
    moving: active && walk && (walk.stage === 'dice' || walk.stage === 'walk') ? walk.seat : null,
    /** The seat whose pawn just landed (bounce). */
    landed: active && walk?.stage === 'landed' ? walk.seat : null,
    /** Anyone's roll is still being shown (dice → walk → landing). */
    walking: active,
    passKey: walk && walk.passed > 0 ? `${walk.version}-${walk.passed}` : null,
  };
}

// ───────────────────────────── money flights ─────────────────────────────

interface Flight {
  id: string;
  from: string;
  to: string;
  amount: number;
}

function flightsFor(entries: LogEntry[], version: number): Flight[] {
  const out: Flight[] = [];
  const seatA = (s: number) => `seat-${s}`;
  entries.forEach((e, k) => {
    const id = `${version}-${k}`;
    switch (e.type) {
      case 'PAID':
        if (e.amount > 0)
          out.push({
            id,
            from: seatA(e.from),
            to: e.to === null ? 'bank' : seatA(e.to),
            amount: e.amount,
          });
        break;
      case 'GAINED':
      case 'SALARY':
        out.push({ id, from: 'bank', to: seatA(e.seat), amount: e.amount });
        break;
      case 'BOUGHT':
        out.push({ id, from: seatA(e.seat), to: 'bank', amount: e.price });
        break;
      case 'BUILT':
        if (e.cost > 0) out.push({ id, from: seatA(e.seat), to: 'bank', amount: e.cost });
        break;
      case 'LOAN':
        out.push({ id, from: 'bank', to: seatA(e.seat), amount: e.amount });
        break;
      case 'REPAID':
        out.push({ id, from: seatA(e.seat), to: 'bank', amount: e.amount });
        break;
      case 'SOLD':
        out.push({ id, from: 'bank', to: seatA(e.seat), amount: e.value });
        break;
      case 'AUCTION_WON':
        out.push({ id, from: seatA(e.seat), to: seatA(e.seller), amount: e.amount });
        break;
    }
  });
  return out.slice(0, 8);
}

function MoneyLayer({
  root,
  flights,
  effects,
  delayMs,
}: {
  root: React.RefObject<HTMLDivElement | null>;
  flights: Flight[];
  effects: EffectsMode;
  /** Wait for the pawn to land before money moves (rent, salary). */
  delayMs: number;
}) {
  const [active, setActive] = useState<
    (Flight & { x0: number; y0: number; x1: number; y1: number; delay: number })[]
  >([]);
  const key = flights.map((x) => x.id).join('|');
  useLayoutEffect(() => {
    if (effects === 'reduced' || flights.length === 0) return;
    const el = root.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    const clampX = (x: number) => Math.max(24, Math.min(box.width - 80, x));
    const at = (anchor: string) => {
      const a = el.querySelector(`[data-anchor="${anchor}"]`);
      if (!a) return null;
      const r = a.getBoundingClientRect();
      return { x: clampX(r.left + r.width / 2 - box.left), y: r.top + r.height / 2 - box.top };
    };
    const next = flights.flatMap((fl, i) => {
      const a = at(fl.from);
      const b = at(fl.to);
      return a && b
        ? [{ ...fl, x0: a.x, y0: a.y, x1: b.x, y1: b.y, delay: delayMs / 1000 + i * 0.12 }]
        : [];
    });
    // eslint-disable-next-line react-hooks/set-state-in-effect -- positions are measured from the laid-out DOM
    setActive(next);
    const t = setTimeout(() => setActive([]), delayMs + 1400 + next.length * 120);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by the flight ids
  }, [key, effects]);
  return (
    <div className="bz-money" aria-hidden="true">
      {active.map((fl) => (
        <motion.div
          key={fl.id}
          className="bz-money__chip"
          initial={{ x: fl.x0, y: fl.y0, scale: 0.6, opacity: 0 }}
          animate={{
            x: [fl.x0, (fl.x0 + fl.x1) / 2, fl.x1],
            y: [fl.y0, Math.min(fl.y0, fl.y1) - 40, fl.y1],
            scale: [0.6, 1.15, 0.8],
            opacity: [0, 1, 0],
          }}
          transition={{
            duration: effects === 'full' ? 0.9 : 0.5,
            delay: fl.delay,
            ease: 'easeInOut',
          }}
        >
          <RupeeChip size={22} />
          <span className="bz-money__amount">{rupees(fl.amount)}</span>
        </motion.div>
      ))}
    </div>
  );
}

// ───────────────────────────── board ─────────────────────────────

export default function BusinessBoard(props: Props) {
  const { view, events, version, me, seats, effects, msUntil, reactions } = props;
  const root = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const { compact: narrow, landscape } = useCompact(root);
  const [fit, setFit] = useState(false);
  const zoomed = narrow && !fit && view.phase !== 'OVER';
  const { shown, moving, landed, walking, passKey } = useWalk(view, events, version, effects);
  const [holdingsOpen, setHoldingsOpen] = useState(false);
  const [focus, setFocus] = useState<{ turn: number; space: number } | null>(null);
  const [sheet, setSheet] = useState<null | 'loan' | 'repay' | 'auction' | 'trade'>(null);
  const [busy, setBusy] = useState(false);

  // A tapped postcard stays until closed or your own next turn begins.
  const myTurnStarted = focus !== null && view.current === me && view.turn !== focus.turn;
  if (myTurnStarted) setFocus(null);
  const [sheetTurn, setSheetTurn] = useState(view.turn);
  if (sheetTurn !== view.turn) {
    setSheetTurn(view.turn);
    if (sheet) setSheet(null);
  }

  const nameOf = (seat: number) =>
    seats.find((s) => s.seat === seat)?.displayName ?? `#${seat + 1}`;
  const label = (seat: number) => (seat === me ? f('you') : nameOf(seat));
  const fresh = logsIn(events);
  const send: Send = async (a) => {
    if (busy) return;
    setBusy(true);
    await props.send({ ...a, turn: view.turn } as BusinessAction);
    setBusy(false);
  };

  // Phones: keep the moving token (or the current player's) in view.
  const followSeat = moving ?? view.current;
  const follow = shown[followSeat] ?? 0;
  useEffect(() => {
    const vp = viewport.current;
    if (!vp || !zoomed) return;
    const p = spot(follow);
    const inner = vp.firstElementChild as HTMLElement | null;
    if (!inner) return;
    vp.scrollTo({
      left: (p.x / 100) * inner.clientWidth - vp.clientWidth / 2,
      top: (p.y / 100) * inner.clientHeight - vp.clientHeight / 2,
      behavior: effects === 'reduced' ? 'auto' : 'smooth',
    });
  }, [follow, zoomed, effects]);

  const eventShown = useFlash(
    (() => {
      const e = fresh.find((x) => x.type === 'EVENT');
      return e && e.type === 'EVENT' ? e : null;
    })(),
    version,
    effects === 'reduced' ? 4000 : 3200,
  );
  const sold = useFlash(
    (() => {
      const b = fresh.find((x) => x.type === 'BOUGHT' || x.type === 'AUCTION_WON');
      return b && (b.type === 'BOUGHT' || b.type === 'AUCTION_WON') ? b.space : null;
    })(),
    version,
    1500,
  );
  const built = useFlash(
    (() => {
      const b = [...fresh].reverse().find((x) => x.type === 'BUILT');
      return b && b.type === 'BUILT' ? b.space : null;
    })(),
    version,
    1500,
  );
  const rolledNow = events.some((e) => e.type === 'ROLLED' && e.dice.length > 0);
  const flights = effects === 'reduced' ? [] : flightsFor(fresh, version);
  const rolledHere = events.find(
    (e): e is Extract<BusinessEvent, { type: 'ROLLED' }> =>
      e.type === 'ROLLED' && e.path.length > 0,
  );
  const flightDelay = rolledHere
    ? walkMs(rolledHere.dice.length > 0, rolledHere.path.length, effects)
    : 0;
  const rentNow = (() => {
    const r = fresh.find(
      (x) =>
        x.type === 'PAID' && (x.reason === 'rent' || x.reason === 'transport') && x.to !== null,
    );
    return r && r.type === 'PAID' ? r : null;
  })();
  const rentShown = useFlash(rentNow, version, flightDelay + 2600);
  const mine = view.current === me && view.phase !== 'OVER';
  // The landing square lights up once the pawn has arrived and a decision is open there.
  const landingSpace =
    !walking && ['DECIDE', 'EVENT', 'RAISE'].includes(view.phase)
      ? (view.players[view.current]?.position ?? null)
      : null;
  const tilt = !narrow && effects !== 'reduced';
  const latestReaction = (seat: number): BoardReaction | undefined =>
    [...reactions].reverse().find((r) => r.seat === seat);
  const optionSpaces = new Set<number>();
  if (mine && !walking && view.decision?.kind === 'FREE_BUILD') {
    for (const i of view.decision.options ?? []) optionSpaces.add(i);
  }

  const stage = (
    <Stage
      view={view}
      me={me}
      effects={effects}
      version={version}
      rolledNow={rolledNow}
      eventShown={eventShown}
      rentShown={walking ? null : rentShown}
      label={label}
      send={send}
      busy={busy}
      final={!narrow}
    />
  );
  const holdingsCount = ASSET_SPACES.filter((i) => view.owner[i] === me).length;

  return (
    <div
      className={`bz${narrow ? ' bz--narrow' : ''}${narrow && landscape ? ' bz--landscape' : ''}`}
      ref={root}
    >
      <TurnBanner
        view={view}
        me={me}
        name={nameOf(view.current)}
        msUntil={msUntil}
        holdings={holdingsCount}
        onHoldings={() => setHoldingsOpen((x) => !x)}
      />
      <Players view={view} seats={seats} me={me} reaction={latestReaction} />

      <div className="bz-viewport-wrap">
        <div className={`bz-viewport${zoomed ? ' bz-viewport--zoom' : ''}`} ref={viewport}>
          <div className="bz-table">
            <div
              className={`bz-board${tilt ? ' bz-board--tilt' : ''}`}
              role="group"
              aria-label={f('board', {
                name: label(view.current),
                place: spaceName(view.players[view.current]?.position ?? 0),
              })}
            >
              {BOARD.map((space, i) => (
                <Tile
                  key={i}
                  index={i}
                  space={space}
                  view={view}
                  me={me}
                  focus={focus?.space === i}
                  option={optionSpaces.has(i)}
                  landing={landingSpace === i}
                  sold={sold === i}
                  built={built === i}
                  effects={effects}
                  label={label}
                  onClick={() => setFocus({ turn: view.turn, space: i })}
                />
              ))}
              <div className="bz-centre">
                <CentreDecor />
                {!narrow && stage}
              </div>
              <div className="bz-tokens" aria-hidden="true">
                {view.seats.map((seat) => {
                  const pos = shown[seat] ?? 0;
                  const p = stand(pos);
                  const together = view.seats.filter((x) => shown[x] === pos);
                  const k = together.indexOf(seat);
                  const n = together.length;
                  const dx = n > 1 ? Math.cos((k / n) * Math.PI * 2) * 2.6 : 0;
                  const dy = n > 1 ? Math.sin((k / n) * Math.PI * 2) * 2.6 : 0;
                  return (
                    <div
                      key={seat}
                      className={[
                        'bz-token',
                        seat === me && 'bz-token--me',
                        seat === view.current && 'bz-token--current',
                        seat === moving && 'bz-token--moving',
                        seat === landed && 'bz-token--landed',
                        view.players[seat]?.insolvent && 'bz-token--insolvent',
                        effects === 'reduced' && 'bz-token--plain',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      style={
                        {
                          left: `${p.x + dx}%`,
                          top: `${p.y + dy}%`,
                          '--seat': seatColor(seat),
                          '--hop': `${HOP_MS[effects]}ms`,
                        } as CSSProperties
                      }
                    >
                      <Token
                        seat={seat}
                        color={`var(--cb-${seatAccent(seat)})`}
                        size={narrow ? 30 : 34}
                        you={seat === me}
                      />
                      {seat === me && <span className="bz-token__you">{f('you')}</span>}
                    </div>
                  );
                })}
              </div>
              {passKey && (
                <PassStart key={passKey} amount={view.economy.salary} effects={effects} />
              )}
            </div>
          </div>
        </div>
        {narrow && <div className="bz-stage-over">{stage}</div>}
        {narrow && (
          <button
            type="button"
            className="bz-holdings-fab"
            style={{ '--seat': seatColor(me) } as CSSProperties}
            onClick={() => setHoldingsOpen((x) => !x)}
          >
            {f('myPropertiesN', { n: holdingsCount })}
          </button>
        )}
        {narrow && view.phase !== 'OVER' && (
          <button type="button" className="bz-fit" onClick={() => setFit((x) => !x)}>
            {fit ? f('followPlay') : f('seeBoard')}
          </button>
        )}
      </div>
      {narrow && view.phase === 'OVER' && view.final && (
        <FinalReveal view={view} me={me} label={label} effects={effects} />
      )}

      {focus && !myTurnStarted && (
        <PropertyCard
          view={view}
          index={focus.space}
          label={label}
          onClose={() => setFocus(null)}
        />
      )}

      <Holdings
        view={view}
        me={me}
        open={holdingsOpen}
        onClose={() => setHoldingsOpen(false)}
        effects={effects}
      />

      <ActionTray
        view={view}
        me={me}
        mine={mine}
        walking={walking}
        busy={busy}
        send={send}
        label={label}
        sheet={sheet}
        setSheet={setSheet}
      />

      <Log view={view} label={label} />
      <MoneyLayer root={root} flights={flights} effects={effects} delayMs={flightDelay} />
    </div>
  );
}

// ───────────────────────────── header ─────────────────────────────

function TurnBanner({
  view,
  me,
  name,
  msUntil,
  holdings,
  onHoldings,
}: {
  view: BusinessView;
  me: number;
  name: string;
  msUntil(ts: number): number;
  holdings: number;
  onHoldings(): void;
}) {
  const mine = view.current === me;
  const timed = view.phase !== 'HOLD' && view.phase !== 'OVER' && view.phaseMs > 0;
  return (
    <div
      className={`bz-banner${mine ? ' bz-banner--mine' : ''}`}
      style={{ '--seat': seatColor(view.current) } as CSSProperties}
      role="status"
      aria-live="polite"
    >
      <span className="bz-banner__token" aria-hidden="true">
        <Token seat={view.current} color={`var(--cb-${seatAccent(view.current)})`} size={30} />
      </span>
      <span className="bz-banner__text">
        {view.phase === 'OVER'
          ? f('finalTitle')
          : mine
            ? f('yourTurn')
            : f('turnOf', { name: name.toUpperCase() })}
      </span>
      <span className="bz-banner__round">
        {view.round >= view.rounds && view.phase !== 'OVER'
          ? f('lastRound')
          : f('round', { round: Math.min(view.round, view.rounds), rounds: view.rounds })}
      </span>
      <button
        type="button"
        className="bz-holdings-toggle"
        style={{ '--seat': seatColor(me) } as CSSProperties}
        onClick={onHoldings}
      >
        {f('myPropertiesN', { n: holdings })}
      </button>
      {timed && (
        <CountdownRing
          key={`${view.turn}-${view.phase}-${view.phaseEndsAt}`}
          deadline={view.phaseEndsAt}
          totalMs={view.phaseMs}
          msUntil={msUntil}
          size={40}
          urgentMs={8000}
        />
      )}
    </div>
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
  const strip = useRef<HTMLOListElement>(null);
  const current = view.current;
  useEffect(() => {
    const ol = strip.current;
    const li = ol?.querySelector<HTMLElement>(`[data-anchor="seat-${current}"]`);
    if (!ol || !li || ol.scrollWidth <= ol.clientWidth) return;
    ol.scrollTo({
      left: li.offsetLeft - (ol.clientWidth - li.clientWidth) / 2,
      behavior: 'smooth',
    });
  }, [current]);
  return (
    <ol className="bz-players" ref={strip}>
      {[...seats]
        .sort((a, b) => view.order.indexOf(a.seat) - view.order.indexOf(b.seat))
        .map((s) => {
          const p = view.players[s.seat];
          if (!p) return null;
          const assets = ASSET_SPACES.filter((i) => view.owner[i] === s.seat);
          const houses = assets.reduce(
            (n, i) => n + ((view.level[i] ?? 0) < HOTEL ? (view.level[i] ?? 0) : 0),
            0,
          );
          const hotels = assets.filter((i) => view.level[i] === HOTEL).length;
          const transports = assets.filter((i) => isTransport(BOARD[i])).length;
          return (
            <li
              key={s.seat}
              data-anchor={`seat-${s.seat}`}
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
                <Token seat={s.seat} color={`var(--cb-${seatAccent(s.seat)})`} size={28} />
              </span>
              <span className="bz-player__who">
                <span className="bz-player__name">
                  <span className="bz-player__text">{s.displayName}</span>
                  {s.seat === me && <span className="bz-you">{f('you')}</span>}
                  {s.controller === 'BOT' && <span className="bz-bot">{f('bot')}</span>}
                </span>
                <span className="bz-player__meta">
                  {assets.length - transports > 0 && (
                    <span title={f('property')}>🏙 {assets.length - transports}</span>
                  )}
                  {houses > 0 && <span title={f('house')}>🏠 {houses}</span>}
                  {hotels > 0 && <span title={f('hotel')}>🏨 {hotels}</span>}
                  {transports > 0 && <span title={f('transportSpend')}>🚆 {transports}</span>}
                  {p.debt > 0 && (
                    <span className="bz-debt">{f('debt', { amount: rupees(p.debt) })}</span>
                  )}
                  {p.insolvent && <span className="bz-insolvent">{f('insolvent')}</span>}
                  {p.skipNext && <span className="bz-flag">{f('skipNext')}</span>}
                  {p.rentHoliday && <span className="bz-flag">{f('rentHoliday')}</span>}
                </span>
              </span>
              <span className="bz-player__cash" aria-label={`${f('cash')} ${rupees(p.cash)}`}>
                ₹<RollingNumber value={p.cash} durationMs={700} />
              </span>
            </li>
          );
        })}
    </ol>
  );
}

// ───────────────────────────── tiles ─────────────────────────────

function Tile({
  index,
  space,
  view,
  me,
  focus,
  option,
  landing,
  sold,
  built,
  effects,
  label,
  onClick,
}: {
  index: number;
  space: Space;
  view: BusinessView;
  me: number;
  focus: boolean;
  option: boolean;
  landing: boolean;
  sold: boolean;
  built: boolean;
  effects: EffectsMode;
  label(seat: number): string;
  onClick(): void;
}) {
  const c = cellOf(index);
  const side = edgeOf(index);
  const owner = view.owner[index];
  const level = view.level[index] ?? 0;
  const aria = [spaceName(index)];
  if (owner !== null && owner !== undefined)
    aria.push(
      `${f('owner')}: ${label(owner)}`,
      f('rent', { amount: rupees(rentFor(view, index)) }),
    );
  else if (isCity(space) || isTransport(space))
    aria.push(`${f('price')} ${rupees(priceOf(index, view.economy))}`);
  return (
    <button
      type="button"
      className={[
        'bz-tile',
        `bz-tile--${space.kind}`,
        `bz-tile--${side}`,
        space.kind === 'city' && `bz-g-${space.group}`,
        space.kind === 'event' && `bz-tile--${space.deck}`,
        space.kind === 'corner' && `bz-tile--${space.corner}`,
        owner !== null && owner !== undefined && 'bz-tile--owned',
        owner === me && 'bz-tile--mine',
        focus && 'bz-tile--focus',
        option && 'bz-tile--option',
        landing && 'bz-tile--landing',
      ]
        .filter(Boolean)
        .join(' ')}
      style={
        {
          gridRow: c.row + 1,
          gridColumn: c.col + 1,
          ...(owner !== null && owner !== undefined ? { '--owner': seatColor(owner) } : {}),
        } as CSSProperties
      }
      data-space={index}
      aria-label={aria.join(' · ')}
      onClick={onClick}
    >
      {space.kind === 'city' && <span className="bz-tile__band" aria-hidden="true" />}
      <span className="bz-tile__face">
        {space.kind === 'city' && <CityIcon id={space.id} size={16} />}
        {space.kind === 'transport' && <TransportIcon id={space.id} size={18} />}
        {space.kind === 'event' && <DeckIcon deck={space.deck} size={18} />}
        {space.kind === 'corner' && <CornerIcon id={space.corner} size={26} />}
        <span className="bz-tile__name">{spaceName(index, true)}</span>
        {space.kind === 'corner' && (
          <span className="bz-tile__corner-note">{cornerNote(space.corner, view)}</span>
        )}
        {(space.kind === 'city' || space.kind === 'transport') && (
          <span className="bz-tile__price">
            {owner === null || owner === undefined
              ? rupees(priceOf(index, view.economy))
              : rupees(rentFor(view, index))}
          </span>
        )}
      </span>
      {owner !== null && owner !== undefined && (
        <span className="bz-tile__flag" aria-hidden="true">
          {owner === me ? f('you') : ''}
        </span>
      )}
      {space.kind === 'city' && level > 0 && (
        <span
          className={`bz-tile__buildings${built ? ' bz-tile__buildings--new' : ''}`}
          aria-hidden="true"
        >
          {level === HOTEL ? (
            <motion.span
              key="hotel"
              initial={effects === 'reduced' ? false : { y: -14, scale: 0.4, opacity: 0 }}
              animate={{ y: 0, scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 500, damping: 14 }}
            >
              <Hotel size={20} />
            </motion.span>
          ) : (
            Array.from({ length: level }, (_, k) => (
              <motion.span
                key={`h${k}`}
                initial={effects === 'reduced' ? false : { y: -12, scale: 0.4, opacity: 0 }}
                animate={{ y: 0, scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 520, damping: 14, delay: k * 0.08 }}
              >
                <House size={13} />
              </motion.span>
            ))
          )}
        </span>
      )}
      <AnimatePresence>
        {sold && effects !== 'reduced' && (
          <motion.span
            className="bz-sold"
            initial={{ scale: 2, opacity: 0, rotate: -20 }}
            animate={{ scale: 1, opacity: 1, rotate: -12 }}
            exit={{ opacity: 0 }}
          >
            {f('sold')}
          </motion.span>
        )}
      </AnimatePresence>
    </button>
  );
}

const cornerNote = (corner: string, view: BusinessView) =>
  corner === 'start'
    ? `+${rupees(view.economy.salary)}`
    : corner === 'jail'
      ? rupees(view.economy.jailFee)
      : corner === 'club'
        ? `+${rupees(view.economy.clubCollect)} ×`
        : `−${rupees(view.economy.resortPay)} ×`;

/** Rent shown on the board — the server computes the real payment (rentAt). */
function rentFor(view: BusinessView, i: number): number {
  const owner = view.owner[i];
  if (owner === null || owner === undefined) return 0;
  // A transport's own fixed rent.
  if (isTransport(BOARD[i])) return transportRent(i, view.economy);
  const s = BOARD[i];
  const group = isCity(s) ? s.group : null;
  const count = ASSET_SPACES.filter((x) => {
    const b = BOARD[x];
    return isCity(b) && b.group === group && view.owner[x] === owner;
  }).length;
  return cityRent(i, view.level[i] ?? 0, count >= view.economy.groupThreshold, view.economy);
}

// ───────────────────────────── centre ─────────────────────────────

const ROTATE: Record<number, { x: number; y: number }> = {
  1: { x: 0, y: 0 },
  2: { x: 0, y: -90 },
  3: { x: -90, y: 0 },
  4: { x: 90, y: 0 },
  5: { x: 0, y: 90 },
  6: { x: 0, y: 180 },
};
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
const FACES: [number, string][] = [
  [1, 'rotateY(0deg)'],
  [6, 'rotateY(180deg)'],
  [2, 'rotateY(90deg)'],
  [5, 'rotateY(-90deg)'],
  [3, 'rotateX(90deg)'],
  [4, 'rotateX(-90deg)'],
];
function Face({ n }: { n: number }) {
  return (
    <svg viewBox="0 0 100 100" className="bz-die__face-svg" aria-hidden="true">
      {(PIPS[n] ?? []).map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={9} />
      ))}
    </svg>
  );
}
function Die({
  value,
  roll,
  effects,
  k,
}: {
  value: number;
  roll: boolean;
  effects: EffectsMode;
  k: number;
}) {
  const r = ROTATE[value] ?? ROTATE[1]!;
  if (effects === 'reduced') {
    return (
      <motion.span
        className="bz-die bz-die--flat"
        initial={roll ? { opacity: 0.3 } : false}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
      >
        <Face n={value} />
      </motion.span>
    );
  }
  return (
    <span className="bz-die">
      <motion.span
        className="bz-die__cube"
        initial={roll ? { rotateX: r.x + 720 + k * 90, rotateY: r.y - 540, y: -34, x: 0 } : false}
        animate={
          roll
            ? {
                rotateX: r.x,
                rotateY: r.y,
                y: [-34, 6, -6, 0],
                x: [0, -5, 5, -2, 0],
              }
            : { rotateX: r.x, rotateY: r.y, y: 0, x: 0 }
        }
        transition={{
          duration: (DICE_MS[effects] - 100) / 1000,
          ease: [0.2, 0.75, 0.3, 1],
          delay: k * 0.04,
        }}
      >
        {FACES.map(([n, t]) => (
          <span
            key={n}
            className="bz-die__side"
            style={{ transform: `${t} translateZ(var(--half))` }}
          >
            <Face n={n} />
          </span>
        ))}
      </motion.span>
    </span>
  );
}

function CentreDecor() {
  return (
    <div className="bz-centre__decor">
      <div className="bz-rangoli" aria-hidden="true" />
      <div className="bz-medallion" data-anchor="bank">
        <BusinessIcon size={40} />
        <span className="bz-medallion__title">{f('name')}</span>
        <span className="bz-medallion__sub">{f('indiaClassic')}</span>
      </div>
      <div className="bz-deck bz-deck--chance" aria-hidden="true">
        <DeckIcon deck="chance" size={18} />
        <span>{fk('deck.chance')}</span>
      </div>
      <div className="bz-deck bz-deck--chest" aria-hidden="true">
        <DeckIcon deck="chest" size={18} />
        <span>{fk('deck.chest')}</span>
      </div>
    </div>
  );
}

/** Dice, event card, auction and (wide) final count-up — over the centre, or over the phone camera. */
function Stage({
  view,
  me,
  effects,
  version,
  rolledNow,
  eventShown,
  rentShown,
  label,
  send,
  busy,
  final,
}: {
  view: BusinessView;
  me: number;
  effects: EffectsMode;
  version: number;
  rolledNow: boolean;
  eventShown: Extract<LogEntry, { type: 'EVENT' }> | null;
  rentShown: Extract<LogEntry, { type: 'PAID' }> | null;
  label(seat: number): string;
  send: Send;
  busy: boolean;
  final: boolean;
}) {
  const dice = view.lastRoll?.dice ?? [];
  const sum = dice.length === 2 ? (dice[0] as number) + (dice[1] as number) : null;
  return (
    <div className="bz-stage">
      {dice.length === 2 && view.phase !== 'OVER' && (
        <div className="bz-dice" role="img" aria-label={f('sum', { sum: sum ?? 0 })}>
          <Die
            value={dice[0] as number}
            roll={rolledNow}
            effects={effects}
            k={0}
            key={`a${version}`}
          />
          <Die
            value={dice[1] as number}
            roll={rolledNow}
            effects={effects}
            k={1}
            key={`b${version}`}
          />
          <motion.span
            key={`s${view.lastRoll?.turn}-${dice.join()}`}
            className="bz-dice__sum"
            initial={rolledNow ? { scale: 0, opacity: 0 } : false}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: (DICE_MS[effects] - 150) / 1000, duration: 0.25 }}
          >
            {sum}
          </motion.span>
        </div>
      )}
      <AnimatePresence>
        {eventShown && (
          <EventCard
            key={`ev-${version}`}
            entry={eventShown}
            effects={effects}
            label={label}
            economy={view.economy}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {rentShown && rentShown.to !== null && (
          <motion.div
            key={`rent-${rentShown.from}-${rentShown.amount}-${view.turn}`}
            className="bz-rent"
            role="status"
            style={{ '--seat': seatColor(rentShown.to) } as CSSProperties}
            initial={effects === 'reduced' ? false : { y: 20, opacity: 0, scale: 0.8 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
          >
            <RupeeChip size={20} />
            {rentShown.from === me
              ? f('rentDueYou', { amount: rupees(rentShown.amount), owner: label(rentShown.to) })
              : f('rentDue', {
                  name: label(rentShown.from),
                  amount: rupees(rentShown.amount),
                  owner: label(rentShown.to),
                })}
          </motion.div>
        )}
      </AnimatePresence>
      {view.phase === 'AUCTION' && view.auction && (
        <AuctionPanel view={view} me={me} label={label} send={send} busy={busy} effects={effects} />
      )}
      {final && view.phase === 'OVER' && view.final && (
        <FinalReveal view={view} me={me} label={label} effects={effects} />
      )}
    </div>
  );
}

function EventCard({
  entry,
  effects,
  label,
  economy,
}: {
  entry: Extract<LogEntry, { type: 'EVENT' }>;
  effects: EffectsMode;
  label(seat: number): string;
  economy: Economy;
}) {
  return (
    <motion.div
      className={`bz-event bz-event--${entry.deck} ${entry.good ? 'bz-event--good' : 'bz-event--bad'}`}
      role="status"
      initial={
        effects === 'reduced'
          ? false
          : effects === 'full'
            ? { rotateY: 180, scale: 0.5, y: 40 }
            : { opacity: 0 }
      }
      animate={{ rotateY: 0, scale: 1, y: 0, opacity: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={
        effects === 'full'
          ? { type: 'spring', stiffness: 160, damping: 16, delay: 0.5 }
          : { duration: 0.25 }
      }
    >
      <span className="bz-event__deck">
        <DeckIcon deck={entry.deck} size={16} /> {fk(`deck.${entry.deck}`)} ·{' '}
        {f('sum', { sum: entry.sum })}
      </span>
      <span className="bz-event__verdict">{entry.good ? f('good') : f('bad')}</span>
      <span className="bz-event__text">{eventText(entry.deck, entry.sum, economy)}</span>
      <span className="bz-event__who">{label(entry.seat)}</span>
    </motion.div>
  );
}

function AuctionPanel({
  view,
  me,
  label,
  send,
  busy,
  effects,
}: {
  view: BusinessView;
  me: number;
  label(seat: number): string;
  send: Send;
  busy: boolean;
  effects: EffectsMode;
}) {
  const a = view.auction!;
  const next = a.high ? a.high.amount + 100 : a.open;
  const cash = view.players[me]?.cash ?? 0;
  const canBid = me !== a.seller && view.players[me] !== undefined && a.high?.seat !== me;
  return (
    <motion.div
      className="bz-auction"
      role="dialog"
      aria-label={f('auctionOf', { place: spaceName(a.space) })}
      initial={effects === 'reduced' ? false : { scale: 0.6, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
    >
      <span className="bz-auction__title">{f('auctionOf', { place: spaceName(a.space) })}</span>
      <span className="bz-auction__by">{f('by', { name: label(a.seller) })}</span>
      <motion.span
        key={a.high?.amount ?? 0}
        className="bz-auction__bid"
        initial={effects === 'reduced' ? false : { scale: 1.4, color: '#ffd23f' }}
        animate={{ scale: 1 }}
      >
        {a.high
          ? f('highBid', { amount: rupees(a.high.amount), name: label(a.high.seat) })
          : f('noBids', { amount: rupees(a.open) })}
      </motion.span>
      {a.seller === me ? (
        <span className="bz-auction__note">{f('yourAuction')}</span>
      ) : canBid ? (
        <span className="bz-auction__buttons">
          {[0, 400, 900].map((extra) => {
            const amount = next + extra;
            return (
              <button
                key={extra}
                type="button"
                className="btn btn--small btn--primary"
                disabled={busy || amount > cash}
                onClick={() => void send({ type: 'BID', amount })}
              >
                {rupees(amount)}
              </button>
            );
          })}
        </span>
      ) : null}
    </motion.div>
  );
}

function FinalReveal({
  view,
  me,
  label,
  effects,
}: {
  view: BusinessView;
  me: number;
  label(seat: number): string;
  effects: EffectsMode;
}) {
  const rows = [...view.seats].sort(
    (a, b) => (view.final![b]?.total ?? 0) - (view.final![a]?.total ?? 0),
  );
  const best = view.final![rows[0] as number]?.total ?? 0;
  const ms = effects === 'reduced' ? 0 : 1200;
  return (
    <motion.div
      className="bz-final"
      initial={effects === 'reduced' ? false : { opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <span className="bz-final__title">{f('finalTitle')}</span>
      <span className="bz-final__formula">{f('finalFormula')}</span>
      <table className="bz-final__table">
        <thead>
          <tr>
            <th />
            <th>{f('cash')}</th>
            <th>{f('property')}</th>
            <th>{f('development')}</th>
            <th>{f('transportSpend')}</th>
            <th>{f('total')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((seat) => {
            const w = view.final![seat]!;
            return (
              <tr
                key={seat}
                className={[seat === me && 'bz-final__me', w.total === best && 'bz-final__best']
                  .filter(Boolean)
                  .join(' ')}
              >
                <th style={{ color: seatColor(seat) }}>{label(seat)}</th>
                <td data-label={f('cash')}>
                  <span className="bz-final__v">
                    ₹<RollingNumber value={w.cash} durationMs={ms} />
                  </span>
                </td>
                <td data-label={f('property')}>
                  <span className="bz-final__v">
                    ₹<RollingNumber value={w.property} durationMs={ms} />
                  </span>
                </td>
                <td data-label={f('development')}>
                  <span className="bz-final__v">
                    ₹<RollingNumber value={w.development} durationMs={ms} />
                  </span>
                </td>
                <td data-label={f('transportSpend')}>
                  <span className="bz-final__v">
                    ₹<RollingNumber value={w.transport} durationMs={ms} />
                  </span>
                </td>
                <td className="bz-final__total">
                  <span className="bz-final__v">
                    ₹<RollingNumber value={w.total} durationMs={ms * 1.5} />
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </motion.div>
  );
}

// ───────────────────────────── property card ─────────────────────────────

function PropertyCard({
  view,
  index,
  label,
  onClose,
}: {
  view: BusinessView;
  index: number;
  label(seat: number): string;
  onClose(): void;
}) {
  const s = BOARD[index] as Space;
  const owner = view.owner[index];
  const e = view.economy;
  return (
    <section
      className={`bz-card${s.kind === 'city' ? ` bz-g-${s.group}` : ''}`}
      aria-label={spaceName(index)}
    >
      <header className="bz-card__head">
        {s.kind === 'city' && <CityIcon id={s.id} size={22} />}
        {s.kind === 'transport' && <TransportIcon id={s.id} size={22} />}
        {s.kind === 'event' && <DeckIcon deck={s.deck} size={22} />}
        {s.kind === 'corner' && <CornerIcon id={s.corner} size={22} />}
        <span className="bz-card__name">{spaceName(index)}</span>
        <button type="button" className="bz-card__close" onClick={onClose} aria-label={f('close2')}>
          ×
        </button>
      </header>
      {s.kind === 'city' && (
        <>
          <p className="bz-card__line">
            {f('group', { group: s.group, region: fk(`region.${s.group}`) })} · {f('price')}{' '}
            {rupees(s.price)}
          </p>
          <p className="bz-card__line">
            {owner !== null && owner !== undefined ? (
              <>
                <OwnerChip owner={owner} label={label} /> · {f('rentNow')}{' '}
                {rupees(rentFor(view, index))} · {levelName(view.level[index] ?? 0)}
              </>
            ) : (
              f('forSale')
            )}
          </p>
          <p className="bz-card__small">
            {f('rentTable', {
              r0: rupees(baseRent(index, e) * (e.levelMultipliers[0] ?? 1)),
              r1: rupees(baseRent(index, e) * (e.levelMultipliers[1] ?? 1)),
              r2: rupees(baseRent(index, e) * (e.levelMultipliers[2] ?? 1)),
              r3: rupees(baseRent(index, e) * (e.levelMultipliers[3] ?? 1)),
              r4: rupees(baseRent(index, e) * (e.levelMultipliers[4] ?? 1)),
            })}
          </p>
          <p className="bz-card__small">
            {f('houseCost', {
              house: rupees(buildCost(index, 0, e)),
              hotel: rupees(buildCost(index, 3, e)),
            })}{' '}
            · {f('groupRule')}
          </p>
        </>
      )}
      {s.kind === 'transport' && (
        <>
          <p className="bz-card__line">
            {f('price')} {rupees(s.price)} ·{' '}
            {owner !== null && owner !== undefined ? (
              <OwnerChip owner={owner} label={label} />
            ) : (
              f('forSale')
            )}
          </p>
          <p className="bz-card__small">
            {f('transportRule', { rent: rupees(transportRent(index, e)) })}
          </p>
        </>
      )}
      {s.kind === 'event' && <p className="bz-card__line">{fk(`about.${s.deck}`)}</p>}
      {s.kind === 'corner' && (
        <p className="bz-card__line">
          {fk(`about.${s.corner}`, {
            salary: rupees(e.salary),
            fee: rupees(e.jailFee),
            amount: rupees(s.corner === 'club' ? e.clubCollect : e.resortPay),
          })}
        </p>
      )}
    </section>
  );
}

// ───────────────────────────── action tray ─────────────────────────────

function ActionTray({
  view,
  me,
  mine,
  walking,
  busy,
  send,
  label,
  sheet,
  setSheet,
}: {
  view: BusinessView;
  me: number;
  mine: boolean;
  walking: boolean;
  busy: boolean;
  send: Send;
  label(seat: number): string;
  sheet: null | 'loan' | 'repay' | 'auction' | 'trade';
  setSheet(s: null | 'loan' | 'repay' | 'auction' | 'trade'): void;
}) {
  const p = view.players[me];
  if (!p || view.phase === 'OVER') return null;
  let body: ReactNode = null;
  if (view.phase === 'TRADE' && view.trade?.to === me) {
    body = <TradeOffer view={view} label={label} send={send} busy={busy} />;
  } else if (view.phase === 'TRADE' && view.trade?.from === me) {
    body = <p className="bz-tray__note">{f('tradePending', { name: label(view.trade.to) })}</p>;
  } else if (!mine) {
    body =
      view.phase === 'AUCTION' ? null : (
        <p className="bz-tray__note">{f('waiting', { name: label(view.current) })}</p>
      );
  } else if (walking && view.phase !== 'ROLL') {
    // Nothing to decide until the pawn has landed.
    body = <p className="bz-tray__note bz-tray__moving">🎲 {f('moving')}</p>;
  } else if (view.phase === 'ROLL') {
    body = (
      <>
        <button
          type="button"
          className="btn btn--primary bz-big"
          disabled={busy}
          onClick={() => void send({ type: 'ROLL' })}
        >
          🎲 {f('roll')}
        </button>
        {p.noBuyActive && <p className="bz-tray__note">{f('noBuyNow')}</p>}
        <div className="bz-tray__more">
          <button
            type="button"
            className="btn btn--small bz-chipbtn"
            onClick={() => setSheet(sheet === 'loan' ? null : 'loan')}
          >
            {f('loan')}
          </button>
          {p.debt > 0 && (
            <button
              type="button"
              className="btn btn--small bz-chipbtn"
              onClick={() => setSheet(sheet === 'repay' ? null : 'repay')}
            >
              {f('repay')}
            </button>
          )}
          <button
            type="button"
            className="btn btn--small bz-chipbtn"
            disabled={view.auctionsThisTurn > 0}
            onClick={() => setSheet(sheet === 'auction' ? null : 'auction')}
          >
            {f('auction')}
          </button>
          <button
            type="button"
            className="btn btn--small bz-chipbtn"
            disabled={view.tradesThisTurn > 0}
            onClick={() => setSheet(sheet === 'trade' ? null : 'trade')}
          >
            {f('trade')}
          </button>
        </div>
        {sheet === 'loan' && (
          <LoanSheet view={view} me={me} send={send} busy={busy} onDone={() => setSheet(null)} />
        )}
        {sheet === 'repay' && (
          <RepaySheet view={view} me={me} send={send} busy={busy} onDone={() => setSheet(null)} />
        )}
        {sheet === 'auction' && (
          <AuctionPicker
            view={view}
            me={me}
            send={send}
            busy={busy}
            onDone={() => setSheet(null)}
          />
        )}
        {sheet === 'trade' && (
          <TradeBuilder
            view={view}
            me={me}
            label={label}
            send={send}
            busy={busy}
            onDone={() => setSheet(null)}
          />
        )}
      </>
    );
  } else if (view.phase === 'EVENT') {
    const at = p.position;
    const b = BOARD[at];
    const deck = b?.kind === 'event' ? b.deck : 'chance';
    body = (
      <button
        type="button"
        className="btn btn--primary bz-big"
        disabled={busy}
        onClick={() => void send({ type: 'EVENT_ROLL' })}
      >
        🎲 {f('rollEvent', { deck: fk(`deck.${deck}`) })}
      </button>
    );
  } else if (view.phase === 'DECIDE' && view.decision) {
    const d = view.decision;
    if (d.kind === 'JAIL') {
      body = (
        <>
          <p className="bz-tray__q">{f('jailQ')}</p>
          <div className="bz-tray__row">
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy || p.cash < d.cost}
              onClick={() => void send({ type: 'JAIL_PAY' })}
            >
              {f('jailPay', { fee: rupees(d.cost) })}
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={busy}
              onClick={() => void send({ type: 'JAIL_WAIT' })}
            >
              {f('jailWait')}
            </button>
          </div>
        </>
      );
    } else if (d.kind === 'BUY') {
      const short = p.cash < d.cost;
      body = (
        <>
          <LandingInfo view={view} me={me} space={d.space} label={label} />
          <p className="bz-tray__q">{f('buyQ', { place: spaceName(d.space) })}</p>
          <div className="bz-tray__row">
            <button
              type="button"
              className="btn btn--primary bz-big"
              disabled={busy || short}
              onClick={() => void send({ type: 'BUY', space: d.space })}
            >
              {f('buy', { price: rupees(d.cost) })}
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={busy}
              onClick={() => void send({ type: 'SKIP' })}
            >
              {f('dontBuy')}
            </button>
          </div>
          {short && (
            <p className="bz-tray__note">
              {f('cantAfford')}{' '}
              {(view.canBorrow[me] ?? 0) > 0 && (
                <button
                  type="button"
                  className="btn btn--small bz-chipbtn"
                  onClick={() => setSheet('loan')}
                >
                  {f('takeLoanToBuy')}
                </button>
              )}
            </p>
          )}
          {sheet === 'loan' && (
            <LoanSheet view={view} me={me} send={send} busy={busy} onDone={() => setSheet(null)} />
          )}
        </>
      );
    } else if (d.kind === 'FREE_BUILD') {
      body = (
        <>
          <p className="bz-tray__q">{f('freeQ')}</p>
          <div className="bz-tray__row bz-tray__row--wrap">
            {(d.options ?? []).map((i) => {
              const lv = view.level[i] ?? 0;
              return (
                <button
                  key={i}
                  type="button"
                  className="btn btn--primary btn--small"
                  disabled={busy}
                  onClick={() => void send({ type: 'FREE_BUILD', space: i })}
                >
                  {f('freeOpt', {
                    place: spaceName(i),
                    from: levelName(lv),
                    to: levelName(lv + 1),
                  })}
                </button>
              );
            })}
          </div>
        </>
      );
    } else {
      // BUILD: one level per click (House 1 → 2 → 3 → Hotel); Done ends the turn.
      const lv = view.level[d.space] ?? 0;
      const cost = buildCost(d.space, lv, view.economy);
      const ownerBonus = groupBonus(view, d.space, me);
      const nextRent = cityRent(d.space, lv + 1, ownerBonus, view.economy);
      body = (
        <>
          <LandingInfo view={view} me={me} space={d.space} label={label} />
          <p className="bz-tray__q">{f('buildQ', { place: spaceName(d.space) })}</p>
          <div className="bz-tray__row bz-tray__row--wrap">
            {lv < HOTEL && (
              <button
                type="button"
                className="btn btn--primary bz-big"
                disabled={busy || p.cash < cost}
                onClick={() => void send({ type: 'BUILD', space: d.space })}
              >
                {f('buildNext', { what: levelName(lv + 1), price: rupees(cost) })}
              </button>
            )}
            <button
              type="button"
              className="btn btn--ghost"
              disabled={busy}
              onClick={() => void send({ type: 'SKIP' })}
            >
              {(d.built ?? 0) > 0 ? f('done') : f('notNow')}
            </button>
          </div>
          {lv < HOTEL && (
            <p className="bz-tray__note">{f('buildThen', { rent: rupees(nextRent) })}</p>
          )}
        </>
      );
    }
  } else if (view.phase === 'RAISE' && view.raise) {
    body = <RaisePanel view={view} me={me} send={send} busy={busy} />;
  }
  return (
    <section
      className={`bz-tray${mine ? ' bz-tray--mine' : ''}`}
      style={{ '--seat': seatColor(me) } as CSSProperties}
      aria-label={f('yourTurn')}
    >
      {body}
    </section>
  );
}

function LoanSheet({
  view,
  me,
  send,
  busy,
  onDone,
}: {
  view: BusinessView;
  me: number;
  send: Send;
  busy: boolean;
  onDone(): void;
}) {
  const max = view.canBorrow[me] ?? 0;
  const step = view.economy.loanStep;
  const steps = [step, 2 * step, 4 * step].filter((x) => x <= max);
  if (max >= step && !steps.includes(max)) steps.push(max);
  return (
    <div className="bz-sheet">
      <p className="bz-sheet__title">{f('loanTitle')}</p>
      {max <= 0 ? (
        <p className="bz-sheet__hint">{f('loanNone')}</p>
      ) : (
        <>
          <p className="bz-sheet__hint">
            {f('loanHint', {
              step: rupees(step),
              debt: rupees(Math.round(step * (1 + view.economy.loanFee))),
              max: rupees(max),
            })}
          </p>
          <div className="bz-tray__row bz-tray__row--wrap">
            {steps.map((amount) => (
              <button
                key={amount}
                type="button"
                className="btn btn--small btn--primary"
                disabled={busy}
                onClick={() => void send({ type: 'LOAN', amount }).then(onDone)}
              >
                {f('borrow', { amount: rupees(amount) })}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function RepaySheet({
  view,
  me,
  send,
  busy,
  onDone,
}: {
  view: BusinessView;
  me: number;
  send: Send;
  busy: boolean;
  onDone(): void;
}) {
  const p = view.players[me]!;
  const amount = Math.min(p.debt, p.cash);
  return (
    <div className="bz-sheet">
      <p className="bz-sheet__title">{f('repayTitle')}</p>
      <p className="bz-sheet__hint">{f('debt', { amount: rupees(p.debt) })}</p>
      <button
        type="button"
        className="btn btn--small btn--primary"
        disabled={busy || amount <= 0}
        onClick={() => void send({ type: 'REPAY', amount }).then(onDone)}
      >
        {f('repayAll', { amount: rupees(amount) })}
      </button>
    </div>
  );
}

function AuctionPicker({
  view,
  me,
  send,
  busy,
  onDone,
}: {
  view: BusinessView;
  me: number;
  send: Send;
  busy: boolean;
  onDone(): void;
}) {
  const mine = ASSET_SPACES.filter((i) => view.owner[i] === me);
  return (
    <div className="bz-sheet">
      <p className="bz-sheet__title">{f('auctionTitle')}</p>
      <p className="bz-sheet__hint">{f('auctionHint')}</p>
      <div className="bz-tray__row bz-tray__row--wrap">
        {mine.map((i) => {
          const locked = (view.lockedUntil[i] ?? 0) > view.round;
          return (
            <button
              key={i}
              type="button"
              className="btn btn--small bz-chipbtn"
              disabled={busy || locked}
              title={locked ? f('auctionLocked') : undefined}
              onClick={() => void send({ type: 'AUCTION_START', space: i }).then(onDone)}
            >
              {f('startAuction', { place: spaceName(i) })}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TradeBuilder({
  view,
  me,
  label,
  send,
  busy,
  onDone,
}: {
  view: BusinessView;
  me: number;
  label(seat: number): string;
  send: Send;
  busy: boolean;
  onDone(): void;
}) {
  const others = view.seats.filter((x) => x !== me);
  const [to, setTo] = useState(others[0] ?? 0);
  const [give, setGive] = useState<number[]>([]);
  const [get, setGet] = useState<number[]>([]);
  const [giveCash, setGiveCash] = useState(0);
  const [getCash, setGetCash] = useState(0);
  const free = (seat: number) =>
    ASSET_SPACES.filter((i) => view.owner[i] === seat && (view.lockedUntil[i] ?? 0) <= view.round);
  const toggle = (list: number[], set: (x: number[]) => void, i: number) =>
    set(list.includes(i) ? list.filter((x) => x !== i) : [...list, i]);
  const myCash = view.players[me]?.cash ?? 0;
  const theirCash = view.players[to]?.cash ?? 0;
  const empty = give.length + get.length === 0 && giveCash + getCash === 0;
  return (
    <div className="bz-sheet">
      <p className="bz-sheet__title">{f('tradeTitle')}</p>
      <label className="bz-field">
        {f('tradeWith')}
        <select
          value={to}
          onChange={(e) => {
            setTo(Number(e.target.value));
            setGet([]);
            setGetCash(0);
          }}
        >
          {others.map((x) => (
            <option key={x} value={x}>
              {label(x)}
            </option>
          ))}
        </select>
      </label>
      <div className="bz-trade">
        <div>
          <p className="bz-sheet__hint">{f('youGive')}</p>
          {free(me).map((i) => (
            <label key={i} className="bz-check">
              <input
                type="checkbox"
                checked={give.includes(i)}
                onChange={() => toggle(give, setGive, i)}
              />{' '}
              {spaceName(i)}
            </label>
          ))}
          <label className="bz-field">
            {f('cashLabel')}
            <input
              type="number"
              min={0}
              max={myCash}
              step={100}
              value={giveCash}
              onChange={(e) =>
                setGiveCash(Math.max(0, Math.min(myCash, Number(e.target.value) || 0)))
              }
            />
          </label>
        </div>
        <div>
          <p className="bz-sheet__hint">{f('youGet')}</p>
          {free(to).map((i) => (
            <label key={i} className="bz-check">
              <input
                type="checkbox"
                checked={get.includes(i)}
                onChange={() => toggle(get, setGet, i)}
              />{' '}
              {spaceName(i)}
            </label>
          ))}
          <label className="bz-field">
            {f('cashLabel')}
            <input
              type="number"
              min={0}
              max={theirCash}
              step={100}
              value={getCash}
              onChange={(e) =>
                setGetCash(Math.max(0, Math.min(theirCash, Number(e.target.value) || 0)))
              }
            />
          </label>
        </div>
      </div>
      <button
        type="button"
        className="btn btn--small btn--primary"
        disabled={busy || empty}
        onClick={() =>
          void send({
            type: 'TRADE_PROPOSE',
            to,
            give: { cash: giveCash, assets: give },
            get: { cash: getCash, assets: get },
          }).then(onDone)
        }
      >
        {f('sendOffer')}
      </button>
    </div>
  );
}

function TradeOffer({
  view,
  label,
  send,
  busy,
}: {
  view: BusinessView;
  label(seat: number): string;
  send: Send;
  busy: boolean;
}) {
  const t = view.trade!;
  const describe = (o: { cash: number; assets: number[] }) => {
    const parts = o.assets.map((i) => spaceName(i));
    if (o.cash > 0) parts.push(rupees(o.cash));
    return parts.length > 0 ? parts.join(', ') : f('nothing');
  };
  return (
    <div className="bz-offer" role="dialog" aria-label={f('offerFrom', { name: label(t.from) })}>
      <p className="bz-tray__q">{f('offerFrom', { name: label(t.from) })}</p>
      <p className="bz-offer__line">
        {f('gives', { name: label(t.from) })}: <strong>{describe(t.give)}</strong> {f('wants')}{' '}
        <strong>{describe(t.get)}</strong>
      </p>
      <div className="bz-tray__row">
        <button
          type="button"
          className="btn btn--primary"
          disabled={busy}
          onClick={() => void send({ type: 'TRADE_ANSWER', accept: true })}
        >
          {f('accept')}
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          disabled={busy}
          onClick={() => void send({ type: 'TRADE_ANSWER', accept: false })}
        >
          {f('decline')}
        </button>
      </div>
    </div>
  );
}

function RaisePanel({
  view,
  me,
  send,
  busy,
}: {
  view: BusinessView;
  me: number;
  send: Send;
  busy: boolean;
}) {
  const r = view.raise!;
  const p = view.players[me]!;
  const e = view.economy;
  const mine = ASSET_SPACES.filter((i) => view.owner[i] === me);
  const borrow = view.canBorrow[me] ?? 0;
  return (
    <div
      className="bz-raise"
      role="alertdialog"
      aria-label={f('raiseTitle', { amount: rupees(r.total) })}
    >
      <p className="bz-tray__q">{f('raiseTitle', { amount: rupees(r.total) })}</p>
      <p className="bz-sheet__hint">
        {f('raiseHave', { cash: rupees(p.cash) })} · {f('raiseHint')}
      </p>
      <div className="bz-tray__row bz-tray__row--wrap">
        {borrow >= e.loanStep && (
          <button
            type="button"
            className="btn btn--small btn--primary"
            disabled={busy}
            onClick={() =>
              void send({
                type: 'LOAN',
                amount: Math.min(borrow, Math.ceil((r.total - p.cash) / e.loanStep) * e.loanStep),
              })
            }
          >
            {f('borrow', {
              amount: rupees(
                Math.min(borrow, Math.ceil((r.total - p.cash) / e.loanStep) * e.loanStep),
              ),
            })}
          </button>
        )}
        {mine
          .filter((i) => (view.level[i] ?? 0) > 0)
          .map((i) => (
            <button
              key={`b${i}`}
              type="button"
              className="btn btn--small bz-chipbtn"
              disabled={busy}
              onClick={() => void send({ type: 'SELL_BUILDING', space: i })}
            >
              {f('sellBuilding', {
                place: spaceName(i),
                value: rupees(
                  Math.round((buildCost(i, (view.level[i] ?? 1) - 1, e) * e.sellBack) / 10) * 10,
                ),
              })}
            </button>
          ))}
        {mine.map((i) => (
          <button
            key={`a${i}`}
            type="button"
            className="btn btn--small bz-chipbtn"
            disabled={busy}
            onClick={() => void send({ type: 'SELL_ASSET', space: i })}
          >
            {f('sellAsset', {
              place: spaceName(i),
              value: rupees(
                Math.round(
                  ((priceOf(i, e) + buildingsValue(i, view.level[i] ?? 0, e)) * e.sellBack) / 10,
                ) * 10,
              ),
            })}
          </button>
        ))}
        {view.auctionsThisTurn === 0 &&
          mine
            .filter((i) => (view.lockedUntil[i] ?? 0) <= view.round)
            .map((i) => (
              <button
                key={`u${i}`}
                type="button"
                className="btn btn--small btn--cyan"
                disabled={busy}
                onClick={() => void send({ type: 'AUCTION_START', space: i })}
              >
                {f('startAuction', { place: spaceName(i) })}
              </button>
            ))}
        <button
          type="button"
          className="btn btn--small btn--ghost"
          disabled={busy}
          onClick={() => void send({ type: 'BANK_HANDLES_IT' })}
        >
          {f('bankHandles')}
        </button>
      </div>
    </div>
  );
}

// ───────────────────────────── log ─────────────────────────────

export function logLine(e: LogEntry, label: (seat: number) => string, economy: Economy): string {
  const name = (seat: number) => label(seat);
  switch (e.type) {
    case 'ROLLED':
      return f('log.ROLLED', {
        name: name(e.seat),
        a: e.dice[0] ?? 0,
        b: e.dice[1] ?? 0,
        place: spaceName(e.to),
      });
    case 'SALARY':
      return f('log.SALARY', { name: name(e.seat), amount: rupees(e.amount) });
    case 'BOUGHT':
      return f('log.BOUGHT', {
        name: name(e.seat),
        place: spaceName(e.space),
        amount: rupees(e.price),
      });
    case 'BUILT':
      return f(e.cost > 0 ? 'log.BUILT' : 'log.BUILT_FREE', {
        name: name(e.seat),
        what: e.level === HOTEL ? f('hotel') : f('house'),
        place: spaceName(e.space),
      });
    case 'PAID': {
      const base =
        e.to === null
          ? f('log.PAID_BANK', { name: name(e.from), amount: rupees(e.amount) })
          : f('log.PAID', { name: name(e.from), amount: rupees(e.amount), to: name(e.to) });
      return e.writtenOff > 0
        ? base + f('log.WRITTEN_OFF', { amount: rupees(e.writtenOff) })
        : base;
    }
    case 'GAINED':
      return f('log.GAINED', { name: name(e.seat), amount: rupees(e.amount) });
    case 'EVENT':
      return f('log.EVENT', {
        name: name(e.seat),
        deck: fk(`deck.${e.deck}`),
        sum: e.sum,
        good: eventText(e.deck, e.sum, economy),
      });
    case 'RENT_WAIVED':
      return f('log.RENT_WAIVED', { name: name(e.seat), amount: rupees(e.amount) });
    case 'NO_BUY':
      return f('log.NO_BUY', { name: name(e.seat), place: spaceName(e.space) });
    case 'MOVED':
      return f('log.MOVED', { name: name(e.seat), place: spaceName(e.to) });
    case 'JAIL':
      return f(e.paid ? 'log.JAIL_PAID' : 'log.JAIL_WAIT', { name: name(e.seat) });
    case 'TURN_SKIPPED':
      return f('log.TURN_SKIPPED', { name: name(e.seat) });
    case 'DECLINED':
      return f('log.DECLINED', { name: name(e.seat), place: spaceName(e.space) });
    case 'LOAN':
      return f('log.LOAN', { name: name(e.seat), amount: rupees(e.amount) });
    case 'REPAID':
      return f('log.REPAID', { name: name(e.seat), amount: rupees(e.amount) });
    case 'SOLD':
      return f(e.what === 'building' ? 'log.SOLD_BUILDING' : 'log.SOLD_ASSET', {
        name: name(e.seat),
        place: spaceName(e.space),
        amount: rupees(e.value),
      });
    case 'AUCTION':
      return f('log.AUCTION', { name: name(e.seller), place: spaceName(e.space) });
    case 'BID':
      return f('log.BID', { name: name(e.seat), amount: rupees(e.amount) });
    case 'AUCTION_WON':
      return f('log.AUCTION_WON', {
        name: name(e.seat),
        place: spaceName(e.space),
        amount: rupees(e.amount),
      });
    case 'AUCTION_UNSOLD':
      return f('log.AUCTION_UNSOLD', { place: spaceName(e.space) });
    case 'TRADE_OFFER':
      return f('log.TRADE_OFFER', { name: name(e.from), to: name(e.to) });
    case 'TRADE_DONE':
      return f('log.TRADE_DONE', { name: name(e.from), to: name(e.to) });
    case 'TRADE_DECLINED':
      return f('log.TRADE_DECLINED', { name: name(e.from), to: name(e.to) });
    case 'INSOLVENT':
      return label(e.seat) === f('you')
        ? f('log.INSOLVENT_YOU')
        : f('log.INSOLVENT', { name: name(e.seat) });
    case 'SETTLED':
      return f('log.SETTLED', { name: name(e.seat), amount: rupees(e.repaid) });
  }
}

function Log({ view, label }: { view: BusinessView; label(seat: number): string }) {
  const recent = view.log
    .filter((e) => e.type !== 'BID')
    .slice(-6)
    .reverse();
  if (recent.length === 0) return null;
  return (
    <section className="bz-log" aria-label={f('log')}>
      <ol className="bz-log__list" aria-live="polite">
        {recent.map((e, i) => (
          <li
            key={`${view.log.length - i}`}
            className={`bz-log__item bz-log__item--${e.type.toLowerCase()}`}
          >
            {logLine(e, label, view.economy)}
          </li>
        ))}
      </ol>
    </section>
  );
}

// ───────────────────────────── ownership ─────────────────────────────

/** Does `seat` hold enough cities of the group of `space` for the ×2 group rent? */
function groupBonus(view: BusinessView, space: number, seat: number): boolean {
  const b = BOARD[space];
  if (!isCity(b)) return false;
  return (
    groupSpaces(b.group).filter((i) => view.owner[i] === seat).length >= view.economy.groupThreshold
  );
}

function OwnerChip({ owner, label }: { owner: number; label(seat: number): string }) {
  return (
    <span className="bz-owner" style={{ '--seat': seatColor(owner) } as CSSProperties}>
      {f('ownedBy', { name: label(owner) })}
    </span>
  );
}

/** "+₹1,500 · START" rising from the START corner when the pawn steps onto it. */
function PassStart({ amount, effects }: { amount: number; effects: EffectsMode }) {
  const p = spot(0);
  return (
    <motion.div
      className="bz-pass"
      style={{ left: `${p.x}%`, top: `${p.y}%` }}
      aria-hidden="true"
      initial={effects === 'reduced' ? { opacity: 1, y: 0 } : { opacity: 0, y: 0, scale: 0.6 }}
      animate={
        effects === 'reduced'
          ? { opacity: [1, 1, 0] }
          : { opacity: [0, 1, 1, 0], y: [0, -30, -50, -70], scale: [0.6, 1.15, 1, 1] }
      }
      transition={{ duration: effects === 'reduced' ? 1.2 : 1.4, ease: 'easeOut' }}
    >
      <RupeeChip size={20} />
      {f('passStart', { amount: rupees(amount) })}
    </motion.div>
  );
}

/** What the player landed on: the property, its rent, its level and their group progress. */
function LandingInfo({
  view,
  me,
  space,
  label,
}: {
  view: BusinessView;
  me: number;
  space: number;
  label(seat: number): string;
}) {
  const b = BOARD[space];
  if (!isCity(b) && !isTransport(b)) return null;
  const owner = view.owner[space];
  const lv = view.level[space] ?? 0;
  const e = view.economy;
  return (
    <div className={`bz-landing ${isCity(b) ? `bz-g-${b.group}` : 'bz-landing--transport'}`}>
      <span className="bz-landing__stripe" aria-hidden="true" />
      <span className="bz-landing__icon" aria-hidden="true">
        {isCity(b) ? <CityIcon id={b.id} size={22} /> : <TransportIcon id={b.id} size={22} />}
      </span>
      <span className="bz-landing__body">
        <span className="bz-landing__name">{spaceName(space)}</span>
        <span className="bz-landing__meta">
          {isCity(b) ? f('groupOf', { region: fk(`region.${b.group}`) }) : f('transportSection')} ·{' '}
          {f('price')} {rupees(priceOf(space, e))}
        </span>
        {owner === null || owner === undefined ? (
          <span className="bz-landing__meta">
            {isCity(b)
              ? f('rentIfOwned', { rent: rupees(cityRent(space, 0, false, e)) })
              : f('fixedRent', { amount: rupees(transportRent(space, e)) })}
          </span>
        ) : (
          <span className="bz-landing__meta">
            <OwnerChip owner={owner} label={label} />{' '}
            {isCity(b)
              ? f('levelNow', { what: levelName(lv), rent: rupees(rentFor(view, space)) })
              : f('fixedRent', { amount: rupees(transportRent(space, e)) })}
          </span>
        )}
        {isCity(b) && (
          <span className="bz-landing__meta">
            {fk(`region.${b.group}`)}:{' '}
            {f('progress', {
              n: groupSpaces(b.group).filter((i) => view.owner[i] === me).length,
              total: groupSpaces(b.group).length,
            })}
            {groupBonus(view, space, me) ? ` · ${f('rentDoubled')}` : ''}
          </span>
        )}
      </span>
    </div>
  );
}

function HoldingCard({ view, space }: { view: BusinessView; space: number }) {
  const b = BOARD[space];
  if (!isCity(b) && !isTransport(b)) return null;
  const lv = view.level[space] ?? 0;
  return (
    <div
      className={`bz-hcard ${isCity(b) ? `bz-g-${b.group}` : 'bz-hcard--transport'}`}
      data-space={space}
    >
      <span className="bz-hcard__stripe" aria-hidden="true" />
      <span className="bz-hcard__top">
        {isCity(b) ? <CityIcon id={b.id} size={16} /> : <TransportIcon id={b.id} size={16} />}
        <span className="bz-hcard__name">{spaceName(space, true)}</span>
      </span>
      <span className="bz-hcard__row">
        <span>{f('price')}</span>
        <strong>{rupees(priceOf(space, view.economy))}</strong>
      </span>
      <span className="bz-hcard__row">
        <span>{f('rentLabel')}</span>
        <strong>{rupees(rentFor(view, space))}</strong>
      </span>
      <span className="bz-hcard__build" aria-label={isCity(b) ? levelName(lv) : f('noBuildings')}>
        {isTransport(b) ? (
          <span className="bz-hcard__fixed">{f('fixedRent', { amount: '' }).trim()}</span>
        ) : lv === HOTEL ? (
          <Hotel size={18} />
        ) : lv > 0 ? (
          Array.from({ length: lv }, (_, k) => <House key={k} size={14} />)
        ) : (
          <span className="bz-hcard__fixed">{f('noBuildings')}</span>
        )}
      </span>
    </div>
  );
}

/**
 * MY PROPERTIES: the local player's cities by group (with progress towards the ×2 group
 * rent) and their transports. A side panel on wide layouts; a toggle opens it as a
 * floating panel (desktop) or a bottom sheet (phones) elsewhere.
 */
function Holdings({
  view,
  me,
  open,
  onClose,
  effects,
}: {
  view: BusinessView;
  me: number;
  open: boolean;
  onClose(): void;
  effects: EffectsMode;
}) {
  if (!view.players[me]) return null;
  const threshold = view.economy.groupThreshold;
  const transports = TRANSPORT_SPACES.filter((i) => view.owner[i] === me);
  return (
    <motion.aside
      className={`bz-holdings${open ? ' bz-holdings--open' : ''}`}
      aria-label={f('myProperties')}
      style={{ '--seat': seatColor(me) } as CSSProperties}
      initial={false}
      animate={open && effects !== 'reduced' ? { y: 0, opacity: 1 } : undefined}
    >
      <header className="bz-holdings__head">
        <span className="bz-holdings__title">{f('myProperties')}</span>
        <span className="bz-you">{f('you')}</span>
        <button
          type="button"
          className="bz-holdings__close"
          onClick={onClose}
          aria-label={f('close')}
        >
          ×
        </button>
      </header>
      {REGION_ORDER.map((g) => {
        const all = groupSpaces(g);
        const owned = all.filter((i) => view.owner[i] === me);
        const bonus = owned.length >= threshold;
        return (
          <section
            key={g}
            className={`bz-hgroup bz-g-${g}${bonus ? ' bz-hgroup--bonus' : ''}`}
            aria-label={fk(`region.${g}`)}
          >
            <h3 className="bz-hgroup__head">
              <span className="bz-hgroup__swatch" aria-hidden="true" />
              <span className="bz-hgroup__name">{fk(`region.${g}`).toUpperCase()}</span>
              <span className="bz-hgroup__count">
                {f('progress', { n: owned.length, total: all.length })}
              </span>
              {bonus ? (
                <span className="bz-hgroup__bonus">{f('rentDoubled')}</span>
              ) : owned.length > 0 ? (
                <span className="bz-hgroup__hint">
                  {f('moreForBonus', { n: threshold - owned.length })}
                </span>
              ) : null}
            </h3>
            {owned.length > 0 ? (
              <div className="bz-hcards">
                {owned.map((i) => (
                  <HoldingCard key={i} view={view} space={i} />
                ))}
              </div>
            ) : (
              <p className="bz-hgroup__none">{f('noneYet')}</p>
            )}
          </section>
        );
      })}
      <section className="bz-hgroup bz-hgroup--transport" aria-label={f('transportSection')}>
        <h3 className="bz-hgroup__head">
          <span className="bz-hgroup__swatch" aria-hidden="true" />
          <span className="bz-hgroup__name">{f('transportSection')}</span>
          <span className="bz-hgroup__count">
            {f('progress', { n: transports.length, total: TRANSPORT_SPACES.length })}
          </span>
        </h3>
        {transports.length > 0 ? (
          <div className="bz-hcards">
            {transports.map((i) => (
              <HoldingCard key={i} view={view} space={i} />
            ))}
          </div>
        ) : (
          <p className="bz-hgroup__none">{f('noneYet')}</p>
        )}
      </section>
    </motion.aside>
  );
}

export { eventOutcome };
