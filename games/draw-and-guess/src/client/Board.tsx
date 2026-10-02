import type { BoardProps, BoardReaction, EffectsMode } from '@cg/game-sdk/client';
import type { ChatMessage, SeatView } from '@cg/protocol';
import { Avatar, CountdownRing, ReactionBubble, Stamp, durationFor, seatAccent } from '@cg/ui';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import type { DrawAction, DrawEvent, DrawView, Op, RelayedOp, WordOption } from '../shared';
import { DrawCanvas, type Brush } from './DrawCanvas';
import { CheckIcon, EyeIcon, FlagIcon, PencilIcon } from './icons';
import { f } from './messages';
import { DrawingSurface } from './surface';
import { Toolbar } from './Toolbar';
import './draw-and-guess.css';

type Ev<K extends DrawEvent['type']> = Extract<DrawEvent, { type: K }>;
const find = <K extends DrawEvent['type']>(events: readonly DrawEvent[], type: K) =>
  events.find((e): e is Ev<K> => e.type === type);

/** Spring for "pop" moments in full effects; a short tween in lite. */
const pop = (effects: EffectsMode) =>
  effects === 'full'
    ? { type: 'spring' as const, stiffness: 520, damping: 16 }
    : { duration: durationFor(effects, 220, 160) / 1000 };

/** Keeps the latest non-null value on screen for `ms`, restarting whenever `key` changes. */
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

export default function DrawBoard({
  view,
  events,
  version,
  me,
  seats,
  send,
  effects,
  msUntil,
  reactions,
  stream,
  chat,
  safety,
}: BoardProps<DrawView, DrawAction, DrawEvent>) {
  const surface = useMemo(() => new DrawingSurface(), []);
  const strokes = useSyncExternalStore(surface.subscribe, surface.strokeCount, surface.strokeCount);
  const [brush, setBrush] = useState<Brush>({ tool: 'pen', colour: 0, size: 1 });
  const [choosing, setChoosing] = useState(false);
  const turn = useRef(view.turn);

  // A new turn on screen starts a fresh sheet.
  useEffect(() => {
    turn.current = view.turn;
    if (view.turn > surface.drawing.turn) {
      surface.drawing.reset(view.turn);
      surface.invalidate();
    }
  }, [view.turn, surface]);

  // Strokes arrive outside the animation director and are painted at once.
  useEffect(
    () =>
      stream.subscribe(({ chunks, reset }) => {
        const ops = chunks as RelayedOp[];
        if (reset) surface.drawing.replay(ops, turn.current);
        else for (const op of ops) surface.drawing.receive(op);
        surface.invalidate();
      }),
    [stream, surface],
  );

  const seatInfo = (seat: number): SeatView | undefined => seats.find((s) => s.seat === seat);
  const nameOf = (seat: number) => seatInfo(seat)?.displayName ?? `#${seat + 1}`;
  const iDraw = view.drawer === me;
  const canDraw = iDraw && view.phase === 'DRAWING';
  const drawer = seatInfo(view.drawer);
  const drawerIsPerson = drawer?.memberKind === 'HUMAN' && !iDraw;
  const drawingHidden = drawerIsPerson && safety.hidden.includes(drawer.memberId);
  const mine = view.guessed.find((g) => g.seat === me);

  // What happened in the update being presented.
  const youGuessed = find(events, 'YOU_GUESSED');
  const correct = useFlash(
    youGuessed ? f('correctPoints', { points: youGuessed.points }) : null,
    version,
    2200,
  );
  const close = useFlash(find(events, 'CLOSE')?.guess ?? null, version, 3500);
  const guessedNow = events.flatMap((e) => (e.type === 'GUESSED' && e.seat !== me ? [e.seat] : []));
  const announce = useFlash(
    guessedNow.length > 0
      ? guessedNow.map((s) => f('guessedIt', { name: nameOf(s) })).join(' ')
      : null,
    version,
    2500,
  );

  const sendOp = (op: Op) => stream.send(op);
  const edit = (op: Extract<Op, { op: 'undo' | 'clear' }>) => {
    surface.drawing.apply(op);
    surface.invalidate();
    sendOp(op);
  };

  const choose = async (option: number) => {
    if (choosing) return;
    setChoosing(true);
    await send({ type: 'CHOOSE', option });
    setChoosing(false);
  };

  const latestReaction = (seat: number): BoardReaction | undefined =>
    [...reactions].reverse().find((r) => r.seat === seat);

  const canvasLabel = iDraw
    ? f('yourCanvas')
    : f('drawingByWith', { name: nameOf(view.drawer), n: Math.max(strokes, view.strokes) });

  return (
    <div className="dg">
      <div className="dg-top">
        <span className="dg-round">{f('round', { round: view.round, rounds: view.rounds })}</span>
        <WordStrip view={view} iDraw={iDraw} solved={!!mine} nameOf={nameOf} effects={effects} />
        {view.phase !== 'OVER' && view.phaseMs > 0 && (
          <CountdownRing
            key={`${view.turn}-${view.phase}`}
            deadline={view.phaseEndsAt}
            totalMs={view.phaseMs}
            msUntil={msUntil}
            size={48}
          />
        )}
      </div>

      <div className="dg-stage">
        <ol className="dg-players">
          {[...seats]
            .sort((a, b) => a.seat - b.seat)
            .map((s) => {
              const guessed = view.guessed.find((g) => g.seat === s.seat);
              const delta = view.phase === 'REVEAL' ? (view.lastTurn?.deltas[s.seat] ?? 0) : 0;
              return (
                <li
                  key={s.seat}
                  className={[
                    'dg-player',
                    s.seat === me && 'dg-player--me',
                    s.seat === view.drawer && 'dg-player--drawer',
                    guessed && 'dg-player--guessed',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <ReactionBubble reaction={latestReaction(s.seat)} />
                  <Avatar
                    name={s.displayName}
                    accent={seatAccent(s.seat)}
                    size={34}
                    botLabel={s.controller === 'BOT' ? f('bot') : undefined}
                  />
                  <span className="dg-player__name">{s.displayName}</span>
                  <span className="dg-player__score">{view.scores[s.seat] ?? 0}</span>
                  <span className="dg-player__badges">
                    {s.seat === view.drawer && view.phase !== 'OVER' && (
                      <span role="img" aria-label={f('drawerBadge')}>
                        <PencilIcon />
                      </span>
                    )}
                    {guessed && (
                      <motion.span
                        role="img"
                        aria-label={f('guessedBadge')}
                        className="dg-player__check"
                        initial={effects === 'reduced' ? false : { scale: 0, rotate: -40 }}
                        animate={{ scale: 1, rotate: 0 }}
                        transition={pop(effects)}
                      >
                        <CheckIcon />
                      </motion.span>
                    )}
                  </span>
                  {delta > 0 && (
                    <motion.span
                      className="dg-player__delta"
                      initial={effects === 'full' ? { y: 18, opacity: 0, scale: 0.6 } : false}
                      animate={{ y: 0, opacity: 1, scale: 1 }}
                      transition={effects === 'full' ? { ...pop(effects), delay: 0.5 } : undefined}
                    >
                      {f('points', { n: delta })}
                    </motion.span>
                  )}
                </li>
              );
            })}
        </ol>

        <div className="dg-sheet">
          <DrawCanvas
            surface={surface}
            canDraw={canDraw}
            brush={brush}
            send={sendOp}
            label={canvasLabel}
            hidden={!!drawingHidden}
          >
            {drawingHidden && (
              <div className="dg-overlay dg-overlay--hidden">
                <p>{f('hiddenDrawing', { name: nameOf(view.drawer) })}</p>
              </div>
            )}
            {view.phase === 'CHOOSING' &&
              (iDraw ? (
                <WordCards
                  options={view.options}
                  disabled={choosing}
                  effects={effects}
                  onChoose={(i) => void choose(i)}
                />
              ) : (
                <div className="dg-overlay">
                  <Avatar name={nameOf(view.drawer)} accent={seatAccent(view.drawer)} size={56} />
                  <p className="dg-overlay__title">
                    {f('choosing', { name: nameOf(view.drawer) })}
                  </p>
                </div>
              ))}
            {view.phase === 'DRAWING' && strokes === 0 && view.strokes === 0 && !iDraw && (
              <p className="dg-hint">{f('nothingYet')}</p>
            )}
            {(view.phase === 'REVEAL' || view.phase === 'OVER') && view.lastTurn && (
              <div className="dg-overlay dg-overlay--reveal">
                <p className="dg-overlay__title">
                  {view.phase === 'OVER' ? f('matchOver') : f('theWordWas')}
                </p>
                <Stamp tone="success">{view.lastTurn.word}</Stamp>
                {view.phase === 'REVEAL' && view.lastTurn.guessed.length === 0 && (
                  <p className="dg-overlay__note">{f('nobodyGuessed')}</p>
                )}
              </div>
            )}
            <AnimatePresence>
              {correct && (
                <motion.div
                  key="correct"
                  className="dg-flash dg-flash--correct"
                  initial={effects === 'reduced' ? false : { opacity: 0, scale: 0.7 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  transition={pop(effects)}
                >
                  <Stamp tone="success">{correct}</Stamp>
                </motion.div>
              )}
            </AnimatePresence>
            <p className="dg-announce" aria-live="polite">
              {announce}
            </p>
          </DrawCanvas>

          {canDraw ? (
            <Toolbar
              brush={brush}
              onBrush={setBrush}
              canUndo={strokes > 0}
              onUndo={() => edit({ op: 'undo' })}
              onClear={() => edit({ op: 'clear' })}
            />
          ) : (
            <GuessBox
              view={view}
              iDraw={iDraw}
              solved={!!mine}
              close={close}
              effects={effects}
              messages={chat.messages}
              onSend={chat.send}
            />
          )}

          {drawerIsPerson && (view.phase === 'DRAWING' || view.phase === 'REVEAL') && (
            <div className="dg-safety">
              <button
                type="button"
                className="btn btn--small btn--ghost"
                aria-pressed={drawingHidden}
                onClick={() => safety.toggleHidden(drawer.memberId)}
              >
                <EyeIcon off={!drawingHidden} />
                {drawingHidden ? f('showDrawing') : f('hideDrawing')}
              </button>
              <button
                type="button"
                className="btn btn--small btn--ghost"
                onClick={() => {
                  if (window.confirm(f('reportConfirm', { name: drawer.displayName }))) {
                    safety.report(drawer.memberId, 'DRAWING');
                  }
                }}
              >
                <FlagIcon />
                {f('reportDrawing')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────── word ─────────────────────────────

function WordStrip({
  view,
  iDraw,
  solved,
  nameOf,
  effects,
}: {
  view: DrawView;
  iDraw: boolean;
  solved: boolean;
  nameOf(seat: number): string;
  effects: EffectsMode;
}) {
  let content;
  if (view.phase === 'CHOOSING') {
    content = (
      <span className="dg-status">
        {iDraw ? f('yourTurn') : f('choosing', { name: nameOf(view.drawer) })}
      </span>
    );
  } else if (view.phase === 'DRAWING' && view.word) {
    content = (
      <span className="dg-status">
        {iDraw ? f('draw') : <CheckIcon />}
        <strong className="dg-word">{view.word}</strong>
        {solved && <span className="sr-only">{f('youGotIt')}</span>}
      </span>
    );
  } else if (view.phase === 'DRAWING') {
    content = <Pattern pattern={view.pattern} effects={effects} />;
  } else {
    content = (
      <span className="dg-status">
        {f('theWordWas')} <strong className="dg-word">{view.lastTurn?.word ?? view.word}</strong>
      </span>
    );
  }
  return <div className="dg-wordstrip">{content}</div>;
}

/** The secret word as blanks; revealed hint letters pop in. */
function Pattern({ pattern, effects }: { pattern: string; effects: EffectsMode }) {
  const chars = [...pattern];
  const letters = chars.filter((c) => c !== ' ' && c !== '-').length;
  const spoken = chars.map((c) => (c === '_' ? f('blank') : c === ' ' ? f('space') : c)).join(' ');
  return (
    <span
      className="dg-pattern"
      role="img"
      aria-label={f('patternLabel', { n: letters, pattern: spoken })}
    >
      {chars.map((c, i) =>
        c === ' ' ? (
          <span key={`g${i}`} className="dg-pattern__gap" />
        ) : c === '_' ? (
          <span key={`b${i}`} className="dg-pattern__blank" />
        ) : c === '-' ? (
          <span key={`d${i}`} className="dg-pattern__dash">
            -
          </span>
        ) : (
          <motion.span
            key={`l${i}`}
            className="dg-pattern__letter"
            initial={
              effects === 'reduced'
                ? false
                : effects === 'full'
                  ? { scale: 1.8, rotateX: 90, opacity: 0 }
                  : { opacity: 0 }
            }
            animate={{ scale: 1, rotateX: 0, opacity: 1 }}
            transition={pop(effects)}
          >
            {c}
          </motion.span>
        ),
      )}
      <span className="dg-pattern__count" aria-hidden="true">
        {letters}
      </span>
    </span>
  );
}

const DIFFICULTY = { easy: 'easy', medium: 'medium', hard: 'hard' } as const;

function WordCards({
  options,
  disabled,
  effects,
  onChoose,
}: {
  options: readonly WordOption[];
  disabled: boolean;
  effects: EffectsMode;
  onChoose(option: number): void;
}) {
  return (
    <div className="dg-overlay dg-overlay--cards">
      <p className="dg-overlay__title">{f('pickWord')}</p>
      <div className="dg-cards">
        {options.map((o, i) => (
          <motion.button
            key={`${o.word}-${i}`}
            type="button"
            className={`dg-card dg-card--${o.difficulty}`}
            disabled={disabled}
            aria-label={f('chooseWord', { word: o.word, difficulty: f(DIFFICULTY[o.difficulty]) })}
            onClick={() => onChoose(i)}
            initial={
              effects === 'reduced'
                ? false
                : effects === 'full'
                  ? { y: 60, rotateY: 100, opacity: 0 }
                  : { opacity: 0 }
            }
            animate={{ y: 0, rotateY: 0, opacity: 1 }}
            transition={
              effects === 'full'
                ? { type: 'spring', stiffness: 380, damping: 22, delay: i * 0.09 }
                : { duration: durationFor(effects, 200, 180) / 1000 }
            }
          >
            <span className="dg-card__word">{o.word}</span>
            <span className="dg-card__level">{f(DIFFICULTY[o.difficulty])}</span>
          </motion.button>
        ))}
      </div>
    </div>
  );
}

// ───────────────────────────── guesses ─────────────────────────────

const FEED_SIZE = 5;

function GuessBox({
  view,
  iDraw,
  solved,
  close,
  effects,
  messages,
  onSend,
}: {
  view: DrawView;
  iDraw: boolean;
  solved: boolean;
  close: string | null;
  effects: EffectsMode;
  messages: readonly ChatMessage[];
  onSend(text: string): Promise<boolean>;
}) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const drawing = view.phase === 'DRAWING';
  const blocked = drawing && iDraw;
  const placeholder = blocked
    ? f('drawerNoChat')
    : drawing
      ? solved
        ? f('solvedPlaceholder')
        : f('guessPlaceholder')
      : f('chatPlaceholder');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const message = text.trim();
    if (!message || sending) return;
    setSending(true);
    const ok = await onSend(message);
    setSending(false);
    if (ok) setText('');
  };

  const recent = messages.slice(-FEED_SIZE);
  return (
    <div className="dg-guess">
      <form className="dg-guess__form" onSubmit={(e) => void submit(e)}>
        <input
          className="field__input dg-guess__input"
          value={text}
          maxLength={100}
          disabled={blocked}
          placeholder={placeholder}
          aria-label={placeholder}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => setText(e.target.value)}
        />
        <button
          type="submit"
          className="btn btn--cyan"
          disabled={blocked || sending || !text.trim()}
        >
          {drawing && !solved ? f('guess') : f('sendChat')}
        </button>
      </form>
      <AnimatePresence>
        {close && (
          <motion.p
            key={close}
            className="dg-close"
            role="status"
            initial={effects === 'reduced' ? false : { opacity: 0 }}
            animate={effects === 'full' ? { opacity: 1, x: [0, -8, 8, -5, 5, 0] } : { opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: durationFor(effects, 450, 150) / 1000 }}
          >
            {f('close', { guess: close })}
          </motion.p>
        )}
      </AnimatePresence>
      {recent.length > 0 && (
        <ol className="dg-feed" aria-label={f('recentGuesses')}>
          {recent.map((m) => (
            <li
              key={m.id}
              className={
                m.channel === 'ROOM' ? 'dg-feed__msg' : 'dg-feed__msg dg-feed__msg--solved'
              }
            >
              <span className="dg-feed__from">{m.fromName}</span>
              {m.channel !== 'ROOM' && <span className="dg-feed__lane">{f('solvedLane')}</span>}
              <span className="dg-feed__text">{m.text}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
