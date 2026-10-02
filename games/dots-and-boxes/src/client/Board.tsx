import type { BoardProps, BoardReaction } from '@cg/game-sdk/client';
import type { SeatView } from '@cg/protocol';
import {
  Avatar,
  ReactionBubble,
  RollingNumber,
  accentDeepVar,
  accentVar,
  durationFor,
  seatAccent,
} from '@cg/ui';
import { AnimatePresence, motion } from 'motion/react';
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  allEdges,
  edgeId,
  isDrawn,
  nearestFreeEdge,
  parseEdge,
  type DotsAction,
  type DotsEvent,
  type DotsView,
  type Edge,
  type EdgeId,
  type Lines,
} from '../shared';
import { f } from './messages';
import './dots-and-boxes.css';

const PAD = 0.45;
/** After this long without a move, a gentle nudge (the bot takes over later, server-side). */
const NUDGE_MS = 60_000;

const ends = (e: Edge) =>
  e.o === 'h'
    ? { x1: e.c, y1: e.r, x2: e.c + 1, y2: e.r }
    : { x1: e.c, y1: e.r, x2: e.c, y2: e.r + 1 };

const ink = (seat: number) => accentDeepVar(seatAccent(seat));
const wash = (seat: number) => accentVar(seatAccent(seat));

/** Keeps a non-null value on screen for `ms` after `key` changes (then it clears). */
function useFlash(value: string | null, key: number, ms: number): string | null {
  const [state, setState] = useState<{ key: number; value: string | null }>({ key, value: null });
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

export default function DotsBoard({
  view,
  events,
  version,
  me,
  seats,
  send,
  effects,
  msUntil,
  reactions,
}: BoardProps<DotsView, DotsAction, DotsEvent>) {
  const svgRef = useRef<SVGSVGElement>(null);
  const pressing = useRef(false);
  const [preview, setPreview] = useState<Edge | null>(null);
  const [pending, setPending] = useState<EdgeId | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const n = view.n;
  const lines: Lines = { n, h: view.h, v: view.v };
  const seatInfo = (seat: number): SeatView | undefined => seats.find((s) => s.seat === seat);
  const nameOf = (seat: number) => seatInfo(seat)?.displayName ?? `#${seat + 1}`;
  const myTurn = view.phase === 'PLAYING' && view.turn === me && seatInfo(me)?.controller !== 'BOT';
  const pendingEdge = pending ? parseEdge(pending, n) : null;
  const pendingLive = pendingEdge && !isDrawn(lines, pendingEdge) ? pendingEdge : null;
  const canDraw = myTurn && !pendingLive;

  // The inactivity nudge needs a clock only while it is your move.
  useEffect(() => {
    if (!myTurn) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [myTurn]);
  const idleFor = myTurn ? -msUntil(view.turnStartedAt) : 0;
  const nudge = myTurn && idleFor >= NUDGE_MS && now > 0;

  // What happened in the update being presented.
  const claimed = events.find(
    (e): e is Extract<DotsEvent, { type: 'BOXES_CLAIMED' }> => e.type === 'BOXES_CLAIMED',
  );
  const drawnNow = events.find(
    (e): e is Extract<DotsEvent, { type: 'EDGE_DRAWN' }> => e.type === 'EDGE_DRAWN',
  );
  const badge = useFlash(
    claimed
      ? claimed.chain >= 3
        ? f('chain', { n: claimed.chain })
        : claimed.boxes.length === 2
          ? f('double')
          : f('again')
      : null,
    version,
    1400,
  );

  const toGrid = (e: { clientX: number; clientY: number }) => {
    const ctm = svgRef.current?.getScreenCTM();
    if (!ctm) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  };
  const pick = (e: { clientX: number; clientY: number }) => {
    const p = toGrid(e);
    return p ? nearestFreeEdge(lines, p.x, p.y) : null;
  };

  const draw = async (e: Edge) => {
    const id = edgeId(e.o, e.r, e.c);
    setPreview(null);
    setPending(id);
    if (effects !== 'reduced' && typeof navigator !== 'undefined') navigator.vibrate?.(12);
    const ok = await send({ type: 'DRAW', edge: id });
    if (!ok) setPending(null);
  };

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!canDraw || e.button > 0) return;
    pressing.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    setCursor(null);
    setPreview(pick(e));
  };
  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    // Touch/pen: the preview follows the finger while it is down; mouse: hover preview.
    if (!canDraw || (!pressing.current && e.pointerType !== 'mouse')) return;
    setPreview(pick(e));
  };
  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!pressing.current) return;
    pressing.current = false;
    const target = pick(e);
    if (canDraw && target) void draw(target);
    else setPreview(null);
  };
  const onPointerLeave = () => {
    if (!pressing.current) setPreview(null);
  };

  // Keyboard: arrows move a cursor over the paper; the nearest free line is the target.
  const cursorEdge = cursor
    ? nearestFreeEdge(lines, cursor.x, cursor.y, { ambiguity: 0, maxDistance: n })
    : null;
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!canDraw) return;
    const at = cursor ?? { x: n / 2, y: n / 2 - 0.5 };
    const step = 0.5;
    const clamp = (v: number) => Math.min(n, Math.max(0, v));
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const delta = moves[e.key];
    if (delta) {
      e.preventDefault();
      setCursor({ x: clamp(at.x + delta[0]), y: clamp(at.y + delta[1]) });
      return;
    }
    if ((e.key === 'Enter' || e.key === ' ') && cursorEdge) {
      e.preventDefault();
      setCursor(null);
      void draw(cursorEdge);
    }
  };
  const describe = (e: Edge) => {
    const row = e.o === 'h' ? Math.min(e.r, n - 1) : e.r;
    const col = e.o === 'v' ? Math.min(e.c, n - 1) : e.c;
    const side =
      e.o === 'h' ? (e.r === row ? f('top') : f('bottom')) : e.c === col ? f('left') : f('right');
    return f('cursor', { side, row: row + 1, col: col + 1 });
  };

  const total = n * n;
  const claimedCount = view.boxes.filter((b) => b !== null).length;
  const latestReaction = (seat: number): BoardReaction | undefined =>
    [...reactions].reverse().find((r) => r.seat === seat);
  const best = Math.max(...view.seats.map((s) => view.scores[s] ?? 0));
  const winners =
    view.phase === 'OVER' ? view.seats.filter((s) => (view.scores[s] ?? 0) === best) : [];
  const target = preview ?? cursorEdge;
  const drawStroke = effects !== 'reduced';

  let status: string;
  if (view.phase === 'OVER') {
    status = winners.length === 1 ? f('wins', { name: nameOf(winners[0] as number) }) : f('tie');
  } else if (view.moves === 0) {
    status = view.turn === me ? f('youStart') : f('starts', { name: nameOf(view.turn) });
  } else {
    status = view.turn === me ? f('yourMove') : f('move', { name: nameOf(view.turn) });
  }

  return (
    <div className="db">
      <ol className="db-players">
        {view.seats.map((seat) => {
          const info = seatInfo(seat);
          const active = view.phase === 'PLAYING' && view.turn === seat;
          return (
            <li
              key={seat}
              className={[
                'db-player',
                active && 'db-player--active',
                seat === me && 'db-player--me',
                winners.includes(seat) && 'db-player--winner',
              ]
                .filter(Boolean)
                .join(' ')}
              style={{ '--seat': ink(seat) } as CSSProperties}
            >
              <ReactionBubble reaction={latestReaction(seat)} />
              <Avatar
                name={nameOf(seat)}
                accent={seatAccent(seat)}
                size={30}
                botLabel={info?.controller === 'BOT' ? f('bot') : undefined}
              />
              <span className="db-player__name">{seat === me ? f('you') : nameOf(seat)}</span>
              <span
                className="db-player__score"
                aria-label={f('boxCount', { n: view.scores[seat] ?? 0 })}
              >
                {effects === 'reduced' ? (
                  (view.scores[seat] ?? 0)
                ) : (
                  <RollingNumber
                    value={view.scores[seat] ?? 0}
                    durationMs={durationFor(effects, 500, 250)}
                  />
                )}
              </span>
              <AnimatePresence>
                {claimed && claimed.seat === seat && effects !== 'reduced' && (
                  <motion.span
                    key={`plus-${version}`}
                    className="db-player__plus"
                    initial={{ y: 6, opacity: 0, scale: 0.7 }}
                    animate={{ y: -14, opacity: 1, scale: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: durationFor(effects, 0.45, 0.25) }}
                  >
                    +{claimed.boxes.length}
                  </motion.span>
                )}
              </AnimatePresence>
            </li>
          );
        })}
      </ol>

      <div
        className="db-progress"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={claimedCount}
        aria-label={f('claimed', { claimed: claimedCount, total })}
      >
        <span style={{ width: `${(claimedCount / total) * 100}%` }} />
      </div>

      <div className="db-status" aria-live="polite">
        <span>{status}</span>
        <AnimatePresence>
          {badge && (
            <motion.span
              key={`badge-${badge}-${version}`}
              className="db-badge"
              style={{ '--seat': ink(claimed?.seat ?? view.turn) } as CSSProperties}
              initial={effects === 'reduced' ? false : { scale: 0.4, rotate: -8, opacity: 0 }}
              animate={{ scale: 1, rotate: -3, opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={
                effects === 'full'
                  ? { type: 'spring', stiffness: 520, damping: 14 }
                  : { duration: durationFor(effects, 0.2, 0.15) }
              }
            >
              {badge}
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      <div
        className={`db-stage${myTurn ? ' db-stage--mine' : ''}`}
        style={{ '--me': ink(me) } as CSSProperties}
        tabIndex={canDraw ? 0 : -1}
        onKeyDown={onKeyDown}
      >
        <svg
          ref={svgRef}
          className={`db-paper${canDraw ? ' db-paper--active' : ''}${view.phase === 'OVER' ? ' db-paper--over' : ''}`}
          viewBox={`${-PAD} ${-PAD} ${n + 2 * PAD} ${n + 2 * PAD}`}
          role="img"
          aria-label={f('paper', { claimed: claimedCount, total })}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            pressing.current = false;
            setPreview(null);
          }}
          onPointerLeave={onPointerLeave}
        >
          <defs>
            <pattern id="db-squares" width={0.5} height={0.5} patternUnits="userSpaceOnUse">
              <path d="M0.5 0H0V0.5" className="db-paper__square" />
            </pattern>
          </defs>
          <rect
            x={-PAD}
            y={-PAD}
            width={n + 2 * PAD}
            height={n + 2 * PAD}
            rx={0.12}
            className="db-paper__sheet"
          />
          <rect
            x={-PAD}
            y={-PAD}
            width={n + 2 * PAD}
            height={n + 2 * PAD}
            rx={0.12}
            fill="url(#db-squares)"
          />
          <line
            x1={-PAD + 0.2}
            y1={-PAD}
            x2={-PAD + 0.2}
            y2={n + PAD}
            className="db-paper__margin"
          />

          {view.boxes.map((owner, b) => {
            if (owner === null) return null;
            const r = Math.floor(b / n);
            const c = b % n;
            const win = winners.includes(owner);
            return (
              <motion.g
                key={`box-${b}`}
                className={`db-box${view.phase === 'OVER' ? (win ? ' db-box--win' : ' db-box--lose') : ''}`}
                initial={effects === 'reduced' ? false : { opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{
                  duration: durationFor(effects, 0.3, 0.18) / 1,
                  delay:
                    effects === 'full' && claimed
                      ? Math.max(0, claimed.boxes.indexOf(b)) * 0.09
                      : 0,
                }}
                style={{ transformOrigin: `${c + 0.5}px ${r + 0.5}px` }}
              >
                <rect
                  x={c + 0.07}
                  y={r + 0.07}
                  width={0.86}
                  height={0.86}
                  rx={0.06}
                  style={{ fill: wash(owner) }}
                />
                <text
                  x={c + 0.5}
                  y={r + 0.64}
                  textAnchor="middle"
                  className="db-box__initial"
                  style={{ fill: ink(owner) }}
                >
                  {[...nameOf(owner).trim()][0]?.toUpperCase() ?? '?'}
                </text>
              </motion.g>
            );
          })}

          {view.lastMove &&
            (() => {
              const e = parseEdge(view.lastMove.edge, n) as Edge;
              return (
                <line
                  {...ends(e)}
                  className="db-last"
                  style={{ stroke: ink(view.lastMove.seat) }}
                />
              );
            })()}

          {allEdges(n).map((e) => {
            const id = edgeId(e.o, e.r, e.c);
            const seat = (e.o === 'h' ? view.h : view.v)[
              e.o === 'h' ? e.r * n + e.c : e.r * (n + 1) + e.c
            ];
            if (seat === null || seat === undefined) return null;
            const fresh = drawStroke && drawnNow?.edge === id;
            return (
              <line
                key={id}
                data-edge={id}
                {...ends(e)}
                pathLength={1}
                className={`db-line${fresh ? ' db-line--fresh' : ''}${effects === 'full' ? ' db-line--wobble' : ''}`}
                style={{ stroke: ink(seat) }}
              />
            );
          })}

          {pendingLive && (
            <line {...ends(pendingLive)} className="db-pending" style={{ stroke: ink(me) }} />
          )}
          {target && canDraw && (
            <g className="db-preview" style={{ stroke: ink(me), fill: ink(me) }}>
              <line {...ends(target)} />
              <circle cx={ends(target).x1} cy={ends(target).y1} r={0.12} />
              <circle cx={ends(target).x2} cy={ends(target).y2} r={0.12} />
            </g>
          )}

          {Array.from({ length: (n + 1) * (n + 1) }, (_, i) => (
            <circle
              key={`dot-${i}`}
              cx={i % (n + 1)}
              cy={Math.floor(i / (n + 1))}
              r={0.075}
              className="db-dot"
            />
          ))}
        </svg>
        {cursorEdge && (
          <p className="sr-only" aria-live="polite">
            {describe(cursorEdge)}
          </p>
        )}
      </div>

      <p className="db-hint">
        {nudge ? (
          <strong className="db-nudge">{f('stillThere')}</strong>
        ) : canDraw ? (
          f('howTo')
        ) : (
          f('claimed', { claimed: claimedCount, total })
        )}
      </p>
    </div>
  );
}
